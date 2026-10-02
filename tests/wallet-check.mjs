// Live wallet: picking up a star raises the wallet at once (shown as "정산 대기" until the period is saved), the shop
// keeps the spendable amount separate, and after settlement the total stays the same (no double count, no dip).
//   CHROME_PATH=… BASE=http://127.0.0.1:5273/ ACCOUNT=demo1@pixeltown.local:PixelTown123! node tests/wallet-check.mjs
//   Run against a server started with a short GAME_DURATION_MS (e.g. 20000) so the settlement comes quickly.
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:5273/', SETTLE_MS = Number(process.env.SETTLE_MS) || 60000;
const [email, password] = process.env.ACCOUNT ? process.env.ACCOUNT.split(':') : (() => { throw new Error('ACCOUNT=email:password'); })();
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(([e, p]) => localStorage.setItem('pixeltown.guest', JSON.stringify({ email: e, password: p })), [email, password]);
  const page = await ctx.newPage(); await page.goto(BASE);
  await page.waitForFunction(() => { const t = window.__pixeltown; return t?.state.current.players?.some(q => q.id === t.self.current) && t.state.current.game?.stars?.length; }, null, { timeout: 30000 });
  if (await page.$('.chat-head >> text=접기')) await page.click('.chat-head >> text=접기');
  const wallet = async () => Number((await page.textContent('.wallet-live')).trim());
  const score = () => page.evaluate(() => { const t = window.__pixeltown; return t.state.current.game.scores?.[t.self.current] || 0; });
  // Walk onto the nearest star by clicking it on screen, until the wallet shows one more (the period score itself
  // resets at each settlement, so it is no signal here).
  const pickOne = async start => {
    for (let tries = 0; tries < 5 && await wallet() === start; tries++) {
      const pt = await page.evaluate(() => {
        const t = window.__pixeltown, v = t.view, a = t.anim.get(t.self.current), r = document.querySelector('.world').getBoundingClientRect();
        const at = q => ({ x: r.left + (q.x - v.cam.x) * v.z / v.dpr, y: r.top + (q.y - 4 - v.cam.y) * v.z / v.dpr });
        const shown = q => { const p = at(q); return p.x > r.left + 30 && p.x < r.right - 30 && p.y > r.top + 30 && p.y < r.bottom - 30; };
        const near = (p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y);
        const stars = t.state.current.game.stars.filter(q => !t.picked.current[q.id]);
        const s = stars.filter(shown).sort(near)[0] || stars.sort(near)[0];
        if (!s) return null;
        const p = at(s); // off screen: click the screen edge in its direction and try again from there
        return { x: Math.min(r.right - 30, Math.max(r.left + 30, p.x)), y: Math.min(r.bottom - 30, Math.max(r.top + 30, p.y)) };
      });
      (out.clicks ||= []).push(pt && [Math.round(pt.x), Math.round(pt.y)]);
      if (pt) await page.mouse.click(pt.x, pt.y);
      await page.waitForFunction(w => Number(document.querySelector('.wallet-live')?.textContent) > w, start, { timeout: 12000 }).catch(() => {});
    }
    return (await wallet()) > start;
  };
  out.start = await wallet();
  out.picked = await pickOne(out.start);
  await sleep(200);
  out.afterPickup = await wallet(); out.pendingShown = Boolean(await page.$('.star-line .pending'));
  await page.click('.profile .btn:has-text("별 상점")'); await sleep(300);
  out.shopSpendable = Number((await page.textContent('.shop .stars-badge')).replace(/\D+/g, ''));
  out.shopPendingNote = (await page.textContent('.shop-pending').catch(() => '')) || '';
  await page.click('.shop .btn:has-text("닫기")');
  // Settlement: the pending note goes away and the total stays.
  const t0 = Date.now(); const seen = new Set([out.afterPickup]);
  while (Date.now() - t0 < SETTLE_MS && await page.$('.star-line .pending')) { seen.add(await wallet()); await sleep(250); }
  await sleep(500); seen.add(await wallet());
  out.settledAfterSeconds = Math.round((Date.now() - t0) / 1000); out.pendingGone = !(await page.$('.star-line .pending'));
  out.afterSettle = await wallet(); out.valuesSeen = [...seen];
  // Collect, then leave the zone at once: the star stays in the wallet while that room settles, then it is saved.
  out.leave = { picked: await pickOne(out.afterSettle) };
  await page.click('.tabs button:has-text("정원")');
  await page.waitForFunction(() => { const t = window.__pixeltown; return t.state.current.zone === 'garden' && t.state.current.players?.some(q => q.id === t.self.current); }, null, { timeout: 20000 });
  out.leave.inOtherZone = await wallet(); out.leave.pending = Boolean(await page.$('.star-line .pending'));
  const t1 = Date.now(); const seen2 = new Set([out.leave.inOtherZone]);
  while (Date.now() - t1 < SETTLE_MS && await page.$('.star-line .pending')) { seen2.add(await wallet()); await sleep(250); }
  out.leave.savedAfterSeconds = Math.round((Date.now() - t1) / 1000); out.leave.after = await wallet(); out.leave.valuesSeen = [...seen2];
  out.ok = out.leave.picked && out.leave.inOtherZone === out.start + 2 && out.leave.pending && !(await page.$('.star-line .pending'))
    && out.leave.after === out.start + 2 && out.leave.valuesSeen.every(v => v === out.start + 2) && out.picked && out.afterPickup === out.start + 1 && out.pendingShown && out.shopSpendable === out.start && /정산 대기 ★1/.test(out.shopPendingNote)
    && out.pendingGone && out.afterSettle === out.start + 1 && out.valuesSeen.every(v => v === out.start + 1);
  console.log(out.ok ? 'PASS' : 'FAIL', JSON.stringify(out));
  process.exitCode = out.ok ? 0 : 1;
} finally { await browser.close(); }
