// Local-only real PB, 100 active SDK clients, release replacement and durable ledger evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@colyseus/sdk';
import PocketBase from 'pocketbase';
import { stepToward, touchesStar, blocked } from '../minimal/shared/world.js';

const root = process.cwd(); mkdirSync(resolve(root, '.test-work'), { recursive: true });
const state = mkdtempSync(resolve(root, '.test-work/minimal-hotswap-'));
const token = randomBytes(32).toString('hex');
const soakMs = Number(process.env.MINIMAL_SOAK_MS || 0);
if (!Number.isInteger(soakMs) || soakMs < 0 || soakMs > 3600000) throw new Error('Invalid MINIMAL_SOAK_MS');
const release = resolve(state, 'release');
for (const dir of ['colyseus/minimal', 'minimal/shared']) mkdirSync(resolve(release, dir), { recursive: true });
for (const file of ['simulation.js', 'simulation-worker.js', 'worker-runtime.js']) copyFileSync(resolve(root, 'colyseus/minimal', file), resolve(release, 'colyseus/minimal', file));
copyFileSync(resolve(root, 'minimal/shared/world.js'), resolve(release, 'minimal/shared/world.js'));
Object.assign(process.env, { MINIMAL_STATE_DIR: state, MINIMAL_PB_PORT: process.env.MINIMAL_TEST_PB_PORT || '18122', MINIMAL_GAME_PORT: process.env.MINIMAL_TEST_GAME_PORT || '12622', MINIMAL_WEB_PORT: '5272',
  MINIMAL_SETTLE_MS: process.env.MINIMAL_SETTLE_MS || '12000', MINIMAL_SPAWN_MS: process.env.MINIMAL_SPAWN_MS || '1000', MINIMAL_SWAP_TOKEN: token, MINIMAL_WORKER_ENTRY: resolve(release, 'colyseus/minimal/simulation-worker.js') });
const { startMinimalPocketBase } = await import('../scripts/minimal-pocketbase.mjs');
const base = `http://127.0.0.1:${process.env.MINIMAL_GAME_PORT}`, pbUrl = `http://127.0.0.1:${process.env.MINIMAL_PB_PORT}`;
const children = [], clients = [], report = { production: false, stateDirectory: state, swaps: [], tests: [], settings: { clients: 100, tickMs: 50, settleMs: Number(process.env.MINIMAL_SETTLE_MS), spawnMs: Number(process.env.MINIMAL_SPAWN_MS), soakMs } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const summary = values => { const a = values.slice().sort((a,b) => a-b); return { n:a.length, p50:a[Math.floor(a.length*.5)] || 0, p95:a[Math.floor(a.length*.95)] || 0, p99:a[Math.floor(a.length*.99)] || 0, max:a.at(-1) || 0 }; };
async function until(fn, name, timeout = 15000) { const end=Date.now()+timeout; while(Date.now()<end) { const value=await fn(); if(value) return value; await sleep(25); } throw new Error('Timeout: '+name); }
let timer, progress, admin, phase = 'baseline', diagnostics = '', observed = false;
const metrics = { baseline: { snapshots: [], ack: [], pickup: [] }, deployment: { snapshots: [], ack: [], pickup: [] } };
function own(child) { children.push(child); child.stdout?.on('data', b => diagnostics += b); child.stderr?.on('data', b => diagnostics += b); return child; }
async function health() { return (await fetch(base+'/health')).json(); }
async function swap(n) {
  // A new executable artifact (different source hash), with the same state/wire contract.
  const file = resolve(release, 'colyseus/minimal/simulation.js');
  let source = readFileSync(resolve(root, 'colyseus/minimal/simulation.js'), 'utf8');
  if (n % 2) source = source.replace('return Object.values(this.game.scores).reduce((n, s) => n + s, 0);', 'let total = 0; for (const score of Object.values(this.game.scores)) total += score; return total;');
  writeFileSync(file, source + `\n// Local release ${n}: equivalent score aggregation implementation\n`);
  const before = await health();
  const response = await fetch(base+'/internal/worker/swap', { method:'POST', headers:{Authorization:`Bearer ${token}`} });
  const result = await response.json(); assert.equal(response.status,200,JSON.stringify(result));
  assert.notEqual(result.revision,before.worker.revision); assert.equal(result.generation,before.worker.generation+1);
  report.swaps.push(result); return result;
}
try {
  const started = await startMinimalPocketBase(); own(started.child); admin = started.admin;
  own(spawn(process.execPath,['colyseus/minimal/server.js'],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']}));
  await until(async()=>{try{return (await fetch(base+'/ready')).ok;}catch{return false;}},'ready');
  assert.equal((await fetch(base+'/internal/worker/swap',{method:'POST'})).status,403);
  assert.equal((await fetch(base+'/internal/worker/swap',{method:'POST',headers:{Authorization:`Bearer ${token}`,Origin:'http://127.0.0.1:5272'}})).status,403);
  report.tests.push('local deployment control rejects unauthenticated and browser-origin requests');
  const password=randomBytes(24).toString('hex');
  for(let i=0;i<100;i++) {
    const u=await admin.collection('users').create({email:`swap-${i}@minimal.test`,password,passwordConfirm:password,name:`교체${i}`});
    await admin.collection('profiles').create({user:u.id,name:`교체${i}`});
    const pb=new PocketBase(pbUrl); const auth=await pb.collection('users').authWithPassword(u.email,password);
    const sdk=new Client(base.replace('http:','ws:')); sdk.auth.token=auth.token;
    const room=await sdk.joinOrCreate('minimal-town',{zone:'lobby'}); room.reconnection.maxRetries=0;
    const c={room,id:u.id,token:auth.token,seq:0,pending:new Map(),ended:[],drops:0,fixes:0,last:0,phase,initialRoom:room.roomId,initialSession:room.sessionId, continuityErrors:[]};
    clients.push(c);
    room.onDrop(()=>c.drops++); room.onLeave(()=>{if(observed)c.drops++;}); room.onError(()=>c.drops++);
    room.onMessage('deployment',()=>{});room.onMessage('featureUnavailable',()=>{});
    room.onMessage('gameEnded',m=>c.ended.push(m));
    room.onMessage('snapshot',s=>{
      const now=performance.now(), p=s.players.find(p=>p.id===c.id); if(!p)return;
      if(observed && c.last && c.phase===phase) metrics[phase].snapshots.push(now-c.last);
      c.last=now;c.phase=phase;
      if(c.snapshot && p.fix!==c.snapshot.players.find(p=>p.id===c.id)?.fix)c.fixes++;
      for(const [seq,at] of c.pending)if(seq<=p.ack){if(observed)metrics[phase].ack.push(now-at);c.pending.delete(seq);}
      if(c.touch && !s.game.stars.some(x=>x.id===c.touch.id)){if(observed)metrics[phase].pickup.push(now-c.touch.at);c.touch=null;}
      if(c.snapshot) {
        const old=c.snapshot.players.find(x=>x.id===c.id);
        if(p.fix===old.fix && (p.ack<old.ack || Math.hypot(p.x-old.x,p.y-old.y)>6*(p.ack-old.ack)+.02)) c.continuityErrors.push('position/ack discontinuity');
        if(s.game.id===c.snapshot.game.id && (s.game.scores[c.id]||0)<(c.snapshot.game.scores[c.id]||0)) c.continuityErrors.push('score rollback');
      }
      c.snapshot=s; if(!c.pos)c.pos={x:p.x,y:p.y};
    });
    await until(()=>c.snapshot,'snapshot');
  }
  assert.equal(new Set(clients.map(c=>c.room.roomId)).size,1);
  observed=true;
  timer=setInterval(()=>{
    for(let i=0;i<clients.length;i++){
      const c=clients[i]; if(!c.pos)continue;
      let target;
      if(i===0) {
        c.goal = c.snapshot.game.stars.find(s => s.id === c.goal?.id) || c.snapshot.game.stars.slice().sort((a,b)=>Math.hypot(a.x-c.pos.x,a.y-c.pos.y)-Math.hypot(b.x-c.pos.x,b.y-c.pos.y))[0];
        target = waypoint(c.pos, c.goal || {x:320,y:340});
      } else {
        const baseX=32+(i%25)*24, y=320+Math.floor(i/25)*20;
        target={x:baseX+(Math.floor(c.seq/3)%2?0:12),y};
      }
      const next=stepToward(c.pos,target); if(next.x===c.pos.x&&next.y===c.pos.y)continue;
      c.pos=next;const seq=++c.seq;c.pending.set(seq,performance.now());
      c.room.send('move',{...next,seq,fix:0});
      if(i===0&&!c.touch){const star=c.snapshot.game.stars.find(s=>touchesStar(next,s));if(star)c.touch={id:star.id,at:performance.now()};}
    }
  },50);
  const activityStarted = Date.now();
  progress = setInterval(() => console.log(JSON.stringify({ stateDirectory: state, elapsedSeconds: Math.floor((Date.now()-activityStarted)/1000), phase, swaps: report.swaps.length, inputs: clients.reduce((n,c)=>n+c.seq,0), drops: clients.reduce((n,c)=>n+c.drops,0), fixes: clients.reduce((n,c)=>n+c.fixes,0), continuityErrors: clients.reduce((n,c)=>n+c.continuityErrors.length,0) })), 30000);
  console.log(`ACTIVITY_READY ${state}`);
  await sleep(soakMs ? 60000 : 6000); phase='deployment';
  if (soakMs) {
    let n=1;
    while (Date.now()-activityStarted < soakMs-6000) { await swap(n++); await sleep(Math.min(60000, Math.max(0,soakMs-6000-(Date.now()-activityStarted)))); }
  } else for(let n=1;n<=8;n++){await swap(n);await sleep(1200);}
  await sleep(6000); clearInterval(progress); progress = null;
  report.activityDurationMs = Date.now()-activityStarted;
  clearInterval(timer); timer=null;
  await until(()=>clients.every(c=>c.pending.size===0),'all inputs acknowledged');
  for(const c of clients){
    assert.equal(c.drops,0);assert.equal(c.fixes,0);assert.deepEqual(c.continuityErrors,[]);assert(c.seq>250);assert.equal(c.room.roomId,c.initialRoom);assert.equal(c.room.sessionId,c.initialSession);
    assert.equal(c.snapshot.players.find(p=>p.id===c.id).ack,c.seq);
    assert.equal(new Set(c.ended.map(m=>m.match_id)).size,c.ended.length);
  }
  report.inputs=clients.reduce((n,c)=>n+c.seq,0);report.drops=0;report.unexpectedFixes=0;
  report.metrics=Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([x,a])=>[x,summary(a)]))]));
  assert(report.metrics.deployment.snapshots.max<250,'snapshot stall');
  assert(report.metrics.deployment.ack.max<300,'ack stall');
  assert(clients[0].ended.some(m=>m.scores[clients[0].id]>0),'real collection and settlement');
  assert(report.metrics.baseline.pickup.n + report.metrics.deployment.pickup.n > 0, 'pickup latency observed');
  // Deliberate invalid position must cause exactly one correction and valid movement must recover after swap.
  const c=clients[0], me=c.snapshot.players.find(p=>p.id===c.id);
  c.room.send('move',{x:320,y:180,seq:++c.seq,fix:0});
  await until(()=>c.snapshot.players.find(p=>p.id===c.id).fix===1,'forced correction');
  await swap(9);
  c.room.send('move',{x:me.x,y:me.y,seq:++c.seq,fix:1});
  await until(()=>c.snapshot.players.find(p=>p.id===c.id).ack===c.seq,'corrected seq after deployment');
  report.tests.push('100 active sessions: no drops, unexpected fixes or lost input; deliberate fix/seq survives deployment');
  observed=false;
  await Promise.all(clients.map(c=>c.room.leave()));
  await until(async()=>{const h=await health();return h.players===0&&h.persistence.pending===0;},'all final settlements');
  const results=await admin.collection('results').getFullList();
  const inventory=await admin.collection('inventory').getFullList();
  report.ledger={results:results.length,inventory:inventory.length};
  for(const c of clients){
    const wallet=await (await fetch(pbUrl+'/api/minimal/wallet',{headers:{Authorization:c.token}})).json();
    const ledger=inventory.filter(x=>x.user===c.id);const expected=ledger.reduce((n,x)=>n+x.quantity,0);
    assert.equal(wallet.balance,expected); assert.equal(new Set(ledger.map(x=>x.match_id)).size,ledger.length);
    for(const m of c.ended)if(m.scores[c.id])assert(wallet.settledMatchIds.includes(m.match_id));
  }
  report.tests.push('collected scores settle once; final wallet and durable per-match ledger agree');
  report.health=await health();
  if(process.env.MINIMAL_BROWSER_HOLD==='1') {
    own(spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','vite.minimal.config.js'],{cwd:root,env:{...process.env,VITE_MINIMAL_PB_URL:pbUrl,VITE_MINIMAL_GAME_URL:base.replace('http:','ws:')},stdio:['ignore','pipe','pipe']}));
    // Secret stays in a private file; the browser never receives the deployment token.
    writeFileSync(resolve(state,'control.json'),JSON.stringify({token,release,base,pbUrl,webUrl:'http://127.0.0.1:5272'}),{mode:0o600});
    console.log(`BROWSER_READY ${state}`);
    await until(()=>readFileSyncSafe(resolve(state,'browser-done')), 'browser validation completion', 1800000);
  }
  report.passed=true;
} catch(error){report.passed=false;report.error=error.stack;console.error(error.stack);process.exitCode=1;}
finally{
  observed=false;clearInterval(timer);clearInterval(progress);
  await Promise.allSettled(clients.filter(c=>c.room.connection.isOpen).map(c=>c.room.leave()));
  for(const child of [...children].reverse())if(child.exitCode===null&&!child.signalCode)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});
  writeFileSync(resolve(state,'report.json'),JSON.stringify(report,null,2)+'\n');
  writeFileSync(resolve(state,'server.log'),diagnostics);
  console.log(`Report: ${state}/report.json`);
}
function readFileSyncSafe(path){try{return readFileSync(path,'utf8');}catch{return null;}}

function waypoint(from, goal) {
  const nodes=[from,goal,{x:248,y:128},{x:392,y:128},{x:248,y:240},{x:392,y:240}], distances=nodes.map(()=>Infinity), paths=nodes.map(()=>[]), used=new Set(); distances[0]=0;
  const visible=(a,b)=>{const n=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/2);for(let k=1;k<=n;k++)if(blocked(a.x+(b.x-a.x)*k/n,a.y+(b.y-a.y)*k/n))return false;return true;};
  for(let k=0;k<nodes.length;k++){
    let u=-1;for(let i=0;i<nodes.length;i++)if(!used.has(i)&&(u<0||distances[i]<distances[u]))u=i;
    if(u===1)return nodes[paths[u][0]] || goal;used.add(u);
    for(let v=1;v<nodes.length;v++)if(!used.has(v)&&visible(nodes[u],nodes[v])){const d=distances[u]+Math.hypot(nodes[u].x-nodes[v].x,nodes[u].y-nodes[v].y);if(d<distances[v]){distances[v]=d;paths[v]=[...paths[u],v];}}
  }
  return from;
}
