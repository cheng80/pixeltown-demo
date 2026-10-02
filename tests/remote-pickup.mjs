// Real-browser star pickup against the Mac mini (`npm run dev:remote` on 5173): walks onto the nearest stars with the
// arrow keys and measures when the screen hides the star (hitbox touch) and when the server snapshot drops it.
//   CHROME_PATH=/path/to/chromium node tests/remote-pickup.mjs
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import { getMap, findPath } from '../shared/world.js';
const root = new URL('..', import.meta.url).pathname, BASE = process.env.BASE || 'http://127.0.0.1:5173/';
const [acc] = JSON.parse(await readFile(root + 'pocketbase/.local/remote-accounts.json', 'utf8'));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = { url: BASE, pickups: [] };
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(([email, password]) => localStorage.setItem('pixeltown.guest', JSON.stringify({ email, password })), [acc.email, acc.password]);
  const p = await ctx.newPage(); await p.goto(BASE);
  await p.waitForFunction(() => window.__pixeltown?.state.current.game?.stars?.length > 0, null, { timeout: 15000 });
  const look = () => p.evaluate(() => {
    const t = window.__pixeltown, a = t.anim.get(t.self.current);
    return { me: a && { x: a.x, y: a.y }, stars: t.state.current.game.stars, picked: Object.keys(t.picked.current) };
  });
  const held = new Set(), hold = async keys => {
    for (const k of held) if (!keys.includes(k)) { await p.keyboard.up(k); held.delete(k); }
    for (const k of keys) if (!held.has(k)) { await p.keyboard.down(k); held.add(k); }
  };
  for (let n = 0; n < 5; n++) {
    let s = await look();
    const star = s.stars.filter(q => !s.picked.includes(q.id)).sort((a, b) => Math.hypot(a.x - s.me.x, a.y - s.me.y) - Math.hypot(b.x - s.me.x, b.y - s.me.y))[0];
    const path = [...findPath(getMap(await p.evaluate(() => window.__pixeltown.zone)), s.me, star), star];
    const t0 = Date.now(); let hideMs = null, at = null, goneMs = null;
    while (Date.now() - t0 < 25000 && goneMs === null) {
      s = await look();
      if (hideMs === null && s.picked.includes(star.id)) { hideMs = Date.now() - t0; at = { dx: Math.round(s.me.x - star.x), dy: Math.round(s.me.y - star.y) }; await hold([]); }
      if (!s.stars.some(q => q.id === star.id)) goneMs = Date.now() - t0;
      if (hideMs === null) {
        while (path.length > 1 && Math.hypot(path[0].x - s.me.x, path[0].y - s.me.y) < 3) path.shift();
        const dx = path[0].x - s.me.x, dy = path[0].y - s.me.y;
        await hold([...(Math.abs(dx) > 1.5 ? [dx > 0 ? 'ArrowRight' : 'ArrowLeft'] : []), ...(Math.abs(dy) > 1.5 ? [dy > 0 ? 'ArrowDown' : 'ArrowUp'] : [])]);
      }
      await sleep(16);
    }
    await hold([]);
    // A star the server never confirmed would come back on screen one second after it was hidden.
    await sleep(1200); s = await look();
    out.pickups.push({ hideMs, serverLagMs: goneMs !== null && hideMs !== null ? goneMs - hideMs : null, touchAt: at, reappeared: s.stars.some(q => q.id === star.id) });
  }
  out.ok = out.pickups.every(q => q.hideMs !== null && q.serverLagMs !== null && !q.reappeared);
  console.log(out.ok ? 'PASS' : 'FAIL', JSON.stringify(out.pickups));
  await writeFile(root + 'tests/remote-pickup-report.json', JSON.stringify({ at: new Date().toISOString(), ...out }, null, 2) + '\n');
} finally { await browser.close(); }
