// Browser check of the local frontend in remote mode (`npm run dev:remote`, http://127.0.0.1:5173) against the Mac mini.
// Two test accounts from pocketbase/.local/remote-accounts.json log in, see each other, chat; network targets are recorded.
//   CHROME_PATH=/path/to/chromium node tests/remote-ui.mjs
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('..', import.meta.url).pathname, BASE = 'http://127.0.0.1:5173/';
const accounts = JSON.parse(await readFile(root + 'pocketbase/.local/remote-accounts.json', 'utf8'));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = { url: BASE, hosts: new Set() };
async function open({ email, password }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }), p = await ctx.newPage();
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  p.on('request', r => out.hosts.add(new URL(r.url()).origin)); p.on('websocket', ws => out.hosts.add(new URL(ws.url()).origin));
  await p.goto(BASE); await p.fill('input[type=email]', email); await p.fill('input[type=password]', password); await p.click('text=타운 입장하기');
  await p.waitForFunction(() => window.__pixeltown?.state.current.players?.length > 0, null, { timeout: 15000 });
  return p;
}
try {
  const a = await open(accounts[0]), b = await open(accounts[1]);
  await a.waitForFunction(() => window.__pixeltown.state.current.players.length === 2, null, { timeout: 10000 });
  for (const p of [a, b]) if (await p.$('.chat-fab')) await p.click('.chat-fab'); // open the chat overlay if it was collapsed
  await b.fill('.chat-form input', '원격 서버에서 안녕!'); await b.keyboard.press('Enter');
  await a.waitForFunction(() => document.querySelector('.chat-log')?.textContent.includes('원격 서버에서 안녕'), null, { timeout: 10000 });
  await sleep(800);
  out.players = await a.evaluate(() => window.__pixeltown.state.current.players.map(p => ({ name: p.name, look: p.look })));
  out.hud = (await a.textContent('body')).match(/다음 정산까지 \d+:\d+/)?.[0] || null;
  await a.screenshot({ path: root + 'docs/assets/remote-lobby-two-users.png' });
  out.pageErrors = [...a.errs, ...b.errs];
  out.hosts = [...out.hosts].filter(h => !h.startsWith('data:')).sort();
  if (!out.hosts.includes('https://pixeltown.fastmake.net') || !out.hosts.includes('wss://pixeltown-rt.fastmake.net') || out.pageErrors.length) throw new Error(JSON.stringify(out));
  out.ok = true; console.log('PASS remote_ui_two_users', JSON.stringify(out));
} finally { await browser.close(); }
