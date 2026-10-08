// Concurrent frame measurement fallback after ego-browser inactive-tab rendering prevented it.
// Run against the isolated MINIMAL_BROWSER_HOLD harness; never points at production.
import * as fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const state = process.env.MINIMAL_SWAP_STATE;
assert(state?.includes('/.test-work/minimal-hotswap-'));
assert(process.env.CHROME_PATH?.includes('chromium-1193/'));
const control = JSON.parse(await fs.readFile(`${state}/control.json`, 'utf8'));
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
try {
const pages = [];
for(let i=0;i<2;i++){
  const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();pages.push(page);
  await page.goto(control.webUrl || 'http://127.0.0.1:5272');
  await page.locator('input[name="nickname"]').fill(`동시${i}${Date.now().toString().slice(-6)}`);
  await page.getByRole('button',{name:'광장 들어가기'}).click();
  await page.waitForFunction(()=>window.__minimal?.snapshot?.players?.length>0);
  await page.evaluate(()=>{const canvas=document.querySelector('canvas');let f=canvas[Object.keys(canvas).find(k=>k.startsWith('__reactFiber'))];while(f&&!f.memoizedProps?.engine)f=f.return;window.__qaEngine=f.memoizedProps.engine;});
}
for (const page of pages) await page.evaluate(() => {
  const e = window.__qaEngine, room = window.__minimal.room;
  const q = window.__swapQA = { phase: 'baseline', started: performance.now(), roomId: room.roomId, sessionId: room.sessionId,
    initialSeq:e.seq, drops:0, errors:0, covers:0, fixes:0, predictionFailures:0, maxPending:0, stale:0, interpolationFrames:0, frames:0,
    deploymentEvents:[],labels:[],lastLabel:'',last:0, lastPhase:'baseline', pending:{}, samples:{baseline:{gaps:[],acks:[]},deployment:{gaps:[],acks:[]}}, live:true, initialFix:e.fix };
  room.onMessage('deployment',m=>q.deploymentEvents.push(m));room.onDrop(()=>q.drops++);room.onLeave(()=>q.drops++);room.onError(()=>q.errors++);
  const send = room.send.bind(room);q.originalSend=send;
  room.send=(type,data)=>{if(type==='move'){q.pending[data.seq]=performance.now();if(Math.hypot(e.self.x-data.x,e.self.y-data.y)>.01)q.predictionFailures++;}return send(type,data);};
  room.onMessage('snapshot',s=>{
    if(!q.live)return;
    const now=performance.now(),me=s.players.find(p=>p.id===window.__minimal.userId);if(!me)return;
    if(q.last&&q.lastPhase===q.phase)q.samples[q.phase].gaps.push(now-q.last);
    q.last=now;q.lastPhase=q.phase;
    if(me.fix!==q.initialFix){q.fixes++;q.initialFix=me.fix;}
    for(const seq of Object.keys(q.pending))if(Number(seq)<=me.ack){q.samples[q.phase].acks.push(now-q.pending[seq]);delete q.pending[seq];}
  });
  const draw=now=>{
    if(!q.live)return;
    const label=document.querySelector('.release')?.textContent || '';if(label!==q.lastLabel){q.labels.push(label);q.lastLabel=label;}
    q.frames++;q.maxPending=Math.max(q.maxPending,e.pending.length);
    if(document.querySelector('.overlay.cover'))q.covers++;
    if(Date.now()-e.lastSnapshot>3000)q.stale++;
    for(const p of e.others.values()){
      const k=Math.max(0,Math.min(1,(now-p.at)/100));
      if(k>0&&k<1&&Math.hypot(p.from.x-p.to.x,p.from.y-p.to.y)>.1)q.interpolationFrames++;
    }
    requestAnimationFrame(draw);
  };requestAnimationFrame(draw);
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const p of pages)await p.keyboard.down('ArrowRight');
await sleep(2200);
for(const p of pages){await p.keyboard.up('ArrowRight');await p.keyboard.down('ArrowLeft');}
await sleep(1400);
for(const p of pages)await p.evaluate(()=>window.__swapQA.phase='deployment');
const swaps=[];
for(let i=0;i<6;i++){
  const key=i%2?'ArrowLeft':'ArrowRight',old=i%2?'ArrowRight':'ArrowLeft';
  for(const p of pages){await p.keyboard.up(old);await p.keyboard.down(key);}
  // Each replacement has new executable source bytes, while preserving the rules contract.
  const file=`${control.release}/colyseus/minimal/simulation.js`;
  const source=await fs.readFile(file,'utf8');await fs.writeFile(file,source+`\n// Browser release ${i}\n`);
  const response=await fetch((control.base || 'http://127.0.0.1:12622')+'/internal/worker/swap',{method:'POST',headers:{Authorization:`Bearer ${control.token}`}});
  assert.equal(response.status,200);swaps.push(await response.json());await sleep(1200);
}
for(const p of pages){await p.keyboard.up('ArrowLeft');await p.keyboard.up('ArrowRight');}
await sleep(1800);
const results=[];
for(const p of pages)results.push(await p.evaluate(()=>{
 const q=window.__swapQA,e=window.__qaEngine;q.live=false;window.__minimal.room.send=q.originalSend;
 const {originalSend,...data}=q;
 return {...data,finalSeq:e.seq,finalFix:e.fix,finalPending:e.pending.length,finalRoomId:window.__minimal.room.roomId,finalSessionId:window.__minimal.room.sessionId,others:e.others.size};
}));
const summary=a=>{a.sort((a,b)=>a-b);return {n:a.length,p50:a[Math.floor(a.length*.5)]||0,p95:a[Math.floor(a.length*.95)]||0,p99:a[Math.floor(a.length*.99)]||0,max:a.at(-1)||0};};
for(const r of results){
 for(const phase of Object.values(r.samples))for(const key of Object.keys(phase))phase[key]=summary(phase[key]);
 assert.equal(r.drops+r.errors+r.covers+r.fixes+r.predictionFailures+r.stale,0);
 assert.equal(r.roomId,r.finalRoomId);assert.equal(r.sessionId,r.finalSessionId);assert.equal(r.finalPending,0);
 assert(r.finalSeq-r.initialSeq>100);assert(r.labels.some(x=>x.includes('새 버전 준비 중')));assert(r.labels.some(x=>x.includes('상태 확인 중')));assert(r.labels.some(x=>x.includes('적용 완료')));assert(r.deploymentEvents.some(x=>x.phase==='applied'));
 assert(r.interpolationFrames>60);assert(r.maxPending<20);
 assert(r.samples.deployment.gaps.max<250);assert(r.samples.deployment.acks.max<300);
}
const report={passed:true,browser:'Playwright Chromium 1193 (ego inactive-tab fallback)',swaps,results};
await fs.writeFile(`${state}/browser-report.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,swaps:swaps.length,results:results.map(r=>({inputs:r.finalSeq-r.initialSeq,drops:r.drops,fixes:r.fixes,covers:r.covers,samples:r.samples}))},null,2));
await pages[0].screenshot({path:`${state}/browser-after.png`});
console.log(`Screenshot: ${state}/browser-after.png`);

} finally { await browser.close(); }
