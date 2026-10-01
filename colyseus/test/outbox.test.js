import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Outbox } from '../outbox.js';
test('outbox keeps failed match on disk and fresh process state replays once',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pixeltown-outbox-'))+'/';
  try {
    const match={match_id:randomUUID(),zone:'lobby',ended_at:new Date().toISOString(),scores:{demo:3}};
    const first=new Outbox(dir,async()=>({send:async()=>{throw Error('offline');}}));
    first.enqueue(match);await first.flush();assert.equal(first.status().pending,1);
    assert.equal(first.status().status,'pending');
    const calls=[];
    const restarted=new Outbox(dir,async()=>({send:async(path,options)=>{calls.push({path,body:options.body});}}));
    assert.equal(restarted.status().pending,1);
    await Promise.all([restarted.flush(),restarted.flush()]);
    assert.deepEqual(calls,[{path:'/api/pixeltown/commit-match',body:match}]);
    assert.equal(restarted.status().pending,0);
    await restarted.flush();assert.equal(calls.length,1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
