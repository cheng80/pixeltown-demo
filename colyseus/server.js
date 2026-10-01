import http from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Town } from './town.js';
import { outbox } from './outbox.js';
const httpServer=http.createServer((req,res)=>{
  if(req.url==='/health') {res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,persistence:outbox.status()}));}
  else {res.writeHead(404);res.end();}
});
const server=new Server({transport:new WebSocketTransport({server:httpServer,maxPayload:8192}),greet:false,gracefullyShutdown:false});
server.define('town',Town).filterBy(['zone']);
const port=Number(process.env.SERVER_PORT || process.env.PIXELTOWN_GAME_PORT)||12567;
const host=process.env.SERVER_HOST||'127.0.0.1';
await server.listen(port,host);
console.log(`Colyseus: ws://${host}:${port} (town: lobby/garden/arcade)`);
void outbox.flush();const retry=setInterval(()=>void outbox.flush(),2000);
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(retry);await server.gracefullyShutdown(false);await outbox.flush();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
