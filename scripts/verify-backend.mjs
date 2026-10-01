import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '../colyseus/node_modules/colyseus.js/lib/index.js';
import { adminClient, userClient } from '../colyseus/config.js';
const GAME_PORT=process.env.PIXELTOWN_GAME_PORT||12567;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(50);}throw Error('Verification timed out');}
const pb1=userClient(''),pb2=userClient('');
await pb1.collection('users').authWithPassword('demo1@pixeltown.local','PixelTown123!');
await pb2.collection('users').authWithPassword('demo2@pixeltown.local','PixelTown123!');
const rooms=[];
try {
  await assert.rejects(()=>new Client(`ws://127.0.0.1:${GAME_PORT}`).joinOrCreate('town',{token:'forged',zone:'lobby'}));
  const a=await new Client(`ws://127.0.0.1:${GAME_PORT}`).joinOrCreate('town',{token:pb1.authStore.token,zone:'lobby'});rooms.push(a);
  const b=await new Client(`ws://127.0.0.1:${GAME_PORT}`).joinOrCreate('town',{token:pb2.authStore.token,zone:'lobby'});rooms.push(b);
  let snapshot,chat,emote,ended;
  a.onMessage('snapshot',s=>snapshot=s);a.onMessage('chat',m=>chat=m);a.onMessage('emote',m=>emote=m);a.onMessage('gameEnded',m=>ended=m);
  b.onMessage('*',()=>{});
  await wait(()=>snapshot?.players.length===2);
  const start={...snapshot.players.find(p=>p.id===pb1.authStore.record.id)};
  a.send('input',{dx:1,dy:0});await sleep(220);
  const player=snapshot.players.find(p=>p.id===pb1.authStore.record.id);
  assert(player.x>start.x && player.x<=start.x+20);
  a.send('input',{dx:0,dy:0});
  b.send('chat',{text:'hello'});await wait(()=>chat);assert.equal(chat.id,pb2.authStore.record.id);
  a.send('emote',{});await wait(()=>emote);assert.equal(emote.id,pb1.authStore.record.id);
  a.send('startGame',{});await wait(()=>snapshot.game.active);const star=snapshot.game.stars.find(s=>Math.hypot(s.x-player.x,s.y-player.y)>50);
  if(star){a.send('collect',{id:star.id});await sleep(150);assert.equal(snapshot.game.scores[pb1.authStore.record.id],0);}
  await wait(()=>ended,65000);
  await wait(async()=>{const h=await(await fetch(`http://127.0.0.1:${GAME_PORT}/health`)).json();return h.persistence.pending===0;});
  const admin=await adminClient();
  const filter=admin.filter('match_id={:id}',{id:ended.match_id});
  assert.equal((await admin.collection('results').getFullList({filter})).length,2);
  assert.equal((await admin.collection('inventory').getFullList({filter})).length,2);
  await admin.send('/api/pixeltown/commit-match',{method:'POST',body:ended});
  assert.equal((await admin.collection('inventory').getFullList({filter})).length,2);
  await assert.rejects(()=>pb1.send('/api/pixeltown/commit-match',{method:'POST',body:ended}));
  await assert.rejects(()=>pb1.collection('results').create({user:pb1.authStore.record.id,match_id:randomUUID(),zone:'lobby',score:999,ended_at:new Date().toISOString()}));
  const rollback=randomUUID();
  await assert.rejects(()=>admin.send('/api/pixeltown/commit-match',{method:'POST',body:{...ended,match_id:rollback,scores:{[pb1.authStore.record.id]:1,'invaliduser0000':1}}}));
  assert.equal((await admin.collection('results').getFullList({filter:admin.filter('match_id={:id}',{id:rollback})})).length,0);
  assert.equal((await admin.collection('inventory').getFullList({filter:admin.filter('match_id={:id}',{id:rollback})})).length,0);
  console.log(JSON.stringify({ok:true,checks:['PB login','forged token rejected','two real websocket players','movement','chat','emote','remote collect rejected','deadline','atomic results+inventory','idempotent replay','client commit/write rejected','transaction rollback']},null,2));
} finally {await Promise.all(rooms.map(r=>r.leave()));}
