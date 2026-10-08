// One owned browser verifies the currently published walking animation; no deployment or bot control.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const directory = mkdtempSync(resolve('.test-work/minimal-walking-public-'));
const report = { directory };
let browser, page;
try {
  const account = JSON.parse(readFileSync('.test-work/minimal-live-KytYyv/accounts.json'))[99];
  const response = await fetch('https://pixeltown-minimal-pb.fastmake.net/api/collections/users/auth-refresh', { method: 'POST', headers: { Authorization: account.token } });
  const auth = await response.json(); assert(response.ok && auth.token && auth.record);
  const probe = await build({ entryPoints: ['minimal/game/tests/walking-probe.js'], bundle: true, write: false, format: 'iife', globalName: 'WalkingQA' });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(value => localStorage.setItem('pixeltown.minimal.auth', JSON.stringify(value)), { token: auth.token, record: auth.record });
  page = await context.newPage();
  await page.goto('https://pixeltown.fastmake.net');
  await page.waitForFunction(() => window.__minimalVisual?.movement.connected);
  await page.addScriptTag({ content: probe.outputFiles[0].text });
  const key = await page.evaluate(() => {
    const canvas = document.querySelector('canvas'); let f = canvas[Object.keys(canvas).find(k => k.startsWith('__reactFiber'))]; while (f && !f.memoizedProps?.engine) f = f.return;
    window.__walkingEngine = f.memoizedProps.engine; window.__walkingProbe = WalkingQA.observeWalking(window.__walkingEngine);
    return window.__walkingEngine.self.x < 80 ? 'd' : window.__walkingEngine.self.x > 560 ? 'a' : window.__walkingEngine.self.x < 320 ? 'a' : 'd';
  });
  report.before = await page.evaluate(() => window.__minimalVisual.movement);
  await page.keyboard.down(key); await page.waitForTimeout(1500); await page.keyboard.up(key);
  report.walking = await page.evaluate(() => ({ frames: window.__walkingProbe.read(), movement: window.__minimalVisual.movement }));
  assert.deepEqual(Object.keys(report.walking.frames).sort(), ['0', '1', '3']);
  assert(report.walking.movement.movedAt > report.before.movedAt); assert(report.walking.movement.seq > report.before.seq);
  await page.waitForTimeout(250); await page.evaluate(() => window.__walkingProbe.clear()); await page.waitForTimeout(650);
  report.standing = await page.evaluate(() => ({ frames: window.__walkingProbe.read(), movement: window.__minimalVisual.movement, cover: !!document.querySelector('.cover') }));
  assert.deepEqual(Object.keys(report.standing.frames), ['0']); assert.equal(report.standing.cover, false);
  assert.equal(report.standing.movement.fix, report.before.fix); assert.equal(report.standing.movement.sessionId, report.before.sessionId);
  await page.screenshot({ path: resolve(directory, 'standing.png') }); report.passed = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  if (page) await page.evaluate(async () => { window.__walkingProbe?.dispose(); await window.__walkingEngine?.room?.leave(); }).catch(() => {});
  if (browser) await browser.close(); writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ directory, passed: report.passed, walking: report.walking?.frames, standing: report.standing?.frames, error: report.error }));
}
