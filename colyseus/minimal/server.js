import http from 'node:http';
import express from 'express';
import { Server, Room, ServerError } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GAME_PORT, WEB_PORT, PB_URL, OUTBOX_DIR, STATE_DIR, adminClient, userClient } from './config.js';
import { MinimalOutbox } from './outbox.js';
import { WorkerHost } from './worker-host.js';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { ROOM_CAPACITY, TICK_MS } from '../../minimal/shared/world.js';

const outbox = new MinimalOutbox(OUTBOX_DIR, adminClient);
const period = Number(process.env.MINIMAL_SETTLE_MS || 180000);
const spawnMs = Number(process.env.MINIMAL_SPAWN_MS || 6000);
if (!Number.isInteger(period) || period < 1000 || period > 300000 || !Number.isInteger(spawnMs) || spawnMs < 1000 || spawnMs > 60000) throw new Error('Invalid minimal timing');
let lobby = null;
class MinimalTown extends Room {
  async onCreate(options) {
    if (options.zone !== 'lobby') throw new ServerError(400, '메인 로비만 이용할 수 있어요.');
    if (lobby) throw new ServerError(503, '로비가 가득 찼어요. 잠시 후 다시 입장해 주세요.');
    lobby = this;
    this.maxClients = ROOM_CAPACITY; this.autoDispose = false; this.maxMessagesPerSecond = 120;
    this.held = new Map();
    this.inputs = [];
    this.game = new WorkerHost({ ...(process.env.MINIMAL_WORKER_ENTRY ? { entry: resolve(process.env.MINIMAL_WORKER_ENTRY) } : {}), durationMs: period, spawnMs, settle: match => {
      outbox.enqueue(match);
      this.broadcast('gameEnded', match);
      void outbox.flush();
    } });
    await this.game.ready;
    this.game.on('deployment', status => this.broadcast('deployment', status));
    this.game.on('state', (snapshot, event) => { if (event.commands.some(c => c.type !== 'move')) this.broadcast('snapshot', snapshot); });
    this.game.on('unavailable', () => console.error('Minimal worker unavailable'));
    this.onMessage('move', (client, data) => this.inputs.push({ type: 'move', session: client.sessionId, data, now: Date.now() }));
    this.onMessage('*', (client, feature) => client.send('featureUnavailable', { feature: String(feature).slice(0, 40) }));
    this.setSimulationInterval(() => {
      const commands = this.inputs.splice(0); commands.push({ type: 'tick', now: Date.now() });
      void this.game.dispatch(commands).catch(() => {});
    }, TICK_MS);
  }
  async onAuth(client, options, context) {
    if (options.zone !== 'lobby' || typeof context.token !== 'string' || context.token.length > 8192) throw new ServerError(401, '로그인이 필요해요.');
    try {
      const pb = userClient(context.token);
      const { record } = await pb.collection('users').authRefresh();
      const profile = await pb.collection('profiles').getFirstListItem(pb.filter('user={:id}', { id: record.id }));
      return { id: record.id, name: profile.name };
    } catch (error) {
      throw new ServerError(error.status === 429 ? 429 : error.status >= 500 || !error.status ? 503 : 401, '로그인 상태를 확인하지 못했어요.');
    }
  }
  async onJoin(client, options, auth) {
    // Replace only a disconnected session. A second live tab must not own the same player.
    for (const [session, p] of this.game.players) if (p.id === auth.id && this.held.has(session)) {
      this.held.get(session).reject(); this.held.delete(session); await this.game.dispatch([...this.inputs.splice(0), { type: 'replace', session, now: Date.now() }]);
    }
    const result = await this.game.dispatch([...this.inputs.splice(0), { type: 'join', session: client.sessionId, data: auth, now: Date.now() }]);
    if (result.outcomes[0]?.error) throw new ServerError(409, result.outcomes[0].error);
  }
  onDrop(client) {
    if (!this.game.players.has(client.sessionId)) return;
    const pending = this.allowReconnection(client, 15); this.held.set(client.sessionId, pending);
    pending.then(() => this.held.delete(client.sessionId), () => this.held.delete(client.sessionId));
  }
  async onLeave(client) {
    const commands = this.inputs.splice(0); commands.push({ type: 'leave', session: client.sessionId, now: Date.now() });
    await this.game.dispatch(commands);
  }
  async onDispose() {
    if (this.game) {
      await this.game.dispatch([{ type: 'finish', now: Date.now() }]).catch(() => {});
      if (this.game.state.pendingMatch && !this.game.completed.has(this.game.state.pendingMatch.match_id)) console.error('Minimal settlement could not be written before shutdown');
      await this.game.close();
    }
    if (lobby === this) lobby = null;
  }
}

const origins = new Set([`http://127.0.0.1:${WEB_PORT}`, `http://localhost:${WEB_PORT}`]);
for (const value of (process.env.MINIMAL_PUBLIC_ORIGINS || '').split(',').filter(Boolean)) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value) throw new Error('MINIMAL_PUBLIC_ORIGINS requires exact HTTPS origins');
  origins.add(value);
}
const allowed = origin => !origin || origins.has(origin);
const app = express(); app.disable('x-powered-by');
app.use((req, res, next) => {
  if (!allowed(req.headers.origin)) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
const workerDeployment = process.env.MINIMAL_WORKER_ENTRY === resolve(STATE_DIR, 'worker-current/colyseus/minimal/simulation-worker.js') ? 'managed-release' : 'direct-entry';
const health = () => ({ ok: !lobby?.game.fatal, mode: 'minimal', protocol: 1, capacity: ROOM_CAPACITY, rooms: lobby ? 1 : 0, players: lobby?.game.players.size || 0, persistence: outbox.status(), hotSwap: true, workerDeployment, worker: lobby?.game.status() || null });
// No browser or game token can invoke the local deployment control.
app.post('/internal/worker/swap', async (req, res) => {
  const token = process.env.MINIMAL_SWAP_TOKEN;
  const supplied = req.headers.authorization || '';
  const expected = `Bearer ${token}`;
  if (req.headers.origin || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers.forwarded || !token || token.length < 32 || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.sendStatus(403);
  if (!lobby) return res.status(409).json({ error: 'No active lobby' });
  try { res.json(await lobby.game.swap()); }
  catch (error) { res.status(409).json({ error: error.message }); }
});
app.get('/health', (_req, res) => res.status(lobby?.game.fatal ? 503 : 200).json(health()));
app.get('/ready', async (_req, res) => {
  if (lobby?.game.fatal) return res.status(503).json(health());
  try { const r = await fetch(`${PB_URL}/api/health`, { signal: AbortSignal.timeout(1500) }); if (!r.ok) throw new Error(); res.json(health()); }
  catch { res.status(503).json({ ok: false, mode: 'minimal', dependency: 'pocketbase' }); }
});
const transport = new WebSocketTransport({ server: http.createServer(app), maxPayload: 8192, verifyClient: info => allowed(info.origin),
  // Full 100-player snapshots at 20Hz need less bandwidth on public paths.
  // Keep small input messages uncompressed and bound zlib concurrency.
  perMessageDeflate: { threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true,
    zlibDeflateOptions: { level: 1 }, concurrencyLimit: 4 },
});
const server = new Server({ transport, greet: false, gracefullyShutdown: false });
server.define('minimal-town', MinimalTown).filterBy(['zone']);
await server.listen(GAME_PORT, '127.0.0.1');
console.log(`Minimal Colyseus: http://127.0.0.1:${GAME_PORT} (one lobby, ${ROOM_CAPACITY} seats)`);
const retry = setInterval(() => void outbox.flush(), 2000); void outbox.flush();
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true; clearInterval(retry);
  await server.gracefullyShutdown(false); await outbox.flush(); process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
