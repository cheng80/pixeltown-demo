import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';
import { performance } from 'node:perf_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { getMap, findPath } from '../shared/world.js';

// Only self-spawned processes and dedicated loopback development ports are used.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Ports are overridable so the suite can run beside another checkout's development servers.
const PB_PORT = Number(process.env.PIXELTOWN_TEST_PB_PORT || 18090);
const GAME_PORT = Number(process.env.PIXELTOWN_TEST_GAME_PORT || 12567);
const PB_URL = `http://127.0.0.1:${PB_PORT}`;
const WS_URL = `ws://127.0.0.1:${GAME_PORT}`;
const HTTP_URL = `http://127.0.0.1:${GAME_PORT}`;
const reportPath = resolve(root, 'tests/report.json');
const report = { startedAt: new Date().toISOString(), targets: { pocketbase: PB_URL, colyseus: WS_URL }, status: 'running', tests: [], load: null, cleanup: null };
const rooms = new Set();
const children = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let runtime;

async function saveReport() { await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n'); }
async function waitUntil(fn, label, timeout = 10000) {
  const end = performance.now() + timeout;
  let last;
  do {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await sleep(40);
  } while (performance.now() < end);
  throw new Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
}
async function test(name, fn) {
  const started = performance.now();
  try {
    const evidence = await fn();
    report.tests.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started), evidence });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.tests.push({ name, status: 'failed', durationMs: Math.round(performance.now() - started), error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
  await saveReport();
}
async function assertPortsFree() {
  for (const port of [PB_PORT, GAME_PORT]) {
    const occupied = await new Promise(resolveCheck => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolveCheck(true); });
      socket.once('error', () => resolveCheck(false));
      socket.setTimeout(500, () => { socket.destroy(); resolveCheck(false); });
    });
    assert.equal(occupied, false, `Development port ${port} is occupied; refusing to use or stop an unowned instance`);
  }
}
function launch(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.add(child);
  child.logs = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', d => { child.logs = (child.logs + d.toString()).slice(-16000); });
  child.on('error', e => { child.launchError = e; });
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill('SIGTERM');
  await waitUntil(() => child.exitCode !== null || child.signalCode, 'owned process shutdown', 5000).catch(async () => {
    child.kill('SIGKILL');
    await waitUntil(() => child.exitCode !== null || child.signalCode, 'owned process force shutdown', 3000);
  });
}
async function ready(url, child) {
  await waitUntil(async () => {
    if (child.launchError) throw child.launchError;
    if (child.exitCode !== null) throw new Error(`Child exited: ${child.exitCode}`);
    return (await fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'error' })).ok;
  }, `service ready: ${url}`, 20000);
}
async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${PB_URL}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
function watch(room) {
  const state = { room, snapshot: null, snapshots: [], messages: [] };
  rooms.add(room);
  room.onMessage('*', (type, payload) => {
    state.messages.push({ type, payload, at: performance.now() });
    if (type === 'snapshot') { state.snapshot = payload; state.snapshots.push(payload); }
  });
  return state;
}
async function leave(state) {
  if (!state) return;
  await state.room.leave();
  rooms.delete(state.room);
}

// Protocol-specific setup and checks below are agreed with the backend owner.
async function createAccount(index) {
  const email = `integration-${runtime.runId}-${index}@pixeltown.local`;
  const password = `PixelTown-${runtime.runId}-123!`;
  const created = await runtime.admin.collection('users').create({ email, password, passwordConfirm: password, name: `Test ${index}`, verified: true });
  await runtime.admin.collection('profiles').create({ user: created.id, name: `Test ${index}`, color: '#89cff0' });
  const auth = await request('/api/collections/users/auth-with-password', { method: 'POST', body: { identity: email, password } });
  assert.equal(auth.status, 200);
  assert.ok(auth.data.token);
  assert.equal(auth.data.record.id, created.id);
  return { id: auth.data.record.id, token: auth.data.token, name: auth.data.record.name };
}
// Colyseus 0.18 sends the PocketBase token as client.auth.token, so each user gets its own SDK client.
let runtime_Client;
function gameClient(token) { const client = new runtime_Client(WS_URL); client.auth.token = token; return client; }
async function join(account, zone = 'lobby', extra = {}) {
  const state = watch(await gameClient(account.token).joinOrCreate('town', { zone, ...extra }));
  await waitUntil(() => state.snapshot?.players?.some(p => p.id === account.id), 'authenticated player snapshot');
  return state;
}
async function records(collection, account, filter = '') {
  const result = await request(`/api/collections/${collection}/records?perPage=200${filter ? `&filter=${encodeURIComponent(filter)}` : ''}`, { token: account.token });
  assert.equal(result.status, 200, `${collection} query: ${JSON.stringify(result.data)}`);
  return result.data.items;
}
function player(state, account) { return state.snapshot.players.find(p => p.id === account.id); }
async function moveTo(state, account, point) {
  // Exercise the public movement protocol with the shared walk grid; never mutate server coordinates.
  const path = findPath(getMap(state.snapshot.zone), player(state, account), point);
  path.push(point);
  const started = performance.now();
  while (performance.now() - started < 18000) {
    const p = player(state, account);
    while (path.length && Math.hypot(path[0].x - p.x, path[0].y - p.y) < 3) path.shift();
    if (!path.length || Math.hypot(point.x - p.x, point.y - p.y) < 10) return;
    const dx = path[0].x - p.x, dy = path[0].y - p.y;
    const length = Math.hypot(dx, dy);
    state.room.send('input', { dx: dx / length, dy: dy / length });
    await sleep(50);
  }
  throw new Error('Failed to reach game collectible using server movement');
}
async function functionalChecks() {
  let a, b, ra, rb;
  await test('two_real_users_login', async () => {
    [a, b] = await Promise.all([createAccount(1), createAccount(2)]);
    assert.notEqual(a.id, b.id);
    runtime.accounts = [a, b];
    return { distinctAuthenticatedUsers: 2 };
  });
  if (!a || !b) return;
  await test('invalid_token_rejected', async () => {
    let accepted;
    try { accepted = await gameClient('invalid.integration.token').joinOrCreate('town', { zone: 'lobby' }); }
    catch (error) { return { rejected: true, errorCode: error.code ?? null }; }
    await accepted.leave();
    assert.fail('Invalid token was accepted');
  });
  await test('two_players_join_and_move_sync', async () => {
    [ra, rb] = await Promise.all([join(a, 'lobby', { id: b.id, userId: b.id, name: 'SPOOFED' }), join(b)]);
    await waitUntil(() => ra.snapshot.players.length === 2 && rb.snapshot.players.length === 2, 'two player broadcast');
    assert.equal(ra.room.roomId, rb.room.roomId);
    assert.notEqual(player(ra, a).name, 'SPOOFED');
    const before = { ...player(ra, a) };
    ra.room.send('input', { dx: 1, dy: 0 });
    await waitUntil(() => player(rb, a)?.x > before.x, 'remote movement sync');
    const own = player(ra, a), remote = player(rb, a);
    assert.ok(Math.abs(own.x - remote.x) < 20);
    return { sameRoom: true, observedDisplacement: remote.x - before.x };
  });
  if (!ra || !rb) return;
  await test('chat_delivery_and_user_spoof_denied', async () => {
    const text = `integration chat ${runtime.runId}`;
    ra.room.send('chat', { text, user: b.id, id: b.id, userId: b.id, name: 'SPOOFED' });
    const message = await waitUntil(() => rb.messages.find(m => m.type === 'chat' && m.payload.text === text), 'chat delivery');
    assert.ok(Object.values(message.payload).includes(a.id), 'Chat must expose authenticated sender ID');
    assert.ok(!Object.values(message.payload).includes(b.id), 'Chat must not attribute to supplied spoofed ID');
    assert.notEqual(message.payload.name, 'SPOOFED');
    const previous = { ...player(rb, b) };
    ra.room.send('input', { dx: 1, dy: 0, id: b.id, userId: b.id, x: 99999, y: 99999 });
    await sleep(300);
    assert.deepEqual(player(rb, b), previous, 'Spoofed movement changed another user');
    return { senderAuthenticated: true, anotherPlayerUnchanged: true };
  });
  await test('zone_switch_isolation', async () => {
    await leave(ra);
    ra = await join(a, 'garden');
    await waitUntil(() => !rb.snapshot.players.some(p => p.id === a.id), 'old zone player removal');
    assert.equal(ra.snapshot.zone, 'garden');
    assert.notEqual(ra.room.roomId, rb.room.roomId);
    const marker = `isolated ${runtime.runId}`;
    const n = rb.messages.length;
    ra.room.send('chat', { text: marker });
    await sleep(350);
    assert.ok(!rb.messages.slice(n).some(m => m.payload?.text === marker), 'Chat leaked across zones');
    await leave(rb);
    rb = await join(b, 'garden');
    await waitUntil(() => ra.snapshot.players.length === 2 && rb.snapshot.players.length === 2, 'new zone shared room');
    return { leftOldZone: true, independentRooms: true, crossZoneChatBlocked: true };
  });
  runtime.active = { a, b, ra, rb };
}

async function loadChecks() {
  const clients = [], accounts = [];
  await test('twenty_client_local_load', async () => {
    for (let i = 0; i < 20; i++) accounts.push(await createAccount(i + 100));
    const started = performance.now();
    clients.push(...await Promise.all(accounts.map(a => join(a, 'arcade'))));
    await waitUntil(() => clients.every(s => s.snapshot.players.length === 20), 'all twenty peers visible', 15000);
    const joinedMs = Math.round(performance.now() - started);
    const latencies = [], durationMs = 3000;
    const countBefore = clients.map(s => s.snapshots.length);
    const workloadStarted = performance.now();
    let sentInputs = 0;
    for (let tick = 0; tick < durationMs / 100; tick++) {
      const tickStarted = performance.now();
      clients.forEach(s => { s.room.send('input', { dx: tick % 2 ? -1 : 1, dy: 0 }); sentInputs++; });
      if (tick % 5 === 0) {
        const text = `load-${runtime.runId}-${tick}`;
        const sendTime = performance.now();
        clients[tick % 20].room.send('chat', { text });
        await waitUntil(() => clients.every(s => s.messages.some(m => m.type === 'chat' && m.payload.text === text)), 'twenty-client chat broadcast', 2000);
        latencies.push(performance.now() - sendTime);
      }
      await sleep(Math.max(0, 100 - (performance.now() - tickStarted)));
    }
    const snapshotCounts = clients.map((s, i) => s.snapshots.length - countBefore[i]);
    assert.ok(snapshotCounts.every(n => n > 5), 'Snapshot broadcast stalled under load');
    assert.ok(clients.every(s => s.snapshot.players.length === 20));
    const sorted = latencies.sort((a, b) => a - b);
    const actualDurationMs = Math.round(performance.now() - workloadStarted);
    report.load = { clients: 20, joinedMs, sentInputs, targetInputHzPerClient: 10, durationMs: actualDurationMs, effectiveInputHzPerClient: Number((sentInputs / 20 / (actualDurationMs / 1000)).toFixed(2)), minimumSnapshots: Math.min(...snapshotCounts), chatBroadcastP95Ms: Math.round(sorted[Math.ceil(sorted.length * .95) - 1]), scope: 'single local machine; short functional load, not capacity benchmark' };
    return report.load;
  });
  await Promise.allSettled(clients.map(leave));
  if (process.env.PIXELTOWN_LOAD_100 === '1') await hundredClientCheck();
}

// Opt-in (PIXELTOWN_LOAD_100=1): 100 clients into one zone. Rooms hold 32, so filterBy(['zone']) must open
// extra channel rooms; measures join time, input rate, snapshot flow and in-room chat latency on this machine.
async function hundredClientCheck() {
  const N = 100, clients = [], accounts = [];
  await Promise.allSettled([...rooms].map(room => room.leave())); rooms.clear(); await sleep(500); // last test: start from empty rooms
  await test('hundred_client_local_room_split', async () => {
    for (let i = 0; i < N; i += 10) accounts.push(...await Promise.all(Array.from({ length: 10 }, (_, k) => createAccount(1000 + i + k))));
    const started = performance.now();
    for (let i = 0; i < N; i += 20) clients.push(...await Promise.all(accounts.slice(i, i + 20).map(a => join(a, 'lobby'))));
    const byRoom = new Map();
    for (const s of clients) byRoom.set(s.room.roomId, [...(byRoom.get(s.room.roomId) || []), s]);
    await waitUntil(() => clients.every(s => s.snapshot.players.length === byRoom.get(s.room.roomId).length), 'every client sees exactly its room', 20000);
    const joinedMs = Math.round(performance.now() - started), sizes = [...byRoom.values()].map(r => r.length).sort((a, b) => b - a);
    assert.equal(byRoom.size, Math.ceil(N / 32), `room split ${sizes}`);
    assert.ok(sizes.every(n => n <= 32));
    const countBefore = clients.map(s => s.snapshots.length), latencies = [], durationMs = 3000, workloadStarted = performance.now();
    let sentInputs = 0;
    for (let tick = 0; tick < durationMs / 100; tick++) {
      const tickStarted = performance.now();
      clients.forEach(s => { s.room.send('input', { dx: tick % 2 ? -1 : 1, dy: 0 }); sentInputs++; });
      if (tick % 5 === 0) {
        const members = [...byRoom.values()][tick / 5 % byRoom.size], text = `load100-${runtime.runId}-${tick}`, sendTime = performance.now();
        members[0].room.send('chat', { text });
        await waitUntil(() => members.every(s => s.messages.some(m => m.type === 'chat' && m.payload.text === text)), 'in-room chat broadcast', 3000);
        latencies.push(performance.now() - sendTime);
      }
      await sleep(Math.max(0, 100 - (performance.now() - tickStarted)));
    }
    const snapshotCounts = clients.map((s, i) => s.snapshots.length - countBefore[i]), actualDurationMs = Math.round(performance.now() - workloadStarted);
    assert.ok(snapshotCounts.every(n => n > 5), 'Snapshot broadcast stalled under load');
    const sorted = latencies.sort((a, b) => a - b);
    report.load100 = { clients: N, rooms: byRoom.size, roomSizes: sizes, joinedMs, sentInputs, durationMs: actualDurationMs, effectiveInputHzPerClient: Number((sentInputs / N / (actualDurationMs / 1000)).toFixed(2)), minimumSnapshots: Math.min(...snapshotCounts), chatBroadcastP95Ms: Math.round(sorted[Math.ceil(sorted.length * .95) - 1]), scope: 'single local machine; players in different channel rooms do not see each other; not an internet or capacity benchmark' };
    return report.load100;
  });
  await Promise.allSettled(clients.map(leave));
}

// The star event is always on: there is no start command, scores are settled every period.
async function playMatch(state, account, { verifyGeneration = false } = {}) {
  const offset = state.messages.length;
  await waitUntil(() => state.snapshot.game.active, 'event active on join');
  await sleep(150);
  assert.ok(!state.snapshot.game.scores[account.id], 'Client spoofed score');
  const generation = { cap: 12, periodMs: runtime.starSpawnMs };
  if (verifyGeneration) {
    const started = performance.now(), startCount = state.snapshot.game.stars.length;
    assert.ok(startCount >= 5, 'Event must keep at least five stars on the map');
    await waitUntil(() => state.snapshot.game.stars.length === 12, `periodic generation reaches twelve stars without collection (start ${startCount}, now ${state.snapshot.game.stars.length}, ids ${state.snapshot.game.stars.map(s => s.id.slice(-3)).join(' ')})`, (12 - startCount + 1) * runtime.starSpawnMs + 1500);
    generation.startCount = startCount; generation.timeToCapMs = Math.round(performance.now() - started);
    const growth = state.messages.slice(offset).filter(m => m.type === 'snapshot' && m.payload.game.active);
    const increments = [];
    let previousCount = startCount, previousAt;
    for (const message of growth) {
      const count = message.payload.game.stars.length;
      assert.ok(count >= previousCount, 'Stars disappeared without collection (settlement must keep them)');
      if (count > previousCount) {
        assert.equal(count, previousCount + 1, 'Generator must add one star per period');
        if (previousAt !== undefined) {
          const interval = message.at - previousAt;
          assert.ok(Math.abs(interval - runtime.starSpawnMs) <= 300, `Generation interval ${Math.round(interval)}ms differs from ${runtime.starSpawnMs}ms`);
          increments.push(Math.round(interval));
        }
        previousCount = count; previousAt = message.at;
      }
    }
    assert.equal(previousCount, 12);
    generation.observedGenerationIntervalsMs = increments;
    const capOffset = state.snapshots.length;
    const capIds = state.snapshot.game.stars.map(s => s.id).sort();
    await sleep(runtime.starSpawnMs * 2 + 100); // More than two generation periods while no stars are collected.
    for (const snapshot of state.snapshots.slice(capOffset)) {
      assert.equal(snapshot.game.stars.length, 12);
      assert.deepEqual(snapshot.game.stars.map(s => s.id).sort(), capIds, 'Generator replaced stars while at capacity');
    }
    generation.stableAtCapMs = runtime.starSpawnMs * 2 + 100;
    const stars = state.snapshot.game.stars;
    generation.minimumStarSpacing = Math.round(Math.min(...stars.flatMap((a, i) => stars.slice(i + 1).map(b => Math.hypot(a.x - b.x, a.y - b.y)))));
  }
  const me = () => player(state, account);
  const nearest = [...state.snapshot.game.stars].sort((x, y) => Math.hypot(x.x - me().x, x.y - me().y) - Math.hypot(y.x - me().x, y.y - me().y))[0];
  // Sending collect from a distant location must not create a score.
  const distant = state.snapshot.game.stars.find(s => Math.hypot(s.x - me().x, s.y - me().y) > 32);
  if (distant) {
    state.room.send('collect', { id: distant.id, score: 999999, x: distant.x, y: distant.y });
    await sleep(150);
    assert.ok(!state.snapshot.game.scores[account.id], 'Out-of-range collection accepted');
  }
  await moveTo(state, account, nearest);
  state.room.send('input', { dx: 0, dy: 0 });
  const beforeCollectIds = state.snapshot.game.stars.map(s => s.id);
  const collectOffset = state.snapshots.length;
  const collectedAt = performance.now();
  state.room.send('collect', { id: nearest.id, score: 999999 });
  const scored = await waitUntil(() => state.snapshots.slice(collectOffset).find(s => s.game.scores[account.id] === 1), 'server-authoritative collection score');
  const matchId = scored.game.id;
  if (verifyGeneration) {
    await waitUntil(() => state.snapshots.slice(collectOffset).some(s => s.game.stars.length === 11 && !s.game.stars.some(star => star.id === nearest.id)), 'collection frees one star slot');
    await waitUntil(() => state.snapshot.game.stars.length === 12 && state.snapshot.game.stars.some(star => !beforeCollectIds.includes(star.id)), 'next generation period refills collected slot', runtime.starSpawnMs + 400);
    assert.ok(!state.snapshot.game.stars.some(s => s.id === nearest.id), 'Collected star ID was reused');
    generation.refillDelayMs = Math.round(performance.now() - collectedAt);
    generation.collectionFreedSlot = true;
    generation.regeneratedWithFreshId = true;
  }
  state.room.send('collect', { id: nearest.id });
  await sleep(180);
  if (state.snapshot.game.id === matchId) assert.equal(state.snapshot.game.scores[account.id], 1, 'Duplicate collection scored twice');
  const ended = (await waitUntil(() => state.messages.slice(offset).find(m => m.type === 'gameEnded' && m.payload.match_id === matchId), 'period settlement', runtime.gameDurationMs + 2000)).payload;
  await waitUntil(() => state.snapshot.game.active && state.snapshot.game.id !== matchId, 'next period starts right after settlement', 1000);
  if (verifyGeneration) {
    const snapshots = state.messages.slice(offset).filter(m => m.type === 'snapshot' && m.payload.game.active).map(m => m.payload);
    for (const snapshot of snapshots) {
      assert.ok(snapshot.game.stars.length <= 12, 'Live star count exceeded twelve');
      assert.equal(new Set(snapshot.game.stars.map(s => s.id)).size, snapshot.game.stars.length, 'Duplicate live star IDs');
    }
    runtime.generationEvidence = { ...generation, maximumObservedStars: Math.max(...snapshots.map(s => s.game.stars.length)), observedSnapshots: snapshots.length, continuedAfterSettlement: true };
  }
  return ended;
}

function startPB() {
  return launch(runtime.binary, ['serve', `--http=127.0.0.1:${PB_PORT}`, '--dir', runtime.dataDir, '--hooksDir', resolve(root, 'pocketbase/pb_hooks'), '--automigrate=0']);
}
function startServer() {
  return launch(process.execPath, [resolve(root, 'colyseus/server.js')], { env: runtime.env });
}
async function setup() {
  await assertPortsFree();
  const requireBackend = createRequire(resolve(root, 'colyseus/package.json'));
  const { Client } = requireBackend('@colyseus/sdk');
  runtime_Client = Client;
  const base = resolve(root, '.test-work/integration');
  await mkdir(base, { recursive: true });
  const local = await mkdtemp(resolve(base, 'run-'));
  const envFile = resolve(local, '.env.local');
  await writeFile(envFile, `PB_ADMIN_EMAIL=integration-${randomBytes(8).toString('hex')}@pixeltown.local\nPB_ADMIN_PASSWORD=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  runtime = { runId: randomBytes(5).toString('hex'), local, dataDir: resolve(local, 'pb_data'), outboxDir: resolve(local, 'outbox'), binary: resolve(process.env.PIXELTOWN_PB_BINARY || resolve(root, 'pocketbase/.local/pocketbase')) };
  assert.ok(existsSync(runtime.binary), 'Backend owner must prepare local PocketBase binary first; this test never downloads it');
  runtime.gameDurationMs = 30000; // Settlement period: growth to the cap, two capped periods, collection and refill fit in one or two periods.
  runtime.starSpawnMs = 1500; // Shortened from the 6s default so growth to the cap is observable in seconds.
  runtime.env = { ...process.env, PIXELTOWN_LOCAL_DIR: local, PIXELTOWN_ENV_FILE: envFile, PB_DATA_DIR: runtime.dataDir, OUTBOX_PATH: runtime.outboxDir, GAME_DURATION_MS: String(runtime.gameDurationMs), STAR_SPAWN_INTERVAL_MS: String(runtime.starSpawnMs), PB_URL, POCKETBASE_URL: PB_URL, COLYSEUS_PORT: String(GAME_PORT), COLYSEUS_HOST: '127.0.0.1', SERVER_PORT: String(GAME_PORT), SERVER_HOST: '127.0.0.1' };
  Object.assign(process.env, { PIXELTOWN_LOCAL_DIR: local, PIXELTOWN_ENV_FILE: envFile, PB_DATA_DIR: runtime.dataDir, OUTBOX_PATH: runtime.outboxDir, PB_URL, POCKETBASE_URL: PB_URL, COLYSEUS_PORT: String(GAME_PORT), COLYSEUS_HOST: '127.0.0.1' });
  const config = await import(pathToFileURL(resolve(root, 'colyseus/config.js')).href);
  const credentials = config.credentials();
  const upsert = launch(runtime.binary, ['superuser', 'upsert', credentials.PB_ADMIN_EMAIL, credentials.PB_ADMIN_PASSWORD, '--dir', runtime.dataDir]);
  await waitUntil(() => upsert.exitCode !== null || upsert.launchError, 'temporary DB admin initialization');
  assert.equal(upsert.exitCode, 0, 'Temporary PB initialization failed');
  runtime.pb = startPB(); await ready(`${PB_URL}/api/health`, runtime.pb);
  const initializer = await import(pathToFileURL(resolve(root, 'scripts/init-pocketbase.mjs')).href);
  await initializer.seed(); runtime.admin = await config.adminClient();
  runtime.server = startServer(); await ready(`${HTTP_URL}/health`, runtime.server);
  report.isolation = { freshDataDirectory: true, separateOutbox: true, ownProcessesOnly: true, portsInitiallyFree: true, operatingInstancesTouched: false, externalSiteAccess: false };
}
try {
  await test('isolated_development_setup', setup);
  if (report.tests[0].status === 'passed') {
    await functionalChecks();
    await gameChecks();
    await shopChecks();
    await loadChecks();
  }
} catch (error) {
  report.tests.push({ name: 'unexpected_runner_error', status: 'failed', error: error.message });
} finally {
  await Promise.allSettled([...rooms].map(room => room.leave()));
  for (const child of [...children].reverse()) await stop(child).catch(() => {});
  const alive = [...children].filter(c => c.exitCode === null && !c.signalCode && !c.launchError);
  report.cleanup = { ownedProcessesStopped: alive.length === 0, remainingOwnedProcesses: alive.length, temporaryDataRetainedInWork: Boolean(runtime?.local) };
  report.finishedAt = new Date().toISOString();
  report.summary = { passed: report.tests.filter(t => t.status === 'passed').length, failed: report.tests.filter(t => t.status === 'failed').length };
  report.status = report.summary.failed || alive.length ? 'failed' : 'passed';
  await saveReport();
  console.log(`${report.status.toUpperCase()}: ${report.summary.passed} passed, ${report.summary.failed} failed. tests/report.json`);
  if (report.status !== 'passed') process.exitCode = 1;
}
// Star shop (ADR-004): wallet = settled star rewards - purchases, all writes through the PB hook.
async function shopChecks() {
  let c, d;
  const buy = (who, item) => request('/api/pixeltown/shop/buy', { token: who?.token, method: 'POST', body: { item } });
  const wallet = async who => (await records('inventory', who)).reduce((n, r) => n + r.quantity, 0) - (await records('purchases', who)).reduce((n, r) => n + r.price, 0);
  await test('shop_purchase_wallet_and_forgery_denied', async () => {
    [c, d] = await Promise.all([createAccount(3), createAccount(4)]);
    // Grant c 40 stars through the authoritative settlement path only the game server (superuser) may use.
    const granted = await request('/api/pixeltown/commit-match', { token: runtime.admin.authStore.token, method: 'POST', body: { match_id: randomUUID(), zone: 'lobby', ended_at: new Date().toISOString(), scores: { [c.id]: 40 } } });
    assert.equal(granted.status, 200);
    assert.equal(await wallet(c), 40);
    assert.equal((await buy(undefined, 'hat_ribbon')).status, 401, 'Anonymous purchase accepted');
    const poor = await buy(d, 'hat_ribbon');
    assert.equal(poor.status, 400); assert.equal((await records('purchases', d)).length, 0, 'Failed purchase left a ledger row');
    assert.equal((await buy(c, 'no_such_item')).status, 400);
    const crown = await buy(c, 'hat_crown');
    assert.equal(crown.status, 200); assert.equal(crown.data.balance, 10);
    assert.equal((await buy(c, 'hat_crown')).status, 400, 'Duplicate purchase accepted');
    // Concurrent buys worth 6+8+10 against a balance of 10: never overspend.
    const burst = await Promise.all(['top_heart', 'top_stripe', 'hat_straw'].map(item => buy(c, item)));
    const after = await wallet(c);
    assert.ok(after >= 0, `Wallet went negative: ${after}`);
    assert.equal(burst.filter(r => r.status === 200).length, (await records('purchases', c)).length - 1);
    const forged = [];
    forged.push((await request('/api/collections/purchases/records', { token: c.token, method: 'POST', body: { user: c.id, item: 'pet_bunny', price: 0 } })).status);
    const own = (await records('purchases', c))[0];
    forged.push((await request(`/api/collections/purchases/records/${own.id}`, { token: c.token, method: 'DELETE' })).status);
    forged.push((await request(`/api/collections/purchases/records/${own.id}`, { token: d.token })).status);
    assert.ok(forged.every(code => [400, 403, 404].includes(code)), `Direct ledger access allowed: ${forged}`);
    assert.equal((await records('purchases', d)).length, 0);
    return { grantedStars: 40, crownPrice: 30, burstAccepted: burst.filter(r => r.status === 200).length, walletAfterBurst: after, poorRejected: poor.status, forgedStatuses: forged };
  });
  if (!c) return;
  await test('shop_equip_look_sync_and_room_rules', async () => {
    const equip = (who, body) => request('/api/pixeltown/shop/equip', { token: who.token, method: 'POST', body });
    assert.equal((await equip(c, { hat: 'pet_puppy' })).status, 400, 'Wrong slot accepted');
    assert.equal((await equip(c, { pet: 'pet_puppy' })).status, 400, 'Unowned pet accepted');
    assert.equal((await equip(c, { hat: 'hat_crown' })).status, 200);
    const profile = await runtime.admin.collection('profiles').getFirstListItem(`user="${c.id}"`);
    assert.deepEqual(profile.outfit, { hat: 'hat_crown', top: null, pet: null });
    const patch = await request(`/api/collections/profiles/records/${profile.id}`, { token: c.token, method: 'PATCH', body: { outfit: { pet: 'pet_bunny' }, room: [] } });
    assert.ok([400, 403, 404].includes(patch.status), 'Profile written directly');
    // The room server reads the outfit from PocketBase, not from the client.
    const rc = await join(c, 'arcade'), rd = await join(d, 'arcade');
    await waitUntil(() => rd.snapshot.players.find(p => p.id === c.id)?.look?.hat === 'hat_crown', 'other player sees the crown');
    assert.equal((await equip(c, { hat: null })).status, 200);
    rc.room.send('look', { hat: 'hat_crown', pet: 'pet_bunny' });
    await waitUntil(() => rd.snapshot.players.find(p => p.id === c.id)?.look?.hat === null, 'look refresh after unequip');
    assert.equal(rd.snapshot.players.find(p => p.id === c.id).look.pet, null, 'Client-sent look trusted');
    await leave(rc); await leave(rd);
    const room = body => request('/api/pixeltown/shop/room', { token: c.token, method: 'POST', body });
    const grant2 = await request('/api/pixeltown/commit-match', { token: runtime.admin.authStore.token, method: 'POST', body: { match_id: randomUUID(), zone: 'garden', ended_at: new Date().toISOString(), scores: { [c.id]: 40 } } });
    assert.equal(grant2.status, 200);
    for (const item of ['f_rug', 'f_bed', 'f_chair']) assert.equal((await buy(c, item)).status, 200, `buy ${item}`);
    const cases = {
      unowned: [{ item: 'f_piano', c: 12, r: 10 }],
      outside: [{ item: 'f_bed', c: 29, r: 10 }],
      door: [{ item: 'f_chair', c: 19, r: 18 }],
      overlap: [{ item: 'f_bed', c: 12, r: 10 }, { item: 'f_chair', c: 13, r: 11 }],
      duplicate: [{ item: 'f_chair', c: 12, r: 10 }, { item: 'f_chair', c: 14, r: 10 }],
    };
    const statuses = {};
    for (const [name, placements] of Object.entries(cases)) { statuses[name] = (await room({ placements })).status; assert.equal(statuses[name], 400, `${name} placement accepted`); }
    const good = [{ item: 'f_bed', c: 10, r: 9 }, { item: 'f_rug', c: 14, r: 12 }, { item: 'f_chair', c: 15, r: 12 }];
    assert.equal((await room({ placements: good })).status, 200);
    assert.deepEqual((await runtime.admin.collection('profiles').getFirstListItem(`user="${c.id}"`)).room, good);
    return { wrongSlotOrUnownedRejected: true, directProfileWrite: patch.status, lookFromServerProfile: true, rejectedPlacements: statuses, savedPlacements: good.length };
  });
  // Character set-up (FR-014): only the owner, only catalogue values, unique nickname; rooms show the new look and name.
  await test('character_setup_profile_rules', async () => {
    const save = (who, body) => request('/api/pixeltown/profile', { token: who?.token, method: 'POST', body });
    const ok = { name: `별지기${runtime.runId.slice(0, 4)}`, color: '#9be38c', avatar: { skin: 3, hair: 6, style: 2 } };
    const rejected = {
      anonymous: (await save(null, ok)).status,
      shortName: (await save(c, { ...ok, name: '가' })).status,
      markup: (await save(c, { ...ok, name: '<b>hi</b>' })).status,
      colour: (await save(c, { ...ok, color: '#000000' })).status,
      skin: (await save(c, { ...ok, avatar: { ...ok.avatar, skin: 9 } })).status,
    };
    assert.equal(rejected.anonymous, 401); for (const [k, v] of Object.entries(rejected)) if (k !== 'anonymous') assert.equal(v, 400, k);
    const rc = await join(c, 'garden'), rd = await join(d, 'garden');
    assert.equal((await save(c, ok)).status, 200);
    const takenResponse = await save(d, { ...ok, color: '#89cff0' }), taken = takenResponse.status;
    assert.equal(taken, 400, 'Duplicate nickname accepted');
    assert.match(takenResponse.data?.message || '', /이미 쓰는 닉네임/); assert.ok(takenResponse.data?.data?.name, 'Field marker for the UI');
    // The DB index ignores letter case: "Star…" and "star…" are the same nickname.
    const caseName = `Star${runtime.runId.slice(0, 4)}`;
    assert.equal((await save(c, { ...ok, name: caseName })).status, 200);
    const caseVariant = (await save(d, { ...ok, name: caseName.toLowerCase(), color: '#89cff0' })).status;
    assert.equal(caseVariant, 400, 'Case variant of a taken nickname accepted');
    assert.equal((await save(c, ok)).status, 200);
    const stored = await runtime.admin.collection('profiles').getFirstListItem(`user="${c.id}"`);
    assert.deepEqual([stored.name, stored.color, stored.avatar], [ok.name, ok.color, ok.avatar]);
    rc.room.send('look');
    const seen = await waitUntil(() => { const p = rd.snapshot.players.find(q => q.id === c.id); return p?.name === ok.name && p.look.skin === 3 && p; }, 'other player sees the new character');
    assert.deepEqual([seen.color, seen.look.hair, seen.look.style], [ok.color, 6, 2]);
    await leave(rc); await leave(rd);
    return { rejected, duplicateNickname: taken, duplicateMessage: takenResponse.data?.message, caseVariant, saved: true, seenByOther: { name: true, skin: seen.look.skin, hair: seen.look.hair, style: seen.look.style, color: seen.color } };
  });
}

async function gameChecks() {
  if (!runtime.active) return;
  const { a, b, ra, rb } = runtime.active;
  let match, row;
  await test('star_generation_cap_and_collection_regeneration', async () => {
    match = await playMatch(ra, a, { verifyGeneration: true });
    return runtime.generationEvidence;
  });
  await test('game_finish_result_and_inventory_query', async () => {
    assert.ok(match, 'Star lifecycle match must complete before result query');
    await waitUntil(() => rb.messages.some(m => m.type === 'gameEnded' && m.payload.match_id === match.match_id), 'second player observes game end');
    await waitUntil(async () => (await records('results', a, `match_id="${match.match_id}"`)).length === 1, 'result persisted');
    const results = await records('results', a, `match_id="${match.match_id}"`);
    row = results[0];
    assert.equal(row.user, a.id); assert.equal(row.score, 1); assert.equal(row.zone, 'garden');
    const items = await records('inventory', a, `match_id="${match.match_id}"`);
    assert.equal(items.length, 1); assert.equal(items[0].quantity, 1); assert.equal(items[0].item, 'star');
    const ownB = await records('results', b, `match_id="${match.match_id}"`);
    assert.equal(ownB.length, 0, 'A player without points must not get an empty result row');
    return { matchId: match.match_id, serverScore: row.score, resultsPerScoringUser: 1, rewardPerScoringUser: 1, zeroScoreRows: 0 };
  });
  if (!row) return;
  await test('result_tamper_and_cross_user_access_denied', async () => {
    const filter = `match_id="${match.match_id}"`;
    const ownInventory = (await records('inventory', a, filter))[0];
    const ownProfile = await runtime.admin.collection('profiles').getFirstListItem(`user="${a.id}"`);
    const attempts = [];
    for (const collection of ['results', 'inventory']) {
      const existing = collection === 'results' ? row : ownInventory;
      for (const method of ['PATCH', 'DELETE']) {
        const response = await request(`/api/collections/${collection}/records/${existing.id}`, { token: a.token, method, body: method === 'PATCH' ? { score: 999999, quantity: 999999, user: b.id } : undefined });
        assert.ok([400, 403, 404].includes(response.status), `${collection} ${method} permitted`);
        attempts.push({ collection, method, status: response.status });
      }
      const forged = await request(`/api/collections/${collection}/records`, { token: a.token, method: 'POST', body: { user: a.id, match_id: 'forged', score: 999999, quantity: 999999, zone: 'garden', item: 'star', ended_at: new Date().toISOString() } });
      assert.ok([400, 403, 404].includes(forged.status), 'Forged result creation permitted');
      const directOther = await request(`/api/collections/${collection}/records/${existing.id}`, { token: b.token });
      assert.equal(directOther.status, 404, 'Another user directly read private result/reward');
      const filteredOther = await records(collection, b, `user="${a.id}"`);
      assert.equal(filteredOther.length, 0);
    }
    const spoofProfile = await request(`/api/collections/profiles/records/${ownProfile.id}`, { token: a.token, method: 'PATCH', body: { user: b.id, name: 'SPOOFED' } });
    assert.ok([400, 403, 404].includes(spoofProfile.status));
    assert.equal((await records('results', a, filter))[0].score, 1);
    assert.equal((await records('inventory', a, filter))[0].quantity, 1);
    for (const token of [undefined, a.token, b.token]) {
      const commit = await request('/api/pixeltown/commit-match', { token, method: 'POST', body: { ...match, scores: { [a.id]: 12 } } });
      assert.ok([401, 403].includes(commit.status), 'Non-admin could commit a forged authoritative match');
    }
    return { attempts, crossUserListAndViewDenied: true, storedScoreUnchanged: true };
  });
  await test('duplicate_delivery_idempotency', async () => {
    // Replay the actual committed server match into this test instance's outbox.
    for (let replay = 0; replay < 2; replay++) {
      await writeFile(resolve(runtime.outboxDir, `${match.match_id}.json`), JSON.stringify(match), { mode: 0o600 });
      await waitUntil(async () => (await (await fetch(`${HTTP_URL}/health`)).json()).persistence.pending === 0, 'replayed outbox drained', 10000);
    }
    for (const collection of ['results', 'inventory']) {
      const rows = await records(collection, a, `match_id="${match.match_id}"`);
      assert.equal(rows.length, 1, `${collection} duplicated after delivery replay`);
    }
    for (let replay = 0; replay < 2; replay++) {
      const response = await request('/api/pixeltown/commit-match', { token: runtime.admin.authStore.token, method: 'POST', body: match });
      assert.equal(response.status, 200);
    }
    for (const collection of ['results', 'inventory']) assert.equal((await records(collection, a, `match_id="${match.match_id}"`)).length, 1);
    const duplicate = await runtime.admin.collection('results').create({ user: a.id, match_id: match.match_id, zone: match.zone, score: 1, ended_at: match.ended_at }).then(() => true, error => { assert.equal(error.status, 400); return false; });
    assert.equal(duplicate, false, 'Unique constraint missing');
    return { outboxReplayCount: 2, adminApiReplayCount: 2, rowsPerMatchAndUser: 1, databaseUniqueConstraint: true };
  });
  await test('conflicting_replay_denied_and_transaction_rollback', async () => {
    const conflicting = await request('/api/pixeltown/commit-match', { token: runtime.admin.authStore.token, method: 'POST', body: { ...match, scores: { ...match.scores, [a.id]: 12 } } });
    assert.equal(conflicting.status, 400, 'Conflicting authoritative replay permitted');
    assert.equal((await records('results', a, `match_id="${match.match_id}"`))[0].score, 1);
    assert.equal((await records('inventory', a, `match_id="${match.match_id}"`))[0].quantity, 1);
    const rollbackId = randomUUID();
    const badSecondParticipant = await request('/api/pixeltown/commit-match', { token: runtime.admin.authStore.token, method: 'POST', body: { ...match, match_id: rollbackId, scores: { [a.id]: 2, missinguser0000: 1 } } });
    assert.ok([400, 404].includes(badSecondParticipant.status), 'Invalid second participant was accepted');
    for (const collection of ['results', 'inventory']) {
      const rows = await runtime.admin.collection(collection).getFullList({ filter: `match_id="${rollbackId}"` });
      assert.equal(rows.length, 0, `${collection}: first participant survived transaction rollback`);
    }
    return { conflictingReplayStatus: conflicting.status, invalidSecondParticipantStatus: badSecondParticipant.status, partialResultRows: 0, partialInventoryRows: 0 };
  });
  await test('storage_outage_durable_queue_restart_recovery', async () => {
    await stop(runtime.pb);
    await assert.rejects(fetch(`${PB_URL}/api/health`, { signal: AbortSignal.timeout(500) }));
    const outageMatch = await playMatch(ra, a);
    await waitUntil(async () => (await (await fetch(`${HTTP_URL}/health`)).json()).persistence.pending > 0, 'pending persistence during outage');
    const queued = JSON.parse(await readFile(resolve(runtime.outboxDir, `${outageMatch.match_id}.json`), 'utf8'));
    assert.equal(queued.match_id, outageMatch.match_id);
    await leave(ra); await leave(rb);
    await stop(runtime.server);
    runtime.server = startServer();
    await ready(`${HTTP_URL}/health`, runtime.server);
    const afterRestart = await (await fetch(`${HTTP_URL}/health`)).json();
    assert.ok(afterRestart.persistence.pending >= 1, 'Restart lost queued match');
    runtime.pb = startPB();
    await ready(`${PB_URL}/api/health`, runtime.pb);
    await waitUntil(async () => (await (await fetch(`${HTTP_URL}/health`)).json()).persistence.pending === 0, 'outbox recovered', 15000);
    for (const collection of ['results', 'inventory']) {
      const rows = await records(collection, a, `match_id="${outageMatch.match_id}"`);
      assert.equal(rows.length, 1); assert.equal(rows[0].user, a.id);
    }
    const reconnected = await join(a, 'garden'); await leave(reconnected);
    return { persistedMatchId: outageMatch.match_id, queuedOnDisk: true, survivedServerRestart: true, resultsAndInventoryRecovered: true, authenticatedReconnect: true };
  });
}
