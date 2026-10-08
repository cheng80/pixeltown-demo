// Authorized public minimal observation. Owns synthetic clients only; never restarts a service.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,appendFileSync,existsSync,openSync,closeSync,unlinkSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import WebSocket from '../colyseus/node_modules/ws/wrapper.mjs';
import {stepToward,blocked} from '../minimal/shared/world.js';
globalThis.WebSocket=WebSocket;
const {Client}=await import('@colyseus/sdk');
const {default:PocketBase}=await import('pocketbase');
assert.equal(process.env.MINIMAL_OPERATIONAL,'1','Explicit authorization required');
assert(process.env.MINIMAL_OPERATIONAL_ACCOUNTS,'Reuse existing private test accounts');
const root=process.cwd(),count=85,collectors=5,intervalMs=180000;
mkdirSync(resolve(root,'.local/minimal'),{recursive:true});
mkdirSync(resolve(root,'.test-work'),{recursive:true});
const lock=resolve(root,'.local/minimal/live-observe.lock');
if(existsSync(lock)){
 const previous=JSON.parse(readFileSync(lock));let alive=true;
 try{process.kill(previous.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}
 if(alive)throw Error('An observation runner already owns this lock');
 renameSync(lock,lock+'.stale-'+Date.now());
}
const directory=mkdtempSync(resolve(root,'.test-work/minimal-live-'));
if(process.env.MINIMAL_DEPLOYMENT_PAUSED==='1')writeFileSync(resolve(directory,'PAUSE_DEPLOYMENTS'),'Start with automatic deployment paused; keep clients.\n');
const fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,directory}));closeSync(fd);
const accounts=JSON.parse(readFileSync(process.env.MINIMAL_OPERATIONAL_ACCOUNTS));assert(accounts.length>=count);
writeFileSync(resolve(directory,'accounts.json'),JSON.stringify(accounts),{mode:0o600});
const base='https://pixeltown-minimal-rt.fastmake.net',pbUrl='https://pixeltown-minimal-pb.fastmake.net';
const run=promisify(execFile),ssh=['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',process.env.HOME+'/.ssh/stonematch_macmini_ed25519','cheng80@mac-mini.tailc386bf.ts.net'];
async function control(action){const{stdout}=await run('ssh',[...ssh,'cd /Users/cheng80/Servers/pixeltown-minimal/app && /Users/cheng80/Servers/pixeltown-colyseus/runtime/bin/node --env-file=../.env .test-work/operational-control.mjs '+action],{timeout:90000,maxBuffer:4000000});return JSON.parse(stdout);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let stopping=false,phase='joining',movementTimer,reportTimer,stopTimer,lastOwnRevision,activityStarted,deploying=false;
const diagnosticKey=Date.now()+'-'+process.pid;
let diagnosticBusy=false,diagnosticNumber=0,draining=false,lastProgress=performance.now(),lastMovement=performance.now();
let lastRefresh=Date.now();
const clients=[],samples={snapshots:[],acks:[]};
const stats={pid:process.pid,directory,state:'joining',target:base,bots:count,randomWalkers:count-collectors,starHunters:collectors,deploymentIntervalMs:intervalMs,startedAt:new Date().toISOString(),deployments:0,deploymentFailures:0,drops:0,errors:0,fixes:0,rejoins:0,continuityErrors:0,pickups:0,settlements:0};
function log(type,detail={}){const event={at:new Date().toISOString(),type,phase,...detail};appendFileSync(resolve(directory,'events.jsonl'),JSON.stringify(event)+'\n');if(type!=='snapshot')console.log(JSON.stringify(event));}
function sample(name,value){const a=samples[name];a.push(value);if(a.length>20000)a.splice(0,10000);}
function summary(a){const s=a.slice().sort((a,b)=>a-b);return {n:s.length,p95:s[Math.floor(s.length*.95)]||0,p99:s[Math.floor(s.length*.99)]||0,max:s.at(-1)||0};}
function save(){Object.assign(stats,{updatedAt:new Date().toISOString(),state:stopping?'stopping':phase,connected:clients.filter(c=>c.room?.connection.isOpen&&c.snapshot).length,inputs:clients.reduce((n,c)=>n+c.sent,0),pending:clients.reduce((n,c)=>n+c.pending.size,0),metrics:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,summary(v)]))});writeFileSync(resolve(directory,'status.json'),JSON.stringify(stats,null,2)+'\n');}
async function diagnostics(reason){
 if(diagnosticBusy)return;diagnosticBusy=true;
 try{
  const {stdout}=await run('ssh',[...ssh,'cd /Users/cheng80/Servers/pixeltown-minimal/app && python3 .test-work/live-diagnostics.py '+diagnosticKey],{timeout:25000,maxBuffer:1000000});
  const data=JSON.parse(stdout),file='diagnostics-'+(++diagnosticNumber)+'.json';
  writeFileSync(resolve(directory,file),JSON.stringify({reason,collectedAt:new Date().toISOString(),...data},null,2),{mode:0o600});
  stats.lastDiagnostics={file,at:data.at,services:data.services,players:data.health?.players};
  log('diagnostics-captured',{reason,file,gamePid:data.services?.['com.fastmake.pixeltown.minimal.colyseus']?.pid,players:data.health?.players,logLines:data.logs.reduce((n,l)=>n+(l.lines?.length||0),0)});
 }catch(error){log('diagnostics-failed',{reason,message:error.message.slice(0,300)});}finally{diagnosticBusy=false;}
}
function connectionDetail(c,room){const me=c.snapshot?.players.find(p=>p.id===c.id);return {bot:c.index,roomId:room.roomId,sessionId:room.sessionId,lastSnapshotAt:c.lastSeen?new Date(c.lastSeen).toISOString():null,snapshotAgeMs:c.lastSeen?Date.now()-c.lastSeen:null,seq:c.seq,ack:me?.ack,fix:me?.fix,position:me?{x:me.x,y:me.y}:null,pending:c.pending.size,deployment:c.snapshot?.deployment,lastDeployment:stats.lastDeployment?.generation,eventLoopLagMs:stats.eventLoopLagMs};}
function stop(reason){if(stopping)return;stopping=true;log('stop-request',{reason});save();}
process.on('SIGTERM',()=>stop('SIGTERM'));process.on('SIGINT',()=>stop('SIGINT'));
stopTimer=setInterval(()=>{if(existsSync(resolve(directory,'STOP')))stop('STOP file');},1000);
async function health(){return(await fetch(base+'/health',{signal:AbortSignal.timeout(15000)})).json();}
async function connect(c){
 if(c.connecting||stopping)return;c.connecting=true;
 try{
  const sdk=new Client(base.replace('https:','wss:'));sdk.auth.token=c.token;
  const room=await sdk.joinOrCreate('minimal-town',{zone:'lobby'});
  if(stopping){await room.leave();return;}
  const rejoin=!!c.initialSession;room.reconnection.maxRetries=0;c.room=room;c.snapshot=null;c.pos=null;c.pending.clear();c.seq=0;c.fix=0;c.lastSnapshot=0;c.goal=null;c.nextJoinAt=0;
  c.initialSession ||= room.sessionId;
  if(rejoin){stats.rejoins++;log('bot-rejoined',{bot:c.index,roomId:room.roomId,sessionId:room.sessionId,previousSession:c.lastSession});}c.lastSession=room.sessionId;
  let departed=false;
  const dropped=(kind,code,reason)=>{if(c.room!==room||departed||stopping)return;departed=true;stats.drops++;c.nextJoinAt=Date.now()+16000;log('bot-disconnected',{...connectionDetail(c,room),kind,code,reason});c.snapshot=null;save();void health().then(h=>log('health-after-drop',{players:h.players,worker:h.worker,persistence:h.persistence})).catch(e=>log('health-after-drop-failed',{message:e.message}));void diagnostics('disconnect-bot-'+c.index);};
  room.onDrop((code,reason)=>dropped('drop',code,reason));room.onLeave((code,reason)=>dropped('leave',code,reason));room.onError((code,message)=>{if(stopping)return;stats.errors++;log('bot-error',{...connectionDetail(c,room),code,message});void diagnostics('error-bot-'+c.index);});
  const wire=room.connection.transport.ws;
  wire?.on('close',(code,reason)=>{if(!stopping)log('socket-close',{...connectionDetail(c,room),code,reason:reason.toString().slice(0,300)});});
  wire?.on('error',error=>{if(!stopping)log('socket-error',{...connectionDetail(c,room),message:error.message});});
  room.onMessage('deployment',d=>{if(c.index===0)log('server-deployment',d);});room.onMessage('featureUnavailable',()=>{});
  room.onMessage('gameEnded',m=>{if(!c.matches.has(m.match_id)){c.matches.add(m.match_id);c.awarded+=(m.scores[c.id]||0);stats.settlements++;if(c.matches.size>100)c.matches.delete(c.matches.values().next().value);}});
  room.onMessage('snapshot',s=>{
   if(c.room!==room||(stopping&&!draining))return;const now=performance.now(),me=s.players.find(p=>p.id===c.id);if(!me)return;
   if(c.lastSnapshot)sample('snapshots',now-c.lastSnapshot);c.lastSnapshot=now;c.lastSeen=Date.now();
   for(const [seq,at]of c.pending)if(seq<=me.ack){sample('acks',now-at);c.pending.delete(seq);}
   if(c.snapshot){const old=c.snapshot.players.find(p=>p.id===c.id);if(old&&me.fix===old.fix&&(me.ack<old.ack||Math.hypot(me.x-old.x,me.y-old.y)>6*(me.ack-old.ack)+.02)){stats.continuityErrors++;log('continuity-error',{bot:c.index});}if(s.game.id===c.snapshot.game.id&&(s.game.scores[c.id]||0)<(c.snapshot.game.scores[c.id]||0)){stats.continuityErrors++;log('score-rollback',{bot:c.index});}stats.pickups+=Math.max(0,(s.game.id===c.snapshot.game.id?(s.game.scores[c.id]||0)-(c.snapshot.game.scores[c.id]||0):0));}
   if(!c.pos||me.fix!==c.fix){if(c.pos){stats.fixes++;log('server-correction',{bot:c.index,fix:me.fix});}c.pos={x:me.x,y:me.y};c.fix=me.fix;c.seq=Math.max(c.seq,me.ack);c.pending.clear();}
   c.snapshot=s;
  });
  const until=Date.now()+15000;while(!c.snapshot&&!stopping&&Date.now()<until)await sleep(25);
  if(!c.snapshot&&!stopping){await room.leave();throw Error('Snapshot timeout');}
 }catch(error){c.nextJoinAt=Date.now()+16000;log('join-failed',{bot:c.index,code:error.code,message:error.message});}
 finally{c.connecting=false;}
}
function randomGoal(){let goal;do{goal={x:16+Math.random()*608,y:16+Math.random()*368};}while(blocked(goal.x,goal.y));return goal;}
function move(){
 if(stopping)return;const tickAt=performance.now();stats.eventLoopLagMs=Math.max(0,tickAt-lastMovement-50);lastMovement=tickAt;stats.maxEventLoopLagMs=Math.max(stats.maxEventLoopLagMs||0,stats.eventLoopLagMs);if(stats.eventLoopLagMs>500)log('runner-timer-stall',{lagMs:stats.eventLoopLagMs});const claimed=new Set();
 for(const c of clients){
  if(!c.room?.connection.isOpen||!c.snapshot||!c.pos)continue;
  if(Date.now()-c.lastSeen>8000)continue; // Keep bounded outstanding input during a real outage.
  const now=performance.now();let goal;
  if(c.index<collectors){
   const stars=c.snapshot.game.stars.filter(s=>!claimed.has(s.id));
   c.goal=stars.find(s=>s.id===c.goal?.id)||stars.slice().sort((a,b)=>Math.hypot(a.x-c.pos.x,a.y-c.pos.y)-Math.hypot(b.x-c.pos.x,b.y-c.pos.y))[0];
   if(c.goal)claimed.add(c.goal.id);
   goal=c.goal;
  }
  if(!goal){
   if(now<(c.restUntil||0))continue;
   if(!c.walkGoal||Math.hypot(c.walkGoal.x-c.pos.x,c.walkGoal.y-c.pos.y)<1||now>c.goalUntil){
    if(c.walkGoal&&Math.random()<.2){c.walkGoal=null;c.restUntil=now+500+Math.random()*2000;continue;}
    c.walkGoal=randomGoal();c.goalUntil=now+15000;
   }goal=c.walkGoal;
  }
  const next=stepToward(c.pos,waypoint(c.pos,goal));if(next.x===c.pos.x&&next.y===c.pos.y)continue;
  c.pos=next;const seq=++c.seq;c.sent++;c.pending.set(seq,performance.now());
  try{c.room.send('move',{...next,seq,fix:c.fix});}catch(error){log('send-failed',{bot:c.index,message:error.message});}
 }
}
try{
 const h=await health();assert.equal(h.hotSwap,true);assert(h.players+count<=h.capacity,'Insufficient room capacity; preserve real visitors');stats.externalPlayersAtStart=h.players;stats.startingRevision=h.worker.revision;
 log('starting',{directory,pid:process.pid,existingPlayers:h.players});
 await diagnostics('baseline');
 lastMovement=performance.now();movementTimer=setInterval(move,50);reportTimer=setInterval(()=>{const now=performance.now();stats.progressTimerLagMs=Math.max(0,now-lastProgress-30000);lastProgress=now;stats.memoryRssBytes=process.memoryUsage().rss;save();log('progress',{connected:stats.connected,inputs:stats.inputs,drops:stats.drops,fixes:stats.fixes,deployments:stats.deployments,pickups:stats.pickups,nextDeploymentAt:stats.nextDeploymentAt,eventLoopLagMs:stats.eventLoopLagMs,maxEventLoopLagMs:stats.maxEventLoopLagMs});void diagnostics('periodic');},30000);
 for(let i=0;i<count&&!stopping;i++){const c={index:i,id:accounts[i].id,token:accounts[i].token,seq:0,sent:0,pending:new Map(),matches:new Set(),awarded:0};clients.push(c);await connect(c);if((i+1)%10===0)log('joined',{count:clients.filter(c=>c.snapshot).length});}
 assert(clients.every(c=>c.snapshot)||stopping,'Not all bots joined');
 activityStarted=Date.now();phase='active';stats.activeAt=new Date(activityStarted).toISOString();let nextDeployment=activityStarted+intervalMs;stats.nextDeploymentAt=new Date(nextDeployment).toISOString();save();log('ready',{connected:stats.connected,nextDeploymentAt:stats.nextDeploymentAt});
 while(!stopping){
  const pauseDeployments=existsSync(resolve(directory,'PAUSE_DEPLOYMENTS'));
  if(pauseDeployments&&!stats.deploymentPaused){nextDeployment=Infinity;stats.deploymentPaused=true;stats.deploymentPausedAt=new Date().toISOString();stats.nextDeploymentAt=null;save();log('deployment-paused',{reason:'PAUSE_DEPLOYMENTS file; keep clients'});}
  if(!pauseDeployments&&stats.deploymentPaused){stats.deploymentPaused=false;nextDeployment=Date.now()+intervalMs;stats.nextDeploymentAt=new Date(nextDeployment).toISOString();save();log('deployment-resumed',{nextDeploymentAt:stats.nextDeploymentAt});}
  for(const c of clients)if(!c.connecting&&c.nextJoinAt&&Date.now()>=c.nextJoinAt)void connect(c);
  if(Date.now()-lastRefresh>86400000){lastRefresh=Date.now();for(const c of clients){try{const pb=new PocketBase(pbUrl);pb.authStore.save(c.token,{id:c.id});c.token=(await pb.collection('users').authRefresh()).token;accounts[c.index].token=c.token;}catch(error){log('token-refresh-failed',{bot:c.index,message:error.message});}}writeFileSync(resolve(directory,'accounts.json'),JSON.stringify(accounts),{mode:0o600});}
  if(!pauseDeployments&&Date.now()>=nextDeployment&&!deploying){
   deploying=true;phase='deploying';log('deployment-start',{number:stats.deployments+1});await diagnostics('before-deployment');
   if(stopping){deploying=false;break;}
   try{const result=await control('swap-'+Date.now());lastOwnRevision=result.revision;stats.deployments++;stats.lastDeployment=result;log('deployment-applied',result);}catch(error){stats.deploymentFailures++;log('deployment-failed',{message:error.message.slice(0,1000)});}
   await diagnostics('after-deployment');deploying=false;phase='active';nextDeployment+=intervalMs;if(nextDeployment<Date.now())nextDeployment=Date.now()+intervalMs;stats.nextDeploymentAt=new Date(nextDeployment).toISOString();save();
  }
  await sleep(500);
 }
}catch(error){stats.fatalError=error.stack;log('runner-error',{message:error.message});process.exitCode=1;}
finally{
 stopping=true;clearInterval(movementTimer);clearInterval(reportTimer);clearInterval(stopTimer);
 draining=true;const drain=Date.now()+5000;while(clients.some(c=>c.pending.size)&&Date.now()<drain)await sleep(50);stats.pendingAfterDrain=clients.reduce((n,c)=>n+c.pending.size,0);draining=false;
 await Promise.allSettled(clients.filter(c=>c.room?.connection.isOpen).map(c=>c.room.leave()));
 try{const h=await health();if(lastOwnRevision&&h.worker.revision===lastOwnRevision){stats.restore=await control('restore');log('original-worker-restored',stats.restore);}else if(lastOwnRevision)log('restore-skipped',{reason:'Another release is active; preserve it'});stats.ledger=await control('verify');log('ledger-verified',stats.ledger);}catch(error){stats.cleanupError=error.message;log('cleanup-error',{message:error.message});}
 save();stats.state=stats.fatalError?'failed':'stopped';stats.stoppedAt=new Date().toISOString();writeFileSync(resolve(directory,'status.json'),JSON.stringify(stats,null,2)+'\n');if(existsSync(lock)&&JSON.parse(readFileSync(lock)).pid===process.pid)unlinkSync(lock);log('stopped',{directory,deployments:stats.deployments,drops:stats.drops});
}
function waypoint(from,goal){
 const nodes=[from,goal,{x:248,y:128},{x:392,y:128},{x:248,y:240},{x:392,y:240}],distances=nodes.map(()=>Infinity),paths=nodes.map(()=>[]),used=new Set();distances[0]=0;
 const visible=(a,b)=>{const n=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/2);for(let k=1;k<=n;k++)if(blocked(a.x+(b.x-a.x)*k/n,a.y+(b.y-a.y)*k/n))return false;return true;};
 for(let k=0;k<nodes.length;k++){let u=-1;for(let i=0;i<nodes.length;i++)if(!used.has(i)&&(u<0||distances[i]<distances[u]))u=i;if(u===1)return nodes[paths[u][0]]||goal;used.add(u);for(let v=1;v<nodes.length;v++)if(!used.has(v)&&visible(nodes[u],nodes[v])){const d=distances[u]+Math.hypot(nodes[u].x-nodes[v].x,nodes[u].y-nodes[v].y);if(d<distances[v]){distances[v]=d;paths[v]=[...paths[u],v];}}}return from;
}
