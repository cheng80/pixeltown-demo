// Connection loss: drops the game socket under a loaded page (the servers keep running) and checks that a dialog blocks
// moving, clicking and zone tabs, that a short drop reconnects into the same session by itself, and that after the
// retries give up the dialog's button joins again.
//   CHROME_PATH=… BASE=http://127.0.0.1:5273/ ACCOUNT=demo1@pixeltown.local:PixelTown123! node tests/offline-check.mjs
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:5273/';
const [email, password] = process.env.ACCOUNT ? process.env.ACCOUNT.split(':') : (() => { throw new Error('ACCOUNT=email:password'); })();
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(([e, p]) => localStorage.setItem('pixeltown.guest', JSON.stringify({ email: e, password: p })), [email, password]);
  // Wrap the page's WebSocket: game sockets (not the page's own host, which serves the dev reload socket) are kept so the
  // test can drop them, and while `__refuse` is set new ones go to a closed port. 4010 = Colyseus "may try reconnect":
  // the server takes it as a drop (keeps the session), the SDK as a reason to retry.
  await ctx.addInitScript(() => {
    const Native = window.WebSocket; window.__ws = []; window.__refuse = false;
    window.WebSocket = class extends Native {
      constructor(url, protocols) {
        const game = new URL(url, location.href).host !== location.host;
        super(game && window.__refuse ? 'ws://127.0.0.1:9/' : url, protocols);
        if (game) window.__ws.push(this);
      }
    };
  });
  const p = await ctx.newPage(); await p.goto(BASE);
  await p.waitForFunction(() => window.__pixeltown?.state.current.players?.length > 0, null, { timeout: 20000 });
  await sleep(5500); // the SDK only retries a room that has been up for 5 s
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
  const drop = () => p.evaluate(() => { window.__refuse = true; for (const w of window.__ws) if (w.readyState === 1) w.close(4010); });
  const allow = () => p.evaluate(() => { window.__refuse = false; });
  const dialog = () => p.textContent('[role="alertdialog"]', { timeout: 3000 }).catch(() => null);

  out.movesBefore = await moves();
  // 1. Short drop: blocked while the SDK retries, then back in the same session without a click.
  await drop(); await sleep(300);
  out.short = { dialog: await dialog(), ...(await blocked()) };
  await allow();
  await p.waitForSelector('[role="alertdialog"]', { state: 'detached', timeout: 10000 });
  out.short.reconnected = await p.textContent('.room-title .online');
  out.short.movesAfterReconnect = await moves();

  // 2. Long drop: the retries give up, the dialog offers a fresh join.
  await sleep(5500); await drop();
  await p.waitForSelector('[role="alertdialog"] button', { timeout: 15000 });
  out.long = { dialog: await dialog(), focus: await p.evaluate(() => document.activeElement?.textContent), ...(await blocked()) };
  await allow(); await sleep(2500); // the server holds the dropped session for 8 s; a join before that retries on 409
  await p.click('[role="alertdialog"] button');
  await p.waitForSelector('.room-title .online.online', { timeout: 15000 });
  out.long.movesAfterJoin = await moves();

  const quiet = r => !r.keyMoved && !r.clickRoute && !r.tabClicked;
  out.ok = out.movesBefore && /다시 연결하는 중/.test(out.short.dialog) && quiet(out.short) && /접속 중/.test(out.short.reconnected) && out.short.movesAfterReconnect
    && /연결이 끊겼어요/.test(out.long.dialog) && out.long.focus === '다시 연결' && quiet(out.long) && out.long.movesAfterJoin;
  console.log(out.ok ? 'PASS' : 'FAIL', JSON.stringify(out));
  process.exitCode = out.ok ? 0 : 1;
} finally { await browser.close(); }
