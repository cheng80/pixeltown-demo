// Isolated production UI, real PB/game, two Ego pages and up to 85 SDK players.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync, writeFileSync, existsSync, renameSync, createWriteStream } from 'node:fs';
import { resolve, extname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createEngine, applySnapshot } from '../minimal/game/src/engine.js';
import { stepDirection } from '../minimal/shared/world.js';
delete globalThis.WebSocket;
const { createConnection } = await import('../minimal/game/src/connection.js');
const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, '.test-work'), { recursive: true });
const dir = mkdtempSync(resolve(root, '.test-work/frontend-ota-')), app = resolve(dir, 'app'), out = resolve(app, 'dist-minimal');
const ports = { web: 5489, game: 12740, pb: 18240 }, base = `http://127.0.0.1:${ports.web}`, gameBase = `http://127.0.0.1:${ports.game}`;
const count = Number(process.env.OTA_CLIENTS || 85), baselineMs = Number(process.env.OTA_BASELINE_MS || 600000), swapMs = Number(process.env.OTA_SWAP_MS || 600000);
assert(count >= 1 && count <= 85 && baselineMs >= 0 && swapMs >= 2000);
const space = Number(process.env.OTA_EGO_SPACE), token = randomBytes(32).toString('hex');
assert(Number.isSafeInteger(space) && space > 0, 'OTA_EGO_SPACE must identify the task-owned Ego space');
Object.assign(process.env, { MINIMAL_STATE_DIR: resolve(dir, 'state'), MINIMAL_PB_PORT: String(ports.pb), MINIMAL_GAME_PORT: String(ports.game), MINIMAL_WEB_PORT: String(ports.web),
  MINIMAL_FRONTEND_TOKEN: token, MINIMAL_SWAP_TOKEN: token, MINIMAL_FRONTEND_ORIGIN: base, VITE_MINIMAL_PB_URL: `http://127.0.0.1:${ports.pb}`, VITE_MINIMAL_GAME_URL: `ws://127.0.0.1:${ports.game}`, VITE_OTA_TEST_SCREEN: '1' });
const { startMinimalPocketBase } = await import('../scripts/minimal-pocketbase.mjs');
const children = [], actors = [], requests = [], report = { directory: dir, production: false, productionBuild: true, count, baselineMs, swapMs, checks: [], swaps: [], recoveries: [], timeline: [], lagMs: {}, health: [] };
let staticServer, admin, movementTimer, browserStarted = false, delivered, originFault = null, phase = 'setup', lagTimer, healthTimer, gameLog;
// A timeline lets a recovery be attributed to a phase; the lag sample separates a blocked test process from a server stall.
const mark = (name, extra = {}) => { phase = name; report.timeline.push({ at: Date.now(), phase: name, ...extra }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { const result = await fn(); if (result) return result; await sleep(50); } throw new Error('Timeout: ' + label); }
async function ego(body) {
  writeFileSync(resolve(dir, 'ego-last.mjs'), `const task=await taskSpace(${space});\n${body}`);
  const text = await new Promise((resolveOutput, reject) => {
    const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'pipe', 'pipe'] }); let output = '', errors = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Ego command timeout')); }, 45000);
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => errors += chunk); child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolveOutput(output + errors) : (writeFileSync(resolve(dir, 'ego-failed.mjs'), body), reject(new Error(errors || output))); });
    child.stdin.end(`const task=await taskSpace(${space});\n${body}`);
  });
  const line = text.split('\n').find(line => line.startsWith('OTA_RESULT:'));
  return line ? JSON.parse(line.slice(11)) : text;
}
function build() {
  execFileSync(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.minimal.config.js'], { cwd: app, env: { ...process.env, MINIMAL_VISUAL_STORE: resolve(dir, 'releases') }, stdio: 'pipe' });
  return JSON.parse(readFileSync(resolve(out, 'visual/current.json')));
}
function publish(manifest) { delivered = manifest; writeFileSync(resolve(out, 'visual/current.next'), JSON.stringify(manifest)); renameSync(resolve(out, 'visual/current.next'), resolve(out, 'visual/current.json')); }
async function activate(manifest) {
  publish(manifest); const before = await (await fetch(gameBase + '/health')).json();
  const response = await fetch(gameBase + '/internal/frontend/activate', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedGeneration: before.frontend.generation, revision: manifest.revision }) });
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
}
const browserState = () => ego(`console.log('OTA_RESULT:'+JSON.stringify(await Promise.all(['p1','p2'].map(label=>task.page(label).evaluate(()=>({visual:window.__minimalVisual?.status,movement:window.__minimalVisual?.movement,connection:window.__minimal?.connection,navigation:performance.getEntriesByType('navigation').length,canvasSame:!window.__otaCanvas||window.__otaCanvas===document.querySelector('canvas.world'),canvases:document.querySelectorAll('canvas.world').length,roots:document.querySelectorAll('.ui-release').length,covers:window.__otaCovers||0,heap:performance.memory?.usedJSHeapSize,ui:document.querySelector('.ui-release:not([hidden])')?.shadowRoot?.querySelector('#ota-test-draft')?.value}))))));`);
async function waitBrowsers(revision) { return ego(`await Promise.all(['p1','p2'].map(label=>task.page(label).waitForFunction(revision=>window.__minimalVisual?.status.revision===revision,${JSON.stringify(revision)},{timeout:15000}))); console.log('OTA_RESULT:'+JSON.stringify(true));`); }
try {
  // A refusal to bind never leads to stopping someone else's listener.
  staticServer = createServer((req, res) => {
    const path = new URL(req.url, base).pathname; requests.push({ at: Date.now(), path });
    res.setHeader('Cache-Control', path.startsWith('/visual/releases/') ? 'public,max-age=31536000,immutable' : 'no-store');
    if (originFault?.path === path && originFault.delayMs) { const timer=setTimeout(()=>res.end('late response'),originFault.delayMs);res.writeHead(200,{'Content-Type':originFault.type||'text/javascript'});res.flushHeaders();res.on('close',()=>clearTimeout(timer));return; }
    if (originFault?.path === path) { const fault = originFault; if (fault.remaining && --fault.remaining === 0) originFault = null; res.writeHead(fault.status || 503, { 'Content-Type': fault.type || 'text/plain' }); res.end(fault.body || 'injected fault'); return; }
    const file = resolve(out, path === '/' ? 'index.html' : '.' + path);
    if (!file.startsWith(out + '/') || !existsSync(file)) { res.writeHead(404); res.end('missing'); return; }
    res.setHeader('Content-Type', { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml', '.woff2':'font/woff2' }[extname(file)] || 'application/octet-stream'); res.end(readFileSync(file));
  });
  await new Promise((resolveStart, reject) => { staticServer.once('error', reject); staticServer.listen(ports.web, '127.0.0.1', resolveStart); });
  mkdirSync(app); for (const name of ['minimal', 'scripts', 'vite.minimal.config.js', 'package.json', 'package-lock.json']) cpSync(resolve(root, name), resolve(app, name), { recursive: true });
  symlinkSync(resolve(root, 'node_modules'), resolve(app, 'node_modules'));
  const A = build();
  const uiPath = resolve(app, 'minimal/game/src/main.jsx'), cssPath = resolve(app, 'minimal/game/src/style.css');
  writeFileSync(uiPath, readFileSync(uiPath, 'utf8').replace('작은 광장</span>', '새 작은 광장</span>'));
  writeFileSync(cssPath, readFileSync(cssPath, 'utf8') + '\n.titlebar { background-color:rgb(222,240,255); }\n');
  writeFileSync(resolve(app, 'minimal/game/public/ota-proof.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path fill="#1234ef" d="M0 0h16v16H0z"/></svg>');
  const B = build(); assert.equal(A.compatibility, B.compatibility); assert.notEqual(A.revision, B.revision);
  report.releases = { A: A.revision, B: B.revision, compatibility: A.compatibility };
  // Keep runtime/index from B; compatible initial B can receive current A before entering.
  publish(A);
  const started = await startMinimalPocketBase(); children.push(started.child); admin = started.admin;
  const game = spawn(process.execPath, ['colyseus/minimal/server.js'], { cwd: root, env: process.env, stdio: ['ignore','pipe','pipe'] }); children.push(game);
  // Server output stays in this run's folder; tokens are passed by environment and are not logged.
  gameLog = createWriteStream(resolve(dir, 'game.log'));
  let log = ''; game.stdout.on('data', value => { log += value; gameLog.write(value); }); game.stderr.on('data', value => { log += value; gameLog.write(value); });
  await until(async () => { if (game.exitCode !== null) throw new Error(log.slice(-1000)); try { return (await fetch(gameBase+'/ready')).ok; } catch { return false; } }, 'game readiness');
  // Test-side loopback health, one request at a time: worker sequence/recoveries locate a server stall by phase.
  let healthBusy = false;
  healthTimer = setInterval(async () => {
    if (healthBusy) return; healthBusy = true; const at = Date.now(), label = phase;
    try { const h = await (await fetch(gameBase + '/health', { signal: AbortSignal.timeout(900) })).json(), w = h.worker || {};
      report.health.push({ at, phase: label, ms: Date.now() - at, seq: w.sequence, gen: w.generation, rec: w.recoveries, stale: w.staleResults, fgen: h.frontend?.generation, players: h.players }); }
    catch (error) { report.health.push({ at, phase: label, ms: Date.now() - at, error: error.name }); }
    finally { healthBusy = false; }
  }, 1000);
  await activate(A);
  browserStarted = true;
  if(process.env.OTA_FAULTS==='1') {
    // Two of the three bounded attempts fail; the third recovers without relying on Ego round-trip timing.
    originFault={path:`/visual/releases/${B.revision}/manifest.json`,status:503,remaining:2};
    await ego(`await task.page('p1').goto(${JSON.stringify(base)});await task.page('p1').waitForFunction(()=>document.querySelector('#root > [role=alert]')?.textContent.includes('불러오지'));console.log('OTA_RESULT:true');`);
    originFault=null;
    await ego(`await task.page('p1').waitForFunction(()=>window.__minimalVisual?.status.revision,undefined,{timeout:15000});console.log('OTA_RESULT:'+JSON.stringify(await task.page('p1').evaluate(()=>!document.querySelector('#root > [role=alert]'))));`).then(value=>assert.equal(value,true));
    report.checks.push({name:'initial-ui-failure-visible-and-retry-recovers',passed:true});
  }
  await ego(`const pages=await task.pages(); if(!pages.some(p=>p.label==='p2')) await task.newPage();
    for(const [label,url] of [['p1',${JSON.stringify(base)}],['p2',${JSON.stringify(`http://localhost:${ports.web}`)}]]) { const p=task.page(label); await p.cdp('Emulation.setFocusEmulationEnabled',{enabled:true}); await p.cdp('Storage.clearDataForOrigin',{origin:url,storageTypes:'local_storage'}); await p.goto(url); await p.waitForFunction(()=>!!document.querySelector('.ui-release:not([hidden])')?.shadowRoot?.querySelector('input[name=nickname]'),undefined,{timeout:15000}); }
    console.log('OTA_RESULT:'+JSON.stringify(true));`);
  // Welcome screen is part of the whole UI release, including its nickname draft.
  await ego(`for(const label of ['p1','p2']) await task.page(label).fill('input[name=nickname]','검증'+label+${JSON.stringify(Date.now().toString().slice(-5))}); console.log('OTA_RESULT:'+JSON.stringify(true));`);
  for (const label of ['p1','p2']) {
    await ego(`const p=task.page('${label}'); console.log(await p.snapshot()); await p.click('button.primary'); await p.waitForFunction(()=>window.__minimalVisual?.movement.connected,undefined,{timeout:15000}); console.log('OTA_RESULT:'+JSON.stringify(true));`);
  }
  const password = randomBytes(24).toString('hex');
  for (let i=0; i<count; i++) {
    const user = await admin.collection('users').create({ email:`ota-${i}@minimal.test`,password,passwordConfirm:password,name:`시험${i}` });
    await admin.collection('profiles').create({user:user.id,name:`시험${i}`});
    const { default: PocketBase } = await import('pocketbase'); const pb = new PocketBase(`http://127.0.0.1:${ports.pb}`);
    const auth = await pb.collection('users').authWithPassword(user.email,password), engine = createEngine(), actor={engine,userId:user.id,errors:[],direction:1};
    actor.connection=createConnection({url:`ws://127.0.0.1:${ports.game}`,engine,userId:user.id,token:auth.token,onSnapshot:data=>applySnapshot(engine,data,user.id),onFrontend:()=>{},onFailure:error=>actor.errors.push(error.message||'connection failed'),
      onRecovery:status=>{if(status.drops>(actor.drops||0)){actor.drops=status.drops;report.recoveries.push({at:Date.now(),phase,actor:i,cause:status.lastCause,pending:engine.pending.length});}}});
    actors.push(actor); await until(()=>engine.initialized,'SDK entry');
  }
  movementTimer=setInterval(()=>{
    for(const a of actors) {
      const e=a.engine; a.connection.checkStale(); if(!e.connected||!e.initialized)continue;
      if(e.self.x>490)a.direction=-1;if(e.self.x<70)a.direction=1;
      const next=stepDirection(e.self,a.direction,0,50); if(next.x===e.self.x&&next.y===e.self.y)continue;
      e.previous={...e.self};e.self=next;e.lastTick=performance.now();e.movedAt=e.lastTick;
      const movement={...next,seq:++e.seq,fix:e.fix};e.pending.push(movement);a.connection.send(movement);
    }
  },50);
  await ego(`for(const label of ['p1','p2']) { const p=task.page(label); await p.keyboard.down('d'); await p.evaluate(()=>{
    window.__otaCanvas=document.querySelector('canvas.world');window.__otaCovers=0;let direction='d';
    window.__otaDrive=setInterval(()=>{const m=window.__minimalVisual.movement;const next=m.x>490?'a':m.x<70?'d':direction;if(next!==direction){window.dispatchEvent(new KeyboardEvent('keyup',{key:direction,bubbles:true}));direction=next;}if(!m.keys.includes(direction))window.dispatchEvent(new KeyboardEvent('keydown',{key:direction,bubbles:true}));if(document.querySelector('.ui-release:not([hidden])')?.shadowRoot?.querySelector('.cover'))window.__otaCovers++;},50);
  }); } console.log('OTA_RESULT:'+JSON.stringify(true));`);
  await sleep(1000); await waitBrowsers(A.revision);
  report.before=await browserState();
  let lagAt=performance.now();lagTimer=setInterval(()=>{const now=performance.now();report.lagMs[phase]=Math.max(report.lagMs[phase]||0,Math.round(now-lagAt-100));lagAt=now;},100);
  mark('baseline');const baselineStart=Date.now(); console.log(`BASELINE ${baselineMs}ms with ${count} SDK + 2 browsers; report ${dir}/report.json`);
  await sleep(baselineMs);
  const versionRequests=requests.filter(r=>r.at>=baselineStart&&(r.path==='/visual/current.json'||r.path.endsWith('/manifest.json')));
  assert.equal(versionRequests.length,0,'stable connected baseline has no version HTTP polling');
  report.checks.push({name:'stable-no-poll',durationMs:baselineMs,requests:versionRequests.length});
  // A normal component owns its drafts through runtime state; the updater knows no screen names.
  await ego(`const p=task.page('p1'); console.log(await p.snapshot()); await p.click('button[aria-controls=ota-test-screen]'); await p.fill('#ota-test-draft','한글 초안 보존'); await p.selectOption('#ota-test-choice','b'); await p.evaluate(()=>{const s=document.querySelector('.ui-release:not([hidden])').shadowRoot; s.querySelector('#ota-test-list').scrollTop=160;s.querySelector('#ota-test-draft').focus();s.querySelector('#ota-test-draft').setSelectionRange(2,4);}); console.log('OTA_RESULT:'+JSON.stringify(true));`);
  const repeats=20, start=Date.now();
  for(let i=0;i<repeats;i++) {
    mark(`swap-${i+1}`);const manifest=i%2===0?B:A, receipt=await activate(manifest); await waitBrowsers(manifest.revision);
    const state=await browserState(); report.swaps.push({index:i+1,generation:receipt.generation,state});
    assert.equal(state[0].ui,'한글 초안 보존');
    for(let n=0;n<2;n++){assert.equal(state[n].movement.sessionId,report.before[n].movement.sessionId);assert.equal(state[n].movement.fix,report.before[n].movement.fix);assert.equal(state[n].canvasSame,true);assert.equal(state[n].canvases,1);assert(state[n].roots<=2);}
    if(i===9){mark('worker-swap');const response=await fetch(gameBase+'/internal/worker/swap',{method:'POST',headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200);}
    const wait=start+(i+1)*swapMs/repeats-Date.now();if(wait>0)await sleep(wait);
    console.log(`OTA ${i+1}/${repeats} generation ${receipt.generation}`);
  }
  mark('faults');
  if(process.env.OTA_FAULTS==='1') await (await import('./minimal-frontend-ota-faults.mjs')).runFaults({ego,activate,waitBrowsers,browserState,A,B,out,dir,report,sleep,delayedBody:true,setFault:value=>{originFault=value;}});
  mark('drain');clearInterval(movementTimer);
  await ego(`for(const label of ['p1','p2']){const p=task.page(label);await p.evaluate(()=>{clearInterval(window.__otaDrive);for(const key of ['a','d'])window.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true}));});await p.keyboard.up('a');await p.keyboard.up('d');}console.log('OTA_RESULT:'+JSON.stringify(true));`);
  await until(()=>actors.every(a=>a.engine.pending.length===0),'SDK input drain');await sleep(300);
  report.after=await browserState();
  report.sdk=actors.map(a=>({userId:a.userId,seq:a.engine.seq,ack:a.engine.snapshot.players.find(p=>p.id===a.userId)?.ack,fix:a.engine.fix,pending:a.engine.pending.length,...a.connection.status,errors:a.errors}));
  for(const row of report.sdk){assert.equal(row.drops,0);assert.equal(row.failures,0);assert.equal(row.fix,0);assert.equal(row.pending,0);assert.equal(row.seq,row.ack);assert.deepEqual(row.errors,[]);}
  for(let n=0;n<2;n++){const after=report.after[n];assert.equal(after.connection.drops,0);assert.equal(after.connection.failures,0);assert.equal(after.covers,0);assert.equal(after.navigation,1);assert.equal(after.movement.pending,0);assert.equal(after.movement.seq,after.movement.ack);assert(after.movement.seq>report.before[n].movement.seq);}
  report.checks.push({name:'two-browsers-20-whole-ui-swaps-and-worker-swap',passed:true});
  report.passed=true;
} catch(error){if(browserStarted) { try { report.failedBrowser=await browserState(); } catch {} } report.error=error.stack;process.exitCode=1;console.error(error.stack);}
finally {
  clearInterval(movementTimer);clearInterval(lagTimer);clearInterval(healthTimer);for(const a of actors)a.connection.dispose();
  if(browserStarted) {try { await ego(`for(const label of ['p1','p2']){const p=task.page(label);await p.evaluate(()=>clearInterval(window.__otaDrive));await p.goto('about:blank');}console.log('OTA_RESULT:'+JSON.stringify(true));`);}catch{} }
  for(const child of children.reverse())if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('close',r)),sleep(5000)]);}
  if(staticServer?.listening)await new Promise(r=>staticServer.close(r));
  gameLog?.end();writeFileSync(resolve(dir,'report.json'),JSON.stringify(report,null,2));console.log('Report: '+resolve(dir,'report.json'));
}
