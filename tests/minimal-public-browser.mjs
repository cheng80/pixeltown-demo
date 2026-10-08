// Authorized minimal public browser check. Never restarts any backend service.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
assert.equal(process.env.MINIMAL_OPERATIONAL,'1','Requires an authorized minimal operational check');
assert(process.env.CHROME_PATH?.includes('chromium-1193/'));
const directory='.test-work/minimal-public-browser';mkdirSync(directory,{recursive:true});
const ssh=['-o','BatchMode=yes','-i',process.env.HOME+'/.ssh/stonematch_macmini_ed25519','cheng80@mac-mini.tailc386bf.ts.net'];
function control(action){return JSON.parse(execFileSync('ssh',[...ssh,'cd /Users/cheng80/Servers/pixeltown-minimal/app && /Users/cheng80/Servers/pixeltown-colyseus/runtime/bin/node --env-file=../.env .test-work/operational-control.mjs '+action],{encoding:'utf8',timeout:60000}));}
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
const report={passed:false,production:true,browser:'Chromium 1193, concurrent frame measurement after ego visual check',swaps:[]};
const pages=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 for(let i=0;i<2;i++){
  const context=await browser.newContext({viewport:{width:1280,height:800}}),p=await context.newPage();pages.push(p);
  await p.goto('https://pixeltown.fastmake.net');await p.locator('input[name="nickname"]').fill(`배포${i}${Date.now().toString().slice(-6)}`);await p.getByRole('button',{name:'광장 들어가기'}).click();
  await p.waitForFunction(()=>{const c=document.querySelector('canvas');let f=c?.[Object.keys(c).find(k=>k.startsWith('__reactFiber'))];while(f&&!f.memoizedProps?.engine)f=f.return;if(f?.memoizedProps?.engine?.room&&f.memoizedProps.engine.initialized){window.__qaEngine=f.memoizedProps.engine;return true;}return false;},{},{timeout:20000});
 }
 for(const p of pages)await p.evaluate(()=>{
  const e=window.__qaEngine,r=e.room,q=window.__publicQA={roomId:r.roomId,sessionId:r.sessionId,initialSeq:e.seq,initialFix:e.fix,drops:0,errors:0,covers:0,fixes:0,stale:0,frames:0,interpolationFrames:0,predictionFailures:0,maxPending:0,labels:[],lastLabel:'',last:0,gaps:[],pending:{},acks:[],events:[],live:true};
  r.onDrop(()=>q.drops++);r.onLeave(()=>q.drops++);r.onError(()=>q.errors++);r.onMessage('deployment',s=>q.events.push(s));
  const send=r.send.bind(r);q.send=send;r.send=(type,d)=>{if(type==='move'){q.pending[d.seq]=performance.now();if(Math.hypot(e.self.x-d.x,e.self.y-d.y)>.01)q.predictionFailures++;}return send(type,d);};
  r.onMessage('snapshot',s=>{if(!q.live)return;const now=performance.now(),me=s.players.find(x=>x.id===e.userId);if(!me)return;if(q.last)q.gaps.push(now-q.last);q.last=now;if(me.fix!==q.initialFix){q.fixes++;q.initialFix=me.fix;}for(const seq of Object.keys(q.pending))if(Number(seq)<=me.ack){q.acks.push(now-q.pending[seq]);delete q.pending[seq];}});
  const draw=now=>{if(!q.live)return;q.frames++;q.maxPending=Math.max(q.maxPending,e.pending.length);if(document.querySelector('.overlay.cover'))q.covers++;if(Date.now()-e.lastSnapshot>3000)q.stale++;const label=document.querySelector('.release')?.textContent||'';if(label!==q.lastLabel){q.labels.push(label);q.lastLabel=label;}for(const p of e.others.values()){const k=Math.max(0,Math.min(1,(now-p.at)/100));if(k>0&&k<1&&Math.hypot(p.from.x-p.to.x,p.from.y-p.to.y)>.1)q.interpolationFrames++;}requestAnimationFrame(draw);};requestAnimationFrame(draw);
 });
 for(const p of pages)await p.keyboard.down('ArrowRight');await sleep(1500);
 for(let n=101;n<=106;n++){
  const direction=n%2?'ArrowLeft':'ArrowRight',previous=n%2?'ArrowRight':'ArrowLeft';for(const p of pages){await p.keyboard.up(previous);await p.keyboard.down(direction);}
  report.swaps.push(control('swap-'+n));await sleep(1600);
 }
 for(const p of pages){await p.keyboard.up('ArrowLeft');await p.keyboard.up('ArrowRight');}
 await sleep(4500);
 report.restore=control('restore');await sleep(2500);
 const summarize=a=>{a.sort((a,b)=>a-b);return {n:a.length,p95:a[Math.floor(a.length*.95)]||0,p99:a[Math.floor(a.length*.99)]||0,max:a.at(-1)||0};};
 report.results=[];
 for(const p of pages){const r=await p.evaluate(()=>{const e=window.__qaEngine,q=window.__publicQA;q.live=false;e.room.send=q.send;const {send,...data}=q;return {...data,finalSeq:e.seq,finalPending:e.pending.length,finalRoomId:e.room.roomId,finalSessionId:e.room.sessionId,others:e.others.size};});r.gaps=summarize(r.gaps);r.acks=summarize(r.acks);report.results.push(r);assert.equal(r.drops+r.errors+r.covers+r.fixes+r.stale+r.predictionFailures,0);assert.equal(r.roomId,r.finalRoomId);assert.equal(r.sessionId,r.finalSessionId);assert.equal(r.finalPending,0);assert(r.finalSeq-r.initialSeq>100);if(process.env.MINIMAL_PUBLIC_CROWD==='100')assert.equal(r.others,99);assert(r.interpolationFrames>30);assert(r.maxPending<20);for(const label of ['새 버전 준비 중','상태 확인 중','적용 완료'])assert(r.labels.some(s=>s.includes(label)));assert(r.events.filter(s=>s.phase==='applied').length>=6);}
 await pages[0].screenshot({path:directory+'/desktop.png'});await pages[1].setViewportSize({width:390,height:844});assert(await pages[1].evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await pages[1].screenshot({path:directory+'/mobile.png'});report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await browser.close();if(!report.restore){try{report.restore=control('restore');}catch(error){report.restoreError=String(error);}}writeFileSync(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,swaps:report.swaps.length,error:report.error,directory}));}
