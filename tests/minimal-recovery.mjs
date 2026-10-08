// Real isolated PB + game + TCP proxy. No production access or shared dev-process restart.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
// Force ws in this diagnostic process so ping/pong can be observed and suppressed.
delete globalThis.WebSocket;
const { createConnection } = await import('../minimal/game/src/connection.js');
import { createEngine, applySnapshot } from '../minimal/game/src/engine.js';
import { stepDirection, stepToward, blocked } from '../minimal/shared/world.js';
const root = process.cwd(); mkdirSync(resolve(root, '.test-work'), { recursive: true });
const state = mkdtempSync(resolve(root, '.test-work/minimal-recovery-'));
const count = Number(process.env.MINIMAL_RECOVERY_CLIENTS || 2), soakMs = Number(process.env.MINIMAL_RECOVERY_SOAK_MS || 0);
assert(Number.isInteger(count) && count >= 2 && count <= 85); assert(soakMs >= 0 && soakMs <= 1800000);
const swapToken = randomBytes(32).toString('hex'), gamePort = 12629, proxyPort = 12630, pbPort = 18129, webPort = 5279;
const release = resolve(state, 'release');
for (const dir of ['colyseus/minimal', 'minimal/shared']) mkdirSync(resolve(release, dir), { recursive: true });
for (const file of ['simulation.js', 'simulation-worker.js', 'worker-runtime.js']) copyFileSync(resolve(root, 'colyseus/minimal', file), resolve(release, 'colyseus/minimal', file));
copyFileSync(resolve(root, 'minimal/shared/world.js'), resolve(release, 'minimal/shared/world.js'));
Object.assign(process.env, { MINIMAL_STATE_DIR: state, MINIMAL_PB_PORT: String(pbPort), MINIMAL_GAME_PORT: String(gamePort), MINIMAL_WEB_PORT: String(webPort),
  MINIMAL_SETTLE_MS: '180000', MINIMAL_SPAWN_MS: '1000', MINIMAL_SWAP_TOKEN: swapToken, MINIMAL_WORKER_ENTRY: resolve(release, 'colyseus/minimal/simulation-worker.js'),
  MINIMAL_CONNECTION_OBSERVER: '1', MINIMAL_CONNECTION_LOG_PATH: resolve(state, 'connections.jsonl') });
const { startMinimalPocketBase } = await import('../scripts/minimal-pocketbase.mjs');
const children = [], actors = [], pairs = new Set(), report = { production: false, stateDirectory: state, clients: count, tests: [] };
const base = `http://127.0.0.1:${gamePort}`, pbUrl = `http://127.0.0.1:${pbPort}`;
let diagnostics = '', paused = false, movementTimer, moving = true;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(25); } throw new Error('Timeout: ' + label); }
function own(child) { children.push(child); child.stdout?.on('data', b => diagnostics += b); child.stderr?.on('data', b => diagnostics += b); return child; }
const proxy = createServer(downstream => {
  if (paused) { downstream.destroy(); return; }
  const upstream = connect(gamePort, '127.0.0.1'); const pair = { downstream, upstream }; pairs.add(pair);
  downstream.pipe(upstream); upstream.pipe(downstream);
  const clean = () => { pairs.delete(pair); downstream.destroy(); upstream.destroy(); };
  downstream.on('error', clean); upstream.on('error', clean); downstream.on('close', clean); upstream.on('close', clean);
});
function cut() { for (const pair of [...pairs]) { pair.downstream.destroy(); pair.upstream.destroy(); } }
async function check(name, fn) { const start = Date.now(); await fn(); report.tests.push({ name, passed: true, durationMs: Date.now() - start }); console.log('PASS ' + name); }
try {
  const started = await startMinimalPocketBase(); own(started.child);
  own(spawn(process.execPath, ['colyseus/minimal/server.js'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }));
  await until(async () => { try { return (await fetch(base + '/ready')).ok; } catch { return false; } }, 'server ready');
  await new Promise((yes, no) => { proxy.once('error', no); proxy.listen(proxyPort, '127.0.0.1', yes); });
  const password = randomBytes(24).toString('hex');
  for (let i = 0; i < count; i++) {
    const user = await started.admin.collection('users').create({ email: `recovery-${i}@minimal.test`, password, passwordConfirm: password, name: `복구${i}` });
    await started.admin.collection('profiles').create({ user: user.id, name: `복구${i}` });
    const pb = new PocketBase(pbUrl); const auth = await pb.collection('users').authWithPassword(user.email, password);
    const engine = createEngine(), actor = { engine, id: user.id, failures: [], events: [], collected: 0 }; actors.push(actor);
    actor.connection = createConnection({ url: `ws://127.0.0.1:${proxyPort}`, engine, userId: user.id, token: auth.token,
      onSnapshot: data => applySnapshot(engine, data, user.id), onFailure: error => actor.failures.push(String(error.message || error.code)),
      onRecovery: status => actor.events.push({ at: Date.now(), ...status }), onGameEnded: match => actor.collected += match.scores[user.id] || 0 });
    await until(() => engine.initialized, 'actor snapshot');
    actor.initial = { room: engine.room.roomId, session: engine.room.sessionId };
  }
  movementTimer = setInterval(() => {
    for (const [i, actor] of actors.entries()) {
      const e = actor.engine; actor.connection.checkStale(); if (!moving || !e.connected || !e.initialized) continue;
      const next = i === 0 && actor.goal ? stepToward(e.self, waypoint(e.self, actor.goal)) : stepDirection(e.self, Math.floor(e.seq / 30) % 2 ? -1 : 1, 0);
      if (!next || blocked(next.x, next.y) || (next.x === e.self.x && next.y === e.self.y)) continue;
      e.previous = { ...e.self }; e.self = { ...next }; const move = { ...next, seq: ++e.seq, fix: e.fix }; e.pending.push(move); actor.connection.send(move);
    }
  }, 50);
  await check('an open socket with stalled acknowledgements recovers before prediction exceeds three seconds', async () => {
    moving = false; await until(() => actors.every(a => a.engine.pending.length === 0), 'silent-open initial drain');
    const actor = actors[1], e = actor.engine;
    const pair = [...pairs].find(p => p.downstream.remotePort === e.room.connection.transport.ws._socket.localPort); assert(pair);
    const before = actor.connection.status.recovered, fix = e.fix;
    pair.upstream.pause(); pair.downstream.pause();
    let pendingMax = 0;
    const sampler = setInterval(() => { pendingMax = Math.max(pendingMax, e.pending.length); }, 10);
    const began = Date.now(); moving = true;
    try {
      await until(() => actor.connection.status.recovered === before + 1, 'silent-open same-session recovery', 8000);
      moving = false; await until(() => actors.every(a => a.engine.pending.length === 0), 'silent-open final drain');
      assert(pendingMax <= 60); assert.equal(e.fix, fix); assert.equal(actor.connection.status.corrected, 0);
      assert.equal(e.room.sessionId, actor.initial.session); assert.equal(e.room.roomId, actor.initial.room);
      assert.equal(e.snapshot.players.find(p => p.id === actor.id).ack, e.seq); assert.deepEqual(actor.failures, []);
      report.silentOpen = { pendingMax, durationMs: Date.now() - began, seq: e.seq, ack: e.snapshot.players.find(p => p.id === actor.id).ack, ...actor.connection.status };
    } finally { clearInterval(sampler); pair.downstream.destroy(); pair.upstream.destroy(); moving = true; }
  });
  await check('server awards a real star before disconnect', async () => {
    const a = actors[0]; a.goal = a.engine.snapshot.game.stars.slice().sort((x,y)=>Math.hypot(x.x-a.engine.self.x,x.y-a.engine.self.y)-Math.hypot(y.x-a.engine.self.x,y.y-a.engine.self.y))[0]; assert(a.goal);
    await until(() => (a.engine.snapshot.game.scores[a.id] || 0) > 0, 'star collection', 20000); a.goal = null;
  });
  await check('TCP cut resumes same sessions and drains pending without correction or score rollback', async () => {
    const before = actors.map(a => ({ fix: a.engine.fix, score: a.engine.snapshot.game.scores[a.id] || 0, recovered: a.connection.status.recovered }));
    paused = true; cut(); await delay(700); paused = false;
    await until(() => actors.every((a, i) => a.connection.status.recovered === before[i].recovered + 1 && a.connection.status.phase === 'playing'), 'all resume');
    moving = false; await until(() => actors.every(a => a.engine.pending.length === 0), 'all pending acknowledged');
    actors.forEach((a, i) => { assert.deepEqual(a.failures, []); assert.equal(a.engine.room.roomId, a.initial.room); assert.equal(a.engine.room.sessionId, a.initial.session);
      assert.equal(a.engine.fix, before[i].fix); assert.equal(a.connection.status.corrected, 0); assert((a.engine.snapshot.game.scores[a.id] || 0) >= before[i].score);
      assert.equal(a.engine.snapshot.players.find(p => p.id === a.id).ack, a.engine.seq); });
    report.firstRecovery = actors.map(a => ({ seq: a.engine.seq, ...a.connection.status })); moving = true;
  });
  await check('worker exchange during movement keeps socket and session', async () => {
    const before = actors.map(a => a.connection.status.drops);
    const file = resolve(release, 'colyseus/minimal/simulation.js'); writeFileSync(file, readFileSync(file, 'utf8') + '\n// recovery fixture compatible release\n');
    const response = await fetch(base + '/internal/worker/swap', { method: 'POST', headers: { Authorization: `Bearer ${swapToken}` } }); assert.equal(response.status, 200); report.swap = await response.json();
    await delay(1000); actors.forEach((a, i) => { assert.equal(a.connection.status.drops, before[i]); assert.equal(a.engine.room.sessionId, a.initial.session); });
  });
  await check('valid movement is liveness evidence even when pong is suppressed', async () => {
    const actor = actors[1], ws = actor.engine.room.connection.transport.ws;
    const original = ws.pong, before = actor.connection.status.drops;
    let received = 0, suppressed = 0;
    ws.on('ping', () => received++); ws.pong = function() { suppressed++; };
    const ack = actor.engine.snapshot.players.find(p => p.id === actor.id).ack;
    await delay(10000); ws.pong = original;
    assert(received >= 2 && suppressed >= 2); assert.equal(actor.connection.status.drops, before);
    assert(actor.engine.snapshot.players.find(p => p.id === actor.id).ack > ack + 100);
    report.activeWithoutPong = { received, suppressed, drops: actor.connection.status.drops - before };
  });
  await check('silent socket without pong is terminated and resumes without losing the player', async () => {
    moving = false; await until(() => actors.every(a => a.engine.pending.length === 0), 'idle drain');
    const actor = actors[1], ws = actor.engine.room.connection.transport.ws, before = actor.connection.status.recovered;
    const position = { ...actor.engine.self }, fix = actor.engine.fix;
    ws.pong = () => {};
    await until(() => actor.connection.status.recovered === before + 1, 'idle heartbeat recovery', 16000);
    assert.deepEqual(actor.engine.self, position); assert.equal(actor.engine.fix, fix); assert.deepEqual(actor.failures, []);
    report.idleWithoutPong = { recovered: actor.connection.status.recovered, positionPreserved: true }; moving = true;
  });
  await check('normal delayed burst is accepted while excessive flood closes with recorded rate reason', async () => {
    moving = false; await until(() => actors.every(a => a.engine.pending.length === 0), 'burst drain');
    const a = actors[0], e = a.engine; await delay(1000);
    const pos = { ...e.self }; const start = e.seq; const offset = blocked(pos.x+4,pos.y) ? -4 : 4;
    for (let i=0; i<60; i++) { const move = { x: pos.x + (i%2 ? 0 : offset), y: pos.y, seq: ++e.seq, fix: e.fix }; e.pending.push(move); e.room.send('move',move); }
    await until(() => e.snapshot.players.find(p => p.id === a.id).ack === start+60, 'burst acknowledgement');
    assert.equal(e.pending.length,0); assert.equal(a.connection.status.corrected,0);
    report.normalBurst = { inputs:60, acknowledged:60 };
    // A separate client produces the deliberate flood; it is outside the baseline cohort.
    const user = await started.admin.collection('users').create({email:'flood@minimal.test',password,passwordConfirm:password,name:'과다송신'});
    await started.admin.collection('profiles').create({user:user.id,name:'과다송신'});
    const pb = new PocketBase(pbUrl); const auth = await pb.collection('users').authWithPassword(user.email,password);
    const {Client} = await import('@colyseus/sdk'); const sdk = new Client(`ws://127.0.0.1:${proxyPort}`); sdk.auth.token=auth.token;
    const room = await sdk.joinOrCreate('minimal-town',{zone:'lobby'}); room.reconnection.enabled=false;
    let offenderState, offenderCode; room.onMessage('snapshot',s=>offenderState=s); room.onMessage('deployment',()=>{});room.onMessage('gameEnded',()=>{});room.onLeave(code=>offenderCode=code);
    await until(()=>offenderState,'flood client snapshot'); const player=offenderState.players.find(p=>p.id===user.id);
    for (let i=0; i<250; i++) room.send('move',{x:player.x,y:player.y,seq:0,fix:0});
    await until(()=>offenderCode!==undefined,'flood rejection'); assert.equal(offenderCode,4002);
    await delay(100);
    const records = readFileSync(resolve(state,'connections.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert(records.some(r => r.event==='rate-limit' && r.reason==='message-rate-limit' && r.messages.lastSecond>80));
    assert(records.some(r => r.event==='heartbeat-timeout' && r.reason==='pong-or-valid-move-timeout'));
    report.excessiveBurst = { failure:offenderCode, reasonRecorded:true }; moving = true;
  });
  if (soakMs) await check('controlled local baseline after recovery', async () => { const start = Date.now(); console.log('SOAK_READY ' + state); while (Date.now() - start < soakMs) { await delay(1000); assert(actors.every(a => !a.failures.length)); } report.soakMs = Date.now() - start; });
  // A local-only HTTP collection: no copied public URLs or authentication material.
  const collection = { info: { name: 'Minimal recovery local HTTP contract', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item:
    [['Game health','GET',base+'/health',200], ['Game ready','GET',base+'/ready',200], ['Unauthenticated swap','POST',base+'/internal/worker/swap',403], ['Unauthenticated wallet','GET',pbUrl+'/api/minimal/wallet',401]]
      .map(([name,method,url,expected]) => ({ name, request: { method, url }, event: [{ listen:'test', script:{ type:'text/javascript', exec:[`pm.test('${name}', () => pm.response.to.have.status(${expected}));`] } }] })) };
  writeFileSync(resolve(state, 'http.postman_collection.json'), JSON.stringify(collection, null, 2));
  await check('Postman local HTTP contract', async () => {
    const child = own(spawn('postman', ['collection','run',resolve(state,'http.postman_collection.json'),'--report-events=false','-r','cli,json','--reporter-json-export',resolve(state,'postman.json')], { cwd:root, stdio:['ignore','pipe','pipe'] }));
    assert.equal(await new Promise(r => child.once('exit', r)), 0);
  });
  if (process.env.MINIMAL_RECOVERY_BROWSER_HOLD === '1') {
    own(spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','vite.minimal.config.js'],{cwd:root,env:{...process.env,VITE_MINIMAL_PB_URL:pbUrl,VITE_MINIMAL_GAME_URL:`ws://127.0.0.1:${proxyPort}`},stdio:['ignore','pipe','pipe']}));
    writeFileSync(resolve(state,'control.json'),JSON.stringify({state,base,pbUrl,webUrl:`http://127.0.0.1:${webPort}`}),{mode:0o600});
    console.log('BROWSER_READY ' + state);
    // Browser controls close its own socket. It never needs the deployment credential.
    await until(() => existsSync(resolve(state, 'browser-done')), 'browser validation', 900000);
  }
  moving = false; await until(() => actors.every(a => a.engine.pending.length === 0), 'final acknowledgement');
  report.actors = actors.map(a => ({ ...a.connection.status, seq: a.engine.seq, ack: a.engine.snapshot.players.find(p => p.id === a.id).ack, fix:a.engine.fix, pending:a.engine.pending.length, failures:a.failures, events:a.events }));
  actors.forEach(a => { assert.deepEqual(a.failures, []); assert.equal(a.connection.status.corrected, 0); assert(a.connection.status.recovered>=1); });
  report.passed = true;
} catch(error) { report.passed = false; report.error = error.stack; report.failureActors = actors.map(a=>({status:{...a.connection.status},seq:a.engine.seq,ack:a.engine.snapshot?.players.find(p=>p.id===a.id)?.ack,fix:a.engine.fix,x:a.engine.self.x,y:a.engine.self.y,pending:a.engine.pending.length,failures:a.failures})); console.error(error.stack); process.exitCode = 1; }
finally {
  clearInterval(movementTimer); actors.forEach(a => a.connection?.dispose()); cut(); await new Promise(r => proxy.close(r));
  for (const child of [...children].reverse()) if (child.exitCode === null && !child.signalCode) await new Promise(r => { child.once('exit',r); child.kill('SIGTERM'); });
  writeFileSync(resolve(state,'server.log'),diagnostics); writeFileSync(resolve(state,'report.json'),JSON.stringify(report,null,2)+'\n'); console.log('Report: ' + state + '/report.json');
}

function waypoint(from, goal) {
  const nodes=[from,goal,{x:248,y:128},{x:392,y:128},{x:248,y:240},{x:392,y:240}],distances=nodes.map(()=>Infinity),paths=nodes.map(()=>[]),used=new Set();distances[0]=0;
  const visible=(a,b)=>{const n=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/2);for(let k=1;k<=n;k++)if(blocked(a.x+(b.x-a.x)*k/n,a.y+(b.y-a.y)*k/n))return false;return true;};
  for(let k=0;k<nodes.length;k++){let u=-1;for(let i=0;i<nodes.length;i++)if(!used.has(i)&&(u<0||distances[i]<distances[u]))u=i;if(u===1)return nodes[paths[u][0]]||goal;used.add(u);
    for(let v=1;v<nodes.length;v++)if(!used.has(v)&&visible(nodes[u],nodes[v])){const d=distances[u]+Math.hypot(nodes[u].x-nodes[v].x,nodes[u].y-nodes[v].y);if(d<distances[v]){distances[v]=d;paths[v]=[...paths[u],v];}}
  }return from;
}
