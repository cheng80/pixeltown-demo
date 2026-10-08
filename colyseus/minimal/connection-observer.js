import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink, lstat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { ClientState, CloseCode, Protocol } from '@colyseus/core';
import { decode } from '@colyseus/schema';
import { unpack } from 'msgpackr';

// Recovery replays at 80Hz; leave margin for SDK ping/control frames at that rate.
// A connected 8s stall can accumulate 160 moves; cap burst at the client pending limit.
export const MESSAGE_POLICY = Object.freeze({ rate: 90, burst: 240 });
const socketIdentity = Symbol('minimal diagnostic socket');
const rateLimitedSockets = new WeakSet();
export const wasRateLimited = ws => rateLimitedSockets.has(ws);
const sequence = () => ({ count: 0, min: null, max: null, first: null, last: null });
function addSequence(range, seq) {
  if (!Number.isSafeInteger(seq) || seq < 0) return;
  range.count++; range.min = Math.min(range.min ?? seq, seq); range.max = Math.max(range.max ?? seq, seq);
  range.first ??= seq; range.last = seq;
}
function moveSequence(buffer) {
  // Decode only bounded game frames, never auth/handshake data. Nothing but seq escapes.
  if (!buffer || buffer.byteLength > 8192 || (buffer[0] & 31) !== Protocol.ROOM_DATA) return;
  try {
    const it = { offset: 1 };
    if (!decode.stringCheck(buffer, it) || decode.string(buffer, it) !== 'move') return;
    const data = unpack(buffer.subarray(it.offset));
    return Number.isSafeInteger(data?.seq) && data.seq >= 0 ? data.seq : undefined;
  } catch { return; } // Colyseus retains ownership of malformed frame handling.
}

export class MessageBudget {
  constructor({ rate = MESSAGE_POLICY.rate, burst = MESSAGE_POLICY.burst, now = performance.now() } = {}) {
    if (!Number.isInteger(rate) || rate < 1 || rate > 120 || !Number.isInteger(burst) || burst < 1 || burst > 240) throw Error('Invalid minimal message budget');
    this.rate = rate; this.burst = burst; this.tokens = burst; this.at = now;
    this.total = 0; this.accepted = 0; this.rejected = 0; this.recent = []; this.seq = sequence(); this.closed = false;
  }
  take(now, seq) {
    this.tokens = Math.min(this.burst, this.tokens + Math.max(0, now - this.at) * this.rate / 1000);
    this.at = Math.max(this.at, now); this.total++; addSequence(this.seq, seq);
    while (this.recent.length && this.recent[0].at <= now - 1000) this.recent.shift();
    // No further frames enter after the first rejection, so this is bounded by burst+rate+1.
    this.recent.push({ at: now, seq });
    if (this.tokens < 1) { this.closed = true; this.rejected++; return false; }
    this.tokens--; this.accepted++; return true;
  }
  summary(now = this.at) {
    while (this.recent.length && this.recent[0].at <= now - 1000) this.recent.shift();
    const recentSeq = sequence(); for (const item of this.recent) addSequence(recentSeq, item.seq);
    return { total: this.total, accepted: this.accepted, rejected: this.rejected, lastSecond: this.recent.length,
      receivedFirstMs: this.recent[0]?.at ?? null, receivedLastMs: this.recent.at(-1)?.at ?? null, seq: { ...this.seq }, recentSeq,
      tokens: Math.round(this.tokens * 1000) / 1000, rate: this.rate, burst: this.burst };
  }
}

export function installMessagePolicy(room, observer, { now = () => performance.now(), ...policy } = {}) {
  const budgets = new WeakMap(), original = room._onMessage;
  // Replace the SDK's fixed window entirely; it must not close a permitted burst first.
  room.maxMessagesPerSecond = Infinity;
  room._onMessage = function minimalMessagePolicy(client, buffer) {
    if (client.state === ClientState.LEAVING) return;
    let budget = budgets.get(client.ref);
    if (!budget) { budget = new MessageBudget({ ...policy, now: now() }); budgets.set(client.ref, budget); }
    if (budget.closed) return;
    const accepted = budget.take(now(), moveSequence(buffer));
    observer?.message(client.ref, budget);
    if (!accepted) {
      rateLimitedSockets.add(client.ref);
      observer?.rateLimit(client.ref, budget);
      // Use the real transport close path: _onLeave/onDrop still run once on socket close.
      client.leave(CloseCode.WITH_ERROR, 'message-rate-limit');
      return;
    }
    return original.call(this, client, buffer);
  };
  return budgets;
}

export class ServerHeartbeat {
  constructor({ observer = null, intervalMs = 3000, pongTimeoutMs = 6000, writeTimeoutMs = 6000,
    now = () => performance.now(), schedule = true } = {}) {
    this.observer = observer; this.intervalMs = intervalMs; this.pongTimeoutMs = pongTimeoutMs;
    this.writeTimeoutMs = writeTimeoutMs; this.now = now; this.sockets = new Map();
    if (schedule) { this.timer = setInterval(() => this.tick(), intervalMs); this.timer.unref(); }
  }
  attach(transport) {
    this.transport = transport; this.connection = ws => this.observe(ws);
    transport.wss.prependListener('connection', this.connection); return this;
  }
  observe(ws) {
    const state = { opened: this.now(), lastPong: null, lastMove: null, validatedMoves: 0, probe: null, terminating: false };
    this.sockets.set(ws, state);
    state.onPong = () => { state.lastPong = this.now(); ws.pingCount = 0; };
    state.onClose = () => { this.sockets.delete(ws); ws.off('pong', state.onPong); };
    ws.on('pong', state.onPong); ws.once('close', state.onClose);
  }
  confirmMove(ws, receivedAt) {
    const state = this.sockets.get(ws);
    // Only the server receive timestamp for a newly acknowledged move qualifies.
    if (!state || !Number.isFinite(receivedAt) || receivedAt < state.opened || receivedAt > this.now() || receivedAt <= (state.lastMove ?? -Infinity)) return;
    state.lastMove = receivedAt; state.validatedMoves++; ws.pingCount = 0;
  }
  details(state) {
    const now = this.now();
    return { intervalMs: this.intervalMs, pongTimeoutMs: this.pongTimeoutMs, writeTimeoutMs: this.writeTimeoutMs,
      validatedMoves: state.validatedMoves, validMoveAgeMs: state.lastMove === null ? null : now - state.lastMove,
      pongAgeMs: state.lastPong === null ? null : now - state.lastPong,
      writePendingMs: state.probe?.written === null ? now - state.probe.requested : null };
  }
  end(ws, state, reason) {
    state.terminating = true;
    this.observer?.heartbeatTimeout(ws, reason, this.details(state));
    ws.terminate();
  }
  tick() {
    const now = this.now();
    for (const [ws, state] of this.sockets) {
      if (ws.readyState !== 1 || state.terminating) continue;
      if (state.probe) {
        const probe = state.probe;
        if (probe.written === null) {
          if (now - probe.requested >= this.writeTimeoutMs) this.end(ws, state, 'ping-write-timeout');
          continue;
        }
        const evidence = Math.max(state.lastPong ?? -Infinity, state.lastMove ?? -Infinity);
        // A pong may be delivered before the ping write callback runs. Correlate
        // evidence to the request, while starting the deadline on actual write.
        if (evidence < probe.requested) {
          if (now - probe.written >= this.pongTimeoutMs) this.end(ws, state, 'pong-or-valid-move-timeout');
          continue;
        }
        state.probe = null;
      }
      if (now - state.opened < this.intervalMs) continue;
      const probe = { requested: now, written: null }; state.probe = probe;
      ws.pingCount = (ws.pingCount || 0) + 1;
      this.observer?.record('heartbeat-probe', ws, { heartbeat: this.details(state) });
      try {
        ws.ping(error => {
          if (state.probe !== probe || state.terminating || !this.sockets.has(ws)) return;
          if (error) return this.end(ws, state, 'ping-write-error');
          probe.written = this.now();
        });
      } catch { this.end(ws, state, 'ping-request-error'); }
    }
  }
  close() {
    clearInterval(this.timer); this.transport?.wss.off('connection', this.connection);
    for (const [ws, state] of this.sockets) { ws.off('pong', state.onPong); ws.off('close', state.onClose); }
    this.sockets.clear();
  }
}

export class ValidatedMoveTracker {
  constructor(heartbeat, socketForSession) { this.heartbeat = heartbeat; this.socketForSession = socketForSession; this.acks = new Map(); }
  committed(players, event) {
    for (const command of event.commands) {
      if (command.type !== 'move') continue;
      const player = players.get(command.session), data = command.data;
      const previous = this.acks.get(command.session) ?? 0;
      if (player && Number.isSafeInteger(data?.seq) && data.seq > previous && data.seq <= player.ack && data.fix === player.fix) {
        const ws = this.socketForSession(command.session);
        if (ws) this.heartbeat.confirmMove(ws, command.receivedAt);
        this.acks.set(command.session, data.seq);
      }
    }
    this.acks = new Map([...players].map(([session, player]) => [session, player.ack]));
  }
}

async function safeParents(path) {
  const parent = dirname(path);
  if (parent !== path) await safeParents(parent);
  try { const stat = await lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Unsafe diagnostic directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(path, { mode: 0o700 }); }
}

// Async bounded queue: diagnostic disk stalls must not stall heartbeat/game input.
export class RotatingConnectionLog {
  constructor(path, { maxBytes = 4 * 1024 * 1024, files = 4, maxQueue = 1024 } = {}) {
    if (!Number.isInteger(maxBytes) || maxBytes < 4096 || maxBytes > 64 * 1024 * 1024 || !Number.isInteger(files) || files < 1 || files > 8 || !Number.isInteger(maxQueue) || maxQueue < 1 || maxQueue > 1024) throw Error('Invalid diagnostic log bounds');
    this.path = resolve(path); this.maxBytes = maxBytes; this.files = files; this.maxQueue = maxQueue;
    this.queue = []; this.pending = null; this.dropped = 0; this.errors = 0; this.closing = false;
  }
  write(record) {
    if (this.closing) return;
    const line = JSON.stringify(record) + '\n';
    if (Buffer.byteLength(line) > 4096 || this.queue.length >= this.maxQueue) { this.dropped++; return; }
    this.queue.push(line);
    this.start();
  }
  start() {
    if (!this.pending && this.queue.length) this.pending = this.drain().finally(() => { this.pending = null; this.start(); });
  }
  async drain() {
    let handle, currentLine = null;
    try {
      await safeParents(dirname(this.path));
      const connect = async () => {
        handle = await open(this.path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        const stat = await handle.stat(); if (!stat.isFile()) throw Error('Diagnostic log must be a regular file');
        await handle.chmod(0o600); return stat.size;
      };
      let size = await connect();
      while (this.queue.length) {
        const line = this.queue.shift(), bytes = Buffer.byteLength(line); currentLine = line;
        if (size + bytes > this.maxBytes) {
          await handle.close(); handle = null;
          for (let index = this.files - 1; index >= 0; index--) {
            const from = index === 0 ? this.path : `${this.path}.${index}`;
            try { if (index === this.files - 1) await unlink(from); else await rename(from, `${this.path}.${index + 1}`); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
          size = await connect();
        }
        await handle.writeFile(line); size += bytes; currentLine = null;
      }
    } catch { this.errors++; this.dropped += this.queue.length + (currentLine === null ? 0 : 1); this.queue.length = 0; }
    finally { await handle?.close().catch(() => {}); }
  }
  async close() { this.closing = true; while (this.pending) await this.pending; }
  status() { return { dropped: this.dropped, errors: this.errors, queued: this.queue.length }; }
}

function caller(stack) {
  const frames = String(stack).split('\n').slice(2).map(line => {
    const match = line.match(/[/\\](WebSocketTransport\.mjs|WebSocketClient\.mjs|Room\.mjs|RoomMessages\.mjs|server\.js|websocket\.js|connection-observer\.js|connection[^/\\]*\.test\.js):(\d+):(\d+)/);
    return match ? `${basename(match[1])}:${match[2]}:${match[3]}` : null;
  }).filter(Boolean).slice(0, 4);
  return { caller: stack.includes('ServerHeartbeat.') ? 'minimal-server-heartbeat' : stack.includes('autoTerminateUnresponsiveClients') ? 'transport-heartbeat' : frames.some(f => f.startsWith('Room')) ? 'colyseus-room' : frames.some(f => f.startsWith('WebSocketTransport')) ? 'colyseus-transport' : 'other', callerFrames: frames };
}
function queueState(ws) {
  return { bufferedAmount: Number(ws.bufferedAmount) || 0, senderBytes: Number(ws._sender?._bufferedBytes) || 0,
    senderQueue: ws._sender?._queue?.length || 0, senderState: Number(ws._sender?._state) || 0,
    writableBytes: Number(ws._socket?.writableLength) || 0, pingCount: Number(ws.pingCount) || 0 };
}
function closeReason(code, reason) {
  // Arbitrary peer close reasons can contain credentials; retain only known categories.
  if (String(reason) === 'message-rate-limit') return 'message-rate-limit';
  if (code === 1001 && String(reason).includes('CloudFlare WebSocket proxy restarting')) return 'proxy-restart';
  return reason?.length ? 'redacted' : 'empty';
}

export class ConnectionObserver {
  constructor({ sink, maxSockets = 256, maxRecordsPerSecond = 1000, now = () => performance.now(), wall = () => Date.now(), sample = true } = {}) {
    this.sink = sink; this.now = now; this.wall = wall; this.maxSockets = maxSockets; this.maxRecordsPerSecond = maxRecordsPerSecond;
    this.sockets = new Map(); this.retired = new WeakMap(); this.prefix = randomBytes(6).toString('hex'); this.nextId = 0; this.dropped = 0;
    this.window = 0; this.records = 0; this.loop = { maxMs: 0, meanMs: 0, p99Ms: 0, driftMs: 0 };
    if (sample) {
      this.histogram = monitorEventLoopDelay({ resolution: 20 }); this.histogram.enable();
      let previous = now();
      this.timer = setInterval(() => {
        const at = now(), h = this.histogram;
        this.loop = { maxMs: h.max / 1e6, meanMs: Number.isFinite(h.mean) ? h.mean / 1e6 : 0, p99Ms: h.percentile(99) / 1e6, driftMs: Math.max(0, at - previous - 1000) };
        previous = at; h.reset();
        for (const [ws, state] of this.sockets) {
          this.rollSecond(ws, state);
          this.record('sample', ws, { second: state.second, secondMessages: state.secondMessages, secondSeq: { ...state.secondSeq } });
        }
      }, 1000); this.timer.unref();
    }
  }
  attach(transport) {
    this.transport = transport;
    this.headers = (headers, req) => {
      req[socketIdentity] = `${this.prefix}-${++this.nextId}`;
      headers.push(`X-Minimal-Socket-Id: ${req[socketIdentity]}`);
    };
    this.connection = (ws, req) => this.observe(ws, req?.[socketIdentity]);
    transport.wss.on('headers', this.headers);
    transport.wss.prependListener('connection', this.connection);
    return this;
  }
  observe(ws, id) {
    if (this.sockets.has(ws)) return;
    if (this.sockets.size >= this.maxSockets) { this.dropped++; return; }
    // Generate identity locally; never derive it from URL, auth, user/session IDs or headers.
    const socketId = typeof id === 'string' && /^[a-f0-9]{12}-\d{1,10}$/.test(id) ? id : `${this.prefix}-${++this.nextId}`;
    const state = { socketId, ping: 0, pong: 0, lastPingAt: null, lastPongAt: null, budget: null,
      second: Math.floor(this.wall() / 1000), secondMessages: 0, secondSeq: sequence(), closing: null };
    this.sockets.set(ws, state);
    const observer = this, ping = ws.ping, close = ws.close, terminate = ws.terminate;
    ws.ping = function diagnosticPing(data, mask, cb) {
      if (typeof data === 'function') { cb = data; data = mask = undefined; }
      else if (typeof mask === 'function') { cb = mask; mask = undefined; }
      const pingId = ++state.ping, requestedAt = observer.now(); state.lastPingAt = requestedAt;
      observer.record('ping-requested', ws, { pingId });
      return ping.call(this, data, mask, function diagnosticPingWritten(error) {
        observer.record('ping-write-complete', ws, { pingId, writeMs: observer.now() - requestedAt, writeFailed: !!error });
        cb?.apply(this, arguments);
      });
    };
    ws.close = function diagnosticClose(code, reason) {
      state.closing ??= { ...caller(new Error().stack), code: Number.isInteger(code) ? code : null, reason: closeReason(code, reason) };
      observer.record('close-requested', ws, state.closing);
      return close.apply(this, arguments);
    };
    ws.terminate = function diagnosticTerminate() {
      state.closing ??= { ...caller(new Error().stack), code: 1006, reason: 'terminate' };
      observer.record('terminate-requested', ws, state.closing);
      return terminate.apply(this, arguments);
    };
    state.onPong = () => { state.pong++; state.lastPongAt = observer.now(); observer.record('pong-received', ws); };
    state.onClose = (code, reason) => {
      observer.record('closed', ws, { ...(state.closing || { caller: 'peer-or-network', callerFrames: [] }), code,
        reason: state.closing?.reason ?? closeReason(code, reason), peerReason: closeReason(code, reason) });
      observer.retired.set(ws, state); observer.sockets.delete(ws); ws.off('pong', state.onPong);
      ws.ping = ping; ws.close = close; ws.terminate = terminate;
    };
    ws.on('pong', state.onPong); ws.once('close', state.onClose);
    this.record('opened', ws);
  }
  message(ws, budget) {
    const state = this.sockets.get(ws); if (!state) return;
    state.budget = budget;
    this.rollSecond(ws, state);
    state.secondMessages++; addSequence(state.secondSeq, budget.recent.at(-1)?.seq);
  }
  rollSecond(ws, state) {
    const second = Math.floor(this.wall() / 1000);
    if (state.second !== second) {
      this.record('messages-second', ws, { second: state.second, secondMessages: state.secondMessages, secondSeq: { ...state.secondSeq } });
      state.second = second; state.secondMessages = 0; state.secondSeq = sequence();
    }
  }
  rateLimit(ws, budget) {
    const state = this.sockets.get(ws); if (!state) return;
    state.budget = budget; state.closing = { caller: 'minimal-message-token-bucket', callerFrames: caller(new Error().stack).callerFrames, code: CloseCode.WITH_ERROR, reason: 'message-rate-limit' };
    this.record('rate-limit', ws, state.closing);
  }
  heartbeatTimeout(ws, reason, heartbeat) {
    const state = this.sockets.get(ws); if (!state) return;
    state.closing = { caller: 'minimal-server-heartbeat', callerFrames: caller(new Error().stack).callerFrames, code: 1006, reason };
    this.record('heartbeat-timeout', ws, { ...state.closing, heartbeat });
  }
  record(event, ws, fields = {}) {
    const state = this.sockets.get(ws) || this.retired.get(ws); if (!state) return;
    const second = Math.floor(this.now() / 1000);
    if (second !== this.window) { this.window = second; this.records = 0; }
    if (++this.records > this.maxRecordsPerSecond) { this.dropped++; return; }
    const at = this.now();
    const record = { schema: 1, event, at: this.wall(), monotonicMs: at, socketId: state.socketId,
      pingRequested: state.ping, pongReceived: state.pong, pingAgeMs: state.lastPingAt === null ? null : at - state.lastPingAt,
      pongAgeMs: state.lastPongAt === null ? null : at - state.lastPongAt, queue: queueState(ws), eventLoop: { ...this.loop },
      messages: state.budget?.summary(at) || null, ...fields };
    try { this.sink.write(record); } catch { this.dropped++; }
  }
  status() {
    const log = this.sink.status?.() || {};
    return { enabled: true, tracked: this.sockets.size, observerDropped: this.dropped,
      logDropped: log.dropped || 0, logErrors: log.errors || 0, logQueued: log.queued || 0 };
  }
  lifecycle(event, client, player, held, code = null) {
    if (!['join', 'drop', 'reconnect', 'reconnect-expired', 'leave'].includes(event)) return;
    // Only numeric state confirmation; no player ID, name, position, score or token.
    this.record(event, client.ref, { ack: Number.isSafeInteger(player?.ack) ? player.ack : null,
      fix: Number.isSafeInteger(player?.fix) ? player.fix : null, held: !!held, code: Number.isInteger(code) ? code : null });
  }
  async close() {
    clearInterval(this.timer); this.histogram?.disable();
    this.transport?.wss.off('headers', this.headers); this.transport?.wss.off('connection', this.connection);
    await this.sink.close?.();
  }
}

export function connectionObserverFromEnv(stateDir, env = process.env) {
  if (env.MINIMAL_CONNECTION_OBSERVER !== '1') return null;
  const path = resolve(env.MINIMAL_CONNECTION_LOG_PATH || resolve(stateDir, 'diagnostics/connections.jsonl'));
  const rel = relative(resolve(stateDir), path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Diagnostic log must be within MINIMAL_STATE_DIR');
  const maxBytes = Number(env.MINIMAL_CONNECTION_LOG_MAX_BYTES || 4 * 1024 * 1024);
  const files = Number(env.MINIMAL_CONNECTION_LOG_FILES || 4);
  return new ConnectionObserver({ sink: new RotatingConnectionLog(path, { maxBytes, files }) });
}
