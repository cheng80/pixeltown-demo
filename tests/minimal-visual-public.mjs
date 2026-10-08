// One owned browser observes two real compatible Pages deployments alongside the existing 85 bots.
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const directory = mkdtempSync(resolve('.test-work/minimal-visual-public-'));
writeFileSync(resolve('.local/minimal/visual-public-observe.json'), JSON.stringify({ pid: process.pid, directory }));
const report = { directory, deployments: [], errors: [] };
let browser, page;
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  const account = JSON.parse(readFileSync('.test-work/minimal-live-KytYyv/accounts.json'))[99];
  const response = await fetch('https://pixeltown-minimal-pb.fastmake.net/api/collections/users/auth-refresh', { method: 'POST', headers: { Authorization: account.token } });
  const auth = await response.json(); assert(response.ok && auth.token && auth.record);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(value => localStorage.setItem('pixeltown.minimal.auth', JSON.stringify({ token: value.token, record: value.record })), auth);
  page = await context.newPage(); let navigations = 0;
  page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++; }); page.on('pageerror', e => report.errors.push(e.message));
  await page.goto('https://pixeltown.fastmake.net');
  await page.waitForFunction(() => window.__minimalVisual?.movement.connected, null, { timeout: 30000 });
  report.initial = await page.evaluate(() => ({ status: window.__minimalVisual.status, movement: window.__minimalVisual.movement }));
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas'); let f = canvas[Object.keys(canvas).find(k => k.startsWith('__reactFiber'))]; while (f && !f.memoizedProps?.engine) f = f.return;
    const e = f.memoizedProps.engine; window.__visualPublicEngine = e;
    const q = window.__visualPublic = { snapshots: 0, maxGap: 0, drops: 0, errors: 0, covers: 0, applied: [], live: true, last: performance.now() };
    for (const on of ['onDrop', 'onLeave']) e.room[on](() => { if (q.live) q.drops++; });
    e.room.onError(() => { if (q.live) q.errors++; });
    e.room.onMessage('snapshot', () => { if (!q.live) return; const t = performance.now(); q.snapshots++; q.maxGap = Math.max(q.maxGap, t - q.last); q.last = t; });
    window.addEventListener('minimal-visual-status', event => { if (q.live && event.detail.phase === 'applied') q.applied.push({ revision: event.detail.revision, seq: e.seq, keys: [...e.keys], pad: { ...e.pad }, target: e.target && { ...e.target }, others: e.others.size }); });
    const check = () => { if (!q.live) return; if (document.querySelector('.cover')) q.covers++; requestAnimationFrame(check); }; requestAnimationFrame(check);
    e.keys.add('d'); e.target = null;
    window.__visualPublicSteering = setInterval(() => { if (e.self.x > 500) { e.keys.delete('d'); e.keys.add('a'); } if (e.self.x < 100) { e.keys.delete('a'); e.keys.add('d'); } }, 50);
  });
  writeFileSync(resolve(directory, 'ready.json'), JSON.stringify(report.initial, null, 2)); console.log(`READY ${directory}`);
  for (let step = 1; step <= 2; step++) {
    const command = resolve(directory, `expect-${step}.json`); const deadline = Date.now() + 600000;
    while (!existsSync(command)) { if (Date.now() > deadline) throw new Error('No deployment command before test deadline'); await wait(500); }
    const { revision } = JSON.parse(readFileSync(command));
    await page.waitForFunction(id => window.__minimalVisual.status.revision === id, revision, { timeout: 90000 });
    const observed = await page.evaluate(() => ({ status: window.__minimalVisual.status, movement: window.__minimalVisual.movement, activeStyles: [...document.querySelectorAll('link[rel="stylesheet"]')].filter(l => !l.disabled && l.media !== 'not all').map(l => l.href), fonts: [...document.fonts].filter(f => f.family.startsWith('PixelTown_')).map(f => ({ family: f.family, status: f.status })) }));
    assert.equal(observed.status.revision, revision); assert(observed.status.applied >= step); assert.equal(observed.status.failures, 0);
    assert(observed.activeStyles.every(url => url.includes(revision))); assert(observed.fonts.some(f => f.family.endsWith(revision) && f.status === 'loaded'));
    assert.equal(observed.movement.roomId, report.initial.movement.roomId); assert.equal(observed.movement.sessionId, report.initial.movement.sessionId);
    assert.equal(observed.movement.fix, report.initial.movement.fix); assert(observed.movement.keys.length > 0); assert(observed.movement.others >= 85);
    report.deployments.push(observed); writeFileSync(resolve(directory, `applied-${step}.json`), JSON.stringify(observed, null, 2));
    await page.screenshot({ path: resolve(directory, `public-${step}.png`) }); console.log(`APPLIED ${step} ${revision.slice(0, 8)}`);
  }
  await page.evaluate(() => { clearInterval(window.__visualPublicSteering); window.__visualPublicEngine.keys.clear(); });
  await page.waitForFunction(() => window.__minimalVisual.movement.pending === 0);
  report.final = await page.evaluate(() => { window.__visualPublic.live = false; return { status: window.__minimalVisual.status, movement: window.__minimalVisual.movement, connection: window.__visualPublic }; });
  assert.equal(report.final.connection.drops + report.final.connection.errors + report.final.connection.covers, 0);
  assert.equal(report.final.movement.ack, report.final.movement.seq); assert(report.final.movement.seq > 100);
  assert(report.final.connection.applied.every(item => item.keys.length > 0 && item.others >= 85)); assert.deepEqual(report.errors, []);
  assert.equal(navigations, 1); report.navigations = navigations; report.passed = true;
} catch (error) { report.error = error.stack; if (page) report.failedState = await page.evaluate(() => ({ status: window.__minimalVisual?.status, movement: window.__minimalVisual?.movement })).catch(() => null); process.exitCode = 1; console.error(error.message); }
finally {
  if (page) await page.evaluate(async () => { if (window.__visualPublic) window.__visualPublic.live = false; clearInterval(window.__visualPublicSteering); await window.__visualPublicEngine?.room?.leave(); }).catch(() => {});
  if (browser) await browser.close(); writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(`Report: ${directory}/report.json`);
}
