// Position rollback check: plays for a while in one zone (clicks on random free spots, arrow-key runs) and records
// every time the server's answer moved my predicted avatar (window.__pixeltown.corrections, > 0.5 dot). A correction
// is a visible snap back or forward; on a working connection there should be none.
//   CHROME_PATH=… BASE=https://pixeltown.fastmake.net/ ACCOUNT=email:password ZONE=오락실 SECONDS=60 node tests/rollback-check.mjs
//   JITTER=300 adds an unstable connection in the page (same as motion-check).
import { chromium } from 'playwright-core';
import { getMap, blocked } from '../shared/world.js';
const BASE = process.env.BASE || 'http://127.0.0.1:5273/', SECONDS = Number(process.env.SECONDS) || 60;
const [email, password] = process.env.ACCOUNT ? process.env.ACCOUNT.split(':') : (() => { throw new Error('ACCOUNT=email:password'); })();
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(([e, p]) => localStorage.setItem('pixeltown.guest', JSON.stringify({ email: e, password: p })), [email, password]);
  if (process.env.JITTER) await ctx.addInitScript(jitter => {
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
  const inRoom = () => page.waitForFunction(() => { const t = window.__pixeltown; return t?.state.current.players?.some(q => q.id === t.self.current); }, null, { timeout: 60000 });
  await inRoom();
  if (process.env.ZONE) { await page.click(`.tabs button:has-text("${process.env.ZONE}")`); await page.waitForFunction(() => window.__pixeltown.state.current.zone !== 'lobby', null, { timeout: 60000 }); await inRoom(); }
  if (await page.$('.chat-head >> text=접기')) await page.click('.chat-head >> text=접기');
  const zone = await page.evaluate(() => window.__pixeltown.state.current.zone), map = getMap(zone);
  await page.evaluate(() => { window.__pixeltown.corrections.current.length = 0; });
  // HOPS=n: change zone n times first (tabs), walking a little in each; a zone change must not carry a stale position.
  const zones = ['광장', '오락실']; // an even HOPS ends back in ZONE=오락실
  for (let i = 0; i < (Number(process.env.HOPS) || 0); i++) {
    const hold = process.env.HOPKEY !== '0'; // keep walking while the zone changes
    if (hold) await page.keyboard.down('ArrowDown'); await sleep(400);
    await page.click(`.tabs button:has-text("${zones[i % 2]}")`); if (hold) await page.keyboard.up('ArrowDown');
    await sleep(100); await inRoom(); await sleep(800);
  }
  const end = Date.now() + SECONDS * 1000; let clicks = 0, runs = 0;
  while (Date.now() < end) {
    if (Math.random() < 0.6) { // click a free spot that is on screen
      const pt = await page.evaluate(() => { const v = window.__pixeltown.view, r = document.querySelector('.world').getBoundingClientRect(); return { r: { x: r.left, y: r.top, w: r.width, h: r.height }, cam: v.cam, z: v.z, dpr: v.dpr }; });
      for (let n = 0; n < 20; n++) {
        const sx = 40 + Math.random() * (pt.r.w - 80), sy = 40 + Math.random() * (pt.r.h - 80);
        const wx = pt.cam.x + sx * pt.dpr / pt.z, wy = pt.cam.y + sy * pt.dpr / pt.z;
        if (!blocked(map, wx, wy)) { await page.mouse.click(pt.r.x + sx, pt.r.y + sy); clicks++; break; }
      }
      await sleep(1500 + Math.random() * 1500);
    } else { // hold one or two arrow keys
      const keys = [['ArrowRight'], ['ArrowLeft'], ['ArrowUp'], ['ArrowDown'], ['ArrowRight', 'ArrowDown'], ['ArrowLeft', 'ArrowUp']][Math.floor(Math.random() * 6)];
      for (const k of keys) await page.keyboard.down(k);
      await sleep(600 + Math.random() * 1400);
      for (const k of keys) await page.keyboard.up(k);
      runs++; await sleep(200);
    }
  }
  await sleep(1000);
  const corrections = await page.evaluate(() => window.__pixeltown.corrections.current.slice());
  const errs = corrections.map(c => c.err).sort((a, b) => a - b);
  const result = { base: BASE, zone, jitter: Number(process.env.JITTER) || 0, seconds: SECONDS, clicks, keyRuns: runs, corrections: corrections.length,
    maxDots: errs.at(-1) || 0, medianDots: errs[Math.floor(errs.length / 2)] || 0, sample: corrections.slice(0, 6) };
  const ok = corrections.length === 0;
  console.log(ok ? 'PASS' : 'FAIL', JSON.stringify(result));
  process.exitCode = ok ? 0 : 1;
} finally { await browser.close(); }
