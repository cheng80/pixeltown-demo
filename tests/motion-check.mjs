// Smoothness check (screen shake): hold an arrow key and sample every animation frame. While the camera follows, the
// avatar must stay on the same screen pixel, the view must never step back against the walk (a prediction snapping back
// shakes the whole screen), and the per-frame movement must be even (no stalls or jumps).
//   CHROME_PATH=… BASE=http://127.0.0.1:5273/ ACCOUNT=demo1@pixeltown.local:PixelTown123! node tests/motion-check.mjs
//   JITTER=300 adds an unstable connection in the page: every game message waits 40 ms + random 0–300 ms (in order).
//   (remote: BASE=https://pixeltown.fastmake.net/ and an account from pocketbase/.local/remote-accounts.json)
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
const root = new URL('..', import.meta.url).pathname, BASE = process.env.BASE || 'http://127.0.0.1:5273/';
const [email, password] = process.env.ACCOUNT ? process.env.ACCOUNT.split(':') : (() => { throw new Error('ACCOUNT=email:password'); })();
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), args: process.env.CHROME_HOST_RULES ? [`--host-resolver-rules=${process.env.CHROME_HOST_RULES}`] : [] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(([e, p]) => localStorage.setItem('pixeltown.guest', JSON.stringify({ email: e, password: p })), [email, password]);
  if (process.env.JITTER) await ctx.addInitScript(jitter => {
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url, protocols) {
        super(url, protocols);
        if (new URL(url, location.href).host === location.host) return; // dev reload socket
        // One ordered queue per direction (a TCP socket never reorders); each message is due 40 ms + random later.
        const lane = () => {
          const q = []; let timer = null;
          const run = () => { timer = null; while (q.length && q[0].t <= performance.now()) q.shift().fn(); if (q.length) timer = setTimeout(run, q[0].t - performance.now()); };
          return fn => { q.push({ t: Math.max(q.at(-1)?.t || 0, performance.now() + 40 + Math.random() * jitter), fn }); if (!timer) timer = setTimeout(run, q[0].t - performance.now()); };
        };
        const inbound = lane(), outbound = lane(); let replay = false;
        this.addEventListener('message', e => {
          if (replay) return;
          e.stopImmediatePropagation();
          inbound(() => { replay = true; this.dispatchEvent(new MessageEvent('message', { data: e.data })); replay = false; });
        });
        const send = this.send.bind(this);
        this.send = data => outbound(() => { if (this.readyState === 1) send(data); });
      }
    };
  }, Number(process.env.JITTER));
  const page = await ctx.newPage(); await page.goto(BASE);
  await page.waitForFunction(() => window.__pixeltown?.state.current.players?.length > 0, null, { timeout: 60000 }); // slow with JITTER
  if (process.env.ZONE) { // e.g. ZONE=오락실: the tab's label
    await page.click(`.tabs button:has-text("${process.env.ZONE}")`);
    await page.waitForFunction(z => window.__pixeltown?.state.current.zone !== 'lobby' && window.__pixeltown.state.current.players?.some(q => q.id === window.__pixeltown.self.current), null, { timeout: 60000 });
  }
  await page.waitForTimeout(1000);
  const result = {};
  for (const [keys, label] of [[['ArrowRight'], 'right'], [['ArrowLeft'], 'left'], [['ArrowRight', 'ArrowDown'], 'diagonal'], [['ArrowLeft', 'ArrowUp'], 'diagonalBack']]) {
    const sampling = page.evaluate(ms => new Promise(done => {
      const P = window.__pixeltown, out = []; const end = performance.now() + ms;
      const me = P.self?.current || JSON.parse(localStorage.getItem('pocketbase_auth') || '{}').record?.id; // older builds lack P.self
      const loop = () => { const a = P.anim.get(me); if (a) out.push({ x: a.x, y: a.y, cx: P.view.cam.x, cy: P.view.cam.y, sx: Math.floor(a.x) - P.view.cam.x, dir: a.dir }); performance.now() < end ? requestAnimationFrame(loop) : done(out); };
      requestAnimationFrame(loop);
    }), 2600);
    await page.evaluate(() => { window.__pixeltown.corrections.current.length = 0; });
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(2200);
    for (const k of keys) await page.keyboard.up(k);
    const corrections = await page.evaluate(() => window.__pixeltown.corrections.current.slice());
    const s = (await sampling).slice(20, -25); // skip key-down latency and the stop
    const steps = s.slice(1).map((q, i) => Math.abs(q.x - s[i].x)), moving = steps.filter(d => d > 0);
    const mean = moving.reduce((n, d) => n + d, 0) / moving.length, sd = Math.sqrt(moving.reduce((n, d) => n + (d - mean) ** 2, 0) / moving.length);
    const follow = s.filter(q => q.cx > 0 && q.cx < 640 - 300); // camera not clamped at a map edge
    // Shake = a frame-to-frame move that reverses the previous one (camera, or the avatar on screen).
    const reversals = v => { let n = 0, last = 0; for (let i = 1; i < v.length; i++) { const d = Math.sign(v[i] - v[i - 1]); if (d && last && d !== last) n++; if (d) last = d; } return n; };
    result[label] = { frames: s.length, dirChanges: s.slice(1).filter((q, i) => q.dir !== s[i].dir).length, screenXValues: [...new Set(follow.map(q => q.sx))].length, stalls: steps.filter(d => d === 0).length, jumps: moving.filter(d => d > mean * 2.5).length, meanDotsPerFrame: +mean.toFixed(3), cv: +(sd / mean).toFixed(3),
      cameraReversals: reversals(s.map(q => q.cx)) + reversals(s.map(q => q.cy)), avatarScreenReversals: reversals(follow.map(q => q.sx)), worldReversals: reversals(s.map(q => q.x)),
      corrections: corrections.length, correctionMax: Math.max(0, ...corrections.map(c => c.err)), correctionSample: corrections.slice(0, 4) };
  }
  // Straight runs: avatar fixed on screen, even steps. Every run: the sprite keeps one facing while the keys are held.
  // (A diagonal can hit a wall and slide, so screen/evenness limits apply to the straight runs only.)
  const ok = ['right', 'left'].every(k => result[k].screenXValues <= 1 && result[k].stalls <= 3 && result[k].jumps <= 2 && result[k].cv < 0.5)
    && Object.values(result).every(r => r.dirChanges <= 1 && r.cameraReversals <= 1);
  console.log(ok ? 'PASS' : 'FAIL', JSON.stringify({ base: BASE, jitter: Number(process.env.JITTER) || 0, ...result }));
  process.exitCode = ok ? 0 : 1;
} finally { await browser.close(); }
