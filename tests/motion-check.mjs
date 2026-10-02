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
  for (const [key, label] of [['ArrowRight', 'right'], ['ArrowLeft', 'left']]) {
    const sampling = page.evaluate(ms => new Promise(done => {
      const P = window.__pixeltown, out = []; const end = performance.now() + ms;
      const me = P.self?.current || JSON.parse(localStorage.getItem('pocketbase_auth') || '{}').record?.id; // older builds lack P.self
      const loop = () => { const a = P.anim.get(me); if (a) out.push({ x: a.x, cx: P.view.cam.x, sx: Math.floor(a.x) - P.view.cam.x }); performance.now() < end ? requestAnimationFrame(loop) : done(out); };
      requestAnimationFrame(loop);
    }), 2600);
    await page.keyboard.down(key); await page.waitForTimeout(2200); await page.keyboard.up(key);
    const s = (await sampling).slice(20, -25); // skip key-down latency and the stop
    const steps = s.slice(1).map((q, i) => Math.abs(q.x - s[i].x)), moving = steps.filter(d => d > 0);
    const mean = moving.reduce((n, d) => n + d, 0) / moving.length, sd = Math.sqrt(moving.reduce((n, d) => n + (d - mean) ** 2, 0) / moving.length);
    const follow = s.filter(q => q.cx > 0 && q.cx < 640 - 300); // camera not clamped at a map edge
    result[label] = { frames: s.length, screenXValues: [...new Set(follow.map(q => q.sx))].length, stalls: steps.filter(d => d === 0).length, jumps: moving.filter(d => d > mean * 2.5).length, meanDotsPerFrame: +mean.toFixed(3), cv: +(sd / mean).toFixed(3) };
  }
  const ok = Object.values(result).every(r => r.screenXValues <= 1 && r.stalls <= 3 && r.jumps <= 2 && r.cv < 0.5);
  console.log(ok ? 'PASS' : 'FAIL', JSON.stringify({ base: BASE, ...result }));
  process.exitCode = ok ? 0 : 1;
} finally { await browser.close(); }
