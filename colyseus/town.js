import { Room, ServerError } from '@colyseus/core';
import { randomUUID, randomInt } from 'node:crypto';
import { userClient, ZONES } from './config.js';
import { outbox } from './outbox.js';
import { getMap, blocked, moveActor, entryPoint, starSpots, COLLECT_RADIUS, STEP_PER_TICK, TICK_MS } from '../shared/world.js';
// Random reachable, uncovered spot that is not right on top of another star.
function starPosition(map,stars){
  const spots=starSpots(map);
  for(let n=0;n<50;n++){const s=spots[randomInt(spots.length)];if(!stars.some(t=>Math.hypot(t.x-s.x,t.y-s.y)<24))return {...s};}
  return {...spots[randomInt(spots.length)]};
}
export const INITIAL_STARS=5;
export const MAX_STARS=12;
export const STAR_SPAWN_INTERVAL_MS=1500;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export class Town extends Room {
  onCreate(options) {
    if(!ZONES.includes(options.zone))throw new ServerError(400,'Invalid zone');
    this.zone=options.zone;this.map=getMap(this.zone);this.maxClients=32;this.maxMessagesPerSecond=40;
    this.players=new Map();this.inputs=new Map();this.cooldowns=new Map();
    this.game={active:false,endsAt:0,stars:[],scores:{}};
    this.setMetadata({zone:this.zone});
    this.onMessage('input',(client,data)=>{
      if(!data || !Number.isFinite(data.dx) || !Number.isFinite(data.dy))return;
      let dx=clamp(data.dx,-1,1),dy=clamp(data.dy,-1,1);const len=Math.hypot(dx,dy);
      if(len>1){dx/=len;dy/=len;}
      this.inputs.set(client.sessionId,{dx,dy,at:Date.now()});
    });
    this.onMessage('chat',(client,data)=>{
      if(typeof data?.text!=='string' || !this.allow(client,'chat',700))return;
      const text=data.text.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,240);
      const p=this.players.get(client.sessionId);
      if(text && p)this.broadcast('chat',{id:p.id,name:p.name,text,at:Date.now()});
    });
    this.onMessage('emote',client=>{
      const p=this.players.get(client.sessionId);
      if(p && this.allow(client,'emote',1000))this.broadcast('emote',{id:p.id,emote:'wave',at:Date.now()});
    });
    this.onMessage('startGame',client=>{
      if(this.game.active || !this.players.has(client.sessionId) || !this.allow(client,'start',2000))return;
      this.startGame();
    });
    this.onMessage('collect',(client,data)=>{
      this.collectStar(client,data);
    });
    this.setSimulationInterval(()=>this.tick(),TICK_MS);
    this.onPersistence=()=>this.snapshot();outbox.on('change',this.onPersistence);
  }
  startGame(now=Date.now()) {
    this.matchId=randomUUID();this.starCounter=0;
    const duration=clamp(Number(process.env.GAME_DURATION_MS)||30000,1000,60000);
    this.game={active:true,endsAt:now+duration,stars:[],scores:Object.fromEntries([...this.players.values()].map(p=>[p.id,0]))};
    for(let i=0;i<INITIAL_STARS;i++)this.spawnStar();
    this.nextStarAt=now+STAR_SPAWN_INTERVAL_MS;
    this.snapshot();
  }
  spawnStar() {
    if(!this.game.active || this.game.stars.length>=MAX_STARS)return false;
    this.game.stars.push({id:`${this.matchId}:${this.starCounter++}`,...starPosition(this.map,this.game.stars)});
    return true;
  }
  generateStars(now) {
    if(!this.game.active || now>=this.game.endsAt || now<this.nextStarAt)return;
    // One opportunity per tick; blocked or missed periods never accumulate a burst.
    this.nextStarAt=now+STAR_SPAWN_INTERVAL_MS;
    this.spawnStar();
  }
  collectStar(client,data,now=Date.now()) {
    if(!this.game.active || now>=this.game.endsAt || typeof data?.id!=='string')return false;
    const p=this.players.get(client.sessionId),index=this.game.stars.findIndex(s=>s.id===data.id);
    if(!p || index<0 || !(p.id in this.game.scores))return false;
    const star=this.game.stars[index];
    if(Math.hypot(p.x-star.x,p.y-star.y)>COLLECT_RADIUS)return false;
    this.game.stars.splice(index,1);this.game.scores[p.id]=(this.game.scores[p.id]||0)+1;
    this.snapshot();return true;
  }
  async onAuth(client,options) {
    if(options.zone!==this.zone || typeof options.token!=='string')throw new ServerError(401,'Authentication required');
    const pb=userClient(options.token);
    try {
      const {record}=await pb.collection('users').authRefresh();
      const metadata=await pb.collection('rooms').getFirstListItem(pb.filter('zone={:zone}',{zone:options.zone}));
      if(metadata.zone!==this.zone || metadata.max_players!==32)throw new Error('Invalid room metadata');
      const profile=await pb.collection('profiles').getFirstListItem(pb.filter('user={:id}',{id:record.id}));
      return {pb,id:record.id,name:profile.name||record.name||'Player',color:profile.color,title:metadata.title};
    } catch {throw new ServerError(401,'Invalid PocketBase token or profile');}
  }
  onJoin(client,options,auth) {
    if([...this.players.values()].some(p=>p.id===auth.id))throw new ServerError(409,'User already joined this zone');
    const base=entryPoint(this.map,typeof options?.entry==='string'?options.entry:'default');
    // Arrivals step aside so avatars and name tags do not stack on the same doorway.
    const at=[[0,0],[16,0],[-16,0],[0,12],[16,12],[-16,12],[0,-12]].map(([dx,dy])=>({x:base.x+dx,y:base.y+dy}))
      .find(q=>!blocked(this.map,q.x,q.y)&&![...this.players.values()].some(o=>Math.hypot(o.x-q.x,o.y-q.y)<12))||base;
    this.players.set(client.sessionId,{id:auth.id,name:auth.name,x:at.x,y:at.y,color:auth.color});
    if(this.game.active && !(auth.id in this.game.scores) && Object.keys(this.game.scores).length<64)this.game.scores[auth.id]=0;
    this.snapshot();
  }
  allow(client,type,interval) {
    const key=client.sessionId+':'+type,now=Date.now();
    if(now-(this.cooldowns.get(key)||0)<interval)return false;
    this.cooldowns.set(key,now);return true;
  }
  tick(now=Date.now()) {
    for(const [session,p] of this.players) {
      const input=this.inputs.get(session);
      if(input && now-input.at<=300 && (input.dx || input.dy)) Object.assign(p,moveActor(this.map,p.x,p.y,input.dx,input.dy,STEP_PER_TICK));
    }
    if(this.game.active && now>=this.game.endsAt)this.finish();
    else this.generateStars(now);
    this.snapshot();
  }
  finish() {
    if(!this.game.active)return;
    const match={match_id:this.matchId,zone:this.zone,ended_at:new Date().toISOString(),scores:{...this.game.scores}};
    // Keep active until disk commit succeeds, so a write failure is retried next tick.
    try {outbox.enqueue(match);} catch {return;}
    this.game.active=false;this.game.stars=[];
    this.broadcast('gameEnded',match);void outbox.flush();
  }
  snapshot() {this.broadcast('snapshot',{players:[...this.players.values()],zone:this.zone,game:this.game,persistence:outbox.status()});}
  onLeave(client) {
    this.players.delete(client.sessionId);this.inputs.delete(client.sessionId);
    for(const key of this.cooldowns.keys())if(key.startsWith(client.sessionId+':'))this.cooldowns.delete(key);
    if(!this.players.size && this.game.active)this.finish();
    this.snapshot();
  }
  onDispose() {if(this.game.active)this.finish();outbox.off('change',this.onPersistence);}
}
