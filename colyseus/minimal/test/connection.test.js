import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, realpathSync, readFileSync, readdirSync, statSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ClientState, Protocol, getMessageBytes } from '@colyseus/core';
import { MessageBudget, installMessagePolicy, RotatingConnectionLog, ConnectionObserver,
  connectionObserverFromEnv, ServerHeartbeat, ValidatedMoveTracker, wasRateLimited } from '../connection-observer.js';
import { WorkerHost } from '../worker-host.js';

// Use ws rather than Node's browser-compatible socket so TCP termination is real.
const nativeWebSocket = globalThis.WebSocket;
globalThis.WebSocket = WebSocket;
const { Client } = await import('@colyseus/sdk');
globalThis.WebSocket = nativeWebSocket;

const frame = seq => getMessageBytes.raw(Protocol.ROOM_DATA, 'move', { seq, fix: 0, x: 32, y: 320 });
async function until(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() >= deadline) throw Error('Condition timed out'); await pause(10); }
}
const memorySink = () => ({ records: [], write(record) { this.records.push(record); } });
class FakeSocket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; }
  ping(data, mask, cb) { (typeof data === 'function' ? data : cb)?.(); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; this.emit('close', code, reason); }
  terminate() { this.terminated = true; this.readyState = 3; this.emit('close', 1006, ''); }
}

test('20Hz input, 3s/8s delayed bursts and bounded 80Hz recovery replay fit; sustained abuse and excess burst close', () => {
  const budget = new MessageBudget({ now: 0 });
  for (let i = 1; i <= 200; i++) assert(budget.take(i * 50, i));
  for (let i = 201; i <= 260; i++) assert(budget.take(13000, i));
  for (let i = 261; i <= 500; i++) assert(budget.take(13000 + (i - 260) * 12.5, i), '80Hz replay must fit');
  for (let i = 501; i <= 660; i++) assert(budget.take(24000, i), '8s normal input stall must fit');
  const abuse = new MessageBudget({ now: 0 });
  let accepted = 0; while (abuse.take(accepted * 5, accepted + 1)) accepted++;
  assert(accepted < 500); assert.equal(abuse.summary().rejected, 1); assert(abuse.recent.length <= 331);
  const instant = new MessageBudget({ now: 0 });
  for (let i = 1; i <= 240; i++) assert(instant.take(0, i));
  assert.equal(instant.take(0, 241), false);
  assert.deepEqual(instant.summary().recentSeq, { count: 241, min: 1, max: 241, first: 1, last: 241 });
  assert.equal(instant.summary(1001).lastSecond, 0);
});

test('raw room frame policy counts first frame and unknown messages, logs real 4002 caller and rejects once', () => {
  let now = 1000; const sink = memorySink();
  const observer = new ConnectionObserver({ sink, sample: false, now: () => now });
  const ws = new FakeSocket(); observer.observe(ws);
  let handled = 0, closes = 0;
  const room = { _onMessage() { handled++; } };
  installMessagePolicy(room, observer, { now: () => now });
  const client = { ref: ws, state: ClientState.JOINED, leave(code, reason) { closes++; ws.close(code, reason); } };
  assert.equal(room.maxMessagesPerSecond, Infinity);
  for (let seq = 1; seq <= 260; seq++) room._onMessage(client, frame(seq));
  assert.equal(handled, 240); assert.equal(closes, 1); assert.equal(ws.closed.code, 4002);
  assert(wasRateLimited(ws)); assert.equal(wasRateLimited(new FakeSocket()), false);
  const rejected = sink.records.find(record => record.event === 'rate-limit');
  assert.equal(rejected.caller, 'minimal-message-token-bucket');
  assert.equal(rejected.messages.total, 241); assert.equal(rejected.messages.lastSecond, 241);
  assert.equal(rejected.messages.accepted, 240); assert.equal(rejected.messages.rejected, 1);
  assert.equal(rejected.messages.seq.max, 241);
  const closed = sink.records.find(record => record.event === 'closed');
  assert.equal(closed.caller, rejected.caller); assert.equal(closed.reason, 'message-rate-limit');
  const unknown = { _onMessage() {} }; installMessagePolicy(unknown, null, { now: () => now });
  const other = { ref: new FakeSocket(), state: ClientState.JOINED, leave(code) { this.code = code; } };
  for (let i = 0; i < 241; i++) unknown._onMessage(other, Buffer.from([Protocol.PING]));
  assert.equal(other.code, 4002);
});

test('heartbeat starts pong deadline only on write completion and separately bounds sender stalls', () => {
  let now = 0; const sink = memorySink(), observer = new ConnectionObserver({ sink, sample: false, now: () => now });
  const heartbeat = new ServerHeartbeat({ observer, schedule: false, now: () => now });
  const ws = new FakeSocket(); let write;
  ws.ping = (_data, _mask, cb) => { write = cb; }; observer.observe(ws); heartbeat.observe(ws);
  now = 3000; heartbeat.tick(); now = 8999; heartbeat.tick(); assert(!ws.terminated);
  write(); now = 12000; heartbeat.tick(); assert(!ws.terminated);
  now = 14999; heartbeat.tick(); assert(ws.terminated);
  assert.equal(sink.records.find(record => record.event === 'heartbeat-timeout').reason, 'pong-or-valid-move-timeout');
  assert.equal(sink.records.find(record => record.event === 'ping-write-complete').writeMs, 5999);
  const stalled = new FakeSocket(); stalled.ping = () => {}; heartbeat.observe(stalled); observer.observe(stalled);
  now = 18000; heartbeat.tick(); now = 24000; heartbeat.tick(); assert(stalled.terminated);
  assert.equal(sink.records.filter(record => record.event === 'heartbeat-timeout').at(-1).reason, 'ping-write-timeout');
  heartbeat.close();
});

test('pong received before delayed write completion satisfies its probe without false idle termination', () => {
  let now = 0, write;
  const ws = new FakeSocket(); ws.ping = cb => { write = cb; };
  const heartbeat = new ServerHeartbeat({ schedule: false, now: () => now }); heartbeat.observe(ws);
  now = 3000; heartbeat.tick(); now = 3100; ws.emit('pong'); now = 4000; write();
  now = 10000; heartbeat.tick(); assert(!ws.terminated); assert.equal(heartbeat.sockets.get(ws).probe.requested, 10000);
  heartbeat.close();
});

test('only newly worker-acknowledged input refreshes liveness; duplicate, teleport and wrong fix do not', async t => {
  let now = 0; const heartbeat = new ServerHeartbeat({ schedule: false, now: () => now }), ws = new FakeSocket();
  heartbeat.observe(ws); t.after(() => heartbeat.close());
  const game = new WorkerHost({ settle() {} }); t.after(() => game.close()); await game.ready;
  const tracker = new ValidatedMoveTracker(heartbeat, () => ws);
  game.on('state', (_snapshot, event) => tracker.committed(game.players, event));
  await game.dispatch([{ type: 'join', session: 'a', data: { id: 'u', name: 'private' }, now: 1000 }]);
  now = 3000; heartbeat.tick();
  now = 4000;
  const move = { type: 'move', session: 'a', data: { x: 36, y: 320, seq: 1, fix: 0 }, now: 2000, receivedAt: now };
  await game.dispatch([move]); assert.equal(heartbeat.sockets.get(ws).validatedMoves, 1);
  now = 5000; await game.dispatch([{ ...move, receivedAt: now }]);
  now = 6000; await game.dispatch([{ ...move, data: { x: 320, y: 180, seq: 2, fix: 0 }, receivedAt: now }]);
  now = 7000; await game.dispatch([{ ...move, data: { x: 40, y: 320, seq: 3, fix: 0 }, receivedAt: now }]);
  assert.equal(heartbeat.sockets.get(ws).validatedMoves, 1);
  assert.equal(game.players.get('a').ack, 1); assert.equal(game.players.get('a').fix, 1);
  heartbeat.tick(); now = 13000; heartbeat.tick(); assert(ws.terminated);
});

async function sockets(t, { autoPong = true, compression = false, heartbeat = false } = {}) {
  const sink = memorySink(), observer = new ConnectionObserver({ sink, sample: false });
  const transport = new WebSocketTransport({ server: http.createServer(), pingInterval: 0, perMessageDeflate: compression });
  observer.attach(transport);
  const hb = heartbeat ? new ServerHeartbeat({ observer, intervalMs: 20, pongTimeoutMs: 100, writeTimeoutMs: 100 }).attach(transport) : null;
  transport.listen(0, '127.0.0.1'); await once(transport.server, 'listening');
  const ws = new WebSocket(`ws://127.0.0.1:${transport.server.address().port}/`, { autoPong, perMessageDeflate: compression });
  let socketId; ws.on('upgrade', response => { socketId = response.headers['x-minimal-socket-id']; });
  await once(ws, 'open');
  const raw = [...transport.wss.clients][0];
  t.after(async () => {
    hb?.close(); ws.terminate(); for (const client of transport.wss.clients) client.terminate();
    await new Promise(resolve => transport.wss.close(resolve));
    await new Promise(resolve => transport.server.close(resolve)); await observer.close();
  });
  return { ws, raw, sink, observer, hb, socketId };
}

test('real WebSocket ping request/write/pong share sanitized upgrade socket ID and preserve callback', async t => {
  const { ws, raw, sink, socketId } = await sockets(t, { compression: true });
  assert.match(socketId, /^[a-f0-9]{12}-\d+$/);
  const payload = Buffer.alloc(1024 * 1024, 'a');
  raw.send(payload, { compress: true });
  let callbacks = 0; raw.ping('probe', () => callbacks++);
  await until(() => sink.records.some(record => record.event === 'pong-received'));
  assert.equal(callbacks, 1);
  const requested = sink.records.find(record => record.event === 'ping-requested');
  assert(requested.queue.senderBytes > 0 || requested.queue.senderState > 0, 'compression must be queued');
  const complete = sink.records.find(record => record.event === 'ping-write-complete');
  assert.equal(complete.writeFailed, false); assert(complete.writeMs >= 0);
  assert(sink.records.every(record => record.socketId === socketId));
  assert('p99Ms' in requested.eventLoop);
  ws.close(1000, 'secret-token private-pb-name');
  await until(() => sink.records.some(record => record.event === 'closed'));
  assert(!JSON.stringify(sink.records).includes('secret-token'));
  assert(!JSON.stringify(sink.records).includes('private-pb-name'));
});

test('real suppressed-pong socket stays alive with verified moves, then closes while idle with actual caller', async t => {
  const { ws, raw, hb, sink } = await sockets(t, { autoPong: false, heartbeat: true });
  const moves = setInterval(() => hb.confirmMove(raw, performance.now()), 25);
  t.after(() => clearInterval(moves));
  await pause(280); assert.equal(ws.readyState, WebSocket.OPEN);
  assert(sink.records.some(record => record.event === 'ping-write-complete'));
  assert(!sink.records.some(record => record.event === 'pong-received'));
  clearInterval(moves);
  await until(() => sink.records.some(record => record.event === 'closed'));
  const closed = sink.records.find(record => record.event === 'closed');
  assert.equal(closed.code, 1006); assert.equal(closed.caller, 'minimal-server-heartbeat');
  assert.equal(closed.reason, 'pong-or-valid-move-timeout'); assert.equal(closed.peerReason, 'empty');
  const timeout = sink.records.find(record => record.event === 'heartbeat-timeout');
  assert.equal(timeout.reason, 'pong-or-valid-move-timeout'); assert(timeout.heartbeat.validatedMoves >= 4);
});

test('real idle suppressed-pong socket terminates without accepting raw incoming frames as evidence', async t => {
  const { ws, sink } = await sockets(t, { autoPong: false, heartbeat: true });
  const spam = setInterval(() => { if (ws.readyState === 1) ws.send(Buffer.from([Protocol.PING])); }, 10);
  t.after(() => clearInterval(spam));
  await until(() => sink.records.some(record => record.event === 'closed'));
  assert.equal(sink.records.find(record => record.event === 'heartbeat-timeout').heartbeat.validatedMoves, 0);
  assert.equal(sink.records.find(record => record.event === 'closed').caller, 'minimal-server-heartbeat');
});

test('observer caps sockets and records, redacts arbitrary close reasons and keeps per-second sequence aggregates', () => {
  let at = 1000; const sink = memorySink();
  const observer = new ConnectionObserver({ sink, sample: false, maxSockets: 1, maxRecordsPerSecond: 6, now: () => at, wall: () => at });
  const ws = new FakeSocket(); observer.observe(ws, '_authToken=secret'); observer.observe(new FakeSocket());
  const budget = new MessageBudget({ now: at });
  for (let seq = 1; seq <= 3; seq++) { budget.take(at, seq); observer.message(ws, budget); }
  at = 2000; budget.take(at, 4); observer.message(ws, budget);
  const second = sink.records.find(record => record.event === 'messages-second');
  assert.equal(second.secondMessages, 3); assert.equal(second.secondSeq.max, 3);
  for (let i = 0; i < 10; i++) observer.record('sample', ws);
  assert(observer.dropped > 1); assert(sink.records.length <= 7);
  assert(!JSON.stringify(sink.records).includes('secret'));
  sink.status = () => ({ dropped: 2, errors: 3, queued: 4 });
  assert.deepEqual(observer.status(), { enabled: true, tracked: 1, observerDropped: observer.dropped, logDropped: 2, logErrors: 3, logQueued: 4 });
});

test('opt-in logs rotate within fixed storage bounds with private modes and reject unsafe paths/symlinks', async t => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'minimal-connections-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(connectionObserverFromEnv(dir, {}), null);
  assert.throws(() => connectionObserverFromEnv(dir, { MINIMAL_CONNECTION_OBSERVER: '1', MINIMAL_CONNECTION_LOG_PATH: resolve(dir, '../outside') }));
  const path = join(dir, 'logs/connections.jsonl'), log = new RotatingConnectionLog(path, { maxBytes: 4096, files: 3 });
  for (let i = 0; i < 90; i++) log.write({ event: 'sample', index: i, bounded: 'a'.repeat(200) });
  await log.close(); assert.equal(log.status().errors, 0);
  const files = readdirSync(join(dir, 'logs')); assert.equal(files.length, 3);
  for (const name of files) {
    const file = join(dir, 'logs', name); assert(statSync(file).size <= 4096); assert.equal(statSync(file).mode & 0o777, 0o600);
    for (const line of readFileSync(file, 'utf8').trim().split('\n')) assert.equal(JSON.parse(line).event, 'sample');
  }
  const target = join(dir, 'target'); const link = join(dir, 'linked'); symlinkSync(path, link);
  const unsafe = new RotatingConnectionLog(link); unsafe.write({ event: 'sample' }); await unsafe.close();
  assert.equal(unsafe.status().errors, 1); assert.equal(unsafe.status().dropped, 1); assert.equal(readdirSync(dir).includes('target'), false);
  const bounded = new RotatingConnectionLog(target, { maxQueue: 1 });
  bounded.write({ event: 'sample' }); bounded.write({ event: 'sample' }); await bounded.close(); assert.equal(bounded.status().dropped, 1);
});

test('actual minimal server allows stale live-socket and TCP-drop same-session recovery but denies flagged abuse', async t => {
  const dir = mkdtempSync(join(process.cwd(), '.test-work/minimal-connection-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let authCalls = 0;
  const pb = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('auth-refresh')) { authCalls++; res.end(JSON.stringify({ token: 'fixture-only', record: { id: 'fixture-user' } })); }
    else if (req.url.includes('profiles')) res.end(JSON.stringify({ page: 1, perPage: 1, totalItems: 1, totalPages: 1, items: [{ name: 'private-fixture' }] }));
    else res.end(JSON.stringify({ code: 200 }));
  }); pb.listen(0, '127.0.0.1'); await once(pb, 'listening');
  t.after(() => new Promise(resolve => pb.close(resolve)));
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const gamePort = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['colyseus/minimal/server.js'], { cwd: process.cwd(), env: { ...process.env,
    MINIMAL_STATE_DIR: dir, MINIMAL_GAME_PORT: String(gamePort), MINIMAL_PB_PORT: String(pb.address().port), MINIMAL_WEB_PORT: '5279',
    MINIMAL_CONNECTION_OBSERVER: '1', MINIMAL_COMPRESSION: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-8192); });
  t.after(async () => { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } });
  await until(() => output.includes('Minimal Colyseus:') || child.exitCode !== null, 5000);
  assert.equal(child.exitCode, null, output);
  const client = new Client(`ws://127.0.0.1:${gamePort}`); client.auth.token = 'fixture-only';
  let room = await client.joinOrCreate('minimal-town', { zone: 'lobby' }); room.reconnection.maxRetries = 0;
  let snapshot; room.onMessage('snapshot', data => { snapshot = data; }); room.onMessage('deployment', () => {});
  await until(() => snapshot?.players.length === 1);
  room.send('move', { x: 36, y: 320, seq: 1, fix: 0 }); await until(() => snapshot.players[0].ack === 1);
  const before = structuredClone(snapshot.players[0]), session = room.sessionId, roomId = room.roomId;
  // checkReconnectionToken forcibly closes a still-live old socket with 4002.
  // This is SDK retirement, not rate abuse, and must keep the same worker state.
  snapshot = null; room = await client.reconnect(room.reconnectionToken); room.reconnection.maxRetries = 0;
  room.onMessage('snapshot', data => { snapshot = data; }); room.onMessage('deployment', () => {});
  await until(() => snapshot?.players.length === 1);
  assert.equal(room.sessionId, session); assert.deepEqual(snapshot.players[0], before); assert.equal(authCalls, 1);
  const token = room.reconnectionToken;
  room.connection.transport.ws.terminate(); await pause(100);
  snapshot = null; room = await client.reconnect(token); room.reconnection.maxRetries = 0;
  room.onMessage('snapshot', data => { snapshot = data; }); room.onMessage('deployment', () => {});
  await until(() => snapshot?.players.length === 1);
  assert.equal(room.sessionId, session); assert.equal(room.roomId, roomId); assert.deepEqual(snapshot.players[0], before);
  assert.equal(authCalls, 1, 'same-session recovery must not call PB');
  const badToken = room.reconnectionToken; let closedCode;
  room.onLeave(code => { closedCode = code; }); room.onDrop(code => { closedCode = code; });
  for (let seq = 2; seq <= 251; seq++) room.send('move', { x: 36, y: 320, seq, fix: 0 });
  await until(() => closedCode === 4002);
  await pause(100); await assert.rejects(client.reconnect(badToken));
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  assert.equal(child.exitCode, 0, output);
  const records = readFileSync(join(dir, 'diagnostics/connections.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert(records.some(record => record.event === 'drop')); assert(records.some(record => record.event === 'reconnect' && record.ack === 1));
  assert(records.some(record => record.event === 'drop' && record.code === 4002 && record.held === true));
  assert(records.some(record => record.event === 'drop' && record.code === 4002 && record.held === false));
  const limit = records.find(record => record.event === 'rate-limit'); assert.equal(limit.code, 4002); assert.equal(limit.messages.rejected, 1);
  assert(limit.messages.lastSecond > 240); assert.equal(limit.messages.burst, 240);
  const text = JSON.stringify(records); assert(!text.includes('fixture-only')); assert(!text.includes('fixture-user')); assert(!text.includes('private-fixture'));
});
