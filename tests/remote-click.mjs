// Real-browser click movement against the Mac mini (`npm run dev:remote` on 5173): clicks on-screen spots, samples the
// server-confirmed position, and compares arrival time with the ideal (path length / 60 dots per second).
//   CHROME_PATH=/path/to/chromium node tests/remote-click.mjs
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import { getMap, findPath } from '../shared/world.js';
const root = new URL('..', import.meta.url).pathname, BASE = process.env.BASE || 'http://127.0.0.1:5173/';
const [acc] = process.env.LOCAL ? [{ email: 'demo1@pixeltown.local', password: 'PixelTown123!' }] : JSON.parse(await readFile(root + 'pocketbase/.local/remote-accounts.json', 'utf8'));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = { url: BASE, clicks: [] };
try {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await p.goto(BASE); await p.fill('input[type=email]', acc.email); await p.fill('input[type=password]', acc.password); await p.click('text=타운 입장하기');
  await p.waitForFunction(() => window.__pixeltown?.state.current.players?.length > 0, null, { timeout: 15000 });
  if (await p.$('.chat-head >> text=접기')) await p.click('.chat-head >> text=접기');
  const me = () => p.evaluate(id => { const q = window.__pixeltown.state.current.players.find(x => x.name === id); return q && { x: q.x, y: q.y }; }, acc.name);
  const myName = await p.evaluate(() => document.querySelector('.me-name')?.textContent); acc.name = myName;
  for (const zone of ['lobby', 'arcade']) {
    if (zone !== 'lobby') { await p.click(`.tabs button:has-text("오락실")`); await p.waitForFunction(z => window.__pixeltown.state.current.zone === z, zone); await sleep(800); }
    for (const [fx, fy] of [[0.85, 0.5], [0.15, 0.8], [0.5, 0.15], [0.2, 0.25], [0.8, 0.85]]) {
      const start = await me();
      const pt = await p.evaluate(([fx, fy]) => { const r = document.querySelector('.world').getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height * fy }; }, [fx, fy]);
      await p.mouse.click(pt.x, pt.y); await sleep(60);
      const target = await p.evaluate(() => window.__pixeltown.marker.current);
      if (!target) { out.clicks.push({ zone, fx, fy, note: 'no route (blocked spot)' }); continue; }
      const path = findPath(getMap(zone), start, target); let length = 0, a = start; for (const w of path) { length += Math.hypot(w.x - a.x, w.y - a.y); a = w; }
      const t0 = Date.now(), samples = []; let arrived = null;
      while (Date.now() - t0 < 20000) {
        const q = await me(); samples.push(q);
        if (!(await p.evaluate(() => window.__pixeltown.route.current.length)) && Math.hypot(q.x - target.x, q.y - target.y) < 3) { arrived = Date.now() - t0; break; }
        await sleep(50);
      }
      // Backtracking: steps whose movement points away from the remaining route by more than 90 degrees.
      let back = 0; for (let i = 2; i < samples.length; i++) { const v = [samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y], u = [samples[i - 1].x - samples[i - 2].x, samples[i - 1].y - samples[i - 2].y]; if (Math.hypot(...v) > 0.5 && Math.hypot(...u) > 0.5 && v[0] * u[0] + v[1] * u[1] < 0) back++; }
      const end = samples.at(-1), route = await p.evaluate(() => window.__pixeltown.route.current);
      out.clicks.push({ zone, pathDots: Math.round(length), idealMs: Math.round(length / 60 * 1000), arrivedMs: arrived, extraMs: arrived && Math.round(arrived - length / 60 * 1000), reversals: back, endOff: +Math.hypot(end.x - target.x, end.y - target.y).toFixed(1), ...(arrived ? {} : { target, end, routeLeft: route, last: samples.slice(-6) }) });
    }
  }
  out.ok = out.clicks.every(c => c.note || (c.arrivedMs && c.reversals <= 2));
  console.log(out.ok ? 'PASS' : 'FAIL', JSON.stringify(out.clicks));
  if (!process.env.LOCAL) await writeFile(root + 'tests/remote-click-report.json', JSON.stringify({ at: new Date().toISOString(), ...out }, null, 2) + '\n');
} finally { await browser.close(); }
