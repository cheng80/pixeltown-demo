import test from 'node:test';
import assert from 'node:assert/strict';
import { Town, INITIAL_STARS, MAX_STARS, STAR_SPAWN_INTERVAL_MS, RECONNECT_SECONDS, MAX_QUEUED_INPUTS } from '../town.js';
const T=STAR_SPAWN_INTERVAL_MS;
import { outbox } from '../outbox.js';
// Never touch the real outbox directory from unit tests.
const queued=[];outbox.enqueue=m=>queued.push(m);outbox.flush=async()=>{};
import { getMap, blocked, starSpots, touchesStar } from '../../shared/world.js';
function room() {
  const r=Object.create(Town.prototype);r.map=getMap('lobby');
  r.players=new Map([['session',{id:'player',...r.map.spawn}]]);
  r.moveInputs=new Map();r.held=new Map();r.snapshot=()=>{};
  r.broadcast=()=>{};
  r.startGame(1000);return r;
}
test('ticks cap uncollected stars, collection frees one slot, IDs never repeat',()=>{
  const r=room();assert.equal(r.game.stars.length,INITIAL_STARS);
  const initialIDs=r.game.stars.map(s=>s.id);
  for(let i=1;i<=12;i++){r.tick(1000+i*STAR_SPAWN_INTERVAL_MS);assert(r.game.stars.length<=MAX_STARS);}
  assert.equal(r.game.stars.length,MAX_STARS);
  const counter=r.starCounter;
  const late=1000+13*T;r.tick(late);assert.equal(r.starCounter,counter);
  const target=r.game.stars[0];Object.assign(r.players.get('session'),{x:target.x+12,y:target.y});
  assert.equal(r.collectStar({sessionId:'session'},{id:target.id},late),true,'body box touches the star side');
  r.game.stars.unshift(target);r.game.scores.player=0;Object.assign(r.players.get('session'),{x:target.x+13,y:target.y});
  assert.equal(r.collectStar({sessionId:'session'},{id:target.id},late),false,'one dot past the star side');
  Object.assign(r.players.get('session'),{x:target.x,y:target.y});
  assert.equal(r.collectStar({sessionId:'session'},{id:target.id},late+1),true);
  assert.equal(r.game.stars.length,11);assert.equal(r.game.scores.player,1);
  assert.equal(r.collectStar({sessionId:'session'},{id:target.id},late+2),false);
  r.tick(late+2);assert.equal(r.game.stars.length,11);
  r.tick(late+T);assert.equal(r.game.stars.length,12);
  assert.equal(r.starCounter,counter+1);assert(!r.game.stars.some(s=>s.id===initialIDs[0]));
  assert.equal(new Set(r.game.stars.map(s=>s.id)).size,12);
  assert(r.game.stars.every(s=>!blocked(r.map,s.x,s.y)));
  const spots=starSpots(r.map);assert(r.game.stars.every(s=>spots.some(p=>p.x===s.x&&p.y===s.y)));
});
test('hitbox: the body touching the drawn star counts, the tick picks it up without a client request',()=>{
  const r=room(),p=r.players.get('session'),star=r.game.stars[0],touch=(dx,dy)=>touchesStar({x:star.x+dx,y:star.y+dy},star);
  assert.equal(touch(0,21),true,'head under the star');assert.equal(touch(0,22),false);
  assert.equal(touch(0,-15),true,'feet just behind the star');assert.equal(touch(0,-16),false);
  assert.equal(touch(-13,0),true);assert.equal(touch(-14,0),false);
  Object.assign(p,{x:star.x+10,y:star.y+18});r.tick(1001);
  assert(!r.game.stars.some(s=>s.id===star.id),'picked up on tick');assert.equal(r.game.scores.player,1);
  const far=r.game.stars[0];Object.assign(p,{x:far.x+40,y:far.y});r.tick(1002);
  assert(r.game.stars.some(s=>s.id===far.id),'out of reach stays');
});
test('empty field stays active, other zone is independent, settlement keeps the event running',()=>{
  const r=room(),other=room();
  for(const star of [...r.game.stars]) {
    Object.assign(r.players.get('session'),{x:star.x,y:star.y});
    assert.equal(r.collectStar({sessionId:'session'},{id:star.id},1001),true);
  }
  assert.equal(r.game.stars.length,0);assert.equal(r.game.active,true);assert.equal(r.finished,undefined);
  assert.equal(other.game.stars.length,5);
  r.tick(1000+T);assert.equal(r.game.stars.length,1);
  const carried=r.game.stars.map(s=>s.id),firstMatch=r.matchId,sent=[];r.broadcast=(t,m)=>sent.push([t,m]);
  r.tick(r.game.endsAt);
  assert.equal(r.game.active,true,'event continues after settlement');assert.notEqual(r.matchId,firstMatch);
  assert.equal(sent[0][0],'gameEnded');assert.deepEqual(sent[0][1].scores,{player:5});
  assert.equal(r.game.scores.player,0,'new period starts from zero');
  assert(carried.every(id=>r.game.stars.some(s=>s.id===id)),'stars stay on the map');assert.equal(r.game.stars.length,INITIAL_STARS);
  const quiet=room(),qs=[];quiet.broadcast=t=>qs.push(t);quiet.tick(quiet.game.endsAt);
  assert.equal(qs.includes('gameEnded'),false,'a period without points is not saved');assert.equal(quiet.game.active,true);
});
test('delayed tick does not burst spawn and total generation stays under persistence bound',()=>{
  const previous=process.env.GAME_DURATION_MS;process.env.GAME_DURATION_MS='60000';
  try {
    const r=room();r.tick(1000+4*T);assert.equal(r.game.stars.length,6);
    const running=room();
    const end=running.game.endsAt;
    for(let now=1100;now<end;now+=100) {
      for(const s of [...running.game.stars]) {
        Object.assign(running.players.get('session'),{x:s.x,y:s.y});
        running.collectStar({sessionId:'session'},{id:s.id},now);
      }
      running.tick(now);assert(running.game.stars.length<=MAX_STARS);
    }
    assert.equal(running.starCounter,5+Math.ceil((end-1000)/T)-1);assert(running.game.scores.player>=5);assert(running.game.scores.player<=64);
  } finally {if(previous===undefined)delete process.env.GAME_DURATION_MS;else process.env.GAME_DURATION_MS=previous;}
});

test('PocketBase hook accepts score >12 and rejects over-64 total',async()=>{
  const {readFileSync}=await import('node:fs');const {runInNewContext}=await import('node:vm');
  let handler,rows=[];
  class Record {constructor(collection){this.collection=collection;this.values={};}set(k,v){this.values[k]=v;}}
  runInNewContext(readFileSync(new URL('../../pocketbase/pb_hooks/matches.pb.js',import.meta.url),'utf8'),{
    routerAdd:(method,path,fn)=>{handler=fn;},$apis:{requireSuperuserAuth:()=>{},bodyLimit:()=>{}},
    BadRequestError:Error,Record,
    $app:{runInTransaction:fn=>{const pending=[];fn({findRecordById:()=>{},findRecordsByFilter:()=>[],findCollectionByNameOrId:n=>n,save:r=>pending.push(r)});rows.push(...pending);}}
  });
  const invoke=scores=>handler({requestInfo:()=>({body:{match_id:'12345678-1234-1234-1234-123456789012',zone:'garden',ended_at:new Date().toISOString(),scores}}),json:()=>({ok:true})});
  assert.equal(invoke({'abcdefghijklmno':13}).ok,true);assert.equal(rows[0].values.score,13);assert.equal(rows[1].values.quantity,13);
  assert.throws(()=>invoke({'abcdefghijklmno':65}));
  assert.throws(()=>invoke({'abcdefghijklmno':40,'ponmlkjihgfedcb':30}));
  assert.equal(rows.length,2);
});

test('a click route ends exactly on its target even when the client reacts late (network lag)',()=>{
  const r=room(),p=r.players.get('session'),target={x:p.x+10,y:p.y};
  assert(!blocked(r.map,target.x,target.y));
  // The client keeps sending the same input while it still sees an old position; the server must not walk past the target.
  for(let t=1;t<=8;t++){r.moveInputs.set('session',{queue:[{dx:1,dy:0,to:target,seq:t}],credit:0});r.tick(1000+t*50);}
  assert.deepEqual([p.x,p.y],[target.x,target.y]);
  // A stale direction is corrected toward the target, and `to` never makes a step longer than a normal one.
  const q={x:p.x-6,y:p.y-2};r.moveInputs.set('session',{queue:[{dx:0,dy:1,to:q,seq:9}],credit:0});const before={x:p.x,y:p.y};r.tick(2000);
  assert(p.x<before.x && Math.hypot(p.x-before.x,p.y-before.y)<=3.01);
});

test('inputs are one step each, acknowledged, and sending faster never moves faster',()=>{
  const r=room(),p=r.players.get('session'),e={queue:[],credit:1};r.moveInputs.set('session',e);
  let seq=0,consumed=0;const send=n=>{for(let i=0;i<n;i++)e.queue.push({dx:i%2?1:-1,dy:0,to:null,seq:++seq});if(e.queue.length>MAX_QUEUED_INPUTS)e.queue.splice(0,e.queue.length-MAX_QUEUED_INPUTS);};
  const tick=t=>{const before=e.queue.length;r.tick(t);consumed+=before-e.queue.length;};
  const x0=p.x;send(1);tick(1050);
  assert.equal(p.ack,1);assert(Math.abs(p.x-x0+3)<0.01,'one input = one 3-dot step');
  // A client flooding 4 inputs every tick for 10 s gets at most one step per 50 ms plus the 1 s burst allowance.
  consumed=0;for(let t=0;t<200;t++){send(4);tick(2000+t*50);}
  assert(consumed<=200+MAX_QUEUED_INPUTS,`consumed ${consumed} steps in 200 ticks`);
});

test('inputs that stall and then arrive in a burst are caught up at once (no backlog, no overflow)',()=>{
  const r=room(),e={queue:[],credit:1};r.moveInputs.set('session',e);let seq=0;
  // The server ticks every 50 ms; the client's 50 ms steps reach it in bursts of 12 every 600 ms.
  for(let t=1000,k=0;k<9;t+=50){if((t-1000)%600===0&&t>1000){for(let i=0;i<12;i++)e.queue.push({dx:0,dy:0,to:null,seq:++seq});r.tick(t);assert.equal(e.queue.length,0,`backlog ${e.queue.length} after burst ${k}`);k++;}else r.tick(t);}
  assert.equal(r.players.get('session').ack,seq);
});

test('a dropped player is kept for reconnection; a join refused in onJoin is not (its rejection crashed the server)',async()=>{
  const r=room(),held=[];r.allowReconnection=(c,s)=>{held.push([c.sessionId,s]);const d=Promise.reject(new Error('not joined'));d.reject=()=>{};return d;};
  r.moveInputs.set('session',{queue:[{dx:1,dy:0}],credit:1});
  r.onDrop({sessionId:'session'});r.onDrop({sessionId:'refused'});
  await new Promise(done=>setImmediate(done)); // a rejection escaping onDrop would fail the test as unhandled
  assert.deepEqual(held,[['session',RECONNECT_SECONDS]]);assert(r.players.has('session'),'avatar stays while it may come back');
  assert(!r.moveInputs.has('session'),'queued steps are dropped');
});

test('a reload replaces a dropped session of the same user that is still waiting to reconnect',()=>{
  const r=room();let rejected=0;r.allowReconnection=()=>{const d=new Promise(()=>{});d.reject=()=>rejected++;return d;};
  r.onDrop({sessionId:'session'});assert(r.held.has('session'));
  r.onJoin({sessionId:'fresh'},{},{id:'player',name:'P',look:{}});
  assert.equal(rejected,1);assert(!r.players.has('session'));assert(r.players.has('fresh'));
  assert.throws(()=>r.onJoin({sessionId:'third'},{},{id:'player',name:'P',look:{}}),/already joined/,'a live session still blocks a second tab');
});

test('steps follow real time, not tick count: late ticks (52 ms) never let a walking client fall behind',()=>{
  const r=room(),p=r.players.get('session'),x0=p.x;let seq=0,t=1000;
  // The client sends one step every 50 ms for 60 s; the server ticks every 52 ms.
  const e={queue:[],credit:1};r.moveInputs.set('session',e);
  for(let sent=0;t<61000;t+=52){while(sent*50<t-1000){e.queue.push({dx:1,dy:0,to:null,seq:++seq});sent++;}r.tick(t);}
  assert(e.queue.length<=2,`queued ${e.queue.length} steps behind`);
  assert(p.ack>=seq-2,'acknowledged up to the latest steps');
  assert(p.x-x0<=3*seq+0.01,'never more than one step per input');
});

