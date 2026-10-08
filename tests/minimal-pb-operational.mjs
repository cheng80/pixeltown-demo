// A bounded two-client check; never resumes the stopped 85-client deployment loop.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { stepToward } from '../minimal/shared/world.js';
import WebSocket from '../colyseus/node_modules/ws/wrapper.mjs';
globalThis.WebSocket = WebSocket;
const { Client } = await import('@colyseus/sdk');
assert.equal(process.env.MINIMAL_OPERATIONAL, '1', 'Requires an authorized minimal operational check');
assert(process.env.CHROME_PATH?.includes('chromium-1193/'));
assert(process.env.MINIMAL_OPERATIONAL_ACCOUNTS, 'Reuse private test accounts');
const directory = mkdtempSync(resolve('.test-work/minimal-pb-public-'));
const accounts = JSON.parse(readFileSync(process.env.MINIMAL_OPERATIONAL_ACCOUNTS, 'utf8')).slice(0, 2);
assert.equal(accounts.length, 2);
const base = 'https://pixeltown-minimal-rt.fastmake.net', pbUrl = 'https://pixeltown-minimal-pb.fastmake.net';
const report = { passed: false, production: true, directory, deployments: [] };
const run = promisify(execFile), ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-i', process.env.HOME + '/.ssh/stonematch_macmini_ed25519', 'cheng80@mac-mini.tailc386bf.ts.net'];
async function control(action) { const { stdout } = await run('ssh', [...ssh, 'cd /Users/cheng80/Servers/pixeltown-minimal/app && python3 .test-work/pb-operational-control.py ' + action], { timeout: 70000, maxBuffer: 1000000 }); return JSON.parse(stdout); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await sleep(50); } throw new Error('Timeout: ' + label); }
let browser, page, room, timer, observing = true, snapshot, pos, seq = 0, drops = 0, fixes = 0, last = 0, maxGap = 0, snapshots = 0, restored = false, prepared = false;
try {
  const refreshed = await (await fetch(pbUrl + '/api/collections/users/auth-refresh', { method: 'POST', headers: { Authorization: accounts[1].token } })).json(); assert(refreshed.token && refreshed.record);
  const client = new Client(base.replace('https:', 'wss:')); client.auth.token = accounts[0].token;
  room = await client.joinOrCreate('minimal-town', { zone: 'lobby' }); room.reconnection.maxRetries = 0;
  const identity = { roomId: room.roomId, sessionId: room.sessionId };
  room.onMessage('snapshot', s => { const t = performance.now(); if (last) maxGap = Math.max(maxGap, t - last); last = t; snapshots++; snapshot = s; const p = s.players.find(p => p.id === accounts[0].id); if (p) { fixes = p.fix; if (!pos) pos = { x: p.x, y: p.y }; } });
  room.onMessage('deployment', () => {}); room.onMessage('gameEnded', () => {});
  room.onDrop(() => { if (observing) drops++; }); room.onError(() => { if (observing) drops++; }); room.onLeave(() => { if (observing) drops++; });
  await until(() => snapshot, 'SDK snapshot'); const origin = { ...pos };
  timer = setInterval(() => { const next = stepToward(pos, { x: origin.x + (Math.floor(seq / 3) % 2 ? 0 : 12), y: origin.y }); if (next.x === pos.x && next.y === pos.y) return; pos = next; room.send('move', { ...pos, seq: ++seq, fix: 0 }); }, 50);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true }); const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(auth => localStorage.setItem('pixeltown.minimal.auth', JSON.stringify({ token: auth.token, record: auth.record })), refreshed);
  page = await context.newPage(); await page.goto('https://pixeltown.fastmake.net');
  // Existing authenticated guests enter automatically; no manual entry button.
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); let f = c?.[Object.keys(c).find(k => k.startsWith('__reactFiber'))]; while (f && !f.memoizedProps?.engine) f = f.return;
    if (f?.memoizedProps?.engine?.initialized && f.memoizedProps.engine.room?.connection.isOpen) { window.__pbEngine = f.memoizedProps.engine; return true; } return false; });
  await page.evaluate(() => { const e = window.__pbEngine, r = e.room; window.__pbPublic = { roomId: r.roomId, sessionId: r.sessionId, firstSeq: e.seq, drops: 0, errors: 0, covers: 0, fixes: 0, snapshots: 0, maxGap: 0, live: true }; let last = performance.now();
    r.onDrop(() => window.__pbPublic.drops++); r.onError(() => window.__pbPublic.errors++);
    r.onMessage('snapshot', s => { if (!window.__pbPublic.live) return; const t = performance.now(), me = s.players.find(p => p.id === e.userId); const q = window.__pbPublic; q.snapshots++; q.maxGap = Math.max(q.maxGap, t - last); last = t; if (me?.fix) q.fixes++; });
    const check = () => { if (!window.__pbPublic.live) return; if (document.querySelector('.overlay.cover')) window.__pbPublic.covers++; requestAnimationFrame(check); }; requestAnimationFrame(check);
  });
  report.initialHealth = await (await fetch(base + '/health')).json();
  const movement = setInterval(() => { if (!page) return; void page.keyboard.up('ArrowLeft').then(() => page.keyboard.down('ArrowRight')).catch(() => {}); }, 6000);
  try {
    await page.keyboard.down('ArrowRight'); await sleep(1500); await page.keyboard.up('ArrowRight'); await page.keyboard.down('ArrowLeft');
    report.prepare = await control('prepare'); prepared = true;
    report.deployments.push(await control('deploy')); await sleep(1500);
    await page.keyboard.up('ArrowLeft'); await page.keyboard.down('ArrowRight');
    report.deployments.push(await control('restore')); restored = true; await sleep(4000);
  } finally { clearInterval(movement); }
  await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight'); clearInterval(timer);
  await until(() => snapshot.players.find(p => p.id === accounts[0].id).ack === seq, 'SDK last input acknowledged');
  await page.waitForFunction(() => window.__pbEngine.pending.length === 0);
  report.browser = await page.evaluate(() => { const e = window.__pbEngine, q = window.__pbPublic; q.live = false; return { ...q, lastSeq: e.seq, pending: e.pending.length, finalRoomId: e.room.roomId, finalSessionId: e.room.sessionId }; });
  assert.equal(report.browser.drops + report.browser.errors + report.browser.covers + report.browser.fixes, 0); assert.equal(report.browser.roomId, report.browser.finalRoomId); assert.equal(report.browser.sessionId, report.browser.finalSessionId);
  assert(report.browser.lastSeq - report.browser.firstSeq > 100); assert(seq > 100); assert.equal(drops + fixes, 0); assert.equal(room.roomId, identity.roomId); assert.equal(room.sessionId, identity.sessionId);
  report.finalHealth = await (await fetch(base + '/health')).json(); assert.equal(report.finalHealth.worker.generation, report.initialHealth.worker.generation);
  Object.assign(report, { inputs: seq, snapshots, drops, fixes, maxSnapshotGap: maxGap, passed: true });
  await page.screenshot({ path: resolve(directory, 'public-pb-deployment.png') });
} catch (error) { report.error = error.stack; process.exitCode = 1; console.error(error.message); }
finally {
  observing = false; clearInterval(timer);
  if (prepared && !restored) { try { report.restore = await control('restore'); } catch (e) { report.restoreError = String(e); } }
  if (page) { await page.evaluate(async () => { if (window.__pbPublic) window.__pbPublic.live = false; await window.__pbEngine?.room?.leave(); }).catch(() => {}); }
  if (browser) await browser.close(); if (room?.connection.isOpen) await room.leave();
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(`Report: ${directory}/report.json`);
}
