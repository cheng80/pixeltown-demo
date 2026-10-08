// Real existing PB/game; only Pages-like static file delivery and faulty releases are controlled.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const directory = mkdtempSync(resolve(root, '.test-work/minimal-visual-'));
const app = resolve(directory, 'app'); mkdirSync(app);
for (const name of ['minimal', 'scripts', 'vite.minimal.config.js', 'package.json', 'package-lock.json']) cpSync(resolve(root, name), resolve(app, name), { recursive: true });
symlinkSync(resolve(root, 'node_modules'), resolve(app, 'node_modules'));
const build = () => { execFileSync(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.minimal.config.js'], { cwd: app, stdio: 'pipe' }); return JSON.parse(readFileSync(resolve(app, 'dist-minimal/visual/current.json'))); };
const original = build();
const report = { directory, original: original.revision, checks: [], errors: [] };
let browser, page, delivered = original, fault, observing = false;
try {
  assert(process.env.CHROME_PATH?.includes('chromium-1193/'));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  let navigations = 0; page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++; });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.route('http://127.0.0.1:5270/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/visual/current.json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(delivered), headers: { 'Cache-Control': 'no-store' } });
    if (fault?.path === path) return route.fulfill({ status: fault.status || 404, contentType: fault.type || 'text/plain', body: fault.body || 'missing' });
    const file = resolve(app, 'dist-minimal', path === '/' ? 'index.html' : '.' + path);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'missing' });
    const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream';
    return route.fulfill({ status: 200, contentType: type, body: readFileSync(file) });
  });
  await page.goto('http://127.0.0.1:5270');
  if (await page.locator('input[name="nickname"]').count()) { await page.locator('input[name="nickname"]').fill('교체' + Date.now().toString().slice(-6)); await page.getByRole('button', { name: '광장 들어가기', exact: true }).click(); }
  await page.waitForFunction(() => window.__minimalVisual?.movement.connected);
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas'); let fiber = canvas[Object.keys(canvas).find(k => k.startsWith('__reactFiber'))];
    while (fiber && !fiber.memoizedProps?.engine) fiber = fiber.return;
    const engine = fiber.memoizedProps.engine; window.__visualTestEngine = engine;
    const room = engine.room; window.__visualTest = { drops: 0, errors: 0, covers: 0, snapshots: 0, gap: 0, last: performance.now(), live: true };
    for (const on of ['onDrop', 'onLeave']) room[on](() => { if (window.__visualTest.live) window.__visualTest.drops++; });
    room.onError(() => { if (window.__visualTest.live) window.__visualTest.errors++; });
    room.onMessage('snapshot', () => { const q = window.__visualTest; if (!q.live) return; q.snapshots++; const t = performance.now(); q.gap = Math.max(q.gap, t - q.last); q.last = t; });
    const check = () => { if (!window.__visualTest.live) return; if (document.querySelector('.cover')) window.__visualTest.covers++; requestAnimationFrame(check); }; requestAnimationFrame(check);
    engine.keys.add('d'); engine.target = null;
    window.__visualTestSteering = setInterval(() => { if (engine.self.x > 500) { engine.keys.delete('d'); engine.keys.add('a'); } if (engine.self.x < 140) { engine.keys.delete('a'); engine.keys.add('d'); } }, 50);
  });
  observing = true;
  const before = await page.evaluate(() => window.__minimalVisual.movement); report.before = before;
  // A real bitmap asset and a code change are published as one visual release.
  writeFileSync(resolve(app, 'minimal/game/public/hot-proof.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path fill="#1234ef" d="M0 0h16v16H0z"/></svg>');
  let source = readFileSync(resolve(app, 'minimal/game/src/visual-release.js'), 'utf8');
  source = source.replace('return { draw, dispose() {} };', "return { draw(now) { draw(now); const image = resources.images.get('hot-proof.svg'); if (image) { dc.drawImage(image, 80, 80); canvas.dataset.testRenderer = 'updated'; } }, dispose() {} };");
  writeFileSync(resolve(app, 'minimal/game/src/visual-release.js'), source);
  writeFileSync(resolve(app, 'minimal/game/src/style.css'), readFileSync(resolve(app, 'minimal/game/src/style.css'), 'utf8') + '\n.titlebar { background-color: rgb(222, 240, 255); }\n');
  const next = build(); assert.equal(next.compatibility, original.compatibility); assert.notEqual(next.revision, original.revision); delivered = next;
  await page.waitForFunction(id => window.__minimalVisual.status.revision === id && window.__minimalVisual.status.applied === 1, next.revision, { timeout: 25000 });
  const visible = await page.evaluate(() => ({ renderer: document.querySelector('canvas').dataset.testRenderer, pixel: [...document.querySelector('canvas').getContext('2d').getImageData(82, 82, 1, 1).data], background: getComputedStyle(document.querySelector('.titlebar')).backgroundColor, fonts: [...document.fonts].filter(f => f.family.startsWith('PixelTown_')).map(f => f.status) }));
  assert.equal(visible.renderer, 'updated'); assert.deepEqual(visible.pixel, [18, 52, 239, 255]); assert.equal(visible.background, 'rgb(222, 240, 255)'); assert.deepEqual(visible.fonts, ['loaded', 'loaded']);
  report.checks.push({ name: 'code-image-css-font-live-swap', passed: true, ...visible });
  await page.screenshot({ path: resolve(directory, 'updated-desktop.png') });
  const make = async (name, transform, badFile) => {
    const id = (name === 'missing' ? 'd' : name === 'broken' ? 'e' : name === 'later-error' ? 'f' : 'c').repeat(64);
    const m = JSON.parse(JSON.stringify(next).replaceAll(next.revision, id));
    const src = resolve(app, 'dist-minimal/visual/releases', next.revision), dest = resolve(app, 'dist-minimal/visual/releases', id);
    cpSync(src, dest, { recursive: true });
    if (transform) transform(m, dest);
    delivered = m; fault = badFile?.(m);
    const failures = await page.evaluate(() => window.__minimalVisual.status.failures);
    if (name === 'incompatible') await page.waitForFunction(() => window.__minimalVisual.status.phase === 'incompatible', null, { timeout: 25000 });
    else await page.waitForFunction(n => window.__minimalVisual.status.failures > n, failures, { timeout: 25000 });
    assert.equal(await page.evaluate(() => window.__minimalVisual.status.revision), next.revision);
    report.checks.push({ name, passed: true, status: await page.evaluate(() => window.__minimalVisual.status) }); fault = null;
  };
  await make('missing', null, m => ({ path: m.images[0].url }));
  await make('broken', null, m => ({ path: m.entry, status: 200, type: 'application/javascript', body: 'export function createRenderer() { throw new Error("bad renderer") }' }));
  await make('later-error', null, m => ({ path: m.entry, status: 200, type: 'application/javascript', body: 'export function createRenderer() { let frames = 0; return { draw() { if (++frames > 3) throw new Error("late draw failure") }, dispose() {} } }' }));
  assert.equal(await page.evaluate(() => window.__minimalVisual.status.rollbacks), 1);
  await make('incompatible', m => { m.compatibility = '0'.repeat(64); });
  delivered = next;
  await page.waitForFunction(() => window.__minimalVisual.status.phase === 'idle', null, { timeout: 25000 });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: resolve(directory, 'updated-mobile.png') });
  await page.evaluate(() => { clearInterval(window.__visualTestSteering); window.__visualTestEngine.keys.clear(); });
  await page.waitForFunction(() => window.__minimalVisual.movement.pending === 0);
  report.after = await page.evaluate(() => window.__minimalVisual.movement);
  report.connection = await page.evaluate(() => { window.__visualTest.live = false; return window.__visualTest; });
  observing = false; report.navigations = navigations;
  assert.equal(navigations, 1); assert.equal(report.connection.drops + report.connection.errors + report.connection.covers, 0);
  assert.equal(before.roomId, report.after.roomId); assert.equal(before.sessionId, report.after.sessionId); assert.equal(before.userId, report.after.userId);
  assert.equal(report.after.fix, before.fix); assert(report.after.seq > before.seq + 500); assert.equal(report.after.ack, report.after.seq); assert.equal(report.after.pending, 0);
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.error = error.stack; if (page) report.failedState = await page.evaluate(() => ({ status: window.__minimalVisual?.status, movement: window.__minimalVisual?.movement })).catch(() => null); process.exitCode = 1; console.error(error.message); }
finally {
  if (page) await page.evaluate(async () => { if (window.__visualTest) window.__visualTest.live = false; clearInterval(window.__visualTestSteering); await window.__visualTestEngine?.room?.leave(); }).catch(() => {});
  if (browser) await browser.close();
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Report: ${directory}/report.json`);
}
