// Real, isolated PocketBase + Colyseus. Never touches the legacy database or a remote server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@colyseus/sdk';
import PocketBase from 'pocketbase';
import { stepToward, blocked, WORLD } from '../minimal/shared/world.js';

const root = process.cwd(); mkdirSync(resolve(root, '.test-work'), { recursive: true });
const state = mkdtempSync(resolve(root, '.test-work/minimal-integration-'));
Object.assign(process.env, { MINIMAL_STATE_DIR: state, MINIMAL_PB_PORT: '18121', MINIMAL_GAME_PORT: '12621', MINIMAL_WEB_PORT: '5271', MINIMAL_SETTLE_MS: '6000', MINIMAL_SPAWN_MS: '1000' });
const { startMinimalPocketBase } = await import('../scripts/minimal-pocketbase.mjs');
const { PB_URL, GAME_PORT } = await import('../colyseus/minimal/config.js');
const ws = `ws://127.0.0.1:${GAME_PORT}`, http = `http://127.0.0.1:${GAME_PORT}`;
const children = [], rooms = new Set(), report = { tests: [], stateDirectory: state, production: false };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, name, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await sleep(50); }
  throw new Error(`Timed out: ${name}`);
}
async function check(name, fn) { const start = Date.now(); await fn(); report.tests.push({ name, passed: true, ms: Date.now() - start }); console.log(`PASS ${name}`); }
async function request(path, token, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(PB_URL + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
async function join(token, zone = 'lobby') {
  const client = new Client(ws); client.auth.token = token;
  const room = await client.joinOrCreate('minimal-town', { zone }); rooms.add(room);
  const watch = { room, snapshot: null, ended: [], disabled: [] };
  room.onMessage('snapshot', x => { watch.snapshot = x; });
  room.onMessage('gameEnded', x => watch.ended.push(x));
  room.onMessage('featureUnavailable', x => watch.disabled.push(x));
  await until(() => watch.snapshot, 'first snapshot'); return watch;
}
async function leave(watch) { await watch.room.leave(); rooms.delete(watch.room); }
let admin, guest, a, b;
try {
  const started = await startMinimalPocketBase(); children.push(started.child); admin = started.admin;
  const server = spawn(process.execPath, ['colyseus/minimal/server.js'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(server);
  let diagnostics = ''; server.stdout.on('data', b => diagnostics += b); server.stderr.on('data', b => diagnostics += b);
  await until(async () => { if (server.exitCode !== null) throw new Error(`Server failed: ${diagnostics.slice(-1200)}`); try { return (await fetch(http + '/ready')).ok; } catch { return false; } }, 'readiness');
  await check('isolated_schema_and_guest_wallet', async () => {
    const names = (await admin.collections.getFullList()).map(x => x.name);
    assert(names.includes('profiles')); assert(!names.includes('purchases')); assert(!names.includes('rooms'));
    const password = randomBytes(24).toString('hex');
    const r = await request('/api/minimal/guest', null, { name: '검증사용자', password });
    assert.equal(r.status, 200, JSON.stringify(r.data)); guest = r.data;
    const wallet = await request('/api/minimal/wallet', guest.token);
    assert.equal(wallet.status, 200); assert.equal(wallet.data.balance, 0);
    assert.deepEqual(wallet.data.settledMatchIds, []);
    const duplicate = await request('/api/minimal/guest', null, { name: '검증 사용자', password });
    assert.equal(duplicate.status, 400);
    assert.equal((await request('/api/minimal/wallet')).status, 401);
  });
  await check('single_lobby_movement_and_disabled_messages', async () => {
    a = await join(guest.token);
    const initial = a.snapshot.players.find(p => p.id === guest.record.id), next = { x: initial.x + 4, y: initial.y };
    a.room.send('move', { ...next, seq: 1, fix: 0 });
    await until(() => a.snapshot.players.find(p => p.id === guest.record.id)?.ack === 1, 'movement ack');
    assert.equal(a.snapshot.players[0].x, next.x);
    for (const type of ['chat', 'emote', 'look', 'collect', 'startGame']) a.room.send(type, { text: 'blocked' });
    await until(() => a.disabled.length === 5, 'disabled features');
    assert(a.room.connection.isOpen);
    await assert.rejects(join(guest.token, 'garden'));
    for (const route of ['shop/buy', 'shop/equip', 'shop/room', 'profile', 'guest-cleanup']) {
      const r = await request('/api/pixeltown/' + route, guest.token, { item: 'hat_crown', name: 'Nope' });
      assert([403, 404].includes(r.status), `${route}: ${r.status}`);
    }
  });
  await check('authoritative_collection_settlement_and_replay', async () => {
    const userId = guest.record.id;
    let seq = 1;
    // Pick a reachable star below the central obstacle. Every point is sent at walking speed.
    const star = a.snapshot.game.stars.find(s => s.y > 240);
    assert(star, 'minimal star layout should have a reachable lower star');
    let pos = { ...a.snapshot.players.find(p => p.id === userId) };
    const matchId = a.snapshot.game.id;
    const end = Date.now() + 12000;
    while (Date.now() < end && Math.hypot(pos.x - star.x, pos.y - star.y) > 4) {
      const next = stepToward(pos, star); assert(!blocked(next.x, next.y));
      if (next.x === pos.x && next.y === pos.y) throw new Error('Test route blocked');
      pos = next; a.room.send('move', { ...pos, seq: ++seq, fix: 0 }); await sleep(50);
    }
    await until(() => a.ended.some(m => m.scores[userId] > 0) || a.snapshot.game.scores[userId] > 0, 'star award');
    const match = await until(() => a.ended.find(m => m.scores[userId] > 0), 'settlement', 15000);
    const wallet = await until(async () => { const r = await request('/api/minimal/wallet', guest.token); return r.data.settledMatchIds?.includes(match.match_id) && r.data; }, 'persisted wallet');
    assert(wallet.balance >= 1);
    const before = wallet.balance;
    for (let i = 0; i < 2; i++) assert.equal((await request('/api/minimal/commit-match', admin.authStore.token, match)).status, 200);
    assert.equal((await request('/api/minimal/wallet', guest.token)).data.balance, before);
    assert.equal((await request('/api/minimal/commit-match', guest.token, match)).status, 403);
    const conflict = structuredClone(match); conflict.scores[userId]++;
    assert.equal((await request('/api/minimal/commit-match', admin.authStore.token, conflict)).status, 400);
    await leave(a); a = null;
  });
  await check('failed_outbox_does_not_block_valid_match', async () => {
    const bad = { match_id: '00000000-0000-4000-8000-000000000000', zone: 'lobby', ended_at: new Date().toISOString(), scores: { zzzzzzzzzzzzzzz: 1 } };
    const good = { match_id: randomUUID(), zone: 'lobby', ended_at: new Date().toISOString(), scores: { [guest.record.id]: 2 } };
    writeFileSync(resolve(state, 'outbox', bad.match_id + '.json'), JSON.stringify(bad));
    writeFileSync(resolve(state, 'outbox', good.match_id + '.json'), JSON.stringify(good));
    await until(async () => (await request('/api/minimal/wallet', guest.token)).data.settledMatchIds?.includes(good.match_id), 'healthy settlement after poison');
    assert.deepEqual(JSON.parse(readFileSync(resolve(state, 'outbox', bad.match_id + '.json'))), bad);
  });
  await check('100_clients_one_room_and_101st_rejected', async () => {
    const accounts = [], password = randomBytes(24).toString('hex');
    for (let i = 0; i < 101; i++) {
      const u = await admin.collection('users').create({ email: `load-${i}@minimal.test`, password, passwordConfirm: password, name: `시험${i}` });
      await admin.collection('profiles').create({ user: u.id, name: `시험${i}` });
      const pb = new PocketBase(PB_URL); const auth = await pb.collection('users').authWithPassword(u.email, password); accounts.push(auth);
    }
    const clients = [];
    for (let i = 0; i < 100; i++) clients.push(await join(accounts[i].token));
    assert.equal(new Set(clients.map(c => c.room.roomId)).size, 1);
    await until(() => clients.every(c => c.snapshot.players.length === 100), 'all clients see 100');
    await assert.rejects(join(accounts[100].token));
    const health = await (await fetch(http + '/health')).json(); assert.equal(health.rooms, 1); assert.equal(health.players, 100);
    await Promise.all(clients.map(c => leave(c)));
  });
  await check('pocketbase_restart_preserves_accounts_and_ledger', async () => {
    const before = (await request('/api/minimal/wallet', guest.token)).data;
    const usersBefore = (await admin.collection('users').getList(1, 1)).totalItems;
    // All clients left. Stop only this test's children; preserve the database.
    for (const child of [...children].reverse()) {
      if (child.exitCode === null && !child.signalCode) await new Promise(resolve => {
        child.once('exit', resolve); child.kill('SIGTERM');
      });
    }
    const restarted = await startMinimalPocketBase(); children.push(restarted.child);
    assert.equal((await restarted.admin.collection('users').getList(1, 1)).totalItems, usersBefore);
    assert.deepEqual((await request('/api/minimal/wallet', guest.token)).data, before);
    // Required, non-cascading relations protect even administrator deletion.
    await assert.rejects(restarted.admin.collection('users').delete(guest.record.id));
    assert.deepEqual((await request('/api/minimal/wallet', guest.token)).data, before);
  });
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack; console.error(error.stack); process.exitCode = 1;
} finally {
  await Promise.allSettled([...rooms].map(r => r.leave()));
  for (const child of [...children].reverse()) if (child.exitCode === null && !child.signalCode) await new Promise(r => { child.once('exit', r); child.kill('SIGTERM'); });
  writeFileSync(resolve(state, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${resolve(state, 'report.json')}`);
}
