// Connection loss: drops the game socket under a loaded page (the servers keep running) and checks that a dialog blocks
// moving, clicking and zone tabs while the game recovers by itself, and that the button appears only when the server
// cannot be reached at all.
//   1 short drop    the SDK reconnects into the same server session, no click
//   2 hanging retry a reconnect socket that never opens or closes: after 15 s the page joins again by itself
//   3 expired       (STALE_AFTER=s, against a server started with a shorter RECONNECT_SECONDS) the session is gone when
//                   the retry arrives: the page joins again by itself
//   4 unreachable   retries and the automatic join fail: the dialog shows a button that joins again
//   CHROME_PATH=… BASE=http://127.0.0.1:5273/ ACCOUNT=demo1@pixeltown.local:PixelTown123! node tests/offline-check.mjs
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:5273/', STALE_AFTER = Number(process.env.STALE_AFTER) || 0;
const [email, password] = process.env.ACCOUNT ? process.env.ACCOUNT.split(':') : (() => { throw new Error('ACCOUNT=email:password'); })();
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(([e, p]) => localStorage.setItem('pixeltown.guest', JSON.stringify({ email: e, password: p })), [email, password]);
  // Wrap the page's WebSocket: game sockets (not the page's own host, which serves the dev reload socket) are kept so the
  // test can drop them. While `__refuse` is 'closed' new ones fail at once (closed port); with 'hang' they go to a
  // non-routable address and stay connecting. 4010 = Colyseus "may try reconnect": the server keeps the session.
  await ctx.addInitScript(() => {
    const Native = window.WebSocket; window.__ws = []; window.__refuse = '';
    window.WebSocket = class extends Native {
      constructor(url, protocols) {
        const game = new URL(url, location.href).host !== location.host;
        super(!game || !window.__refuse ? url : window.__refuse === 'hang' ? 'ws://10.255.255.1/' : 'ws://127.0.0.1:9/', protocols);
        if (game) window.__ws.push(this);
      }
    };
  });
  const p = await ctx.newPage(); await p.goto(BASE);
  if (process.env.DEBUG) p.on('console', m => console.log('page', Math.round(performance.now()), m.text().slice(0, 150)));
  const inRoom = () => p.waitForFunction(() => { const t = window.__pixeltown; return t?.state.current.players?.some(q => q.id === t.self.current); }, null, { timeout: 30000 });
  await inRoom();
  const me = () => p.evaluate(() => { const t = window.__pixeltown, a = t.anim.get(t.self.current); return a && `${Math.round(a.x)},${Math.round(a.y)}`; });
  // Any of the four directions (the spot may be next to a wall).
  const moves = async () => {
    for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      const before = await me(); await p.keyboard.down(k); await sleep(500); await p.keyboard.up(k); await sleep(200);
      if (before !== await me()) return true;
    }
    return false;
  };
  const blocked = async () => {
    const keyMoved = await moves();
    await p.mouse.click(400, 300).catch(() => {}); await sleep(300);
    return { keyMoved, clickRoute: await p.evaluate(() => window.__pixeltown.route.current.length),
      tabClicked: await p.locator('.tabs button').nth(1).click({ timeout: 1000 }).then(() => true, () => false) };
  };
  const drop = (mode = 'closed') => p.evaluate(m => { window.__refuse = m; for (const w of window.__ws) if (w.readyState === 1) w.close(4010); }, mode);
  const allow = () => p.evaluate(() => { window.__refuse = ''; });
  const dialog = () => p.textContent('[role="alertdialog"]', { timeout: 3000 }).catch(() => null);
  // Back without a click: the dialog goes away (no button on the way), my avatar is in a snapshot again and moves.
  const recovered = async ms => {
    const t0 = Date.now(); let buttonShown = false;
    const watch = setInterval(() => p.$('[role="alertdialog"] button').then(b => { if (b) buttonShown = true; }, () => {}), 100);
    try { await p.waitForSelector('[role="alertdialog"]', { state: 'detached', timeout: ms }); await inRoom(); } finally { clearInterval(watch); }
    return { seconds: +((Date.now() - t0) / 1000).toFixed(1), buttonShown, moves: await moves() };
  };
  const quiet = r => !r.keyMoved && !r.clickRoute && !r.tabClicked;
  await sleep(5500); // the SDK only retries a room that has been up for 5 s
  out.movesBefore = await moves();

  // 1. Short drop.
  await drop(); await sleep(300);
  out.short = { dialog: await dialog(), ...(await blocked()) };
  await allow();
  Object.assign(out.short, await recovered(15000));

  // 2. Hanging retry: the first reconnect socket never answers; the 15 s guard joins again.
  await sleep(10500); // one automatic join per 10 s
  await drop('hang'); await sleep(1000); await allow();
  out.hang = { dialog: await dialog(), ...(await recovered(30000)) };

  // 3. Expired session (only against a server with a short RECONNECT_SECONDS).
  if (STALE_AFTER) {
    await sleep(10500);
    await drop(); await sleep(STALE_AFTER * 1000); await allow();
    out.expired = await recovered(20000);
  }

  // 4. Unreachable: everything is refused until the button.
  await sleep(10500); await drop();
  await p.waitForSelector('[role="alertdialog"] button', { timeout: 40000 });
  out.unreachable = { dialog: await dialog(), focus: await p.evaluate(() => document.activeElement?.textContent), ...(await blocked()) };
  await allow();
  await p.click('[role="alertdialog"] button');
  await p.waitForSelector('[role="alertdialog"]', { state: 'detached', timeout: 15000 }); await inRoom();
  out.unreachable.movesAfterJoin = await moves();

  const selfHealed = r => r && !r.buttonShown && r.moves;
  out.ok = out.movesBefore && /다시 연결하는 중/.test(out.short.dialog) && quiet(out.short) && selfHealed(out.short)
    && /다시 연결하는 중/.test(out.hang.dialog) && selfHealed(out.hang) && (!STALE_AFTER || selfHealed(out.expired))
    && /연결이 끊겼어요/.test(out.unreachable.dialog) && out.unreachable.focus === '다시 연결' && quiet(out.unreachable) && out.unreachable.movesAfterJoin;
  console.log(out.ok ? 'PASS' : 'FAIL', JSON.stringify(out));
  process.exitCode = out.ok ? 0 : 1;
} finally { await browser.close(); }
