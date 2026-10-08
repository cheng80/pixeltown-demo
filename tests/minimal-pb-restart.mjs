// Real isolated PB/host/browser. Never stops a developer or production process.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@colyseus/sdk';
import { stepToward } from '../minimal/shared/world.js';
import { stopChild } from '../scripts/minimal-process.mjs';

const root = process.cwd(); mkdirSync(resolve(root, '.test-work'), { recursive: true });
const fixture = mkdtempSync(resolve(root, '.test-work/minimal-pb-restart-'));
for (const path of ['colyseus/minimal', 'minimal/shared', 'minimal/game', 'pocketbase/minimal', 'scripts']) {
  cpSync(resolve(root, path), resolve(fixture, path), { recursive: true, filter: path => !path.includes('/.qa') && !path.includes('/__pycache__') });
}
cpSync(resolve(root, 'vite.minimal.config.js'), resolve(fixture, 'vite.minimal.config.js'));
writeFileSync(resolve(fixture, 'package.json'), '{"type":"module"}\n');
symlinkSync(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'dir');
symlinkSync(resolve(root, 'colyseus/node_modules'), resolve(fixture, 'colyseus/node_modules'), 'dir');
const state = resolve(fixture, '.local/minimal');
const env = { ...process.env, MINIMAL_STATE_DIR: state, MINIMAL_PB_BINARY: resolve(root, 'pocketbase/.local/pocketbase'),
  MINIMAL_PB_PORT: '18125', MINIMAL_GAME_PORT: '12625', MINIMAL_WEB_PORT: '5275', MINIMAL_SETTLE_MS: '10000', MINIMAL_SPAWN_MS: '1000',
  VITE_MINIMAL_PB_URL: 'http://127.0.0.1:18125', VITE_MINIMAL_GAME_URL: 'ws://127.0.0.1:12625', MINIMAL_BACKEND_ONLY: '1' };
const pbUrl = env.VITE_MINIMAL_PB_URL, base = 'http://127.0.0.1:12625';
const children = [], rooms = [], report = { passed: false, production: false, fixture, cycles: [], tests: [] };
let pb, game, web, room, timer, browser, page, stopping = false, diagnostics = '';
let snapshot, position, target, sequence = 0, drops = 0, fixes = 0, snapshots = 0, lastSnapshot = 0, maxSnapshotGap = 0;
const matches = new Map(), gaps = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(50); }
  throw new Error('Timeout: ' + label);
}
function start(script, extra = {}) {
  const child = spawn(process.execPath, [script], { cwd: fixture, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.stdout.on('data', b => diagnostics += b); child.stderr.on('data', b => diagnostics += b);
  return child;
}
async function ready(url) { return until(async () => { try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, url); }
async function health() { return (await fetch(base + '/health')).json(); }
async function wallet(token) { return (await fetch(pbUrl + '/api/minimal/wallet', { headers: { Authorization: token } })).json(); }
async function join(token) {
  const client = new Client(env.VITE_MINIMAL_GAME_URL); client.auth.token = token;
  const joined = await client.joinOrCreate('minimal-town', { zone: 'lobby' }); joined.reconnection.maxRetries = 0; rooms.push(joined); return joined;
}
function attach(joined, id) {
  joined.onMessage('deployment', () => {});
  joined.onMessage('gameEnded', match => matches.set(match.match_id, match));
  joined.onDrop(() => { if (!stopping) drops++; });
  joined.onLeave(() => { if (!stopping) drops++; });
  joined.onError(() => { if (!stopping) drops++; });
  joined.onMessage('snapshot', value => {
    const now = performance.now(); if (lastSnapshot) { const gap = now - lastSnapshot; gaps.push(gap); maxSnapshotGap = Math.max(maxSnapshotGap, gap); }
    lastSnapshot = now; snapshots++; snapshot = value;
    const player = value.players.find(p => p.id === id); assert(player, 'connected player retained');
    fixes = player.fix; if (!position) position = { x: player.x, y: player.y };
  });
}
async function browserState() { return page?.evaluate(() => ({ ...window.__pbTest, open: !!window.__minimal?.room?.connection.isOpen,
  roomId: window.__minimal?.room?.roomId, sessionId: window.__minimal?.room?.sessionId,
  wallet: document.querySelector('.stat.saved')?.textContent, cover: !!document.querySelector('.overlay.cover') })); }
async function observeBrowser() {
  if (!page) return;
  await page.evaluate(() => {
    const d = window.__minimal, room = d.room;
    window.__pbTest = { snapshots: 0, drops: 0, errors: 0, fixes: 0, covers: 0, ack: 0, maxSnapshotGap: 0 };
    let previous = performance.now();
    room.onMessage('snapshot', value => {
      const t = performance.now(); const p = value.players.find(p => p.id === d.userId);
      Object.assign(window.__pbTest, { snapshots: window.__pbTest.snapshots + 1, fixes: p?.fix || 0, ack: p?.ack || 0,
        maxSnapshotGap: Math.max(window.__pbTest.maxSnapshotGap, t - previous) }); previous = t;
    });
    room.onDrop(() => window.__pbTest.drops++); room.onError(() => window.__pbTest.errors++);
    window.__pbCoverTimer = setInterval(() => { if (document.querySelector('.overlay.cover')) window.__pbTest.covers++; }, 50);
  });
}
async function runPostman(outage) {
  const file = resolve(root, 'tests/contracts/minimal-pb-lifecycle.postman_collection.json');
  const expected = outage ? 503 : 200;
  const child = spawn('postman', ['collection', 'run', file, '--env-var', `game_url=${base}`, '--env-var', `expected_ready=${expected}`,
    '--no-report-events'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const code = await new Promise(r => child.once('exit', r));
  writeFileSync(resolve(fixture, `postman-${outage ? 'down' : 'up'}.log`), output);
  assert.equal(code, 0, output.slice(-1500)); report.tests.push(`Postman /health 200 and /ready ${expected}`);
}

try {
  console.log(`Fixture: ${fixture}`);
  pb = start('scripts/minimal-pocketbase.mjs'); await ready(pbUrl + '/api/health');
  game = start('scripts/start-minimal-game.mjs'); await ready(base + '/ready');
  const password = randomBytes(32).toString('hex');
  const response = await fetch(pbUrl + '/api/minimal/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '저장장애검증', password }) });
  assert.equal(response.status, 200); const auth = await response.json();
  room = await join(auth.token); attach(room, auth.record.id); await until(() => snapshot, 'first snapshot');
  const identity = { roomId: room.roomId, sessionId: room.sessionId, gamePid: game.pid };
  await runPostman(false);
  if (process.env.MINIMAL_PB_BROWSER === '1') {
    assert(process.env.CHROME_PATH, 'explicit CHROME_PATH required');
    const { chromium } = await import('playwright-core');
    web = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.minimal.config.js'], { cwd: fixture, env, stdio: 'ignore' }); children.push(web);
    await ready('http://127.0.0.1:5275');
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://127.0.0.1:5275'); await page.locator('input[name="nickname"]').fill('브라우저검증');
    await page.getByRole('button', { name: '광장 들어가기' }).click();
    await page.waitForFunction(() => window.__minimal?.room?.connection.isOpen && window.__minimal?.snapshot && !document.querySelector('.overlay.cover'));
    await observeBrowser(); report.browserIdentity = await browserState();
    await page.keyboard.down('ArrowRight');
  }
  const hooksFile = resolve(fixture, 'pocketbase/minimal/pb_hooks/api.pb.js'), originalHooks = readFileSync(hooksFile, 'utf8');
  target = snapshot.game.stars.find(s => s.y > 260 && s.x > 80 && s.x < 550) || snapshot.game.stars.find(s => s.y > 240);
  assert(target, 'reachable lower star');
  let origin;
  timer = setInterval(() => {
    if (!position || !room?.connection.isOpen) return;
    if (Math.hypot(position.x - target.x, position.y - target.y) < 3) {
      if (!origin) origin = { ...position };
      target = { x: origin.x + (target.x > origin.x ? -12 : 12), y: origin.y };
    }
    const next = stepToward(position, target); if (next.x === position.x && next.y === position.y) return;
    position = next; room.send('move', { ...next, seq: ++sequence, fix: 0 });
  }, 50);
  let byteBefore;
  for (const kind of ['planned-hooks-update', 'abrupt-pb-exit', 'rejected-hooks-rollback']) {
    const before = await health(), firstSequence = sequence, firstSnapshots = snapshots, startedAt = Date.now();
    byteBefore = (await wallet(auth.token)).balance;
    if (kind === 'abrupt-pb-exit') {
      const wrapperPid = JSON.parse(readFileSync(resolve(state, 'pb.lock'), 'utf8')).pid;
      const childPid = Number(execFileSync('pgrep', ['-P', String(wrapperPid)], { encoding: 'utf8' }).trim());
      assert(childPid > 0); process.kill(childPid, 'SIGKILL'); await until(() => pb.exitCode !== null, 'abrupt PB wrapper exit'); assert.notEqual(pb.exitCode, 0);
    } else await stopChild(pb);
    assert.equal((await fetch(base + '/health')).status, 200); assert.equal((await fetch(base + '/ready')).status, 503);
    assert.equal(game.exitCode, null); assert.equal(game.pid, identity.gamePid);
    await assert.rejects(join(auth.token), error => error.code === 503 || error.code === 401 || error.message.includes('確認') || error.message.includes('확인'));
    // Wait longer than the frontend's 8-second stale threshold, with actual movement continuing.
    for (let n = 0; n < 12; n++) {
      if (page) { await page.keyboard.up(n % 2 ? 'ArrowLeft' : 'ArrowRight'); await page.keyboard.down(n % 2 ? 'ArrowRight' : 'ArrowLeft'); }
      await sleep(1000); assert.equal((await health()).ok, true);
    }
    if (kind === 'planned-hooks-update') {
      await runPostman(true);
      writeFileSync(hooksFile, originalHooks + '\nrouterAdd("GET", "/api/minimal/test-hook-revision", (e) => e.json(200, { revision: 2 }));\n');
      await until(() => [...matches.values()].some(m => m.scores[auth.record.id] > 0), 'star collected and settled while PB offline');
      assert((await health()).persistence.pending > 0);
      const workerFile = resolve(fixture, 'colyseus/minimal/simulation.js');
      writeFileSync(workerFile, readFileSync(workerFile, 'utf8') + '\n// swap while PB is offline\n');
      const swap = start('scripts/deploy-minimal-worker.mjs');
      await until(() => swap.exitCode !== null, 'worker swap during PB outage'); assert.equal(swap.exitCode, 0);
      assert.equal((await health()).worker.generation, before.worker.generation + 1);
    }
    if (kind === 'rejected-hooks-rollback') {
      const validHooks = readFileSync(hooksFile, 'utf8');
      writeFileSync(hooksFile, validHooks + '\nonBootstrap((e) => { throw new Error("deliberate rejection in isolated test"); });\n');
      pb = start('scripts/minimal-pocketbase.mjs'); await until(() => pb.exitCode !== null, 'invalid PB hook rejected', 30000); assert.notEqual(pb.exitCode, 0);
      assert.equal(game.exitCode, null); assert.equal((await health()).ok, true);
      writeFileSync(hooksFile, validHooks);
    }
    const offline = { durationMs: Date.now() - startedAt, inputs: sequence - firstSequence, snapshots: snapshots - firstSnapshots,
      pendingMatches: (await health()).persistence.pending, balanceBefore: byteBefore };
    assert(offline.durationMs >= 12000); assert(offline.inputs > 100); assert(offline.snapshots > 150); assert.equal(drops + fixes, 0);
    if (page) {
      const b = await browserState(); assert.equal(b.cover, false); assert.equal(b.covers + b.drops + b.errors + b.fixes, 0);
      assert(b.wallet.includes('미확인'), b.wallet); assert.equal(b.roomId, report.browserIdentity.roomId); assert.equal(b.sessionId, report.browserIdentity.sessionId);
      await page.screenshot({ path: resolve(fixture, `browser-${kind}.png`) }); offline.browser = b;
    }
    pb = start('scripts/minimal-pocketbase.mjs'); await ready(base + '/ready');
    await until(async () => (await health()).persistence.pending === 0, 'outbox flushed', 20000);
    assert.equal((await fetch(pbUrl + '/api/minimal/test-hook-revision')).status, 200);
    const settled = await wallet(auth.token);
    const positive = [...matches.values()].filter(m => m.scores[auth.record.id] > 0);
    for (const match of positive) assert(settled.settledMatchIds.includes(match.match_id));
    assert.equal(settled.balance, positive.reduce((n, m) => n + m.scores[auth.record.id], 0));
    assert.equal(room.roomId, identity.roomId); assert.equal(room.sessionId, identity.sessionId); assert.equal(game.pid, identity.gamePid);
    report.cycles.push({ kind, ...offline, balanceAfter: settled.balance, drops, fixes }); console.log(`PASS ${kind}`);
  }
  clearInterval(timer); await until(() => snapshot.players.find(p => p.id === auth.record.id).ack === sequence, 'last input acknowledged');
  report.inputs = sequence; report.snapshots = snapshots; report.drops = drops; report.fixes = fixes;
  report.maxSnapshotGap = maxSnapshotGap; gaps.sort((a, b) => a - b); report.snapshotP95 = gaps[Math.floor(gaps.length * .95)];
  assert(maxSnapshotGap < 8000);
  if (page) {
    await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight');
    await page.waitForFunction(() => !document.querySelector('.stat.saved')?.textContent.includes('미확인'), undefined, { timeout: 65000 });
    report.browser = await browserState(); assert(report.browser.ack > 100); assert.equal(report.browser.covers + report.browser.drops + report.browser.errors + report.browser.fixes, 0);
    await page.screenshot({ path: resolve(fixture, 'browser-recovered.png') });
    await page.evaluate(async () => { clearInterval(window.__pbCoverTimer); await window.__minimal.room.leave(); });
    await browser.close(); browser = null; page = null;
  }
  await runPostman(false);
  stopping = true; await room.leave(); room = null; await stopChild(game); await stopChild(pb); await stopChild(web);
  // Also exercise dev:all's component-only supervisor on the same isolated DB.
  const supervisor = start('scripts/dev-minimal.mjs'); await ready(base + '/ready');
  const supervisedRoom = await join(auth.token); let supervisedSnapshots = 0, supervisedDrops = 0;
  supervisedRoom.onMessage('snapshot', () => supervisedSnapshots++); supervisedRoom.onMessage('deployment', () => {}); supervisedRoom.onMessage('gameEnded', () => {});
  supervisedRoom.onDrop(() => supervisedDrops++); supervisedRoom.onError(() => supervisedDrops++);
  const oldPbPid = JSON.parse(readFileSync(resolve(state, 'pb.lock'), 'utf8')).pid;
  const hostStatus = await health(); process.kill(oldPbPid, 'SIGTERM');
  await until(() => { try { return JSON.parse(readFileSync(resolve(state, 'pb.lock'), 'utf8')).pid !== oldPbPid; } catch { return false; } }, 'PB-only supervisor restart');
  await ready(base + '/ready'); await sleep(500);
  assert.equal(supervisor.exitCode, null); assert(supervisedRoom.connection.isOpen); assert(supervisedSnapshots > 5); assert.equal(supervisedDrops, 0);
  assert.equal((await health()).worker.generation, hostStatus.worker.generation);
  await supervisedRoom.leave(); await stopChild(supervisor); report.tests.push('dev:all restarts only PB and preserves existing room');
  report.passed = true;
} catch (error) { report.error = error.stack; console.error(error.stack); process.exitCode = 1; }
finally {
  stopping = true; clearInterval(timer);
  if (browser) await browser.close();
  await Promise.allSettled(rooms.filter(r => r.connection.isOpen).map(r => r.leave()));
  for (const child of [...children].reverse()) await stopChild(child);
  writeFileSync(resolve(fixture, 'server.log'), diagnostics);
  writeFileSync(resolve(fixture, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${fixture}/report.json`);
}
