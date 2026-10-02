import test from 'node:test';
import assert from 'node:assert/strict';
import { Town, INITIAL_STARS, MAX_STARS, STAR_SPAWN_INTERVAL_MS, RECONNECT_SECONDS, connectionSummary } from '../town.js';
const T=STAR_SPAWN_INTERVAL_MS;
import { outbox } from '../outbox.js';
// Never touch the real outbox directory from unit tests.
const queued=[];outbox.enqueue=m=>queued.push(m);outbox.flush=async()=>{};
import { getMap, blocked, starSpots, touchesStar, stepInput, findPath, MOVE_BURST_MS, MOVE_SLACK, STEP_PER_TICK, TICK_MS } from '../../shared/world.js';
function room() {
  const r=Object.create(Town.prototype);r.map=getMap('lobby');
  r.players=new Map([['session',{id:'player',...r.map.spawn,fix:0}]]);
  r.moves=new Map();r.held=new Map();r.dropped=new Set();r.cooldowns=new Map();r.zone='lobby';r.snapshot=()=>{};
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

const C={sessionId:'session'};
test('local-first movement: walking steps are accepted and acknowledged, impossible ones are sent back',()=>{
  const r=room(),p=r.players.get('session');let at={x:p.x,y:p.y},t=1000,seq=0;
  // A client walking a real route (with corner slides) at walking pace is never corrected.
  const path=findPath(r.map,at,{x:p.x+200,y:p.y+120});
  for(const w of path)for(let n=0;n<200&&Math.hypot(w.x-at.x,w.y-at.y)>=0.5;n++){at=stepInput(r.map,at,{dx:1,dy:0,to:w});r.move(C,{...at,seq:++seq,fix:0},t+=50);}
  assert.equal(p.fix,0);assert.deepEqual([p.x,p.y],[at.x,at.y]);assert.equal(p.ack,seq);
  // A teleport, a step into a wall and a report sent before the correction are all refused.
  r.move(C,{x:p.x+40,y:p.y,seq:++seq,fix:0},t+=50);assert.equal(p.fix,1);assert.deepEqual([p.x,p.y],[at.x,at.y]);
  r.move(C,{x:p.x+3,y:p.y,seq:++seq,fix:0},t+=50);assert.equal(p.fix,1,'stale report ignored');assert.deepEqual([p.x,p.y],[at.x,at.y]);
  const wall=[[3,0],[-3,0],[0,3],[0,-3]].map(([dx,dy])=>({x:p.x+dx,y:p.y+dy})).find(q=>blocked(r.map,q.x,q.y));
  if(wall){r.move(C,{...wall,seq:++seq,fix:1},t+=50);assert.equal(p.fix,2);}
  for(const bad of [{x:'1',y:2},{x:NaN,y:p.y},null,{x:p.x}])r.move(C,{...bad,fix:p.fix},t+=50);
  assert(Number.isFinite(p.x)&&Number.isFinite(p.y));
});
test('walking anywhere is never corrected: random key presses and click routes in every zone, pushing into walls',()=>{
  let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  for(const zone of ['lobby','garden','arcade']){
    const r=room();r.map=getMap(zone);const p=r.players.get('session');Object.assign(p,r.map.spawn);
    let at={x:p.x,y:p.y},t=1000,seq=0;
    for(let k=0;k<60;k++){
      if(k%2){const route=findPath(r.map,at,{x:rnd()*r.map.width,y:rnd()*r.map.height});
        for(const w of route)for(let n=0;n<300&&Math.hypot(w.x-at.x,w.y-at.y)>=0.5;n++){at=stepInput(r.map,at,{dx:1,dy:0,to:w});r.move(C,{...at,seq:++seq,fix:0},t+=50);}}
      else{const a=Math.floor(rnd()*8)*Math.PI/4;for(let n=0;n<40;n++){at=stepInput(r.map,at,{dx:Math.cos(a),dy:Math.sin(a)});r.move(C,{...at,seq:++seq,fix:0},t+=50);}}
    }
    assert.equal(p.fix,0,`${zone}: a walking step was refused`);assert(seq>1000);
  }
});
test('speed: reports in a burst after a stall pass, sending faster than walking does not',()=>{
  const r=room(),p=r.players.get('session');let t=1000,seq=0;
  // 2 s of 3-dot steps (40) stalled on the way, then arriving within a few ms: all accepted.
  r.move(C,{x:p.x+1,y:p.y,seq:++seq,fix:0},t);
  t+=2000;for(let i=0;i<40;i++){const q=stepInput(r.map,p,{dx:1,dy:0});r.move(C,{...q,seq:++seq,fix:p.fix},t+=1);}
  assert.equal(p.fix,0,'stall burst refused');
  // A cheat sending 6-dot hops (back and forth) 40 times a second for 10 s moves no farther than the allowance.
  const x1=p.x;assert(!blocked(r.map,x1+6,p.y));let moved=0;
  for(let i=0;i<400;i++){const from=p.x;r.move(C,{x:p.x===x1?x1+6:x1,y:p.y,seq:++seq,fix:p.fix},t+=25);moved+=Math.abs(p.x-from);}
  const allowance=STEP_PER_TICK*MOVE_SLACK*(MOVE_BURST_MS+10000)/TICK_MS;
  assert(moved<=allowance+0.01,`moved ${moved} > ${allowance}`);
});
test('a dropped player is kept for reconnection; a join refused in onJoin is not (its rejection crashed the server)',async()=>{
  const r=room(),held=[];r.allowReconnection=(c,s)=>{held.push([c.sessionId,s]);const d=Promise.reject(new Error('not joined'));d.reject=()=>{};return d;};
  r.onDrop({sessionId:'session'});r.onDrop({sessionId:'refused'});
  await new Promise(done=>setImmediate(done)); // a rejection escaping onDrop would fail the test as unhandled
  assert.deepEqual(held,[['session',RECONNECT_SECONDS]]);assert(r.players.has('session'),'avatar stays while it may come back');
});

test('a reload replaces a dropped session of the same user that is still waiting to reconnect',()=>{
  const r=room();let rejected=0;r.allowReconnection=()=>{const d=new Promise(()=>{});d.reject=()=>rejected++;return d;};
  r.onDrop({sessionId:'session'});assert(r.held.has('session'));
  r.onJoin({sessionId:'fresh'},{},{id:'player',name:'P',look:{}});
  assert.equal(rejected,1);assert(!r.players.has('session'));assert(r.players.has('fresh'));
  assert.throws(()=>r.onJoin({sessionId:'third'},{},{id:'player',name:'P',look:{}}),/already joined/,'a live session still blocks a second tab');
});

test('connection stats: a drop that comes back counts as reconnect, one that does not as lost',()=>{
  const r=room(),before=connectionSummary();r.allowReconnection=()=>{const d=new Promise(()=>{});d.reject=()=>{};return d;};
  r.players.set('other',{id:'p2',x:0,y:0});
  r.onDrop({sessionId:'session'},1006);r.onReconnect({sessionId:'session'});
  r.onDrop({sessionId:'other'},1006);r.onLeave({sessionId:'other'});
  r.onReconnect({sessionId:'never-dropped'});
  r.players.set('closing',{id:'p3',x:0,y:0});r.onDrop({sessionId:'closing'},1001);r.onLeave({sessionId:'closing'}); // tab closed: not a drop
  const after=connectionSummary();
  assert.deepEqual([after.drop1h-before.drop1h,after.reconnect1h-before.reconnect1h,after.lost1h-before.lost1h],[2,1,1]);
});

