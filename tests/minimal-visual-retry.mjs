// Real browser, isolated renderer harness. No PB/game requests or existing servers.
// Ego is the default; explicitly use --playwright with the approved CHROME_PATH.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, symlinkSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, '.test-work'), { recursive: true });
const directory = mkdtempSync(resolve(root, '.test-work/visual-retry-browser-'));
const report = { directory, browser: process.argv.includes('--playwright') ? 'playwright' : 'ego', checks: [], requests: [], limitations: ['Isolated engine harness; no live PB, WebSocket or long-duration network test'] };
const app = resolve(directory, 'app'); mkdirSync(app);
for (const name of ['minimal', 'scripts', 'vite.minimal.config.js', 'package.json', 'package-lock.json']) cpSync(resolve(root, name), resolve(app, name), { recursive: true });
symlinkSync(resolve(root, 'node_modules'), resolve(app, 'node_modules'));
execFileSync(process.execPath, ['scripts/build-minimal-frontend.mjs'], { cwd: app, env: { ...process.env, MINIMAL_VISUAL_STORE: resolve(app, 'history') }, stdio: 'pipe' });
const built = JSON.parse(readFileSync(resolve(app, 'dist-minimal/visual/current.json')));
assert.equal(built.files.filter(f=>f.path.endsWith('.js')).length, 1);
report.actualBuild={revision:built.revision,entry:built.entry,files:built.files};
const compatibility = '0'.repeat(64), original = 'a'.repeat(64), transient = 'b'.repeat(64), permanent = 'c'.repeat(64), recovered = 'd'.repeat(64), broken = 'e'.repeat(64), dependencyFailure = 'f'.repeat(64), raw = '9'.repeat(64);
const entry = id => `/visual/releases/${id}/assets/entry.js`;
const dependency = id => `/visual/releases/${id}/assets/shared.js`;
const moduleSource = id => `import { revision } from './shared.js'; export function createRenderer({canvas}) { ${id === broken ? 'throw new Error("preview failure");' : ''} return {draw(){canvas.dataset.renderer=revision; const c=canvas.getContext('2d');c.fillStyle='#1234ef';c.fillRect(0,0,8,8);},dispose(){}}; }`;
const depSource = id => `export const revision=${JSON.stringify(id)};`;
const hash = data => createHash('sha256').update(data).digest('hex');
const manifest = id => ({ schema: 1, compatibility, revision: id, entry: entry(id), styles: [], fonts: [], images: [], files: [{ path: 'assets/entry.js', sha256: hash(moduleSource(id)) }, { path: 'assets/shared.js', sha256: hash(depSource(id)) }] });
let delivered = manifest(original), fault, spaceId = process.env.VISUAL_RETRY_EGO_SPACE ? Number(process.env.VISUAL_RETRY_EGO_SPACE) : undefined, browser, page, finished = false;
const updaterSource = readFileSync(resolve(root, 'minimal/game/src/visual-update.js'), 'utf8');
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (body, type = 'application/javascript', status = 200) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  if (url.pathname === '/') return send(`<!doctype html><html><body><canvas width="32" height="32"></canvas><script type="module">
import {createVisualUpdater} from '/updater.js';
const canvas=document.querySelector('canvas');
const engine=window.engine={connected:true,room:{roomId:'room',sessionId:'session'},userId:'user',seq:42,fix:7,self:{x:100,y:100},previous:{x:100,y:100},keys:new Set(['d']),pad:{x:0,y:0},target:{x:400,y:100},pending:[{seq:42}],others:new Map(),stars:[],lastTick:performance.now(),initialized:false,snapshot:{players:[{id:'user',ack:41}],game:{scores:{user:5}}}};
window.refs={room:engine.room,self:engine.self,pending:engine.pending,keys:engine.keys,target:engine.target,snapshot:engine.snapshot};
window.view={current:{scale:1}};window.events=[];window.initialDraws=0;window.disposals=0;
window.addEventListener('minimal-visual-status',e=>window.events.push(e.detail));
const set=window.setInterval;window.setInterval=(fn,ms,...args)=>{if(ms===15000){window.checkVisual=fn;return set(()=>{},ms);}return set(fn,ms,...args);};
window.updater=createVisualUpdater({canvas,engine,view:window.view,createRenderer:({canvas})=>({draw(){window.initialDraws++;canvas.dataset.renderer='initial';},dispose(){window.disposals++;}})});
window.setInterval=set;
function draw(){window.updater.draw(performance.now());window.frame=requestAnimationFrame(draw);}draw();window.harnessReady=true;
</script></body></html>`, 'text/html');
  if (url.pathname === '/updater.js') return send(`const __MINIMAL_VISUAL_COMPAT__=${JSON.stringify(compatibility)},__MINIMAL_VISUAL_REVISION__=${JSON.stringify(original)};\n` + updaterSource.replace('import.meta.env.DEV', 'false'));
  if (url.pathname === '/visual/current.json') return send(JSON.stringify(delivered), 'application/json');
  if (url.pathname.startsWith('/visual/releases/')) {
    const record = { path: url.pathname, query: url.search, status: 200 }; report.requests.push(record);
    if (fault?.path === url.pathname && (fault.remaining === undefined || fault.remaining-- > 0)) { record.status = 503; return send('temporary failure', 'text/plain', 503); }
    if (url.pathname.startsWith(`/visual/releases/${built.revision}/`)) {
      const file = resolve(app, 'dist-minimal', '.' + url.pathname);
      if (!existsSync(file)) return send('missing', 'text/plain', 404);
      return send(readFileSync(file), { '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json' }[extname(file)] || 'application/octet-stream');
    }
    const id = url.pathname.split('/')[3];
    if (url.pathname === entry(id)) return send(moduleSource(id));
    if (url.pathname === dependency(id)) return send(depSource(id));
  }
  send('missing', 'text/plain', 404);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const insecure = process.argv.includes('--insecure-http');
assert(!insecure || report.browser === 'playwright');
const base = `http://${insecure ? 'visual-retry.test' : '127.0.0.1'}:${server.address().port}`;
const run = promisify(execFile);
const ego = async code => {
  const child = run(process.env.EGO_BROWSER_CLI || '/Users/cheng80/.local/bin/ego-browser', ['nodejs', '-e', code], { timeout: 45000, maxBuffer: 2000000 }); child.child.stdin.end();
  const { stdout, stderr } = await child;
  const result = (stdout + '\n' + stderr).trim().split('\n').filter(line => line.startsWith('{')).at(-1);
  if (!result) throw new Error(`Ego returned no JSON result: ${(stdout + stderr).slice(0, 500)}`);
  return JSON.parse(result);
};
const evaluate = async (fn, arg) => report.browser === 'ego'
  ? ego(`const t=await taskSpace(${spaceId}),p=t.page('p1');console.log(JSON.stringify(await p.evaluate(${fn.toString()},${JSON.stringify(arg) ?? 'null'})));`)
  : page.evaluate(fn, arg);
const wait = async (fn, arg) => {
  if (report.browser === 'ego') await ego(`const t=await taskSpace(${spaceId}),p=t.page('p1');await p.waitForFunction(${fn.toString()},${JSON.stringify(arg) ?? 'undefined'},{timeout:10000});console.log(JSON.stringify({ready:true}));`);
  else await page.waitForFunction(fn, arg, { timeout: 10000 });
};
const state = () => evaluate(() => ({ status: window.__minimalVisual.status, renderer: document.querySelector('canvas').dataset.renderer, initialDraws: window.initialDraws, disposals: window.disposals, frames: window.frame, movementPreserved: Object.entries(window.refs).every(([key,value]) => window.engine[key] === value), movement: {seq:engine.seq,fix:engine.fix,x:engine.self.x,pending:engine.pending,score:engine.snapshot.game.scores.user,connected:engine.connected}, events: window.events, navigationCount: performance.getEntriesByType('navigation').length }));
const check = async (id, phase, failures) => {
  delivered = manifest(id);
  await evaluate(() => { window.checkVisual(); return {checking:true}; });
  await wait(({phase,failures}) => window.__minimalVisual.status.phase === phase && (failures === undefined || window.__minimalVisual.status.failures === failures), {phase,failures});
  return state();
};
try {
  if (report.browser === 'ego') {
    if (spaceId === undefined) spaceId = (await ego('const t=await taskSpace("visual import retry proof");console.log(JSON.stringify({spaceId:t.spaceId}));')).spaceId;
    report.spaceId = spaceId;
    await ego(`const t=await taskSpace(${spaceId}),p=t.page('p1');await p.goto(${JSON.stringify(base)});await p.waitForFunction(()=>window.harnessReady&&window.initialDraws>1,undefined,{timeout:10000});console.log(JSON.stringify({ready:true}));`);
  } else {
    const exact = resolve(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1193/chrome-mac/Chromium.app/Contents/MacOS/Chromium');
    assert.equal(process.env.CHROME_PATH, exact);
    const { chromium } = await import('playwright-core');
    assert(existsSync(exact), 'Approved Chromium binary missing; do not install automatically');
    browser = await chromium.launch({ executablePath: exact, headless: true, args: insecure ? ['--host-resolver-rules=MAP visual-retry.test 127.0.0.1', '--no-proxy-server'] : [] }); page = await browser.newPage();
    await page.goto(base); await wait(() => window.harnessReady && window.initialDraws > 1);
  }
  report.crypto = await evaluate(() => ({secureContext:isSecureContext,randomUUID:typeof crypto.randomUUID,getRandomValues:typeof crypto.getRandomValues}));
  if (insecure) { assert.equal(report.crypto.secureContext,false); assert.equal(report.crypto.randomUUID,'undefined'); assert.equal(report.crypto.getRandomValues,'function'); }
  // Reproduce the original import expression before exercising the updater.
  fault = { path: entry(raw), remaining: 1 };
  const cached = await evaluate(async url => {
    const attempts = [];
    for (let n=0;n<3;n++) { try { await import(url); attempts.push('loaded'); } catch { attempts.push('failed'); } }
    const repaired = await import(url+'?proof=unique');
    return {attempts,repaired:typeof repaired.createRenderer};
  }, entry(raw));
  assert.deepEqual(cached.attempts, ['failed','failed','failed']); assert.equal(cached.repaired, 'function');
  const rawRequests = report.requests.filter(r => r.path === entry(raw)); assert.equal(rawRequests.length, 2); assert.equal(rawRequests[0].status, 503); assert.equal(rawRequests[1].status, 200);
  report.checks.push({name:'same-url-failure-cache-reproduced',passed:true,...cached,requests:rawRequests});

  fault = { path: entry(transient), remaining: 1 };
  const retained = await check(transient, 'retained', 1); assert.equal(retained.renderer, 'initial'); assert.equal(retained.status.revision, original); assert.equal(retained.disposals, 0);
  fault = null;
  const applied = await check(transient, 'applied'); assert.equal(applied.renderer, transient); assert.equal(applied.status.failures, 1); assert.equal(applied.status.applied, 1);
  const attempts = report.requests.filter(r => r.path === entry(transient)); assert.equal(attempts.length, 2); assert.equal(attempts[0].query, ''); assert.match(attempts[1].query, /visualAttempt=.+-2/);
  assert.equal(report.requests.filter(r=>r.path===dependency(transient)).length, 1);
  report.checks.push({name:'same-manifest-recovered-with-relative-dependency',passed:true,retained,applied,attempts,entrySHA256:hash(moduleSource(transient)),dependencySHA256:hash(depSource(transient))});

  fault = { path: entry(permanent) };
  for (let n=2;n<=4;n++) { const kept=await check(permanent,'retained',n); assert.equal(kept.renderer,transient); }
  for (let n=5;n<=6;n++) await check(permanent,'retained',n);
  const exhausted = await state(); assert.match(exhausted.status.reason,/retry limit/); assert.equal(report.requests.filter(r=>r.path===entry(permanent)).length,3);
  report.checks.push({name:'permanent-failure-bounded-at-three',passed:true,status:exhausted.status});
  fault = null;
  const different = await check(recovered,'applied'); assert.equal(different.renderer,recovered); assert.equal(different.status.failures,6);
  report.checks.push({name:'different-revision-applies-after-exhaustion',passed:true,status:different.status});

  const failedPreview = await check(broken,'retained',7); assert.equal(failedPreview.renderer,recovered); assert.equal(failedPreview.status.revision,recovered);
  report.checks.push({name:'preview-failure-retains-current-renderer',passed:true,status:failedPreview.status});

  // A failed dependency has its own cached identity. Keep failure visible rather
  // than rewrite module bytes/imports or escape the immutable release directory.
  fault = { path: dependency(dependencyFailure), remaining: 1 };
  for (let n=8;n<=10;n++) { const kept=await check(dependencyFailure,'retained',n); assert.equal(kept.renderer,recovered); }
  const dependencyState = await check(dependencyFailure,'retained',11);
  assert.equal(report.requests.filter(r=>r.path===entry(dependencyFailure)).length,3);
  assert.equal(report.requests.filter(r=>r.path===dependency(dependencyFailure)).length,1);
  report.checks.push({name:'cached-dependency-failure-remains-bounded-and-retained',passed:true,status:dependencyState.status});
  report.limitations.push('Unique entry query cannot invalidate a failed static dependency module identity; such failures retain the renderer and exhaust after 3 imports. A new release can apply.');

  const rejected = '7'.repeat(64);
  delivered = { ...manifest(rejected), compatibility: '8'.repeat(64) };
  await evaluate(() => { window.checkVisual(); return {checking:true}; });
  await wait(() => window.__minimalVisual.status.phase === 'incompatible');
  delivered = { ...manifest(rejected), entry: entry(rejected) + '?untrusted=1' };
  await evaluate(() => { window.checkVisual(); return {checking:true}; });
  await wait(() => window.__minimalVisual.status.failures === 12);
  assert.equal(report.requests.filter(r=>r.path===entry(rejected)).length,0);
  report.checks.push({name:'incompatible-and-invalid-manifests-never-imported',passed:true});

  // Exercise the real Vite output with the same updater/engine and one failed
  // download. Compatibility is substituted only for this isolated host harness.
  fault = {path:built.entry,remaining:1}; delivered = {...built,compatibility};
  await evaluate(() => { window.checkVisual(); return {checking:true}; });
  await wait(() => window.__minimalVisual.status.failures === 13);
  assert.equal((await state()).status.revision,recovered);
  fault = null;
  await evaluate(() => { window.checkVisual(); return {checking:true}; });
  await wait(id => window.__minimalVisual.status.revision === id,built.revision);
  const actualState = await state(), actualRequests = report.requests.filter(r=>r.path===built.entry);
  assert.equal(actualRequests.length,2); assert.equal(actualRequests[0].status,503); assert.equal(actualRequests[1].status,200); assert.match(actualRequests[1].query,/visualAttempt=.+-2/);
  assert(actualState.movementPreserved); assert.equal(actualState.status.failures,13);
  const pixels = await evaluate(() => [...document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data]); assert.equal(pixels[3],255); assert.notDeepEqual(pixels,[18,52,239,255]);
  report.checks.push({name:'actual-standalone-vite-renderer-recovers-on-same-manifest',passed:true,status:actualState.status,requests:actualRequests,pixel:pixels});

  const final = await state(); assert(final.movementPreserved); assert.equal(final.navigationCount,1); assert.equal(final.movement.seq,42); assert.equal(final.movement.fix,7); assert.equal(final.movement.pending.length,1); assert.equal(final.movement.score,5); assert(final.movement.connected);
  assert.equal(readFileSync(resolve(root,'minimal/game/src/visual-update.js'),'utf8'),updaterSource);
  report.final=final;
  await evaluate(() => { cancelAnimationFrame(window.frame); window.updater.dispose(); return {disposed:true}; });
  if (report.browser === 'ego') { await ego(`const t=await taskSpace(${spaceId});await t.finish({keep:[]});console.log(JSON.stringify({finished:true}));`); finished=true; }
  report.passed=true;
} catch (error) { report.passed=false;report.error=error.stack;process.exitCode=1; }
finally {
  if (browser) await browser.close();
  // An Ego error leaves its own space for diagnosis; never touch another space.
  report.egoFinished=finished;
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  writeFileSync(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.map(c=>c.name),report:resolve(directory,'report.json'),error:report.error}));
}
