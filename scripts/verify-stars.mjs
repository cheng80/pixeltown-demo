// Owns an isolated PB (18091) and Colyseus (12568); never touches main processes/data.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { randomUUID, randomBytes } from 'node:crypto';
import PocketBase from '../colyseus/node_modules/pocketbase/dist/pocketbase.es.mjs';
import { Client } from '../colyseus/node_modules/colyseus.js/lib/index.js';
import { backendDir, pocketbaseDir, localDir } from '../colyseus/config.js';
import { seed } from './init-pocketbase.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(50);}throw Error('Star verification timeout');}
mkdirSync(localDir,{recursive:true});const temp=mkdtempSync(localDir+'verify-stars-');
const pbURL='http://127.0.0.1:18091',port=12568;
let child,pbChild,room,logs='',latest,maxObserved=0,ended=false;
async function stop(child){if(child?.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),sleep(7000)]);if(child.exitCode===null){child.kill('SIGKILL');await once(child,'exit');}}}
try {
  // Refuse occupied verification ports before opening an independent SQLite DB.
  const {createServer}=await import('node:net');
  for(const port of [18091,12568])await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
  const email='verification@pixeltown.local',password=randomBytes(24).toString('hex');
  const envFile=temp+'/admin.env';writeFileSync(envFile,`PB_ADMIN_EMAIL=${email}\nPB_ADMIN_PASSWORD=${password}\n`,{mode:0o600});
  execFileSync(localDir+'pocketbase',['superuser','upsert',email,password,'--dir',temp+'/data'],{stdio:'pipe'});
  pbChild=spawn(localDir+'pocketbase',['serve','--http=127.0.0.1:18091','--dir',temp+'/data','--hooksDir',pocketbaseDir+'pb_hooks','--automigrate=0'],{stdio:'ignore'});
  await wait(async()=>{try{return(await fetch(pbURL+'/api/health')).ok;}catch{return false;}},5000);
  const admin=new PocketBase(pbURL);admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(email,password);await seed(admin);
  const pb=new PocketBase(pbURL);await pb.collection('users').authWithPassword('demo1@pixeltown.local','PixelTown123!');
  const metadata=await pb.collection('rooms').getFullList({sort:'-created'});
  assert.deepEqual(metadata.map(r=>r.zone).sort(),['arcade','garden','lobby']);assert(metadata.every(r=>r.max_players===32));
  assert.equal((await new PocketBase(pbURL).collection('rooms').getFullList()).length,0);
  await assert.rejects(()=>pb.collection('rooms').update(metadata[0].id,{max_players:1}));
  child=spawn(process.execPath,['server.js'],{cwd:backendDir,env:{...process.env,PB_URL:pbURL,SERVER_HOST:'127.0.0.1',SERVER_PORT:String(port),GAME_DURATION_MS:'30000',OUTBOX_PATH:temp+'/outbox',PIXELTOWN_ENV_FILE:envFile},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
  await wait(()=>logs.includes(`ws://127.0.0.1:${port}`)|| (child.exitCode!==null && assert.fail(logs)),5000);
  room=await new Client(`ws://127.0.0.1:${port}`).joinOrCreate('town',{token:pb.authStore.token,zone:'garden'});
  room.onMessage('snapshot',s=>{latest=s;maxObserved=Math.max(maxObserved,s.game.stars.length);});
  room.onMessage('gameEnded',()=>ended=true);
  room.send('startGame',{});await wait(()=>latest?.game.active);
  assert.equal(latest.game.stars.length,5);
  const collectID=latest.game.stars[0].id;
  await wait(()=>latest.game.stars.length===12);
  const cappedIDs=latest.game.stars.map(s=>s.id);
  await sleep(3100);assert.equal(latest.game.stars.length,12);assert.deepEqual(latest.game.stars.map(s=>s.id),cappedIDs);
  room.send('collect',{id:collectID});await wait(()=>latest.game.stars.length===11);
  assert.equal(latest.game.scores[pb.authStore.record.id],1);
  await wait(()=>latest.game.stars.length===12,2500);
  assert(!latest.game.stars.some(s=>s.id===collectID));assert.equal(new Set(latest.game.stars.map(s=>s.id)).size,12);
  assert.equal(maxObserved,12);assert.equal(ended,false);
  const commit={match_id:randomUUID(),zone:'garden',ended_at:new Date().toISOString(),scores:{[pb.authStore.record.id]:13}};
  await admin.send('/api/pixeltown/commit-match',{method:'POST',body:commit});
  const saved=await pb.collection('results').getFirstListItem(pb.filter('match_id={:id}',{id:commit.match_id}));assert.equal(saved.score,13);
  await assert.rejects(()=>admin.send('/api/pixeltown/commit-match',{method:'POST',body:{...commit,match_id:randomUUID(),scores:{[pb.authStore.record.id]:65}}}));
  const report={ok:true,checkedAt:new Date().toISOString(),initial:5,cap:12,intervalMs:1500,maxObserved,capStableForTwoPeriods:true,collectFreedSlot:true,resumedGeneration:true,uniqueIDs:true,activeUntilTimer:true,score13Persisted:true,score65Rejected:true,roomsMetadataAndACL:true,mainProcessesTouched:false,mainDatabaseWrites:false,serverPort:port,pbPort:18091};
  console.log(JSON.stringify(report,null,2));writeFileSync(backendDir+'verification-stars.json',JSON.stringify(report,null,2)+'\n');
} finally {
  if(room)await room.leave();await stop(child);await stop(pbChild);
  rmSync(temp,{recursive:true,force:true});
}
