import test from 'node:test';
import assert from 'node:assert/strict';
import { Town, INITIAL_STARS, MAX_STARS, STAR_SPAWN_INTERVAL_MS } from '../town.js';
const T=STAR_SPAWN_INTERVAL_MS;
import { outbox } from '../outbox.js';
// Never touch the real outbox directory from unit tests.
const queued=[];outbox.enqueue=m=>queued.push(m);outbox.flush=async()=>{};
import { getMap, blocked, starSpots } from '../../shared/world.js';
function room() {
  const r=Object.create(Town.prototype);r.map=getMap('lobby');
  r.players=new Map([['session',{id:'player',...r.map.spawn}]]);
  r.inputs=new Map();r.snapshot=()=>{};
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
  const target=r.game.stars[0];Object.assign(r.players.get('session'),{x:target.x+15,y:target.y});
  assert.equal(r.collectStar({sessionId:'session'},{id:target.id},late),true,'within 16px');
  r.game.stars.unshift(target);r.game.scores.player=0;Object.assign(r.players.get('session'),{x:target.x+17,y:target.y});
  assert.equal(r.collectStar({sessionId:'session'},{id:target.id},late),false,'beyond 16px');
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
