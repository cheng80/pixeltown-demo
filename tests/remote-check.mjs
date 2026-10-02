// Two-user functional check against the Mac mini services through the public HTTPS/WSS endpoints (PLAN-004).
// Uses the test accounts in pocketbase/.local/remote-accounts.json (0600, git-ignored). Writes tests/remote-report.json
// without credentials or tokens. Takes about four minutes: the star event settles on the server default (3 min).
//   node tests/remote-check.mjs
// Never use this for load: the public tunnel is for small functional checks only.
// PIXELTOWN_REMOTE_OUTAGE=1 runs only the durable-outbox check instead: over SSH it shortens the settlement period to 30s,
// stops PocketBase during a settlement, restarts Colyseus with the match still on disk, brings PocketBase back and checks the
// saved result. The period override is removed and both services are restored in `finally`.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import PocketBase from 'pocketbase';
import { getMap, findPath, COLLECT_RADIUS, ITEMS } from '../shared/world.js';

const root = new URL('..', import.meta.url).pathname;
const PB_URL = process.env.PIXELTOWN_REMOTE_PB || 'https://pixeltown-pb.fastmake.net';
const RT_URL = process.env.PIXELTOWN_REMOTE_RT || 'https://pixeltown-rt.fastmake.net';
const WS_URL = RT_URL.replace(/^http/, 'ws');
const { Client } = createRequire(root + 'colyseus/package.json')('@colyseus/sdk');
const accounts = JSON.parse(await readFile(root + 'pocketbase/.local/remote-accounts.json', 'utf8'));
const report = { startedAt: new Date().toISOString(), pocketbase: PB_URL, realtime: WS_URL, checks: {} };
const RT_DIR = '/Users/cheng80/Servers/pixeltown-colyseus', PB_PLIST = '~/Library/LaunchAgents/com.fastmake.pixeltown.pocketbase.plist';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  do { const v = await fn(); if (v) return v; await sleep(50); } while (Date.now() < end);
  throw new Error(`timeout: ${label}`);
}
async function check(name, fn) {
  const started = Date.now();
  try { report.checks[name] = { ok: true, ...(await fn()), ms: Date.now() - started }; console.log('PASS', name); }
  catch (e) { report.checks[name] = { ok: false, error: e.message }; console.log('FAIL', name, e.message); }
}
async function login({ email, password }) {
  const pb = new PocketBase(PB_URL); pb.autoCancellation(false);
  await pb.collection('users').authWithPassword(email, password);
  return pb;
}
function watch(room) {
  const s = { room, snapshot: null, messages: [] };
  room.onMessage('*', (type, payload) => { s.messages.push({ type, payload, at: Date.now() }); if (type === 'snapshot') s.snapshot = payload; });
  return s;
}
async function join(pb, zone = 'lobby') {
  const client = new Client(WS_URL); client.auth.token = pb.authStore.token;
  const s = watch(await client.joinOrCreate('town', { zone }));
  await until(() => s.snapshot?.players?.some(p => p.id === pb.authStore.record.id), 'own snapshot');
  return s;
}
const me = (s, pb) => s.snapshot.players.find(p => p.id === pb.authStore.record.id);
async function walk(s, pb, target, timeout = 25000) {
  const map = getMap(s.snapshot.zone), path = [...findPath(map, me(s, pb), target), target], end = Date.now() + timeout;
  while (Date.now() < end) {
    const p = me(s, pb);
    while (path.length > 1 && Math.hypot(path[0].x - p.x, path[0].y - p.y) < 3) path.shift();
    if (Math.hypot(target.x - p.x, target.y - p.y) < COLLECT_RADIUS - 4) return p;
    const dx = path[0].x - p.x, dy = path[0].y - p.y, l = Math.hypot(dx, dy) || 1;
    s.room.send('input', { dx: dx / l, dy: dy / l }); await sleep(50);
  }
  throw new Error('walk timeout');
}
const pbFetch = (path, { token, method = 'GET', body } = {}) => fetch(PB_URL + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
}).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));

const [pa, pb2] = await Promise.all(accounts.map(login));
const [A, B] = [pa.authStore.record.id, pb2.authStore.record.id];
report.users = { user1: A, user2: B };
let a, b;
const OUTAGE = process.env.PIXELTOWN_REMOTE_OUTAGE === '1';
try {
  if (OUTAGE) await outage(); else {
  await check('auth_and_forgery_rejected', async () => {
    const bad = new Client(WS_URL); bad.auth.token = 'invalid.remote.token';
    const invalid = await bad.joinOrCreate('town', { zone: 'lobby' }).then(r => (r.leave(), 'accepted'), e => e.code ?? 'rejected');
    const missing = await new Client(WS_URL).joinOrCreate('town', { zone: 'lobby' }).then(r => (r.leave(), 'accepted'), e => e.code ?? 'rejected');
    assert.notEqual(invalid, 'accepted'); assert.notEqual(missing, 'accepted');
    const meOk = await fetch(RT_URL + '/me', { headers: { Authorization: `Bearer ${pa.authStore.token}` } });
    const meNo = await fetch(RT_URL + '/me');
    assert.equal(meOk.status, 200); assert.equal(meNo.status, 401);
    const profileB = await pbFetch(`/api/collections/profiles/records?filter=${encodeURIComponent(`user="${B}"`)}`, { token: pa.authStore.token });
    const ownProfile = (await pbFetch('/api/collections/profiles/records', { token: pa.authStore.token })).data.items[0];
    const patch = await pbFetch(`/api/collections/profiles/records/${ownProfile.id}`, { token: pa.authStore.token, method: 'PATCH', body: { user: B, outfit: { hat: 'hat_crown' } } });
    const forgedResult = await pbFetch('/api/collections/results/records', { token: pa.authStore.token, method: 'POST', body: { user: A, match_id: 'forged', zone: 'lobby', score: 999, ended_at: new Date().toISOString() } });
    const forgedPurchase = await pbFetch('/api/collections/purchases/records', { token: pa.authStore.token, method: 'POST', body: { user: A, item: 'pet_bunny', price: 0 } });
    const commitAsUser = await pbFetch('/api/pixeltown/commit-match', { token: pa.authStore.token, method: 'POST', body: { match_id: 'x', zone: 'lobby', ended_at: new Date().toISOString(), scores: { [A]: 64 } } });
    const anonymousRows = await pbFetch('/api/collections/results/records');
    // Public sign-up is closed (users.createRule = null); accounts come only from provision-accounts.mjs.
    const signupPassword = `Probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const signup = await pbFetch('/api/collections/users/records', { method: 'POST', body: { email: `signup-probe-${Date.now()}@example.com`, password: signupPassword, passwordConfirm: signupPassword } });
    assert.equal(profileB.data.items.length, 0); assert.ok(patch.status >= 400); assert.ok(forgedResult.status >= 400);
    assert.ok(forgedPurchase.status >= 400); assert.ok([401, 403].includes(commitAsUser.status)); assert.equal(anonymousRows.data?.items?.length ?? 0, 0); assert.equal(signup.status, 403);
    return { invalidToken: invalid, missingToken: missing, meWithToken: 200, meWithout: 401, otherProfileVisible: 0, profilePatch: patch.status, forgedResult: forgedResult.status, forgedPurchase: forgedPurchase.status, commitAsUser: commitAsUser.status, publicSignup: signup.status };
  });

  await check('two_users_move_chat', async () => {
    [a, b] = [await join(pa), await join(pb2)];
    await until(() => a.snapshot.players.length === 2 && b.snapshot.players.length === 2, 'both visible');
    const before = me(a, pa), target = { x: before.x + 40, y: before.y };
    for (let i = 0; i < 12; i++) { a.room.send('input', { dx: 1, dy: 0 }); await sleep(50); }
    const seen = await until(() => { const p = b.snapshot.players.find(q => q.id === A); return p.x > before.x + 10 && p; }, 'movement seen by other');
    const text = `remote-${Date.now()}`;
    a.room.send('chat', { text, id: B, name: 'SPOOF' });
    const got = await until(() => b.messages.find(m => m.type === 'chat' && m.payload.text === text), 'chat delivered');
    assert.equal(got.payload.id, A);
    return { movedBy: +(seen.x - before.x).toFixed(1), target: target.x, chatSenderIsServerId: true };
  });

  await check('zone_separation', async () => {
    await b.room.leave(); b = await join(pb2, 'garden');
    await until(() => a.snapshot.players.length === 1 && b.snapshot.players.length === 1, 'separate rooms');
    const text = `lobby-only-${Date.now()}`; a.room.send('chat', { text }); await sleep(800);
    assert.ok(!b.messages.some(m => m.payload?.text === text));
    return { lobbyPlayers: 1, gardenPlayers: 1, crossZoneChat: false };
  });

  let collected = 0, matchId;
  await check('star_cap_collect_and_refill', async () => {
    matchId = a.snapshot.game.id;
    const counts = [];
    await until(() => (counts.push(a.snapshot.game.stars.length), a.snapshot.game.stars.length === 12), 'cap 12', 60000);
    const capAt = Date.now(); let max = 12;
    while (Date.now() - capAt < 8000) { max = Math.max(max, a.snapshot.game.stars.length); await sleep(100); }
    assert.equal(max, 12);
    const ids = new Set(a.snapshot.game.stars.map(s => s.id));
    while (collected < 10 && a.snapshot.game.id === matchId && a.snapshot.game.endsAt - Date.now() > 20000) {
      const p = me(a, pa), star = [...a.snapshot.game.stars].sort((s, t) => Math.hypot(s.x - p.x, s.y - p.y) - Math.hypot(t.x - p.x, t.y - p.y))[0];
      await walk(a, pa, star);
      a.room.send('collect', { id: star.id });
      await until(() => !a.snapshot.game.stars.some(s => s.id === star.id), 'collected', 3000).catch(() => {});
      collected = a.snapshot.game.scores[A] || 0;
    }
    const refill = await until(() => a.snapshot.game.stars.find(s => !ids.has(s.id)), 'refill with new id', 15000);
    return { startCountSeen: counts[0], cap: 12, maxObservedAtCap: max, collected, refillId: Boolean(refill), serverScore: a.snapshot.game.scores[A] };
  });

  let ended;
  await check('default_3min_settlement_saved', async () => {
    const endedMsg = await until(() => a.messages.find(m => m.type === 'gameEnded' && m.payload.match_id === matchId), 'gameEnded', 200000);
    ended = endedMsg.payload;
    await until(() => a.snapshot.persistence.status === 'saved' && a.snapshot.game.id !== matchId, 'saved and next period', 30000);
    const results = (await pbFetch(`/api/collections/results/records?filter=${encodeURIComponent(`match_id="${matchId}"`)}`, { token: pa.authStore.token })).data.items;
    const inventory = (await pbFetch(`/api/collections/inventory/records?filter=${encodeURIComponent(`match_id="${matchId}"`)}`, { token: pa.authStore.token })).data.items;
    const otherSees = (await pbFetch(`/api/collections/results/records?filter=${encodeURIComponent(`match_id="${matchId}"`)}`, { token: pb2.authStore.token })).data.items;
    assert.equal(results.length, 1); assert.equal(results[0].score, ended.scores[A]); assert.equal(inventory[0].quantity, ended.scores[A]); assert.equal(otherSees.length, 0);
    // The next period starts at settlement, so its endsAt minus the settlement time is the server's period length.
    const periodMs = a.snapshot.game.endsAt - endedMsg.at;
    assert.ok(Math.abs(periodMs - 180000) < 3000, `period ${periodMs}`);
    report.matchId = matchId;
    return { matchId, scoreSaved: results[0].score, inventoryQuantity: inventory[0].quantity, serverScores: ended.scores, measuredPeriodMs: Math.round(periodMs), starsKeptIntoNextPeriod: a.snapshot.game.stars.length > 0, otherUserCanRead: false };
  });

  await check('shop_equip_room_and_relogin', async () => {
    const list = async (col, pb) => (await pbFetch(`/api/collections/${col}/records?perPage=200`, { token: pb.authStore.token })).data.items;
    const wallet = async pb => (await list('inventory', pb)).reduce((n, r) => n + r.quantity, 0) - (await list('purchases', pb)).reduce((n, r) => n + r.price, 0);
    const buy = item => pbFetch('/api/pixeltown/shop/buy', { token: pa.authStore.token, method: 'POST', body: { item } });
    // Re-runnable: earlier runs keep their purchases, so buy the cheapest affordable new wearable and furniture
    // and fall back to owned ones for equip/placement when the wallet cannot buy anything new.
    const before = await wallet(pa), owned = new Set((await list('purchases', pa)).map(r => r.item)), items = Object.values(ITEMS).sort((x, y) => x.price - y.price);
    let left = before; const bought = [];
    const pick = slots => {
      const fresh = items.find(i => slots.includes(i.slot) && !owned.has(i.id) && i.price <= left);
      if (fresh) { left -= fresh.price; bought.push(fresh.id); return fresh; }
      return items.find(i => slots.includes(i.slot) && owned.has(i.id));
    };
    const wear = pick(['hat', 'top', 'pet']), furniture = pick(['furniture']);
    assert.ok(wear && furniture, `wallet ${before}: nothing to buy and nothing owned`);
    for (const id of bought) assert.equal((await buy(id)).status, 200, `buy ${id}`);
    const again = await buy(wear.id), dear = items.filter(i => !owned.has(i.id) && !bought.includes(i.id) && i.price > left).at(-1);
    const tooDear = dear ? (await buy(dear.id)).status : 'none left';
    assert.equal(again.status, 400); if (dear) assert.equal(tooDear, 400);
    const outfit = { hat: null, top: null, pet: null, [wear.slot]: wear.id };
    const equip = await pbFetch('/api/pixeltown/shop/equip', { token: pa.authStore.token, method: 'POST', body: outfit });
    const notOwnedItem = items.find(i => i.slot === 'hat' && !owned.has(i.id) && !bought.includes(i.id));
    const notOwned = notOwnedItem ? (await pbFetch('/api/pixeltown/shop/equip', { token: pa.authStore.token, method: 'POST', body: { hat: notOwnedItem.id } })).status : 'all owned';
    const door = await pbFetch('/api/pixeltown/shop/room', { token: pa.authStore.token, method: 'POST', body: { placements: [{ item: furniture.id, c: 19, r: 18 }] } });
    const room = await pbFetch('/api/pixeltown/shop/room', { token: pa.authStore.token, method: 'POST', body: { placements: [{ item: furniture.id, c: 11, r: 10 }] } });
    assert.equal(equip.status, 200); if (notOwnedItem) assert.equal(notOwned, 400); assert.equal(door.status, 400); assert.equal(room.status, 200);
    a.room.send('look');
    if (b.snapshot.zone !== 'lobby') { await b.room.leave(); b = await join(pb2, 'lobby'); }
    await until(() => b.snapshot.players.find(p => p.id === A)?.look?.[wear.slot] === wear.id, 'other sees the outfit');
    // Fresh login: the outfit and the mini-room come back from PocketBase.
    await a.room.leave(); const fresh = await login(accounts[0]); a = await join(fresh, 'lobby');
    const profile = (await list('profiles', fresh))[0];
    assert.equal(profile.outfit[wear.slot], wear.id); assert.deepEqual(profile.room, [{ item: furniture.id, c: 11, r: 10 }]);
    assert.equal(me(a, fresh).look[wear.slot], wear.id);
    return { bought, wear: wear.id, furniture: furniture.id, walletBefore: before, walletAfter: await wallet(fresh), duplicateBuy: again.status, unaffordable: tooDear, notOwnedEquip: notOwned, doorPlacement: door.status, savedRoom: profile.room, otherSeesOutfit: true };
  });

  await check('character_setup_profile', async () => {
    // FR-014 on the remote hooks: own profile only, catalogue values only, unique nickname; the room shows the new look.
    const save = (pb, body) => pbFetch('/api/pixeltown/profile', { token: pb?.authStore.token, method: 'POST', body });
    const mine = { name: accounts[0].name || 'Tester 1', color: '#ffb347', avatar: { skin: 2, hair: 3, style: 1 } };
    const anonymous = (await save(null, mine)).status, badColour = (await save(pa, { ...mine, color: '#000000' })).status;
    const saved = (await save(pa, mine)).status, duplicate = (await save(pb2, { ...mine, color: '#89cff0' })).status;
    assert.equal(anonymous, 401); assert.equal(badColour, 400); assert.equal(saved, 200); assert.equal(duplicate, 400);
    // Independent of earlier checks: put both players in the same room first.
    if (b.snapshot.zone !== a.snapshot.zone) { await b.room.leave(); b = await join(pb2, a.snapshot.zone); }
    a.room.send('look');
    const seen = await until(() => { const p = b.snapshot.players.find(q => q.id === A); return p?.look?.skin === 2 && p; }, 'other sees the character');
    assert.deepEqual([seen.name, seen.color, seen.look.hair, seen.look.style], [mine.name, mine.color, 3, 1]);
    return { anonymous, badColour, saved, duplicateNickname: duplicate, seenByOther: { skin: seen.look.skin, hair: seen.look.hair, style: seen.look.style, color: seen.color } };
  });

  await check('monitor_admin_only', async () => {
    const basic = (u, p) => ({ Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
    const none = await fetch(RT_URL + '/monitor/'), user = await fetch(RT_URL + '/monitor/', { headers: basic(accounts[0].email, accounts[0].password) });
    const api = await fetch(RT_URL + '/monitor/api/', { headers: basic(accounts[1].email, 'wrong-password') });
    assert.equal(none.status, 401); assert.equal(user.status, 401); assert.equal(api.status, 401);
    return { anonymous: none.status, gameUser: user.status, wrongPassword: api.status };
  });
}
} finally {
  if (OUTAGE) restore();
  await Promise.race([Promise.allSettled([a, b].filter(Boolean).map(s => s.room.leave())), sleep(3000)]); // a room cut by a server restart never acknowledges
  report.finishedAt = new Date().toISOString();
  const all = Object.values(report.checks);
  report.summary = { passed: all.filter(c => c.ok).length, failed: all.filter(c => !c.ok).length };
  await writeFile(root + 'tests/remote-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(report.summary.failed ? 'FAILED' : 'PASSED', JSON.stringify(report.summary));
  process.exit(report.summary.failed ? 1 : 0);
}

function ssh(cmd) {
  const key = process.env.PIXELTOWN_SSH_KEY || `${process.env.HOME}/.ssh/stonematch_macmini_ed25519`, host = process.env.PIXELTOWN_SSH_HOST || 'cheng80@100.92.43.82';
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-i', key, host, cmd], { encoding: 'utf8' }).trim();
}
function setPeriod(line) {
  return ssh(`cd ${RT_DIR} && grep -v '^GAME_DURATION_MS=' .env > .env.next; ${line ? `echo '${line}' >> .env.next;` : ''} chmod 600 .env.next && mv .env.next .env && launchctl kickstart -k gui/$(id -u)/com.fastmake.pixeltown.colyseus`);
}
function health() { return fetch(RT_URL + '/health').then(r => r.json()).catch(() => null); }
function restore() {
  try { ssh(`launchctl print gui/$(id -u)/com.fastmake.pixeltown.pocketbase >/dev/null 2>&1 || launchctl bootstrap gui/$(id -u) ${PB_PLIST}`); } catch (e) { console.log('restore PB failed', e.message); }
  try { setPeriod(null); } catch (e) { console.log('restore period failed', e.message); }
}
async function outage() {
  await check('outbox_outage_restart_recovery', async () => {
    setPeriod('GAME_DURATION_MS=30000');
    await until(async () => (await health())?.ok, 'colyseus back', 30000);
    a = await join(pa, 'lobby');
    const matchId = a.snapshot.game.id, p = me(a, pa);
    const star = [...a.snapshot.game.stars].sort((s, t) => Math.hypot(s.x - p.x, s.y - p.y) - Math.hypot(t.x - p.x, t.y - p.y))[0];
    await walk(a, pa, star); a.room.send('collect', { id: star.id });
    await until(() => a.snapshot.game.scores[A] >= 1, 'scored', 5000);
    ssh(`launchctl bootout gui/$(id -u)/com.fastmake.pixeltown.pocketbase`);
    const pbDown = await fetch(PB_URL + '/api/health').then(r => r.status, () => 'unreachable');
    const ended = (await until(() => a.messages.find(m => m.type === 'gameEnded' && m.payload.match_id === matchId), 'settled while PB down', 40000)).payload;
    await until(() => a.snapshot.persistence.status === 'pending', 'pending', 10000);
    const onDisk = Number(ssh(`ls ${RT_DIR}/outbox/*.json 2>/dev/null | wc -l`));
    ssh(`launchctl kickstart -k gui/$(id -u)/com.fastmake.pixeltown.colyseus`);
    const afterRestart = await until(async () => { const h = await health(); return h?.ok && h; }, 'colyseus restarted', 30000);
    ssh(`launchctl bootstrap gui/$(id -u) ${PB_PLIST}`);
    const saved = await until(async () => { const h = await health(); return h?.persistence?.status === 'saved' && h; }, 'outbox flushed', 60000);
    const fresh = await login(accounts[0]);
    const results = (await pbFetch(`/api/collections/results/records?filter=${encodeURIComponent(`match_id="${matchId}"`)}`, { token: fresh.authStore.token })).data.items;
    assert.equal(onDisk >= 1, true); assert.equal(afterRestart.persistence.pending >= 1, true); assert.equal(results.length, 1); assert.equal(results[0].score, ended.scores[A]);
    return { matchId, pocketbaseWhileDown: pbDown, outboxFilesOnDisk: onDisk, pendingAfterColyseusRestart: afterRestart.persistence.pending, flushedStatus: saved.persistence.status, savedScore: results[0].score };
  });
}
