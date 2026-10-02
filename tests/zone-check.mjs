// Zone change on a slow connection: my avatar must be drawn on the new zone's doorway at once with the camera on it (not the
// map centre first), and walking while the room is still being joined must not be pulled back once it is.
//   CHROME_PATH=… [BASE=…] ACCOUNT=email:password [JITTER=ms one way, also on matchmaking requests] node tests/zone-check.mjs
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:5273/', JITTER = Number(process.env.JITTER) || 0;
const [email, password] = process.env.ACCOUNT.split(':');
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(([e, p]) => localStorage.setItem('pixeltown.guest', JSON.stringify({ email: e, password: p })), [email, password]);
  if (JITTER) await ctx.addInitScript(jitter => { // fixed extra delay both ways on game sockets and on matchmaking fetches
    const Native = window.WebSocket, f = window.fetch;
    window.fetch = (...a) => new Promise(r => setTimeout(r, jitter)).then(() => f(...a)).then(x => new Promise(r => setTimeout(() => r(x), jitter)));
    window.WebSocket = class extends Native {
      constructor(url, protocols) {
        super(url, protocols);
        if (new URL(url, location.href).host === location.host) return;
        let replay = false;
        this.addEventListener('message', e => { if (replay) return; e.stopImmediatePropagation(); setTimeout(() => { replay = true; this.dispatchEvent(new MessageEvent('message', { data: e.data })); replay = false; }, jitter); });
        const send = this.send.bind(this); this.send = data => { const copy = ArrayBuffer.isView(data) ? data.slice() : data; setTimeout(() => { if (this.readyState === 1) send(copy); }, jitter); };
      }
    };
  }, JITTER);
  const page = await ctx.newPage(); await page.goto(BASE);
  await page.waitForFunction(() => { const t = window.__pixeltown; return t?.state.current.players?.some(q => q.id === t.self.current); }, null, { timeout: 60000 });
  await sleep(1500);
  // Every frame for 5 s after the zone button: zone, my drawn position, camera, status text.
  const trace = () => page.evaluate(() => new Promise(done => {
    const start = performance.now(), out = [];
    const loop = () => {
      const t = window.__pixeltown, a = t.anim.get(t.self.current);
      out.push({ at: Math.round(performance.now() - start), zone: t.zone, me: a && [Math.round(a.x), Math.round(a.y)], cam: t.view.cam && [t.view.cam.x, t.view.cam.y], text: document.querySelector('.online')?.textContent, corrections: t.corrections.current.length });
      performance.now() - start < 5000 ? requestAnimationFrame(loop) : done(out);
    };
    requestAnimationFrame(loop);
  }));
  let ok = true;
  for (const [label, walk] of [['정원', null], ['광장', 'ArrowDown'], ['오락실', 'ArrowUp']]) { // walk away from each doorway
    const from = await page.evaluate(() => window.__pixeltown.zone), c0 = await page.evaluate(() => window.__pixeltown.corrections.current.length);
    const tracing = trace();
    await page.click(`button:has-text("${label}")`);
    if (walk) { await sleep(300); await page.keyboard.down(walk); await sleep(800); await page.keyboard.up(walk); }
    const s = await tracing, inNew = s.filter(f => f.zone !== from);
    const shown = inNew.find(f => f.me), online = inNew.find(f => /접속 중/.test(f.text) && s.slice(0, s.indexOf(f)).some(g => /연결 중/.test(g.text)));
    const camSteady = shown && inNew.slice(inNew.indexOf(shown)).every(f => !f.me || Math.abs(f.cam[0] - shown.cam[0]) + Math.abs(f.cam[1] - shown.cam[1]) <= Math.abs(f.me[0] - shown.me[0]) + Math.abs(f.me[1] - shown.me[1]) + 1);
    const atOnline = online && online.me, last = s.at(-1), far = p => Math.hypot(p[0] - shown.me[0], p[1] - shown.me[1]);
    const r = { zone: label, shownMs: shown?.at, shownAt: shown?.me, onlineMs: online?.at, atOnline, end: last.me, camFollowsAvatarOnly: camSteady, corrections: last.corrections - c0 };
    ok &&= r.shownMs < 200 && camSteady && r.corrections === 0 && last.zone !== from && (!walk || (atOnline && far(atOnline) > 10 && far(last.me) >= far(atOnline) - 1));
    console.log(JSON.stringify(r));
    await sleep(500);
  }
  console.log(ok ? 'PASS' : 'FAIL'); process.exitCode = ok ? 0 : 1;
} finally { await browser.close(); }
