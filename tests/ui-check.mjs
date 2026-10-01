// Browser checks for the remake (AC-003..008, 011, 014..016). Drives the real UI like a player:
// clicks on the mini-room to walk, holds arrow keys, uses the chat and the star game.
// Needs `npm run dev:all` (optionally with PIXELTOWN_*_PORT) and a Chromium binary:
//   CHROME_PATH=/path/to/chrome PIXELTOWN_WEB_PORT=5273 node tests/ui-check.mjs
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import { getMap, findPath } from '../shared/world.js';

const BASE = `http://127.0.0.1:${process.env.PIXELTOWN_WEB_PORT || 5173}/`;
const ASSETS = new URL('../docs/assets/', import.meta.url).pathname;
const report = { startedAt: new Date().toISOString(), url: BASE, checks: {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });

async function login(account = 1, { w = 1280, h = 720, mobile = false, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(BASE + query); await p.click(`text=이웃 ${account} 계정`); await p.click('text=타운 입장하기');
  await p.waitForFunction(() => window.__pixeltown?.state.current.players?.length > 0, null, { timeout: 10000 })
    .catch(async e => { throw new Error(`login ${account}: ${await p.evaluate(() => document.querySelector('.toast')?.textContent)} ${e.message}`); });
  await sleep(400); p.name = `Demo ${account}`; return p;
}
const pos = p => p.evaluate(n => window.__pixeltown.state.current.players.find(q => q.name === n), p.name);
const collapseChat = async p => { if (await p.$('.chat')) await p.click('.chat-head >> text=접기'); };
async function zone(p, label, id) { await p.click(`.tabs button:has-text("${label}")`); await p.waitForFunction(z => window.__pixeltown.state.current.zone === z, id); await sleep(400); }
async function clickWorld(p, x, y) { // clamped to the visible mini-room, like a real click
  const pt = await p.evaluate(([x, y]) => {
    const v = window.__pixeltown.view, r = document.querySelector('.world').getBoundingClientRect(), k = v.z / v.dpr;
    const cx = Math.max(v.cam.x + 12, Math.min(v.cam.x + r.width / k - 12, x)), cy = Math.max(v.cam.y + 40, Math.min(v.cam.y + r.height / k - 12, y));
    return { x: r.left + (cx - v.cam.x) * k, y: r.top + (cy - v.cam.y) * k };
  }, [x, y]);
  await p.mouse.click(pt.x, pt.y);
}
async function walkTo(p, x, y, timeout = 40000) {
  const end = Date.now() + timeout, z = await p.evaluate(() => window.__pixeltown.zone);
  let q = await pos(p); if (!q) return null;
  for (const wp of findPath(getMap(z), q, { x, y })) {
    if (await p.evaluate(z => window.__pixeltown.zone !== z, z)) return null;
    await clickWorld(p, wp.x, wp.y); let last, still = 0, tries = 0;
    while (Date.now() < end) {
      await sleep(120); q = await pos(p); if (!q || await p.evaluate(z => window.__pixeltown.zone !== z, z)) return null;
      if (Math.hypot(q.x - wp.x, q.y - wp.y) < 4) break;
      if (last && Math.hypot(q.x - last.x, q.y - last.y) < 0.1) { if (++still > 4) { if (++tries > 6) break; still = 0; await clickWorld(p, wp.x, wp.y); } } else still = 0;
      last = q;
    }
  }
  await sleep(450); return pos(p);
}
async function hold(p, key, ms) { await p.keyboard.down(key); await sleep(ms); await p.keyboard.up(key); await sleep(300); return pos(p); }
async function shot(p, file, x, y, rw = 170, rh = 115) {
  const c = await p.evaluate(([x, y]) => { const v = window.__pixeltown.view, r = document.querySelector('.world').getBoundingClientRect(); return { x: r.left + (x - v.cam.x) * v.z / v.dpr, y: r.top + (y - v.cam.y) * v.z / v.dpr, r: { l: r.left, t: r.top, w: r.width, h: r.height }, k: v.z / v.dpr }; }, [x, y]);
  const W = Math.min(rw * c.k, c.r.w), H = Math.min(rh * c.k, c.r.h);
  await p.screenshot({ path: ASSETS + file, clip: { x: Math.max(c.r.l, Math.min(c.x - W / 2, c.r.l + c.r.w - W)), y: Math.max(c.r.t, Math.min(c.y - H * 0.65, c.r.t + c.r.h - H)), width: W, height: H } });
}
async function check(name, fn) {
  try { report.checks[name] = { ok: true, ...(await fn()) }; console.log('PASS', name); }
  catch (e) { report.checks[name] = { ok: false, error: e.message }; console.log('FAIL', name, e.message); }
  finally { for (const c of browser.contexts()) await c.close().catch(() => {}); await sleep(500); }
}
const assert = (v, msg) => { if (!v) throw new Error(msg); };

await check('depth_and_collision_lobby', async () => {
  const p = await login(1); await collapseChat(p);
  const tree = await walkTo(p, 146, 170); await shot(p, 'depth-tree-behind.png', 146, 170, 150, 110);
  const front = await walkTo(p, 146, 194); await shot(p, 'depth-tree-front.png', 146, 190, 150, 110);
  const trunk = await hold(p, 'ArrowUp', 500);
  const behind = await walkTo(p, 120, 48); await shot(p, 'depth-house-behind.png', 120, 60);
  await walkTo(p, 120, 112); const wall = await hold(p, 'ArrowUp', 800); await shot(p, 'depth-house-front.png', 120, 90);
  assert(tree.y < 179 && Math.abs(tree.x - 146) < 6, 'stood under canopy north of the trunk');
  assert(trunk.y >= 183 + 3 - 0.5, 'trunk blocks from the south'); assert(behind.y < 66, 'walked behind the house');
  assert(wall.y >= 96 + 3 - 0.5 && wall.y < 101, 'house wall (door front) blocks'); assert(!p.errs.length, p.errs.join());
  await p.context().close(); return { underCanopy: tree, inFront: front, trunkStop: trunk, behindHouse: behind, wallStop: wall };
});
await check('depth_and_collision_arcade_garden', async () => {
  const p = await login(1); await collapseChat(p); await zone(p, '오락실', 'arcade');
  const behind = await walkTo(p, 106, 190); await shot(p, 'depth-arcade-behind.png', 106, 190);
  const front = await walkTo(p, 106, 222); await shot(p, 'depth-arcade-front.png', 106, 210);
  const pillar = await walkTo(p, 200, 120); await shot(p, 'depth-pillar-behind.png', 200, 120, 120, 100);
  const counter = await walkTo(p, 540, 312); await shot(p, 'depth-counter-behind.png', 540, 320);
  await walkTo(p, 320, 120); const wall = await hold(p, 'ArrowUp', 1500); await shot(p, 'collision-arcade-wall.png', 320, 70);
  await zone(p, '정원', 'garden');
  const pergola = await walkTo(p, 98, 216); await shot(p, 'depth-pergola.png', 98, 216, 170, 120);
  await walkTo(p, 272, 198); const pond = await hold(p, 'ArrowUp', 800); await shot(p, 'collision-pond.png', 272, 200, 170, 120);
  assert(wall.y >= 48 + 3 - 0.5 && wall.y < 56, 'arcade wall stops the avatar'); assert(pond.y >= 192 + 3 - 0.5, 'pond blocks');
  assert(behind.y < 198 && counter.y < 326, 'walked behind cabinets and counter');
  await p.context().close(); return { behindCabinets: behind, frontCabinets: front, behindPillar: pillar, behindCounter: counter, wallStop: wall, underPergola: pergola, pondStop: pond };
});
await check('two_users_move_chat_portal', async () => {
  const a = await login(1), c = await login(2), out = {};
  try {
  await a.waitForFunction(() => window.__pixeltown.state.current.players.length === 2).catch(async e => { throw new Error(`presence: ${JSON.stringify(await a.evaluate(() => window.__pixeltown.state.current.players.map(q => q.name)))} ${e.message}`); });
  const before = await pos(c); await walkTo(c, before.x + 40, before.y - 30); await sleep(300);
  out.seenByOther = await a.evaluate(() => window.__pixeltown.state.current.players.find(q => q.name === 'Demo 2'));
  assert(Math.abs(out.seenByOther.x - before.x - 40) < 6, 'remote movement synced');
  await collapseChat(a); if (!(await c.$('.chat'))) await c.click('.chat-fab');
  await c.fill('.chat-form input', '안녕! 일촌 신청해요 ♥'); await c.keyboard.press('Enter');
  await a.waitForSelector('.chat-fab .badge'); out.unreadWhileCollapsed = await a.textContent('.chat-fab .badge');
  await a.screenshot({ path: ASSETS + 'lobby-two-users-chat.png' });
  await a.click('.chat-fab'); out.badgeAfterExpand = Boolean(await a.$('.chat-fab .badge')); out.log = await a.textContent('.chat-log');
  const p0 = await pos(a); await a.click('.chat-form input'); await a.keyboard.type('wasd'); await sleep(500);
  out.typingDidNotMove = JSON.stringify(p0) === JSON.stringify(await pos(a));
  await a.focus('.opacity input'); for (let i = 0; i < 80; i++) await a.keyboard.press('ArrowLeft'); out.opacityMin = await a.inputValue('.opacity input');
  out.chatBackground = await a.$eval('.chat', e => getComputedStyle(e).backgroundColor); out.chatTextOpacity = await a.$eval('.chat-log', e => getComputedStyle(e).opacity);
  for (let i = 0; i < 80; i++) await a.keyboard.press('ArrowRight'); out.opacityMax = await a.inputValue('.opacity input');
  for (let i = 0; i < 20; i++) await a.keyboard.press('ArrowLeft'); await a.reload(); 
  await a.waitForFunction(() => window.__pixeltown?.state.current.players?.length > 0); out.opacityAfterReload = await a.inputValue('.opacity input');
  await walkTo(c, 632, 224); await c.waitForFunction(() => window.__pixeltown.state.current.zone === 'garden'); out.portalArrival = await pos(c);
  await c.screenshot({ path: ASSETS + 'portal-garden-arrival.png' });
  await a.waitForFunction(() => window.__pixeltown.state.current.players.length === 1); out.otherZoneHidden = true;
  await walkTo(c, 4, 216); await c.waitForFunction(() => window.__pixeltown.state.current.zone === 'lobby'); out.portalBack = await pos(c);
  assert(out.unreadWhileCollapsed === '1' && !out.badgeAfterExpand && out.typingDidNotMove, 'chat unread/typing');
  assert(out.opacityMin === '20' && out.opacityMax === '95' && out.opacityAfterReload === '75' && out.chatTextOpacity === '1', 'chat opacity');
  } catch (e) { throw new Error(`${e.message} pos=${JSON.stringify(await pos(c).catch(() => null))}`); }
  return out;
});
await check('star_game_default_30s', async () => {
  const a = await login(1), c = await login(2), out = { counts: [] };
  for (const p of [a, c]) await zone(p, '오락실', 'arcade');
  await collapseChat(a);
  const g = () => a.evaluate(() => { const s = window.__pixeltown.state.current.game; return { active: s.active, n: s.stars.length, endsAt: s.endsAt, scores: s.scores }; });
  const t0 = Date.now(); await a.click('.profile .btn:has-text("시작하기")'); await a.waitForFunction(() => window.__pixeltown.state.current.game.active);
  out.durationSeconds = Math.round(((await g()).endsAt - Date.now()) / 1000); out.initial = (await g()).n;
  while (Date.now() - t0 < 13600) { out.counts.push((await g()).n); await sleep(500); }
  await a.screenshot({ path: ASSETS + 'star-cap12.png' });
  while ((await g()).active) {
    const me = await pos(a), stars = await a.evaluate(() => window.__pixeltown.state.current.game.stars);
    if (!stars.length) { await sleep(300); continue; }
    stars.sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y));
    await walkTo(a, stars[0].x, stars[0].y, 6000);
    if (!out.shot && Date.now() - t0 > 15000) { out.shot = true; await a.screenshot({ path: ASSETS + 'arcade-star-game.png' }); }
  }
  out.elapsed = Math.round((Date.now() - t0) / 1000);
  await a.waitForSelector('.toast:has-text("저장되었어요")', { timeout: 15000 });
  await a.click('.profile .btn:has-text("내 수첩")'); await sleep(800);
  out.notebook = await a.textContent('.notebook-body'); await a.screenshot({ path: ASSETS + 'result-notebook.png' });
  assert(out.durationSeconds === 30 && out.initial === 5 && Math.max(...out.counts) === 12 && out.counts.at(-1) === 12, 'generation cap');
  assert(/별 보상 [1-9]\d*개/.test(out.notebook), 'reward saved');
  await a.context().close(); await c.context().close(); return out;
});
await check('viewports_no_scroll_integer_scale', async () => {
  const out = {};
  for (const [w, h, n] of [[1280, 720, 'desktop'], [390, 844, 'mobile'], [844, 390, 'landscape'], [390, 430, 'short']]) {
    const mobile = n !== 'desktop', p = await login(1, { w, h, mobile });
    if (mobile) { const b = await (await p.$('.pad.오른쪽')).boundingBox(), x0 = (await pos(p)).x; await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await sleep(600); await p.mouse.up(); await sleep(300); out[n + 'DpadMoved'] = (await pos(p)).x - x0; }
    await p.screenshot({ path: ASSETS + `viewport-${n}.png`, scale: 'css' });
    const r = await p.evaluate(() => { const v = window.__pixeltown.view, c = document.querySelector('.world'); return { scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], zoomDevicePx: v.z, low: [v.low.width, v.low.height], canvas: [c.width, c.height], smoothing: c.getContext('2d').imageSmoothingEnabled, galmuri: document.fonts.check('12px Galmuri11') }; });
    assert(r.scroll[0] === w && r.scroll[1] === h, `${n} scroll`); assert(Number.isInteger(r.zoomDevicePx) && !r.smoothing && r.galmuri, `${n} pixel scale`);
    assert(r.low[0] * r.zoomDevicePx >= r.canvas[0] && (r.low[0] - 1) * r.zoomDevicePx < r.canvas[0], `${n} integer upscale`);
    if (mobile) {
      if (!(await p.$('.chat'))) await p.tap('.chat-fab');
      await p.tap('.chat-form input'); await p.keyboard.type('모바일 안녕'); await p.keyboard.press('Enter'); await sleep(400);
      const s = await (await p.$('.chat-form button')).boundingBox(); r.sendButtonVisible = s.y + s.height <= h && s.x + s.width <= w;
      await p.screenshot({ path: ASSETS + `viewport-${n}-chat.png`, scale: 'css' });
    }
    out[n] = r; await p.context().close();
  }
  const d = await login(1, { query: '?debug=collision' }); await collapseChat(d); await sleep(300);
  await d.screenshot({ path: ASSETS + 'debug-collision-lobby.png' }); await zone(d, '정원', 'garden'); await d.screenshot({ path: ASSETS + 'debug-collision-garden.png' });
  await d.context().close();
  return out;
});
report.finishedAt = new Date().toISOString();
report.status = Object.values(report.checks).every(c => c.ok) ? 'passed' : 'failed';
await writeFile(new URL('./ui-report.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
console.log(report.status.toUpperCase());
await browser.close();
if (report.status !== 'passed') process.exitCode = 1;
