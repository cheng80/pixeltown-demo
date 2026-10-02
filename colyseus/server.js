// One entry for the local launcher and the Mac mini service (launchd runs it through server.mjs with --env-file=.env).
import http from 'node:http';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import { Town, connectionSummary } from './town.js';
import { outbox } from './outbox.js';
import { PB_URL, userClient } from './config.js';
import { pocketbaseAdminGuard } from './monitor-auth.js';

const port=Number(process.env.SERVER_PORT||process.env.PORT)||12567;
const host=process.env.SERVER_HOST||'127.0.0.1';
// Exact browser origins only (no wildcard). Requests without Origin (node clients, curl, health probes) pass; auth still applies.
const origins=new Set((process.env.ALLOWED_ORIGINS||'https://pixeltown.fastmake.net').split(',').map(x=>x.trim()).filter(Boolean));
const allowed=origin=>!origin||origins.has(origin);
const monitorOrigins=new Set((process.env.MONITOR_ORIGINS||`https://pixeltown-rt.fastmake.net,http://127.0.0.1:${port},http://localhost:${port}`).split(',').map(x=>x.trim()));

const app=express();
app.disable('x-powered-by');
app.use((req,res,next)=>{
  if(!allowed(req.headers.origin))return res.status(403).json({error:'Origin not allowed'});
  if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  if(req.method==='OPTIONS')return res.sendStatus(204);
  next();
});
// The outbox superuser in .env is a service account: it saves results but may not open the monitor.
const monitorDenied=new Set([process.env.PB_ADMIN_EMAIL].filter(Boolean).map(e=>e.toLowerCase()));
app.use('/monitor',pocketbaseAdminGuard(PB_URL,monitorOrigins,monitorDenied),monitor({prefix:'/monitor'}));
app.get('/health',(_req,res)=>res.json({ok:true,service:'pixeltown-colyseus',persistence:outbox.status(),connections:connectionSummary()}));
app.get('/health/pocketbase',async(_req,res)=>{
  try {
    const r=await fetch(`${PB_URL}/api/health`,{signal:AbortSignal.timeout(5000)});
    if(!r.ok)throw new Error();
    res.json({ok:true,pocketbase:'connected'});
  } catch {res.status(503).json({ok:false,pocketbase:'unavailable'});}
});
app.get('/me',async(req,res)=>{
  try {
    const token=req.headers.authorization?.replace(/^Bearer\s+/i,'');
    if(typeof token!=='string'||!token||token.length>8192)throw new Error();
    const {record}=await userClient(token).collection('users').authRefresh();
    res.json({id:record.id,name:record.name||'Player'});
  } catch {res.status(401).json({error:'PocketBase user login required'});}
});

const httpServer=http.createServer(app);
const server=new Server({transport:new WebSocketTransport({server:httpServer,maxPayload:8192,verifyClient:info=>allowed(info.origin)}),greet:false,gracefullyShutdown:false});
server.define('town',Town).filterBy(['zone']);
await server.listen(port,host);
console.log(`Colyseus: ws://${host}:${port} (town: lobby/garden/arcade)`);
void outbox.flush();const retry=setInterval(()=>void outbox.flush(),2000);
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(retry);await server.gracefullyShutdown(false);await outbox.flush();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
