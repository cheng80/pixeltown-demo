import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@colyseus/sdk';

const root = process.cwd(), state = mkdtempSync(resolve(root, '.test-work/frontend-http-'));
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64), token = randomBytes(32).toString('hex');
const manifest = revision => ({ schema: 2, revision, compatibility: C, uiApiVersion: 1, uiStateSchema: 1,
  entry: `/visual/releases/${revision}/assets/app.js`, styles: [], fonts: [], images: [], files: [{ path: 'assets/app.js', sha256: C }] });
let publicValue = manifest(A), publicStatus = 200, publicBody, publicDelay = 0, game, pbServer, room, output = '';
const staticServer = http.createServer(async (req, res) => {
  if (req.url !== '/visual/current.json') { res.writeHead(404).end(); return; }
  if (publicDelay) await new Promise(resolve => setTimeout(resolve, publicDelay));
  if (publicStatus === 302) { res.writeHead(302, { Location: '/elsewhere' }).end(); return; }
  res.writeHead(publicStatus, { 'Content-Type': 'application/json' }).end(publicBody ?? JSON.stringify(publicValue));
});
staticServer.listen(0, '127.0.0.1'); await once(staticServer, 'listening');
const staticPort = staticServer.address().port;
async function freePort() { const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
const gamePort = await freePort(), pbPort = await freePort(), webPort = await freePort(), base = `http://127.0.0.1:${gamePort}`;
const env = { ...process.env, MINIMAL_STATE_DIR: state, MINIMAL_GAME_PORT: String(gamePort), MINIMAL_PB_PORT: String(pbPort), MINIMAL_WEB_PORT: String(webPort),
  MINIMAL_FRONTEND_ORIGIN: `http://127.0.0.1:${staticPort}`, MINIMAL_FRONTEND_TOKEN: token };
async function start() {
  game = spawn(process.execPath, ['colyseus/minimal/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [game.stdout, game.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-8000); });
  for (let i = 0; i < 120; i++) {
    if (game.exitCode !== null) throw Error(output);
    try { if ((await fetch(base + '/health')).status === 200) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Game server did not start: ' + output);
}
async function stop() {
  if (game?.exitCode === null) { const exited = once(game, 'exit'); game.kill('SIGTERM'); await exited; }
}
const health = async () => { const response = await fetch(base + '/health'); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/); return (await response.json()).frontend; };
const activate = async (expectedGeneration, revision, headers = {}, body = JSON.stringify({ expectedGeneration, revision })) => {
  const response = await fetch(base + '/internal/frontend/activate', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body });
  return { status: response.status, data: await response.json().catch(() => null) };
};
const check = (name, fn) => fn().then(() => console.log('PASS ' + name));
try {
  await start();
  await check('empty lobby health and uninitialized generation', async () => { const h = await health(); assert.equal(h.state, 'uninitialized'); assert.equal(h.generation, 0); assert.equal(h.current, null); });
  await check('authentication, origin and proxy headers', async () => {
    assert.equal((await activate(0, A, { Authorization: 'Bearer wrong' })).status, 403);
    assert.equal((await activate(0, A, { Origin: `http://127.0.0.1:${webPort}` })).status, 403);
    for (const name of ['CF-Connecting-IP', 'X-Forwarded-For', 'Forwarded']) assert.equal((await activate(0, A, { [name]: '127.0.0.1' })).status, 403);
    const response = await new Promise((resolvePromise, reject) => { const req = http.request(base + '/internal/frontend/activate', { method: 'POST', headers: { Authorization: `Bearer ${token}\xff`, 'Content-Type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolvePromise(res.statusCode)); }); req.on('error', reject); req.end('{}'); });
    assert.equal(response, 403); assert.equal((await health()).generation, 0);
  });
  await check('body keys, JSON and 4KiB limit', async () => {
    for (const body of ['{', '{}', JSON.stringify({ expectedGeneration: 0, revision: A, path: '/bad' }), 'x'.repeat(4097)]) assert.equal((await activate(0, A, {}, body)).status, 400);
  });
  await check('schema 2, redirects, body cap and timeout reject public current', async () => {
    publicValue = { ...manifest(A), schema: 1 }; assert.equal((await activate(0, A)).status, 502);
    publicValue = manifest(A); publicStatus = 302; assert.equal((await activate(0, A)).status, 502); publicStatus = 200;
    publicBody = 'x'.repeat(512 * 1024 + 1); assert.equal((await activate(0, A)).status, 502); publicBody = undefined;
    publicDelay = 5500; assert.equal((await activate(0, A)).status, 502); publicDelay = 0;
    assert.equal((await health()).generation, 0);
  });
  await check('first activation, duplicate, current mismatch and stale CAS', async () => {
    let response = await activate(0, A); assert.equal(response.status, 200); assert.equal(response.data.activation, 'confirmed'); assert.equal(response.data.notification.state, 'queued');
    assert.equal((await health()).generation, 1); assert.equal(JSON.parse(readFileSync(resolve(state, 'frontend-current.json'))).generation, 1);
    response = await activate(0, A); assert.equal(response.status, 200); assert.equal(response.data.generation, 1);
    publicValue = manifest(B); assert.equal((await activate(1, A)).status, 409); assert.equal((await activate(0, B)).status, 409);
    response = await activate(1, B); assert.equal(response.status, 200); assert.equal(response.data.generation, 2);
    publicValue = manifest(A); response = await activate(2, A); assert.equal(response.status, 200); assert.equal(response.data.generation, 3);
  });
  await check('restart restores durable generation without PB', async () => { await stop(); await start(); const h = await health(); assert.equal(h.state, 'ready'); assert.equal(h.generation, 3); assert.equal(h.current.revision, A); });
  await check('socket current request, revision broadcast and reconnect current', async () => {
    pbServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('auth-refresh')) res.end(JSON.stringify({ token: 'fixture-only', record: { id: 'fixture-user' } }));
      else if (req.url.includes('profiles')) res.end(JSON.stringify({ page: 1, perPage: 1, totalItems: 1, totalPages: 1, items: [{ name: 'fixture' }] }));
      else res.end(JSON.stringify({ code: 200 }));
    });
    pbServer.listen(pbPort, '127.0.0.1'); await once(pbServer, 'listening');
    const client = new Client(`ws://127.0.0.1:${gamePort}`); client.auth.token = 'fixture-only';
    room = await client.joinOrCreate('minimal-town', { zone: 'lobby' }); room.reconnection.maxRetries = 0;
    let current, revision;
    room.onMessage('snapshot', () => {});
    room.onMessage('frontendCurrent', value => { current = value; });
    room.onMessage('frontendRevision', value => { revision = value; });
    room.send('frontendCurrent', {});
    for (let i = 0; i < 50 && !current; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(current.generation, 3); assert.equal(current.revision, A);
    publicValue = manifest(B); const response = await activate(3, B);
    assert.equal(response.status, 200); assert.deepEqual(response.data.notification, { state: 'queued', targets: 1, failed: 0 });
    for (let i = 0; i < 50 && !revision; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(revision.generation, 4); assert.equal(revision.revision, B);
    const reconnectToken = room.reconnectionToken;
    room.connection.transport.ws.close(); await new Promise(resolve => setTimeout(resolve, 100));
    room = await client.reconnect(reconnectToken); room.reconnection.maxRetries = 0;
    current = null; room.onMessage('snapshot', () => {}); room.onMessage('frontendCurrent', value => { current = value; }); room.send('frontendCurrent', {});
    for (let i = 0; i < 50 && !current; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(current.generation, 4); assert.equal(current.revision, B);
    await room.leave(); room = null; await new Promise(resolve => pbServer.close(resolve)); pbServer = null;
  });
  await check('corrupt state leaves game health 200 and blocks activation', async () => {
    await stop(); writeFileSync(resolve(state, 'frontend-current.json'), '{broken'); await start();
    const h = await health(); assert.equal(h.state, 'error'); assert.equal((await activate(0, A)).status, 503);
    assert.equal(readFileSync(resolve(state, 'frontend-current.json'), 'utf8'), '{broken');
  });
} finally {
  if (room?.connection.isOpen) await room.leave();
  if (pbServer) await new Promise(resolve => pbServer.close(resolve));
  await stop(); await new Promise(resolve => staticServer.close(resolve));
}
