// Browser check of the local frontend in remote mode (`npm run dev:remote`, http://127.0.0.1:5173) against the Mac mini.
// Two test accounts from pocketbase/.local/remote-accounts.json log in, see each other, chat; network targets are recorded.
//   CHROME_PATH=/path/to/chromium node tests/remote-ui.mjs
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('..', import.meta.url).pathname, BASE = process.env.BASE || 'http://127.0.0.1:5173/';
const accounts = JSON.parse(await readFile(root + 'pocketbase/.local/remote-accounts.json', 'utf8'));
// CHROME_HOST_RULES (e.g. "MAP pixeltown-pb.fastmake.net 104.21.83.7") bypasses a stale local DNS cache after a hostname move.
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), args: process.env.CHROME_HOST_RULES ? [`--host-resolver-rules=${process.env.CHROME_HOST_RULES}`] : [] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = { url: BASE, hosts: new Set() };
async function open({ email, password }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }), p = await ctx.newPage();
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  p.on('request', r => out.hosts.add(new URL(r.url()).origin)); p.on('websocket', ws => out.hosts.add(new URL(ws.url()).origin));
  // Existing accounts enter from saved credentials, like a returning guest (no login screen since PLAN-006).
  await ctx.addInitScript(([email, password]) => localStorage.setItem('pixeltown.guest', JSON.stringify({ email, password })), [email, password]);
  await p.goto(BASE);
  // First entry without a chosen look shows the character set-up (FR-014); keep the account name and pick a look.
  const setup = await p.waitForSelector('[role=dialog][aria-label="캐릭터 만들기"]', { timeout: 8000 }).catch(() => null);
  if (setup) { out.setupShown = (out.setupShown || 0) + 1; await p.click('button[aria-label="머리 색 6"]'); await p.click('button:has-text("이대로 입장")'); }
  await p.waitForFunction(() => window.__pixeltown?.state.current.players?.length > 0, null, { timeout: 15000 });
  return p;
}
try {
  const a = await open(accounts[0]), b = await open(accounts[1]);
  // Real visitors may be in the same room, so wait for the other tester rather than an exact head count.
  await a.waitForFunction(n => window.__pixeltown.state.current.players.some(q => q.name === n), accounts[1].name || 'Tester 2', { timeout: 15000 });
  for (const p of [a, b]) if (await p.$('.chat-fab')) await p.click('.chat-fab'); // open the chat overlay if it was collapsed
  await b.fill('.chat-form input', '원격 서버에서 안녕!'); await b.keyboard.press('Enter');
  await a.waitForFunction(() => document.querySelector('.chat-log')?.textContent.includes('원격 서버에서 안녕'), null, { timeout: 10000 });
  await sleep(800);
  out.players = await a.evaluate(() => window.__pixeltown.state.current.players.map(p => ({ name: p.name, look: p.look })));
  out.hud = (await a.textContent('body')).match(/다음 정산까지 \d+:\d+/)?.[0] || null;
  await a.screenshot({ path: root + 'docs/assets/remote-lobby-two-users.png' });
  out.pageErrors = [...a.errs, ...b.errs];
  out.hosts = [...out.hosts].filter(h => !h.startsWith('data:')).sort();
  if (!out.hosts.includes('https://pixeltown-pb.fastmake.net') || !out.hosts.includes('wss://pixeltown-rt.fastmake.net') || out.pageErrors.length) throw new Error(JSON.stringify(out));
  // A first-time visitor on the remote server: character screen → guest account → town; a reload comes back as the same character.
  const g = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage(); g.errs = []; g.on('pageerror', e => g.errs.push(e.message));
  await g.goto(BASE); await g.waitForSelector('[role=dialog][aria-label="캐릭터 만들기"]');
  const nick = `원격손님${Date.now().toString(36).slice(-4)}`;
  await g.fill('[role=dialog] input', nick); await g.click('button[aria-label="옷 색 7"]'); await g.click('button:has-text("이대로 입장")');
  await a.waitForFunction(n => window.__pixeltown.state.current.players.some(q => q.name === n), nick, { timeout: 15000 });
  await g.reload(); await g.waitForFunction(n => window.__pixeltown?.state.current.players?.some(q => q.name === n), nick, { timeout: 15000 });
  out.guest = { created: true, seenByOther: true, reloadSameCharacter: true, pageErrors: g.errs };
  // Remove the guest this check created when the verification superuser is available (pocketbase/.local/remote-admin.env).
  const env = await readFile(root + 'pocketbase/.local/remote-admin.env', 'utf8').catch(() => null);
  if (env) {
    const get = k => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1], pbUrl = out.hosts.find(h => /^https:\/\/pixeltown-pb\./.test(h)) || 'https://pixeltown-pb.fastmake.net';
    const guestEmail = JSON.parse(await g.evaluate(() => localStorage.getItem('pixeltown.guest'))).email;
    try { // housekeeping only: never fails the check. Sign-ins share the PB rate limit (2 per 3 s per IP), so retry on 429.
      let r; for (let i = 0; i < 4 && (!r || r.status === 429); i++) { if (r) await sleep(3500); r = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: get('REMOTE_ADMIN_EMAIL'), password: get('REMOTE_ADMIN_PASSWORD') }) }); }
      const token = (await r.json()).token;
      const found = await (await fetch(`${pbUrl}/api/collections/users/records?filter=${encodeURIComponent(`email="${guestEmail}"`)}`, { headers: { Authorization: token } })).json();
      for (const u of found.items || []) out.guest.removed = (await fetch(`${pbUrl}/api/collections/users/records/${u.id}`, { method: 'DELETE', headers: { Authorization: token } })).status;
    } catch (e) { out.guest.removed = `cleanup failed: ${e.message}`; }
  }
  if (g.errs.length) throw new Error(JSON.stringify(out));
  out.ok = true; console.log('PASS remote_ui_two_users', JSON.stringify(out));
} finally { await browser.close(); }
