// Browser checks for the remake (AC-003..008, 011, 014..016). Drives the real UI like a player:
// clicks on the mini-room to walk, holds arrow keys, uses the chat and the star game.
// Needs `npm run dev:all` (optionally with PIXELTOWN_*_PORT) and a Chromium binary:
//   CHROME_PATH=/path/to/chrome PIXELTOWN_WEB_PORT=5273 node tests/ui-check.mjs
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getMap, findPath, clearWalk } from '../shared/world.js';

const BASE = `http://127.0.0.1:${process.env.PIXELTOWN_WEB_PORT || 5173}/`;
const ASSETS = new URL('../docs/assets/', import.meta.url).pathname;
const report = { startedAt: new Date().toISOString(), url: BASE, checks: {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });

async function login(account = 1, { w = 1280, h = 720, mobile = false, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
  // No login screen any more (PLAN-006): an existing account enters like a returning guest, from saved credentials.
  await ctx.addInitScript(([email, password]) => localStorage.setItem('pixeltown.guest', JSON.stringify({ email, password })), [`demo${account}@pixeltown.local`, 'PixelTown123!']);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(BASE + query);
  await p.waitForFunction(() => window.__pixeltown?.state.current.players?.length > 0, null, { timeout: 10000 })
    .catch(async e => { throw new Error(`login ${account}: ${await p.evaluate(() => document.querySelector('.toast')?.textContent)} ${e.message}`); });
  await sleep(400); p.name = `Demo ${account}`; return p;
}
// Throwaway shopper account with stars granted through the server-only settlement endpoint (dev DB of this worktree).
async function shopper({ avatar = { skin: 2, hair: 4, style: 1 }, name = `쇼핑왕${Date.now().toString(36).slice(-4)}` } = {}) {
  process.env.PB_URL ||= `http://127.0.0.1:${process.env.PIXELTOWN_PB_PORT || 18090}`;
  const { adminClient } = await import('../colyseus/config.js'), admin = await adminClient(), id = Date.now().toString(36);
  const email = `ui-${id}@pixeltown.local`, password = `PixelTown-${id}-1!`;
  const user = await admin.collection('users').create({ email, password, passwordConfirm: password, name: `Shop ${id}`, verified: true });
  await admin.collection('profiles').create({ user: user.id, name, color: '#9fd0ff', ...(avatar ? { avatar } : {}) });
  await admin.send('/api/pixeltown/commit-match', { method: 'POST', body: { match_id: randomUUID(), zone: 'lobby', ended_at: new Date().toISOString(), scores: { [user.id]: 60 } } });
  await admin.send('/api/pixeltown/commit-match', { method: 'POST', body: { match_id: randomUUID(), zone: 'garden', ended_at: new Date().toISOString(), scores: { [user.id]: 60 } } });
  return { email, password, id: user.id, name };
}
async function loginAs({ email, password }, name, { w = 1280, h = 720 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([email, password]) => localStorage.setItem('pixeltown.guest', JSON.stringify({ email, password })), [email, password]);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(BASE);
  await p.waitForFunction(() => window.__pixeltown?.state.current.players?.length > 0, null, { timeout: 10000 });
  await sleep(400); p.name = name; return p;
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
  if (z === 'home') { await clickWorld(p, x, y); await sleep(3000); return pos(p); } // the mini-room map lives only in the page
  // Long straight segments are split so every click target is on screen.
  const pts = []; let prev = q;
  for (const wp of findPath(getMap(z), q, { x, y })) { const n = Math.ceil(Math.hypot(wp.x - prev.x, wp.y - prev.y) / 56); for (let i = 1; i <= n; i++) pts.push({ x: prev.x + (wp.x - prev.x) * i / n, y: prev.y + (wp.y - prev.y) * i / n }); prev = wp; }
  for (const wp of pts) {
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
  if (process.env.UI_ONLY && !process.env.UI_ONLY.split(',').some(k => name.includes(k))) return; // e.g. UI_ONLY=shop,arcade
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
  await walkTo(p, 320, 120); const wall = await hold(p, 'ArrowUp', 3000); await shot(p, 'collision-arcade-wall.png', 320, 70);
  await zone(p, '정원', 'garden');
  const pergola = await walkTo(p, 98, 216); await shot(p, 'depth-pergola.png', 98, 216, 170, 120);
  await walkTo(p, 272, 198); const pond = await hold(p, 'ArrowUp', 800); await shot(p, 'collision-pond.png', 272, 200, 170, 120);
  assert(wall.y >= 48 + 3 - 0.5 && wall.y < 56, `arcade wall stops the avatar ${JSON.stringify(wall)}`); assert(pond.y >= 192 + 3 - 0.5, 'pond blocks');
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
await check('click_move_shortest_marker_and_key_cancel', async () => {
  const a = await login(1), out = {};
  if (!(await a.$('.chat'))) await a.click('.chat-fab');
  // Click through the chat log onto the map: the avatar walks there.
  const box = await (await a.$('.chat-log')).boundingBox(), start = await pos(a);
  await a.mouse.click(box.x + box.width - 20, box.y + 20); await sleep(150);
  const r1 = await a.evaluate(() => ({ route: window.__pixeltown.route.current, marker: window.__pixeltown.marker.current }));
  out.chatClickStartedRoute = r1.route.length > 0 && Boolean(r1.marker);
  out.routeSegmentsClear = r1.route.every((p, i) => clearWalk(getMap('lobby'), i ? r1.route[i - 1] : start, p));
  // Arrow key while walking cancels the route and the marker.
  await sleep(500); await a.keyboard.down('ArrowDown'); await sleep(200); await a.keyboard.up('ArrowDown'); await sleep(100);
  out.keyCancelled = await a.evaluate(() => window.__pixeltown.route.current.length === 0 && !window.__pixeltown.marker.current);
  // Clicking onto the house (blocked) walks to the closest reachable spot in front of it.
  await walkTo(a, 120, 120); await clickWorld(a, 120, 80); await sleep(120);
  out.blockedClickMarker = await a.evaluate(() => window.__pixeltown.marker.current);
  await shot(a, 'click-marker.png', out.blockedClickMarker.x, out.blockedClickMarker.y);
  await sleep(2500); out.stoppedAt = await pos(a);
  // Clicking on a star walks onto it; the marker is drawn on the ground under the star.
  const stars = await a.evaluate(() => window.__pixeltown.state.current.game.stars);
  out.starCount = stars.length;
  assert(out.chatClickStartedRoute && out.routeSegmentsClear && out.keyCancelled, 'chat click / straight route / key cancel');
  assert(Math.hypot(out.stoppedAt.x - out.blockedClickMarker.x, out.stoppedAt.y - out.blockedClickMarker.y) < 4 && out.stoppedAt.y > 96, 'nearest reachable spot');
  return out;
});
await check('star_event_always_on', async () => {
  const a = await login(1), out = { counts: [] };
  await zone(a, '오락실', 'arcade'); await collapseChat(a);
  const g = () => a.evaluate(() => { const s = window.__pixeltown.state.current.game; return { active: s.active, n: s.stars.length, endsAt: s.endsAt, scores: s.scores, stars: s.stars }; });
  out.startButton = Boolean(await a.$('button:has-text("시작하기")'));
  const first = await g(); out.activeOnJoin = first.active; out.initial = first.n;
  out.minimumSpacing = Math.round(Math.min(...first.stars.flatMap((p, i) => first.stars.slice(i + 1).map(q => Math.hypot(p.x - q.x, p.y - q.y)))));
  const t0 = Date.now(); while (Date.now() - t0 < 13000) { out.counts.push((await g()).n); await sleep(1000); }
  out.secondsToNextSettlement = Math.round(((await g()).endsAt - Date.now()) / 1000);
  for (let i = 0; i < 3; i++) {
    const me = await pos(a), stars = (await g()).stars.sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y));
    await walkTo(a, stars[0].x, stars[0].y, 15000);
  }
  await a.screenshot({ path: ASSETS + 'arcade-star-game.png' });
  out.myScore = (await g()).scores[(await a.evaluate(() => window.__pixeltown.state.current.players.find(q => q.name === 'Demo 1').id))];
  // Wait for the regular settlement (default 3 minutes) and the saved notice.
  await a.waitForSelector('.toast:has-text("저장되었어요")', { timeout: 200000 });
  out.stillActiveAfterSettlement = (await g()).active;
  await a.click('.profile .btn:has-text("내 수첩")'); await sleep(800);
  out.notebook = (await a.textContent('.notebook-body')).slice(0, 200); await a.screenshot({ path: ASSETS + 'result-notebook.png' });
  assert(!out.startButton && out.activeOnJoin && out.initial >= 5 && out.stillActiveAfterSettlement, 'always on');
  assert(Math.max(...out.counts) - out.counts[0] <= 3, 'not spawning too often'); assert(out.myScore >= 1, 'server scored collection');
  return out;
});
await check('shop_dress_pet_and_miniroom', async () => {
  const acc = await shopper(), s = await loginAs(acc, acc.name), o = await login(2), out = {};
  await collapseChat(s);
  await s.click('.profile .btn:has-text("별 상점")'); await s.waitForSelector('.shop');
  out.walletBefore = await s.textContent('.shop .stars-badge');
  const buyWear = async (tab, name, wear) => {
    await s.click(`.shop-tabs button:has-text("${tab}")`);
    const card = s.locator('.shop-item', { hasText: name });
    await card.locator('button:has-text("사기")').click(); await card.locator('button:has-text("사기")').waitFor({ state: 'detached' });
    if (wear) { await card.locator(`button:has-text("${wear}")`).click(); await s.locator('.shop-item.worn', { hasText: name }).waitFor(); }
  };
  await buyWear('모자', '왕관', '입기'); await buyWear('옷', '세일러복', '입기'); await buyWear('펫', '강아지', '데리고 다니기');
  for (const f of ['침대', '하트 러그', '소파', '화분']) await buyWear('가구', f);
  await s.click('.shop-tabs button:has-text("모자")'); await s.screenshot({ path: ASSETS + 'shop-closet.png' });
  out.walletAfter = await s.textContent('.shop .stars-badge');
  await s.click('.shop >> text=닫기');
  // The other player sees the crown, the sailor top and the puppy (from the server profile).
  await o.waitForFunction(n => window.__pixeltown.state.current.players.find(q => q.name === n)?.look?.pet === 'pet_puppy', acc.name, { timeout: 5000 });
  out.seenByOther = await o.evaluate(n => window.__pixeltown.state.current.players.find(q => q.name === n).look, acc.name);
  const me = await pos(s); await walkTo(s, me.x + 50, me.y + 10); await sleep(1200);
  await shot(s, 'outfit-pet.png', me.x + 50, me.y + 5, 120, 80);
  await shot(o, 'outfit-pet-other.png', me.x + 50, me.y + 5, 120, 80);
  // Mini-room: place furniture on the grid, save, reload, still there.
  await zone(s, '미니룸', 'home'); await s.click('button:has-text("가구 배치")');
  const place = async (name, x, y) => { await s.click(`.edit-item:has-text("${name}")`); await clickWorld(s, x, y); await sleep(200); };
  await place('침대', 184, 180); await place('하트 러그', 320, 230); await place('소파', 420, 180);
  await place('화분', 320, 296); out.doorBlockedToast = await s.textContent('.toast').catch(() => null);
  await clickWorld(s, 456, 300); await sleep(200); // the plant is still selected: put it in the corner
  await s.screenshot({ path: ASSETS + 'miniroom-edit.png' });
  await s.click('.edit-bar button:has-text("저장")'); await s.waitForSelector('.toast:has-text("저장했어요")');
  await s.reload(); await s.waitForFunction(() => window.__pixeltown?.state.current.players?.length > 0); await zone(s, '미니룸', 'home'); await sleep(800);
  const { adminClient } = await import('../colyseus/config.js'), admin = await adminClient();
  out.savedRoom = (await admin.collection('profiles').getFirstListItem(`user="${acc.id}"`)).room;
  await walkTo(s, 240, 200); await sleep(600);
  // Facing the camera, the pet must sit beside the owner (not straight behind the body where it is fully covered).
  await s.keyboard.down('ArrowDown'); await sleep(200); await s.keyboard.up('ArrowDown'); await sleep(1200);
  out.petFacingDown = await s.evaluate(() => { const a = [...window.__pixeltown.anim.values()].find(v => v.pet); return a && { dir: a.dir, dx: +(a.pet.x - a.x).toFixed(1), dy: +(a.pet.y - a.y).toFixed(1) }; });
  await s.screenshot({ path: ASSETS + 'miniroom.png' });
  out.besideBed = await pos(s);
  out.pageErrors = [...s.errs, ...o.errs];
  assert(out.seenByOther.hat === 'hat_crown' && out.seenByOther.top === 'top_sailor', 'outfit synced');
  assert(out.petFacingDown?.dir === 0 && (Math.abs(out.petFacingDown.dx) >= 10 || out.petFacingDown.dy > 0), 'pet visible beside owner'); assert(/문 앞/.test(out.doorBlockedToast || ''), 'door rule'); assert(out.savedRoom?.length === 4, 'room saved'); assert(!out.pageErrors.length, 'page errors');
  return out;
});
await check('character_setup_first_entry', async () => {
  // A first-time visitor (no account) lands on the character set-up, which signs a guest up (PLAN-006); others see it (FR-014).
  const out = {};
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }), p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(BASE);
  await p.waitForSelector('[role=dialog][aria-label="캐릭터 만들기"]');
  out.noLoginForm = !(await p.$('input[type=email]')) && !(await p.$('text=혼자 둘러보기')) && !(await p.$('input[type=password]'));
  await p.screenshot({ path: ASSETS + 'first-screen.png' });
  out.roomJoinedBeforeSetup = await p.evaluate(() => Boolean(window.__pixeltown?.state.current.players?.length));
  const nick = `별돌이${Date.now().toString(36).slice(-3)}`;
  await p.fill('[role=dialog] input', '가'); out.shortNameDisabled = await p.isDisabled('[role=dialog] button:has-text("이대로 입장")');
  // A taken nickname (case-insensitive) is refused with a message under the field; the room is still not joined.
  await p.fill('[role=dialog] input', 'demo 1'); await p.click('button:has-text("이대로 입장")');
  await p.waitForSelector('#name-error'); out.takenMessage = await p.textContent('#name-error');
  out.takenFieldInvalid = await p.getAttribute('[role=dialog] input', 'aria-invalid'); await p.screenshot({ path: ASSETS + 'character-name-taken.png' });
  assert(/이미 쓰는 닉네임/.test(out.takenMessage) && out.takenFieldInvalid === 'true', 'taken nickname feedback');
  await p.fill('[role=dialog] input', nick);
  await p.click('button[aria-label="피부 4"]'); await p.click('button[aria-label="머리 색 7"]'); await p.click('button:has-text("방울 머리")'); await p.click('button[aria-label="옷 색 4"]');
  await p.screenshot({ path: ASSETS + 'character-setup.png' });
  await p.click('button:has-text("이대로 입장")');
  await p.waitForFunction(() => window.__pixeltown?.state.current.players?.length > 0, null, { timeout: 10000 }).catch(async e => { throw new Error(`enter after set-up: ${await p.evaluate(() => document.querySelector('[role=alert]')?.textContent)} ${e.message}`); });
  out.guestSaved = await p.evaluate(() => /@guest\.pixeltown\.local$/.test(JSON.parse(localStorage.getItem('pixeltown.guest') || '{}').email || ''));
  // Returning visitor: a reload enters the town again as the same character without any screen in between.
  await p.reload(); await p.waitForFunction(n => window.__pixeltown?.state.current.players?.some(q => q.name === n), nick, { timeout: 15000 });
  out.reloadSameCharacter = true;
  const o = await login(2);
  const seen = await o.waitForFunction(n => window.__pixeltown.state.current.players.find(q => q.name === n), nick, { timeout: 10000 }).then(h => h.jsonValue())
    .catch(async e => { throw new Error(`seen by other: ${JSON.stringify(await o.evaluate(() => window.__pixeltown.state.current.players.map(q => q.name)))} ${e.message}`); });
  out.seenByOther = { name: seen.name, color: seen.color, look: seen.look };
  assert(seen.look.skin === 3 && seen.look.hair === 6 && seen.look.style === 2 && seen.color === '#9be38c', 'look synced');
  // Later edit from the game: rename and recolour, the name tag follows.
  await p.click('button:has-text("캐릭터 꾸미기")'); await p.fill('[role=dialog] input', nick + '2'); await p.click('button[aria-label="옷 색 2"]'); await p.click('[role=dialog] button:has-text("저장")');
  await o.waitForFunction(n => window.__pixeltown.state.current.players.some(q => q.name === n && q.color === '#ffb347'), nick + '2', { timeout: 10000 });
  out.editedName = nick + '2'; await sleep(500); await p.screenshot({ path: ASSETS + 'character-in-town.png' });
  out.pageErrors = [...p.errs, ...o.errs];
  assert(out.noLoginForm && out.guestSaved && !out.roomJoinedBeforeSetup && out.shortNameDisabled && !out.pageErrors.length, JSON.stringify(out));
  await ctx.close(); await o.context().close();
  return out;
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
if (process.env.UI_ONLY) { // partial run: merge into the last full report
  const prev = JSON.parse(await import('node:fs/promises').then(f => f.readFile(new URL('./ui-report.json', import.meta.url), 'utf8')).catch(() => '{}'));
  report.checks = { ...(prev.checks || {}), ...report.checks };
}
report.status = Object.values(report.checks).every(c => c.ok) ? 'passed' : 'failed';
await writeFile(new URL('./ui-report.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
console.log(report.status.toUpperCase());
await browser.close();
if (report.status !== 'passed') process.exitCode = 1;
