import { Room, ServerError } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import { userClient, ZONES } from './config.js';
import { outbox } from './outbox.js';
import { getMap, blocked, moveActor, entryPoint, spreadSpot, COLLECT_RADIUS, STAR_SPAWN_MS, ITEMS, STEP_PER_TICK, TICK_MS } from '../shared/world.js';
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
// Outfit shown to everyone comes from the PocketBase profile (written only by the shop hook), never from the client.
export const lookOf=profile=>{const o=profile?.outfit||{};return Object.fromEntries(['hat','top','pet'].map(s=>[s,ITEMS[o[s]]?.slot===s?o[s]:null]));};
export const INITIAL_STARS=5;
export const MAX_STARS=12;
export const MAX_MATCH_SCORE=64; // PocketBase hook limit per settlement
export const STAR_SPAWN_INTERVAL_MS=clamp(Number(process.env.STAR_SPAWN_INTERVAL_MS)||STAR_SPAWN_MS,1000,60000);
// The star event never stops; scores are settled (saved) every period and the next period starts right away.
const settlePeriod=()=>clamp(Number(process.env.GAME_DURATION_MS)||180000,1000,300000);
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
    this.lookJobs=new Map();
    this.onMessage('look',client=>this.refreshLook(client));
    this.onMessage('collect',(client,data)=>{
      this.collectStar(client,data);
    });
    this.setSimulationInterval(()=>this.tick(),TICK_MS);
    this.onPersistence=()=>this.snapshot();outbox.on('change',this.onPersistence);
  }
  // Re-read the outfit from PocketBase. Requests while one is in flight coalesce into one more read.
  async refreshLook(client) {
    if(!this.players.has(client.sessionId))return;
    if(this.lookJobs.has(client.sessionId)){this.lookJobs.set(client.sessionId,true);return;}
    this.lookJobs.set(client.sessionId,false);
    try {
      do {
        this.lookJobs.set(client.sessionId,false);
        const p=this.players.get(client.sessionId),pb=client.auth.pb;
        if(!p)break;
        p.look=lookOf(await pb.collection('profiles').getFirstListItem(pb.filter('user={:id}',{id:p.id})));
      } while(this.lookJobs.get(client.sessionId));
      this.snapshot();
    } catch {} finally {this.lookJobs.delete(client.sessionId);}
  }
  startGame(now=Date.now(),carry=[]) {
    this.matchId=randomUUID();this.starCounter=0;
    this.game={id:this.matchId,active:true,endsAt:now+settlePeriod(),stars:carry,scores:Object.fromEntries([...this.players.values()].map(p=>[p.id,0]))};
    while(this.game.stars.length<INITIAL_STARS)this.spawnStar();
    this.nextStarAt=now+STAR_SPAWN_INTERVAL_MS;
    this.snapshot();
  }
  spawnStar() {
    if(!this.game.active || this.game.stars.length>=MAX_STARS)return false;
    this.game.stars.push({id:`${this.matchId}:${this.starCounter++}`,...spreadSpot(this.map,[...this.game.stars,...this.players.values()])});
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
    if(Object.values(this.game.scores).reduce((a,b)=>a+b,0)>=MAX_MATCH_SCORE)return false; // settlement write pending
    const star=this.game.stars[index];
    if(Math.hypot(p.x-star.x,p.y-star.y)>COLLECT_RADIUS)return false;
    this.game.stars.splice(index,1);this.game.scores[p.id]=(this.game.scores[p.id]||0)+1;
    if(Object.values(this.game.scores).reduce((a,b)=>a+b,0)>=MAX_MATCH_SCORE)this.settle(now);
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
      return {pb,id:record.id,name:profile.name||record.name||'Player',color:profile.color,look:lookOf(profile),title:metadata.title};
    } catch {throw new ServerError(401,'Invalid PocketBase token or profile');}
  }
  onJoin(client,options,auth) {
    if([...this.players.values()].some(p=>p.id===auth.id))throw new ServerError(409,'User already joined this zone');
    const base=entryPoint(this.map,typeof options?.entry==='string'?options.entry:'default');
    // Arrivals step aside so avatars and name tags do not stack on the same doorway.
    const at=[[0,0],[16,0],[-16,0],[0,12],[16,12],[-16,12],[0,-12]].map(([dx,dy])=>({x:base.x+dx,y:base.y+dy}))
      .find(q=>!blocked(this.map,q.x,q.y)&&![...this.players.values()].some(o=>Math.hypot(o.x-q.x,o.y-q.y)<12))||base;
    this.players.set(client.sessionId,{id:auth.id,name:auth.name,x:at.x,y:at.y,color:auth.color,look:auth.look});
    if(!this.game.active)this.startGame();
    else if(!(auth.id in this.game.scores) && Object.keys(this.game.scores).length<64)this.game.scores[auth.id]=0;
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
    if(this.game.active && now>=this.game.endsAt)this.settle(now);
    else this.generateStars(now);
    this.snapshot();
  }
  // Save this period and start the next one, keeping the stars on the map.
  settle(now) {
    const carry=this.game.stars;
    if(this.finish() && this.players.size)this.startGame(now,carry);
  }
  finish() {
    if(!this.game.active)return false;
    // Only players who collected something get a result row; an empty period is not saved.
    const scores=Object.fromEntries(Object.entries(this.game.scores).filter(([,s])=>s>0));
    const match={match_id:this.matchId,zone:this.zone,ended_at:new Date().toISOString(),scores};
    if(Object.keys(scores).length) {
      // Keep active until disk commit succeeds, so a write failure is retried next tick.
      try {outbox.enqueue(match);} catch {return false;}
      this.broadcast('gameEnded',match);void outbox.flush();
    }
    this.game.active=false;this.game.stars=[];
    return true;
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
