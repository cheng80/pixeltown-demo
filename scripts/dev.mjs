import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
const root = fileURLToPath(new URL('..', import.meta.url));
const developmentEnv={...process.env,PB_URL:'http://127.0.0.1:18090',SERVER_HOST:'127.0.0.1',SERVER_PORT:'12567',PIXELTOWN_LOCAL_DIR:root+'pocketbase/.local',PIXELTOWN_ENV_FILE:root+'pocketbase/.env.local',PB_DATA_DIR:root+'pocketbase/.local/pb_data',OUTBOX_PATH:root+'colyseus/.local/outbox'};
const children=[];
let ending=false;
async function free(port) {
  return new Promise(resolve=>{
    const socket=createConnection({host:'127.0.0.1',port});
    socket.once('connect',()=>{socket.destroy();resolve(false)});
    socket.once('error',()=>resolve(true));
    socket.setTimeout(700,()=>{socket.destroy();resolve(false)});
  });
}
async function stop(code=0){
  if(ending)return;ending=true;
  for(const child of children)child.kill('SIGTERM');
  setTimeout(()=>process.exit(code),2000);
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
for(const port of [18090,12567,5173])if(!await free(port)){
  console.error(`개발 포트 ${port} 사용 중: 기존 프로세스를 수정하거나 종료하지 않습니다.`);process.exit(1);
}
for(const [program,args,cwd] of [
  [process.execPath,['scripts/dev-backend.mjs'],root],
  [process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],root]
]){
  const child=spawn(program,args,{cwd,stdio:'inherit',env:developmentEnv});children.push(child);
  child.on('error',e=>{console.error(e.message);stop(1)});
  child.on('exit',code=>{if(!ending)stop(code||0)});
}
console.log('픽셀타운: http://127.0.0.1:5173 — 개발 서버는 localhost에서만 실행됩니다. Ctrl+C로 모두 종료.');
