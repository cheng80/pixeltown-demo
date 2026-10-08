// Offline browser QA: all HTTP is fulfilled in-process, and the room SDK is mocked.
// No backend process, network request, or real account is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The SDK mock is a tiny server: one shared player state, rooms as sockets onto it, and reconnect() by resume token.
// The real connection object (src/connection.js) runs against it, so drops and recovery go through production code.
const sdkMock = `
export const ErrorCode = { MATCHMAKE_INVALID_ROOM_ID: 522, MATCHMAKE_EXPIRED: 524, AUTH_FAILED: 525 };
let sessions = 0;
function openRoom(m, sessionId) {
  const handlers = {};
  const room = { roomId: 'room-a', sessionId, reconnectionToken: 'resume-' + sessionId, reconnection: {}, handlers,
    connection: { isOpen: true, close() { room.connection.isOpen = false; } },
    onMessage:(type,cb)=>{handlers[type]=cb}, onDrop:cb=>{handlers.drop=cb}, onLeave:cb=>{handlers.leave=cb}, onError:cb=>{handlers.error=cb},
    send(type, move){
      if(type !== 'move') throw new Error('Wrong movement contract');
      if(!room.connection.isOpen) throw new Error('Socket closed');
      m.moves.push({...move});
      const me = m.snapshot.players[0];
      if(move.fix !== me.fix || move.seq <= me.ack) { m.ignored++; return; }
      if(!m.lag) Object.assign(me, {x:move.x, y:move.y, ack:move.seq});
    },
    async leave(){ room.connection.isOpen = false; }
  };
  m.room = room;
  return room;
}
export class Client {
  auth = {};
  async joinOrCreate(name, options) {
    if (globalThis.__rejectJoin) throw Object.assign(new Error(globalThis.__rejectJoin.message), { code: globalThis.__rejectJoin.code });
    if (name !== 'minimal-town' || options.zone !== 'lobby' || !this.auth.token) throw new Error('Invalid join');
    clearInterval(window.__mock?.timer);
    const snapshot = {zone:'lobby',players:[{id:'minimal-user',name:'산책이',x:56,y:336,ack:0,fix:0},{id:'neighbor',name:'이웃',x:130,y:300,ack:0,fix:0}],game:{id:'round-a',active:true,endsAt:Date.now()+180000,stars:[{id:'star',x:100,y:336}],scores:{'minimal-user':0}}};
    const m = window.__mock = {snapshot,moves:[],ignored:0,reconnects:0,down:null,lag:false};
    m.emit = (type, data) => { if (m.room.connection.isOpen) m.room.handlers[type]?.(structuredClone(data)); };
    // A network cut: the socket dies without a goodbye; down makes reconnect attempts fail (true = unreachable, number = server code).
    m.cut = (code = 1006, down = true) => { m.down = down; m.room.connection.isOpen = false; m.room.handlers.drop?.(code); };
    m.timer = setInterval(() => { if (!m.lag) m.emit('snapshot', snapshot); }, 50);
    return openRoom(m, 's' + ++sessions);
  }
  async reconnect(token) {
    const m = window.__mock; m.reconnects++;
    if (m.down === true) throw new Error('Network unreachable');
    if (m.down) throw Object.assign(new Error('Room gone'), { code: m.down });
    if (token !== m.room.reconnectionToken) throw Object.assign(new Error('Bad token'), { code: ErrorCode.MATCHMAKE_EXPIRED });
    return openRoom(m, m.room.sessionId);
  }
}`;
const bundle = await build({ entryPoints: [path.join(root, 'src/main.jsx')], bundle: true, write: false,
  outdir: path.join(root, '.qa-assets'), format: 'esm', define: { 'import.meta.env': JSON.stringify({ DEV: true }) },
  plugins: [{ name: 'offline-room', setup(builder) { builder.onResolve({ filter: /^@colyseus\/sdk$/ }, () => ({ path: 'room', namespace: 'mock' })); builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: sdkMock, loader: 'js' })); } }],
});
const assets = Object.fromEntries(bundle.outputFiles.map(file => [path.basename(file.path), file.contents]));
const walkingProbe = await build({ entryPoints: [path.join(root, 'tests/walking-probe.js')], bundle: true, write: false, format: 'esm' });
assets['walking-probe.js'] = walkingProbe.outputFiles[0].contents;
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let walletMode = 'success', walletCalls = 0, guestCalls = 0, authCalls = 0, balance = 12, settledMatchIds = [];
  const record = {id:'minimal-user',email:'offline@example.invalid',name:'산책이',collectionName:'users'};
  const token = `test.${Buffer.from(JSON.stringify({ id:record.id,exp:9999999999 })).toString('base64url')}.test`;
  await context.addInitScript(() => { localStorage.setItem('pocketbase_auth','legacy-untouched'); localStorage.setItem('pixeltown.guest','legacy-guest-untouched'); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const send = (data, status = 200, headers = {}) => route.fulfill({ status, contentType:'application/json', headers:{'Access-Control-Allow-Origin':'*', ...headers}, body:JSON.stringify(data) });
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status:204, headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'} });
    if (url.pathname === '/api/minimal/guest') { guestCalls++; const body = route.request().postDataJSON(); assert.equal(body.name,'산책이'); assert.ok(body.password.length >= 32); return send({token,record}); }
    if (url.pathname === '/api/collections/users/auth-with-password') { authCalls++; assert.equal(route.request().postDataJSON().identity,record.email); return send({token,record}); }
    if (url.pathname === '/api/minimal/wallet') { walletCalls++; assert.equal(route.request().headers().authorization,`Bearer ${token}`); return walletMode === 'success' ? send({balance,settledMatchIds,profile:{name:'산책이'}}) : send({},429,{'Retry-After':'60'}); }
    if (url.pathname === '/unavailable.html') return route.fulfill({contentType:'text/html',body:await fs.readFile(path.join(root,'public/unavailable.html'),'utf8')});
    if (url.hostname === 'minimal.test' && url.pathname === '/') return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/main.css"><div id="root"></div><script type="module" src="/main.js"></script></html>'});
    const file = assets[url.pathname.slice(1)];
    if (url.hostname === 'minimal.test' && file) return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:Buffer.from(file)});
    throw new Error('Unexpected request blocked: '+url.pathname);
  });
  await page.clock.install();
  await page.goto('https://minimal.test/');
  await page.getByLabel('닉네임',{exact:true}).fill('산책이');
  await page.getByRole('button',{name:'광장 들어가기'}).click();
  await page.waitForFunction(()=>!!window.__mock);
  await page.clock.runFor(100);
  await page.getByText('함께 있는 이웃 2명').waitFor();
  assert.equal(await page.evaluate(()=>window.__minimal.snapshot.players[0].x),56,'initial spawn must come from server');
  assert.equal(await page.evaluate(()=>window.__minimal.userId),'minimal-user');
  await page.keyboard.down('d'); await page.clock.runFor(250); await page.keyboard.up('d');
  const moves = await page.evaluate(()=>window.__mock.moves);
  assert.equal(moves[0].seq,1); assert.equal(moves[0].x,60); assert.ok(moves.at(-1).x > 60);
  await page.evaluate(()=>{const mock=window.__mock; Object.assign(mock.snapshot.players[0],{x:80,y:336,fix:1,ack:mock.moves.at(-1).seq}); mock.emit('snapshot',mock.snapshot)});
  await page.keyboard.down('s'); await page.clock.runFor(100); await page.keyboard.up('s');
  assert.equal(await page.evaluate(()=>window.__mock.moves.at(-1).fix),1);
  // Others: a burst of 10 accepted steps plays back at walking pace instead of jumping.
  await page.evaluate(()=>{const canvas=document.querySelector('canvas');let f=canvas[Object.keys(canvas).find(k=>k.startsWith('__reactFiber'))];while(f&&!f.memoizedProps?.engine)f=f.return;window.__qaEngine=f.memoizedProps.engine;});
  await page.evaluate(()=>{const n=window.__mock.snapshot.players[1]; Object.assign(n,{x:n.x+40,ack:10}); window.__mock.emit('snapshot',window.__mock.snapshot);});
  await page.clock.runFor(150);
  const midX = await page.evaluate(()=>window.__qaEngine.others.get('neighbor').x);
  assert.ok(midX > 130 && midX < 160, `burst replays gradually (x=${midX})`);
  await page.clock.runFor(1000);
  assert.equal(await page.evaluate(()=>window.__qaEngine.others.get('neighbor').x), 170, 'playback reaches the latest accepted step');
  await page.evaluate(async()=>{const {observeWalking}=await import('/walking-probe.js');window.__walkingProbe=observeWalking(window.__qaEngine);});
  const movedBefore = await page.evaluate(()=>window.__qaEngine.movedAt);
  // Diagonal walking keeps one facing (legacy ec5da17): own avatar and others both show the side view without flipping.
  await page.keyboard.down('d'); await page.keyboard.down('w');
  const facings = [];
  for (let i = 0; i < 16; i++) { await page.clock.runFor(50); facings.push(await page.evaluate(()=>window.__qaEngine.facing)); }
  await page.keyboard.up('d'); await page.keyboard.up('w');
  assert.deepEqual([...new Set(facings.slice(1))], [2], `own diagonal facing is steady (${facings})`);
  const walkingFrames = await page.evaluate(()=>window.__walkingProbe.read());
  assert.deepEqual(Object.keys(walkingFrames).sort(), ['0','1','3'], `drawn arms and legs must cycle (${JSON.stringify(walkingFrames)})`);
  assert.ok(await page.evaluate(()=>window.__qaEngine.movedAt)>movedBefore,'movement timestamp advances while walking');
  await page.clock.runFor(200); await page.evaluate(()=>window.__walkingProbe.clear()); await page.clock.runFor(650);
  assert.deepEqual(Object.keys(await page.evaluate(()=>window.__walkingProbe.read())), ['0'], 'released keys return the drawn avatar to standing');
  await page.evaluate(()=>window.__walkingProbe.dispose());
  await page.evaluate(()=>{const n=window.__mock.snapshot.players[1]; Object.assign(n,{x:n.x+20,y:n.y-20,ack:17}); window.__mock.emit('snapshot',window.__mock.snapshot);});
  const others = [];
  for (let i = 0; i < 12; i++) { await page.clock.runFor(40); others.push(await page.evaluate(()=>window.__qaEngine.others.get('neighbor').dir)); }
  assert.deepEqual([...new Set(others.slice(1))], [2], `other diagonal facing is steady (${others})`);
  // Lag (slow tunnel): no ack or snapshot for 2.5 s must not hold the avatar back; delayed acks then catch up without a fix.
  const lagFrom = await page.evaluate(()=>{ window.__mock.lag = true; return window.__mock.moves.length; });
  await page.keyboard.down('d'); await page.clock.runFor(2500); await page.keyboard.up('d');
  assert.ok(await page.evaluate(()=>window.__mock.moves.length) - lagFrom >= 45, 'avatar keeps walking while acks are late');
  assert.equal(await page.getByRole('heading',{name:'잠시 쉬어 가요'}).count(),0,'2.5 s lag is not a connection failure');
  assert.equal(await page.getByText('연결을 다시 확인하고 있어요').count(),0,'2.5 s lag is not a recovery');
  await page.evaluate(()=>{ const mock = window.__mock, last = mock.moves.at(-1); mock.lag = false; Object.assign(mock.snapshot.players[0], {x:last.x, y:last.y, ack:last.seq}); mock.emit('snapshot', mock.snapshot); });
  assert.equal(await page.evaluate(()=>window.__minimal.snapshot.players[0].fix), await page.evaluate(()=>window.__mock.moves.at(-1).fix), 'no correction after late acks');
  // Deployment status: old servers send none; steps are display-only and never stop movement.
  assert.equal(await page.locator('.release').count(),0,'no deployment field means no indicator');
  const release = () => page.locator('.release').innerText();
  const deploy = (phase, eventSeq, revision, generation, message = true) => page.evaluate(d => { const mock = window.__mock; mock.snapshot.deployment = {...d, updatedAt: Date.now()}; if (d.message) mock.emit('deployment', mock.snapshot.deployment); }, {phase, eventSeq, revision, generation, message});
  await deploy('idle', 0, 'aaaaaaaa11112222', 1, false); await page.clock.runFor(100);
  assert.ok((await release()).includes('aaaaaaaa · 1회차'), 'initial version from snapshot');
  const movesBeforeDeploy = await page.evaluate(()=>window.__mock.moves.length);
  await page.keyboard.down('w');
  await deploy('preparing', 1, 'aaaaaaaa11112222', 1); await deploy('catching-up', 2, 'aaaaaaaa11112222', 1); await deploy('applied', 3, 'bbbbbbbb33334444', 2);
  await page.clock.runFor(60);
  assert.ok((await release()).includes('새 버전 준비 중') && (await release()).includes('bbbbbbbb · 2회차'), 'step replays while the version is the latest applied one');
  await page.screenshot({path:path.join(root,'.qa/deploy-desktop.png'),animations:'disabled'});
  await page.clock.runFor(700); assert.ok((await release()).includes('상태 확인 중') && (await release()).includes('bbbbbbbb · 2회차'));
  await page.clock.runFor(700); assert.ok((await release()).includes('적용 완료') && (await release()).includes('bbbbbbbb · 2회차'));
  assert.ok((await page.locator('.release [role=status]').innerText()).includes('적용 완료'));
  await page.keyboard.up('w');
  assert.ok(await page.evaluate(()=>window.__mock.moves.length) > movesBeforeDeploy + 10, 'movement continues during deployment');
  assert.equal(await page.getByText('연결을 다시 확인하고 있어요').count(),0,'a normal deployment shows no recovery notice');
  await page.clock.runFor(4100); assert.ok(!(await release()).includes('적용 완료') && (await release()).includes('bbbbbbbb · 2회차'));
  await deploy('catching-up', 2, 'aaaaaaaa11112222', 1); await page.clock.runFor(100);
  assert.ok(!(await release()).includes('상태 확인 중') && (await release()).includes('bbbbbbbb'), 'late deployment status ignored');
  await deploy('preparing', 4, 'bbbbbbbb33334444', 2); await page.clock.runFor(100);
  assert.ok((await release()).includes('새 버전 준비 중') && (await release()).includes('bbbbbbbb · 2회차'), 'preparing keeps the active version');
  await deploy('cancelled', 5, 'bbbbbbbb33334444', 2); await page.clock.runFor(800);
  assert.ok((await release()).includes('이번 배포 취소 · 현재 버전 유지') && (await release()).includes('bbbbbbbb · 2회차'));
  assert.equal(await page.getByRole('heading',{name:'잠시 쉬어 가요'}).count(),0,'cancel is not a connection failure');
  await page.setViewportSize({width:390,height:844}); await page.clock.runFor(100);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,'deployment indicator overflow at 390px');
  const [bar, hud] = await page.evaluate(()=>[document.querySelector('.release').getBoundingClientRect().bottom, document.querySelector('.hud').getBoundingClientRect().top]);
  assert.ok(bar <= hud, 'indicator does not cover the HUD');
  await page.screenshot({path:path.join(root,'.qa/deploy-mobile.png'),animations:'disabled'});
  await page.setViewportSize({width:1280,height:1000});
  await deploy('idle', 6, 'bbbbbbbb33334444', 3); await page.clock.runFor(800);
  assert.ok(!(await release()).includes('취소') && (await release()).includes('bbbbbbbb · 3회차'), 'idle after recovery clears the step and updates generation');
  await page.clock.runFor(5000);
  await page.evaluate(()=>{window.__mock.snapshot.game.scores['minimal-user']=3;window.__mock.emit('snapshot',window.__mock.snapshot);window.__mock.emit('gameEnded',{match_id:'round-a',scores:{'minimal-user':3}})});
  await page.waitForFunction(()=>document.querySelector('.pending-number').textContent.includes('3'));
  assert.ok((await page.locator('.wallet').innerText()).includes('12'));
  walletMode = 'rate'; await page.clock.runFor(10100);
  await page.getByText('저장 내역 미확인.',{exact:true}).waitFor();
  assert.ok((await page.locator('.wallet').innerText()).includes('12'));
  assert.ok((await page.locator('.wallet-message').innerText()).includes('기다린'));
  const callsAfter429 = walletCalls;
  await page.clock.runFor(20000); assert.equal(walletCalls,callsAfter429,'no retry storm during rate limit');
  walletMode = 'success'; balance = 15; settledMatchIds = ['round-a'];
  await page.clock.runFor(41000);
  await page.waitForFunction(()=>document.querySelector('.pending-number').textContent==='0개');
  assert.ok((await page.locator('.wallet').innerText()).includes('15'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('pocketbase_auth')),'legacy-untouched');
  assert.equal(await page.evaluate(()=>localStorage.getItem('pixeltown.guest')),'legacy-guest-untouched');
  const checkOverflow = async width => { await page.setViewportSize({width,height:1000}); await page.clock.runFor(100); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,`horizontal overflow at ${width}px`); };
  await fs.mkdir(path.join(root,'.qa'),{recursive:true});
  await checkOverflow(1280); await page.screenshot({path:path.join(root,'.qa/desktop.png'),fullPage:true});
  await checkOverflow(390); await page.screenshot({path:path.join(root,'.qa/mobile.png'),fullPage:true});
  const right = page.getByRole('button',{name:'오른쪽으로 이동'}); const box = await right.boundingBox();
  const before = await page.evaluate(()=>window.__mock.moves.length);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down(); await page.clock.runFor(150); await page.mouse.up();
  assert.ok(await page.evaluate(()=>window.__mock.moves.length)>before,'touchpad moves');
  const canvas = page.locator('canvas'); await canvas.click({position:{x:220,y:290}}); await page.clock.runFor(200);
  // Recovery: a cut socket resumes in the same room/session through the real connection object. The screen keeps playing
  // with a small title-bar notice (never the outage cover), predicts up to 3 s, then holds still without dropping keys or pending.
  const recoveringText = page.getByText('연결을 다시 확인하고 있어요');
  const sessionBefore = await page.evaluate(()=>[window.__minimal.room.roomId, window.__minimal.room.sessionId]);
  await page.keyboard.down('d'); await page.clock.runFor(300);
  await page.evaluate(()=>window.__mock.cut(1006));
  await page.clock.runFor(1000);
  await recoveringText.waitFor();
  assert.equal(await page.locator('.cover').count(),0,'recovery keeps playing without the outage cover');
  assert.equal(await page.locator('.release-step').count(),0,'recovery notice is not mixed into the deployment indicator');
  assert.equal(await page.locator('.recovery-band').count(),0,'no band while the avatar still walks');
  await page.screenshot({path:path.join(root,'.qa/recovering.png'),animations:'disabled'});
  const during = await page.evaluate(()=>({pending:window.__qaEngine.pending.length, connected:window.__qaEngine.connected}));
  assert.ok(during.connected && during.pending >= 15, `avatar keeps predicting while reconnecting (${JSON.stringify(during)})`);
  await page.clock.runFor(2600);
  const frozen = await page.evaluate(()=>({x:window.__qaEngine.self.x, pending:window.__qaEngine.pending.length, connected:window.__qaEngine.connected, key:window.__qaEngine.keys.has('d')}));
  assert.ok(!frozen.connected && frozen.key && frozen.pending > 0 && frozen.pending <= 240, `prediction stops after 3 s, keeping keys and pending (${JSON.stringify(frozen)})`);
  await page.clock.runFor(400);
  assert.equal(await page.evaluate(()=>window.__qaEngine.self.x), frozen.x, 'avatar holds still past the prediction limit');
  await page.locator('.recovery-band').waitFor();
  assert.equal(await page.locator('.recovery-band').evaluate(e=>getComputedStyle(e).pointerEvents),'none','band never takes input');
  await page.screenshot({path:path.join(root,'.qa/recovering-held.png'),animations:'disabled'});
  assert.equal(await page.locator('.cover').count(),0);
  await page.evaluate(()=>{ window.__mock.down = null; });
  await page.clock.runFor(3000);
  await page.getByText('함께 있는 이웃 2명').waitFor();
  assert.equal(await page.locator('.recovery-band').count(),0,'band leaves on recovery');
  await page.keyboard.up('d'); await page.clock.runFor(300);
  const resumed = await page.evaluate(()=>{ const e = window.__qaEngine, m = window.__mock, me = m.snapshot.players[0];
    return { room:[window.__minimal.room.roomId, window.__minimal.room.sessionId], ack:me.ack, seq:e.seq, pending:e.pending.length, ignored:m.ignored,
      reconnects:m.reconnects, same:me.x === e.self.x && me.y === e.self.y, status:{...window.__minimal.connection} }; });
  assert.deepEqual(resumed.room, sessionBefore, 'same room/session after recovery');
  assert.ok(resumed.ack === resumed.seq && resumed.pending === 0 && resumed.same, `every input confirmed in order (${JSON.stringify(resumed)})`);
  assert.equal(resumed.ignored, 0, 'no acknowledged input is sent twice');
  assert.ok(resumed.status.recovered === 1 && resumed.status.replayed > 0 && resumed.status.corrected === 0, `recovery counted (${JSON.stringify(resumed.status)})`);
  assert.ok(resumed.reconnects >= 2, 'failed attempts were retried');
  // Recovery that cannot finish in 12 s hands over to the outage cover; movement stops there.
  await page.evaluate(()=>window.__mock.cut(1006));
  await page.clock.runFor(1000); await recoveringText.waitFor();
  await page.clock.runFor(12500);
  await page.getByRole('heading',{name:'잠시 쉬어 가요'}).waitFor();
  assert.equal(await recoveringText.count(),0,'failed recovery replaces the notice with the cover');
  assert.equal(await page.locator('.recovery-band').count(),0);
  const stopped = await page.evaluate(()=>window.__mock.moves.length);
  await page.keyboard.down('d'); await page.clock.runFor(1000); await page.keyboard.up('d');
  assert.equal(await page.evaluate(()=>window.__mock.moves.length),stopped,'movement stops while disconnected');
  assert.equal(await page.getByRole('link',{name:'접속 안내 보기'}).count(),1,'a real outage keeps the outage help');
  // The same guest already playing in another tab is told apart from an outage; any other 409 is still an outage.
  const rejoin = async rejection => { await page.evaluate(r=>{ globalThis.__rejectJoin = r; }, rejection); await page.clock.runFor(10000); await page.locator('.cover .primary').click(); await page.clock.runFor(100); };
  await rejoin({code:409,message:'이미 입장한 사용자입니다.'});
  await page.getByRole('heading',{name:'다른 탭에서 광장을 열었어요'}).waitFor();
  assert.ok((await page.locator('.cover').innerText()).includes('다른 탭'));
  assert.equal(await page.getByRole('link',{name:'접속 안내 보기'}).count(),0,'duplicate tab is not an outage');
  assert.ok((await page.locator('.presence').innerText()).includes('다른 탭에서 입장 중'));
  await rejoin({code:409,message:'Other conflict'});
  await page.getByRole('heading',{name:'잠시 쉬어 가요'}).waitFor();
  assert.ok((await page.locator('.cover').innerText()).includes('연결하지 못'));
  await rejoin(null);
  await page.getByText('함께 있는 이웃 2명').waitFor();
  assert.equal(await page.locator('.cover').count(),0,'rejoin after closing the other tab plays again');
  // A vanished room (process restart) cannot be resumed: the cover comes up at once instead of retrying for 12 s.
  await page.evaluate(()=>window.__mock.cut(1006, 522));
  await page.clock.runFor(1000);
  await page.getByRole('heading',{name:'잠시 쉬어 가요'}).waitFor();
  await rejoin(null); await page.getByText('함께 있는 이웃 2명').waitFor();
  const authBeforeReload = authCalls;
  await page.reload(); await page.waitForFunction(()=>!!window.__mock); await page.clock.runFor(100);
  assert.equal(guestCalls,1,'reload must not create a new guest'); assert.equal(authCalls,authBeforeReload+1,'reload authenticates saved guest');
  await page.goto('https://minimal.test/unavailable.html'); await page.getByRole('heading',{name:'광장에 잠시 연결할 수 없어요'}).waitFor();
  assert.equal(await page.locator('script').count(),0); assert.equal(await page.locator('a').getAttribute('href'),'./');
  assert.deepEqual(errors,[]);
  console.log('PASS offline UI: guest/restore, isolated credentials, server spawn, seq/fix, movement, lag-tolerant local movement, paced playback of others, steady diagonal facing, deployment indicator, pending/settlement, wallet failure/429, session recovery/timeout/room gone, duplicate-tab vs outage, 1280/390 overflow, static fallback');
} finally { await browser.close(); }
