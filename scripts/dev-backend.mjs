import { spawn } from 'node:child_process';
import { startPocketBase, seed } from './init-pocketbase.mjs';
import { backendDir } from '../colyseus/config.js';
let pb,server,stopping=false;
function stop(code=0){if(stopping)return;stopping=true;server?.kill('SIGTERM');setTimeout(()=>{pb?.kill('SIGTERM');process.exit(code);},1500);}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
try {
  pb=await startPocketBase();await seed();
  server=spawn(process.execPath,['server.js'],{cwd:backendDir,stdio:'inherit',env:process.env});
  server.on('exit',code=>stop(code||0));pb.on('exit',code=>stop(code||0));
} catch(e){console.error(e.message);stop(1);}
