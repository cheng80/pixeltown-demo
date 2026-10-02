// Other players on screen: one page walks back and forth with the arrow keys, a second page watches it and samples the
// walker's drawn position every frame. While the walker moves it should glide: no frames frozen in place, no jumps.
//   CHROME_PATH=… BASE=… WALKER=email:password WATCHER=email:password [JITTER=ms] node tests/others-check.mjs
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:5273/', JITTER = Number(process.env.JITTER) || 0;
const accounts = ['WALKER', 'WATCHER'].map(k => process.env[k]?.split(':') || (() => { throw new Error(`${k}=email:password`); })());
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const open = async ([email, password]) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(([e, p]) => localStorage.setItem('pixeltown.guest', JSON.stringify({ email: e, password: p })), [email, password]);
    if (JITTER) await ctx.addInitScript(jitter => { // same unstable connection as motion-check, on every game socket of this page
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url, protocols) {
          super(url, protocols);
          if (new URL(url, location.href).host === location.host) return;
          const lane = () => {
            const q = []; let timer = null;
            const run = () => { timer = null; while (q.length && q[0].t <= performance.now()) q.shift().fn(); if (q.length) timer = setTimeout(run, q[0].t - performance.now()); };
            return fn => { q.push({ t: Math.max(q.at(-1)?.t || 0, performance.now() + 40 + Math.random() * jitter), fn }); if (!timer) timer = setTimeout(run, q[0].t - performance.now()); };
          };
          const inbound = lane(), outbound = lane(); let replay = false;
          this.addEventListener('message', e => { if (replay) return; e.stopImmediatePropagation(); inbound(() => { replay = true; this.dispatchEvent(new MessageEvent('message', { data: e.data })); replay = false; }); });
          const send = this.send.bind(this); this.send = data => { const copy = ArrayBuffer.isView(data) ? data.slice() : data; outbound(() => { if (this.readyState === 1) send(copy); }); }; // copy now: the SDK reuses its encode buffer, and a late send carried the bytes of a later message (the join confirmation was lost)
        }
      };
    }, JITTER);
    const page = await ctx.newPage(); await page.goto(BASE);
    await page.waitForFunction(() => { const t = window.__pixeltown; return t?.state.current.players?.some(q => q.id === t.self.current); }, null, { timeout: 60000 });
    return page;
  };
  const walker = await open(accounts[0]), watcher = await open(accounts[1]);
  const walkerId = await walker.evaluate(() => window.__pixeltown.self.current);
  await watcher.waitForFunction(id => window.__pixeltown.state.current.players.some(q => q.id === id), walkerId, { timeout: 30000 });
  await sleep(1500);
  const sampling = watcher.evaluate(([id, ms]) => new Promise(done => {
    const t = window.__pixeltown, out = [], end = performance.now() + ms;
    const loop = () => { const a = t.anim.get(id); if (a) out.push({ x: a.x, y: a.y, at: performance.now() }); performance.now() < end ? requestAnimationFrame(loop) : done(out); };
    requestAnimationFrame(loop);
  }), [walkerId, 12500]);
  for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft']) { await walker.keyboard.down(k); await sleep(2500); await walker.keyboard.up(k); await sleep(300); }
  const s = await sampling;
  const steps = s.slice(1).map((q, i) => Math.hypot(q.x - s[i].x, q.y - s[i].y));
  // Only the stretch where the walker is visibly travelling: from its first move to its last.
  const first = steps.findIndex(d => d > 0.05), last = steps.length - 1 - [...steps].reverse().findIndex(d => d > 0.05);
  const moving = steps.slice(first, last + 1);
  let run = 0, freezes = 0, longest = 0; for (const d of moving) { if (d < 0.05) { run++; longest = Math.max(longest, run); } else { if (run >= 4) freezes++; run = 0; } }
  const result = { base: BASE, jitter: JITTER, frames: moving.length, frozenFrames: moving.filter(d => d < 0.05).length, freezes4plus: freezes, longestFreezeFrames: longest,
    jumps: moving.filter(d => d > 4).length, maxStep: +Math.max(...moving).toFixed(1), ping: await watcher.textContent('.ping').catch(() => null) };
  // A walker turning round stands still for a few frames on purpose; allow those (4 turns).
  const ok = result.jumps === 0 && result.freezes4plus <= 4 && result.longestFreezeFrames <= 20;
  console.log(ok ? 'PASS' : 'FAIL', JSON.stringify(result));
  process.exitCode = ok ? 0 : 1;
} finally { await browser.close(); }
