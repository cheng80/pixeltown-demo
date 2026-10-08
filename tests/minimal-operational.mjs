// Public minimal backend only: 100 synthetic SDK clients, no legacy service restart.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
// Node load generator uses ws directly; browsers keep their native WebSocket.
import WebSocket from '../colyseus/node_modules/ws/wrapper.mjs';
globalThis.WebSocket = WebSocket;
const { Client } = await import('@colyseus/sdk');
import PocketBase from 'pocketbase';
import { stepToward, touchesStar, blocked } from '../minimal/shared/world.js';

assert.equal(process.env.MINIMAL_OPERATIONAL, '1', 'Set MINIMAL_OPERATIONAL=1 only for an authorized minimal operational test');
const root = process.cwd(); mkdirSync(resolve(root, '.test-work'), { recursive: true });
const state = mkdtempSync(resolve(root, '.test-work/minimal-hotswap-'));
const soakMs = Number(process.env.MINIMAL_SOAK_MS || 1800000);
const count=Number(process.env.MINIMAL_OPERATIONAL_CLIENTS || 100);assert(Number.isInteger(count)&&count>0&&count<=100);
const swarmOnly=process.env.MINIMAL_SWARM_ONLY==='1';
assert(soakMs >= 60000 && soakMs <= 3600000);
const base = 'https://pixeltown-minimal-rt.fastmake.net', pbUrl = 'https://pixeltown-minimal-pb.fastmake.net';
const children = [], clients = [], report = { production: true, stateDirectory: state, swaps: [], tests: [], settings: { clients: count, tickMs: 50, settleMs: 180000, spawnMs: 6000, soakMs } };
const { execFileSync } = await import('node:child_process');
const ssh = ['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',process.env.HOME+'/.ssh/stonematch_macmini_ed25519','cheng80@mac-mini.tailc386bf.ts.net'];
const remote = action => JSON.parse(execFileSync('ssh',[...ssh, 'cd /Users/cheng80/Servers/pixeltown-minimal/app && /Users/cheng80/Servers/pixeltown-colyseus/runtime/bin/node --env-file=../.env .test-work/operational-control.mjs '+action],{encoding:'utf8',maxBuffer:4000000,timeout:120000}));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const summary = values => { const a = values.slice().sort((a,b) => a-b); return { n:a.length, p50:a[Math.floor(a.length*.5)] || 0, p95:a[Math.floor(a.length*.95)] || 0, p99:a[Math.floor(a.length*.99)] || 0, max:a.at(-1) || 0 }; };
async function until(fn, name, timeout = 15000) { const end=Date.now()+timeout; while(Date.now()<end) { const value=await fn(); if(value) return value; await sleep(25); } throw new Error('Timeout: '+name); }
let timer, progress, admin, phase = 'baseline', diagnostics = '', observed = false;
const metrics = { baseline: { snapshots: [], ack: [], pickup: [] }, deployment: { snapshots: [], ack: [], pickup: [] } };
function own(child) { children.push(child); child.stdout?.on('data', b => diagnostics += b); child.stderr?.on('data', b => diagnostics += b); return child; }
async function health() { return (await fetch(base+'/health')).json(); }
async function swap(n) {
  const before = await health();
  const result = remote('swap-'+n);
  assert.equal(result.generation,before.worker.generation+1);
  assert.notEqual(result.revision,before.worker.revision);
  report.swaps.push(result); return result;
}
try {
  const accounts=process.env.MINIMAL_OPERATIONAL_ACCOUNTS ? JSON.parse(readFileSync(process.env.MINIMAL_OPERATIONAL_ACCOUNTS,'utf8')) : remote('provision');
  writeFileSync(resolve(state,'accounts.json'),JSON.stringify(accounts),{mode:0o600});
  assert.equal((await fetch(base+'/internal/worker/swap',{method:'POST'})).status,403);
  report.tests.push('public deployment control denied');
  for(const account of accounts.slice(0,count)) {
    const sdk=new Client(base.replace('https:','wss:'),{fetchFn:async(url,options)=>{try{return await fetch(url,options);}catch(error){console.log(JSON.stringify({networkError:error.cause?.code,message:error.cause?.message}));throw error;}}}); sdk.auth.token=account.token;
    let room;
    for(let attempt=1;attempt<=3;attempt++){try{room=await sdk.joinOrCreate('minimal-town',{zone:'lobby'});break;}catch(error){report.joinRetries=(report.joinRetries||0)+1;if(attempt===3)throw error;await sleep(1000);}}
    room.reconnection.maxRetries=0;
    const c={room,id:account.id,token:account.token,seq:0,pending:new Map(),ended:[],drops:0,fixes:0,last:0,phase,initialRoom:room.roomId,initialSession:room.sessionId,continuityErrors:[]};
    clients.push(c);
    room.onDrop(code=>{c.drops++;(report.closeCodes ||= []).push(code);});room.onLeave(code=>{if(observed){c.drops++;(report.closeCodes ||= []).push(code);}});room.onError(()=>c.drops++);
    room.onMessage('deployment',m=>(report.deploymentEvents ||= []).push(m));room.onMessage('featureUnavailable',()=>{});room.onMessage('gameEnded',m=>c.ended.push(m));
    room.onMessage('snapshot',s=>{
      const now=performance.now(),p=s.players.find(p=>p.id===c.id);if(!p)return;
      if(observed&&c.last&&c.phase===phase)metrics[phase].snapshots.push(now-c.last);
      c.last=now;c.phase=phase;
      if(c.snapshot&&p.fix!==c.snapshot.players.find(p=>p.id===c.id)?.fix)c.fixes++;
      for(const [seq,at] of c.pending)if(seq<=p.ack){if(observed)metrics[phase].ack.push(now-at);c.pending.delete(seq);}
      if(c.touch&&!s.game.stars.some(x=>x.id===c.touch.id)){if(observed)metrics[phase].pickup.push(now-c.touch.at);c.touch=null;}
      if(c.snapshot){const old=c.snapshot.players.find(x=>x.id===c.id);if(p.fix===old.fix&&(p.ack<old.ack||Math.hypot(p.x-old.x,p.y-old.y)>6*(p.ack-old.ack)+.02))c.continuityErrors.push('position/ack discontinuity');if(s.game.id===c.snapshot.game.id&&(s.game.scores[c.id]||0)<(c.snapshot.game.scores[c.id]||0))c.continuityErrors.push('score rollback');}
      c.snapshot=s;if(!c.pos)c.pos={x:p.x,y:p.y};
    });
    await until(()=>c.snapshot,'snapshot');if(clients.length%10===0)console.log('Joined '+clients.length);
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
  await sleep(swarmOnly ? 1000 : (soakMs ? 60000 : 6000));
  assert.equal(clients.reduce((n,c)=>n+c.drops,0),0,'baseline connection loss; deployment not started');
  phase='deployment';
  if (swarmOnly) { await sleep(soakMs-1000); } else if (soakMs) {
    let n=1;
    while (Date.now()-activityStarted < soakMs-6000) { assert.equal(clients.reduce((n,c)=>n+c.drops,0),0,'connection loss during operational test'); await swap(n++); await sleep(Math.min(60000, Math.max(0,soakMs-6000-(Date.now()-activityStarted)))); }
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
  assert(report.metrics.deployment.snapshots.max<8000,'snapshot exceeds frontend stale threshold');
  assert(report.metrics.deployment.ack.max<8000,'unacknowledged movement exceeds stale threshold');
  assert(clients[0].ended.some(m=>m.scores[clients[0].id]>0),'real collection and settlement');
  assert(report.metrics.baseline.pickup.n + report.metrics.deployment.pickup.n > 0, 'pickup latency observed');
  // Deliberate invalid position must cause exactly one correction and valid movement must recover after swap.
  if(!swarmOnly){
  const c=clients[0], me=c.snapshot.players.find(p=>p.id===c.id);
  c.room.send('move',{x:320,y:180,seq:++c.seq,fix:0});
  await until(()=>c.snapshot.players.find(p=>p.id===c.id).fix===1,'forced correction');
  await swap(9);
  c.room.send('move',{x:me.x,y:me.y,seq:++c.seq,fix:1});
  await until(()=>c.snapshot.players.find(p=>p.id===c.id).ack===c.seq,'corrected seq after deployment');
  }
  report.tests.push('active sessions: no drops, unexpected fixes or lost input; deliberate fix/seq survives deployment');
  observed=false;
  await Promise.all(clients.map(c=>c.room.leave()));
  await until(async()=>{const h=await health();return h.players===0&&h.persistence.pending===0;},'all final settlements');
  report.ledger=remote('verify');
  report.tests.push('operational ledger equals per-user wallet, no duplicate match rows');
  report.health=await health();
  report.passed=true;

} catch(error){report.passed=false;report.error=error.stack;console.error(error.stack);process.exitCode=1;}
finally{
  observed=false;clearInterval(timer);clearInterval(progress);
  try { report.restore=remote('restore'); } catch(error) { report.passed=false;report.restoreError=String(error);process.exitCode=1; }
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
