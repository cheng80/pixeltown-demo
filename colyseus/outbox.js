import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { adminClient, outboxDir } from './config.js';
export class Outbox extends EventEmitter {
  constructor(dir=outboxDir,getClient=adminClient) {
    super(); this.dir=dir; this.getClient=getClient; this.busy=false; this.lastError=null;
    mkdirSync(dir,{recursive:true,mode:0o700});
  }
  files() { return readdirSync(this.dir).filter(f=>f.endsWith('.json')); }
  status() {const pending=this.files().length;return {status:pending?'pending':'saved',pending,lastError:this.lastError};}
  enqueue(match) {
    // fsync before exposing completion; recovery reads only committed JSON files.
    const filename=this.dir+match.match_id+'.json';
    writeFileSync(filename+'.tmp',JSON.stringify(match),{mode:0o600,flush:true});
    renameSync(filename+'.tmp',filename); this.emit('change');
  }
  async flush() {
    if(this.busy || !this.files().length)return;
    this.busy=true;
    try {
      const pb=await this.getClient();
      for(const file of this.files()) {
        const match=JSON.parse(readFileSync(this.dir+file,'utf8'));
        await pb.send('/api/pixeltown/commit-match',{method:'POST',body:match});
        unlinkSync(this.dir+file);
      }
      this.lastError=null;
    } catch {this.lastError='PocketBase save unavailable; retrying';}
    finally {this.busy=false;this.emit('change');}
  }
}
export const outbox=new Outbox();
