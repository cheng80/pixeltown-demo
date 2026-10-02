// Smoothness check (screen shake): hold an arrow key and sample every animation frame. While the camera follows, the
// avatar must stay on the same screen pixel, and its per-frame movement must be even (no stalls or jumps).
//   CHROME_PATH=… BASE=http://127.0.0.1:5273/ ACCOUNT=demo1@pixeltown.local:PixelTown123! node tests/motion-check.mjs
//   (remote: BASE=https://pixeltown.fastmake.net/ and an account from pocketbase/.local/remote-accounts.json)
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
const root = new URL('..', import.meta.url).pathname, BASE = process.env.BASE || 'http://127.0.0.1:5273/';
const [email, password] = process.env.ACCOUNT ? process.env.ACCOUNT.split(':') : (() => { throw new Error('ACCOUNT=email:password'); })();
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), args: process.env.CHROME_HOST_RULES ? [`--host-resolver-rules=${process.env.CHROME_HOST_RULES}`] : [] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(([e, p]) => localStorage.setItem('pixeltown.guest', JSON.stringify({ email: e, password: p })), [email, password]);
  const page = await ctx.newPage(); await page.goto(BASE);
  await page.waitForFunction(() => window.__pixeltown?.state.current.players?.length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  const result = {};
  for (const [keys, label] of [[['ArrowRight'], 'right'], [['ArrowLeft'], 'left'], [['ArrowRight', 'ArrowDown'], 'diagonal'], [['ArrowLeft', 'ArrowUp'], 'diagonalBack']]) {
    const sampling = page.evaluate(ms => new Promise(done => {
      const P = window.__pixeltown, out = []; const end = performance.now() + ms;
      const me = P.self?.current || JSON.parse(localStorage.getItem('pocketbase_auth') || '{}').record?.id; // older builds lack P.self
      const loop = () => { const a = P.anim.get(me); if (a) out.push({ x: a.x, cx: P.view.cam.x, sx: Math.floor(a.x) - P.view.cam.x, dir: a.dir }); performance.now() < end ? requestAnimationFrame(loop) : done(out); };
      requestAnimationFrame(loop);
    }), 2600);
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(2200);
    for (const k of keys) await page.keyboard.up(k);
    const s = (await sampling).slice(20, -25); // skip key-down latency and the stop
    const steps = s.slice(1).map((q, i) => Math.abs(q.x - s[i].x)), moving = steps.filter(d => d > 0);
    const mean = moving.reduce((n, d) => n + d, 0) / moving.length, sd = Math.sqrt(moving.reduce((n, d) => n + (d - mean) ** 2, 0) / moving.length);
    const follow = s.filter(q => q.cx > 0 && q.cx < 640 - 300); // camera not clamped at a map edge
    result[label] = { frames: s.length, dirChanges: s.slice(1).filter((q, i) => q.dir !== s[i].dir).length, screenXValues: [...new Set(follow.map(q => q.sx))].length, stalls: steps.filter(d => d === 0).length, jumps: moving.filter(d => d > mean * 2.5).length, meanDotsPerFrame: +mean.toFixed(3), cv: +(sd / mean).toFixed(3) };
  }
  // Straight runs: avatar fixed on screen, even steps. Every run: the sprite keeps one facing while the keys are held.
  // (A diagonal can hit a wall and slide, so screen/evenness limits apply to the straight runs only.)
  const ok = ['right', 'left'].every(k => result[k].screenXValues <= 1 && result[k].stalls <= 3 && result[k].jumps <= 2 && result[k].cv < 0.5)
    && Object.values(result).every(r => r.dirChanges <= 1);
  console.log(ok ? 'PASS' : 'FAIL', JSON.stringify({ base: BASE, ...result }));
  process.exitCode = ok ? 0 : 1;
} finally { await browser.close(); }
