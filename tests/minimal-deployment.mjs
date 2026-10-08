// Real isolated host/DB: immutable release, rejection rollback and public ingress policy.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Client } from '@colyseus/sdk';
import { stepToward } from '../minimal/shared/world.js';
const root=process.cwd(), fixture=mkdtempSync(resolve(root,'.test-work/minimal-deployment-'));
for(const path of ['colyseus/minimal','minimal/shared','pocketbase/minimal','scripts'])mkdirSync(resolve(fixture,path),{recursive:true});
for(const path of ['colyseus/minimal','minimal/shared','pocketbase/minimal'])cpSync(resolve(root,path),resolve(fixture,path),{recursive:true});
for(const file of ['dev-minimal.mjs','minimal-process.mjs','start-minimal-game.mjs','minimal-pocketbase.mjs','minimal-release.mjs','deploy-minimal-worker.mjs'])cpSync(resolve(root,'scripts',file),resolve(fixture,'scripts',file));
writeFileSync(resolve(fixture,'package.json'),'{"type":"module"}');
symlinkSync(resolve(root,'node_modules'),resolve(fixture,'node_modules'),'dir');
symlinkSync(resolve(root,'colyseus/node_modules'),resolve(fixture,'colyseus/node_modules'),'dir');
const state=resolve(fixture,'.local/minimal');const env={...process.env,MINIMAL_STATE_DIR:state,MINIMAL_PB_BINARY:resolve(root,'pocketbase/.local/pocketbase'),MINIMAL_PB_PORT:'18124',MINIMAL_GAME_PORT:'12624',MINIMAL_WEB_PORT:'5274',MINIMAL_BACKEND_ONLY:'1',MINIMAL_PUBLIC_MODE:'1',MINIMAL_PUBLIC_ORIGINS:'https://pixeltown.fastmake.net'};
delete env.MINIMAL_SWAP_TOKEN;
const base='http://127.0.0.1:12624',pb='http://127.0.0.1:18124';let child,timer,room,observe=true;let diagnostics='';
const report={passed:false,production:false,tests:[],fixture};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<400;i++){if(await fn())return;await sleep(25);}throw new Error('Timeout: '+label);}
const health=async()=>(await fetch(base+'/health')).json();
async function deploy(extra={}){return new Promise(resolvePromise=>{const p=spawn(process.execPath,['scripts/deploy-minimal-worker.mjs'],{cwd:fixture,env:{...env,...extra},stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('exit',code=>resolvePromise({code,output}));});}
try{
 child=spawn(process.execPath,['scripts/dev-minimal.mjs'],{cwd:fixture,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>diagnostics+=b);child.stderr.on('data',b=>diagnostics+=b);
 await until(async()=>{try{return (await fetch(base+'/ready')).ok;}catch{return false;}},'ready');
 assert.equal((await health()).workerDeployment,'managed-release');
 const password=randomBytes(32).toString('hex');
 const auth=await (await fetch(pb+'/api/minimal/guest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'배포확인',password})})).json();assert(auth.token);
 const sdk=new Client('ws://127.0.0.1:12624');sdk.auth.token=auth.token;room=await sdk.joinOrCreate('minimal-town',{zone:'lobby'});room.reconnection.maxRetries=0;
 const identity={roomId:room.roomId,sessionId:room.sessionId};let snapshot,pos,seq=0,drops=0,fixes=0;
 room.onMessage('deployment',()=>{});room.onDrop(()=>drops++);room.onLeave(()=>{if(observe)drops++;});room.onError(()=>drops++);room.onMessage('gameEnded',()=>{});
 room.onMessage('snapshot',s=>{snapshot=s;const p=s.players.find(p=>p.id===auth.record.id);if(!pos)pos={x:p.x,y:p.y};fixes=p.fix;});await until(()=>snapshot,'snapshot');
 const start={...pos};timer=setInterval(()=>{const next=stepToward(pos,{x:start.x+(Math.floor(seq/3)%2?0:12),y:start.y});if(next.x===pos.x&&next.y===pos.y)return;pos=next;room.send('move',{...pos,seq:++seq,fix:0});},50);
 const token=readFileSync(resolve(state,'swap-token'),'utf8').trim();
 assert.equal((await fetch(base+'/internal/worker/swap',{method:'POST',headers:{Authorization:`Bearer ${token}`,'CF-Connecting-IP':'198.51.100.2'}})).status,403);
 assert.equal((await fetch(pb+'/api/minimal/ready',{headers:{'CF-Connecting-IP':'198.51.100.2'}})).status,403);
 assert.equal((await fetch(base+'/health',{headers:{Origin:'https://pixeltown.fastmake.net'}})).status,200);
 assert.equal((await fetch(base+'/health',{headers:{Origin:'https://unapproved.example'}})).status,403);
 report.tests.push('exact public Origin allowed; unknown Origin and forwarded deployment/readiness controls rejected');
 const file=resolve(fixture,'colyseus/minimal/simulation.js'),original=readFileSync(file,'utf8');const before=await health();const oldPointer=readlinkSync(resolve(state,'worker-current'));
 writeFileSync(file,original+'\n// Immutable release integration check\n');const success=await deploy();assert.equal(success.code,0,success.output);const promoted=JSON.parse(success.output);assert.equal(promoted.generation,before.worker.generation+1);assert.notEqual(promoted.revision,before.worker.revision);report.swap=promoted;
 const pointer=readlinkSync(resolve(state,'worker-current'));assert.notEqual(pointer,oldPointer);assert.equal(readFileSync(resolve(state,oldPointer,'colyseus/minimal/simulation.js'),'utf8'),original);
 assert.equal((await deploy()).code,0);assert.equal((await health()).worker.generation,promoted.generation);
 report.tests.push('complete immutable release selected; active promotion and unchanged release preserve generation and old artifact');
 writeFileSync(file,original+'\nthrow new Error("candidate rejected for test");\n');const failed=await deploy();assert.notEqual(failed.code,0);assert.equal(readlinkSync(resolve(state,'worker-current')),pointer);assert.equal((await health()).worker.revision,promoted.revision);
 writeFileSync(file,original+'\n// Wrong deployment token check\n');assert.notEqual((await deploy({MINIMAL_SWAP_TOKEN:randomBytes(32).toString('hex')})).code,0);assert.equal(readlinkSync(resolve(state,'worker-current')),pointer);
 report.tests.push('candidate startup failure and HTTP 403 restore previous selection without replacing active worker');
 for(let i=0;i<21;i++){
  const r=await fetch(pb+'/api/minimal/guest',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'198.51.100.25'},body:JSON.stringify({name:`발급확인${i}`,password})});assert.equal(r.status,i<20?200:429,`guest request ${i}: ${r.status}`);
 }
 report.tests.push('public visitor-IP guest issuance permits 20/hour and rejects the 21st; loopback backend remains usable');
 await sleep(1000);clearInterval(timer);await until(()=>snapshot.players.find(p=>p.id===auth.record.id).ack===seq,'all inputs acknowledged');
 assert(seq>20);assert.equal(drops+fixes,0);assert.equal(room.roomId,identity.roomId);assert.equal(room.sessionId,identity.sessionId);
 report.inputs=seq;report.drops=drops;report.fixes=fixes;report.tests.push('live room/session, movement seq/fix and acknowledgements survive successful and rejected deployments');report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error.message);}
finally{clearInterval(timer);observe=false;if(room?.connection.isOpen)await room.leave();if(child?.exitCode===null&&!child.signalCode)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});writeFileSync(resolve(fixture,'report.json'),JSON.stringify(report,null,2));writeFileSync(resolve(fixture,'server.log'),diagnostics);console.log(`Report: ${fixture}/report.json`);}
