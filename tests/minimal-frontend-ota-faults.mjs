import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Faults modify only this test's copied immutable history; production files are untouched.
export async function runFaults({ ego, activate, waitBrowsers, browserState, A, B, out, report, sleep, setFault, delayedBody = false }) {
  function fixture(name, { renderer, mount, invalidJS, manifest } = {}) {
    const revision = sha(B.revision + ':' + name), source = resolve(out, 'visual/releases', B.revision), dest = resolve(out, 'visual/releases', revision);
    cpSync(source, dest, { recursive: true });
    const m = JSON.parse(JSON.stringify(B).replaceAll(B.revision, revision));
    for (const f of m.files) {
      const path = resolve(dest, f.path);
      if (/\.(js|css)$/.test(path)) writeFileSync(path, readFileSync(path, 'utf8').replaceAll(B.revision, revision));
    }
    const entry = resolve(dest, m.entry.split(`/visual/releases/${revision}/`)[1]);
    let code = readFileSync(entry, 'utf8');
    if (renderer) {
      const match = code.match(/(\w+)\s+as\s+createRenderer\b/); assert(match, 'standalone entry exports createRenderer');
      code = code.replace(match[0], 'otaRenderer as createRenderer') + `\nfunction otaRenderer(args){const base=${match[1]}(args);${renderer}}\n`;
    }
    if (mount) {
      const match = code.match(/(\w+)\s+as\s+mountUI\b/); assert(match, 'standalone entry exports mountUI');
      code = code.replace(match[0], 'otaMount as mountUI') + `\nfunction otaMount(args){${mount.replaceAll('ORIGINAL_MOUNT', match[1])}}\n`;
    }
    if (invalidJS) code = 'export const broken = ;';
    writeFileSync(entry, code);
    for (const f of m.files) f.sha256 = sha(readFileSync(resolve(dest, f.path)));
    manifest?.(m);
    writeFileSync(resolve(dest, 'manifest.json'), JSON.stringify(m));
    return m;
  }
  const latest = async () => (await browserState())[0];
  async function retained(name, m, fault) {
    await activate(A); await waitBrowsers(A.revision);
    const before = await latest(); setFault(fault?.(m) || null);
    await activate(m);
    await ego(`await task.page('p1').waitForFunction(n=>window.__minimalVisual.status.failures>n,${before.visual.failures},{timeout:15000});console.log('OTA_RESULT:true');`);
    const after = await latest(); assert.equal(after.visual.revision, A.revision, name);
    assert.equal(after.movement.sessionId, before.movement.sessionId); assert.equal(after.movement.fix, before.movement.fix);
    report.checks.push({ name, passed: true, failures: after.visual.failures });
    setFault(null); await activate(A); await waitBrowsers(A.revision);
  }
  const preserved = await ego(`console.log('OTA_RESULT:'+JSON.stringify(await task.page('p1').evaluate(()=>{const s=document.querySelector('.ui-release:not([hidden])').shadowRoot,input=s.querySelector('#ota-test-draft');return {draft:input.value,start:input.selectionStart,end:input.selectionEnd,scroll:s.querySelector('#ota-test-list').scrollTop,choice:s.querySelector('#ota-test-choice').value};})));`);
  assert.equal(preserved.draft,'한글 초안 보존'); assert.equal(preserved.choice,'b'); assert.equal(preserved.start,2); assert.equal(preserved.end,4); assert(preserved.scroll>0);
  report.checks.push({name:'draft-choice-scroll-selection-preserved',passed:true,...preserved});
  const resource = fixture('resource-paint', {renderer:"return {...base,draw(now){base.draw(now);const image=args.resources.images.get('ota-proof.svg');if(image)args.canvas.getContext('2d').drawImage(image,80,80)}};"});
  await activate(resource); await waitBrowsers(resource.revision);
  const painted = await ego(`console.log('OTA_RESULT:'+JSON.stringify(await task.page('p1').evaluate(()=>({pixel:[...document.querySelector('canvas.world').getContext('2d').getImageData(82,82,1,1).data],background:getComputedStyle(document.querySelector('.ui-release:not([hidden])').shadowRoot.querySelector('.titlebar')).backgroundColor,fonts:[...document.fonts].filter(f=>f.family.startsWith('PixelTown_')).map(f=>f.status)}))));`);
  assert.deepEqual(painted.pixel,[18,52,239,255]);assert.equal(painted.background,'rgb(222, 240, 255)');assert(painted.fonts.length<=4&&painted.fonts.every(s=>s==='loaded'));
  report.checks.push({name:'whole-ui-code-css-font-image-production-release',passed:true,...painted});
  await activate(A);await waitBrowsers(A.revision);
  await retained('manifest-404-retains-ui', fixture('manifest404'), m => ({ path:`/visual/releases/${m.revision}/manifest.json`,status:404 }));
  await retained('manifest-malformed-json-retains-ui', fixture('manifest-json'), m => ({ path:`/visual/releases/${m.revision}/manifest.json`,status:200,type:'application/json',body:'{' }));
  await retained('js-503-retains-ui', fixture('js503'), m => ({path:m.entry,status:503}));
  await retained('css-failure-retains-ui', fixture('css503'), m => ({path:m.styles[0],status:503}));
  await retained('font-failure-retains-ui', fixture('font503'), m => ({path:m.fonts[0].url,status:503}));
  await retained('image-failure-retains-ui', fixture('image503'), m => ({path:m.images[0].url,status:503}));
  await retained('resource-hash-mismatch-retains-ui', fixture('hash'), m => ({path:m.entry,status:200,type:'text/javascript',body:'export const wrong=1'}));
  if (delayedBody) await retained('twelve-second-body-preparation-deadline',fixture('timeout'),m=>({path:m.entry,delayMs:15000}));
  await retained('candidate-read-only-command-rejected', fixture('readonly', {mount:"args.runtime.setUI({otaDraft:'FORBIDDEN'});return ORIGINAL_MOUNT(args);"}));
  assert.equal((await latest()).ui,'한글 초안 보존');
  await retained('preview-draw-error-retains-ui', fixture('preview',{renderer:"return {...base,draw(now){if(!args.canvas.isConnected)throw new Error('preview fault');base.draw(now)}};"}));
  await retained('activation-draw-error-retains-ui', fixture('activate',{renderer:"return {...base,draw(now){if(args.canvas.isConnected)throw new Error('activation fault');base.draw(now)}};"}));
  const broken = fixture('syntax', {invalidJS:true}), beforeSyntax = await latest();
  await activate(broken);
  await ego(`await task.page('p1').waitForFunction(n=>window.__minimalVisual.status.failures>=n+3,${beforeSyntax.visual.failures},{timeout:15000});console.log('OTA_RESULT:true');`);
  const failed = await latest(); await sleep(1500); assert.equal((await latest()).visual.failures,failed.visual.failures,'three attempts stop without polling');
  report.checks.push({name:'invalid-js-bounded-three-attempts',passed:true,attempts:3});
  await activate(A); await waitBrowsers(A.revision);
  const late = fixture('late-draw', {renderer:"let frames=0;return {...base,draw(now){if(args.canvas.isConnected&&++frames>3)throw new Error('late draw');base.draw(now)}};"});
  const beforeLate = await latest(); await activate(late);
  await ego(`await task.page('p1').waitForFunction(n=>window.__minimalVisual.status.rollbacks>n,${beforeLate.visual.rollbacks},{timeout:15000});console.log('OTA_RESULT:true');`);
  const afterLate = await latest(); assert.equal(afterLate.visual.revision,A.revision); assert.equal(afterLate.ui,'한글 초안 보존');assert(afterLate.movement.seq>=beforeLate.movement.seq);
  await activate(late); await sleep(300); assert.equal((await latest()).visual.revision,A.revision,'failed revision remains quarantined');
  report.checks.push({name:'late-render-error-current-state-rollback-and-quarantine',passed:true});
  await activate(A); await waitBrowsers(A.revision);
  const incompatible = fixture('incompatible', {manifest:m=>{m.compatibility='f'.repeat(64)}}); await activate(incompatible);
  await ego(`await task.page('p1').waitForFunction(()=>window.__minimalVisual.status.phase==='incompatible');console.log('OTA_RESULT:true');`);
  assert.equal((await latest()).visual.revision,A.revision); report.checks.push({name:'runtime-compatibility-rejection',passed:true});
  await activate(A); await waitBrowsers(A.revision);
  const beforeIME = await latest();
  await ego(`await task.page('p1').evaluate(()=>{const input=document.querySelector('.ui-release:not([hidden])').shadowRoot.querySelector('#ota-test-draft');input.focus();input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,composed:true,data:'한'}));});console.log('OTA_RESULT:true');`);
  await activate(B);
  await ego(`await task.page('p1').waitForFunction(()=>window.__minimalVisual.status.phase==='waiting');console.log('OTA_RESULT:true');`);
  assert.equal((await latest()).visual.revision,A.revision); await sleep(300);
  await ego(`await task.page('p1').evaluate(()=>document.querySelector('.ui-release:not([hidden])').shadowRoot.querySelector('#ota-test-draft').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,composed:true,data:'한'})));console.log('OTA_RESULT:true');`);
  await waitBrowsers(B.revision); assert.equal((await latest()).ui,beforeIME.ui);
  report.checks.push({name:'IME-composition-defers-whole-ui-swap',passed:true,synthetic:true});
  // Pointer capture is controlled by the real pad handler; the release must wait for its end.
  await ego(`await task.page('p1').evaluate(()=>{const s=document.querySelector('.ui-release:not([hidden])').shadowRoot,pad=s.querySelector('.dpad'),r=pad.getBoundingClientRect();pad.dispatchEvent(new PointerEvent('pointerdown',{pointerId:73,clientX:r.right-10,clientY:r.top+r.height/2,bubbles:true}));});console.log('OTA_RESULT:true');`);
  await activate(A); await ego(`await task.page('p1').waitForFunction(()=>window.__minimalVisual.status.phase==='waiting');console.log('OTA_RESULT:true');`);
  assert.equal((await latest()).visual.revision,B.revision);
  await ego(`await task.page('p1').evaluate(()=>document.querySelector('.ui-release:not([hidden])').shadowRoot.querySelector('.dpad').dispatchEvent(new PointerEvent('pointerup',{pointerId:73,bubbles:true})));console.log('OTA_RESULT:true');`);
  await waitBrowsers(A.revision); report.checks.push({name:'touch-pad-defers-swap-until-release',passed:true,synthetic:true});
  const slow = fixture('slow-commit', {mount:"window.__otaSlowCommit=true;return new Promise((resolve,reject)=>setTimeout(()=>Promise.resolve(ORIGINAL_MOUNT(args)).then(resolve,reject),700));"});
  await activate(slow); await ego(`await task.page('p1').waitForFunction(()=>window.__otaSlowCommit===true);console.log('OTA_RESULT:true');`);
  await activate(B); await waitBrowsers(B.revision); await sleep(1000);
  const afterCancel=await latest();assert.equal(afterCancel.visual.revision,B.revision);assert(afterCancel.roots<=2);
  report.checks.push({name:'newer-hint-cancels-late-candidate-commit',passed:true});
  await activate(A); await waitBrowsers(A.revision);
  const duplicate = (await latest()).visual.checks; await activate(A); await sleep(300); assert.equal((await latest()).visual.checks,duplicate);
  report.checks.push({name:'same-generation-rebroadcast-does-not-refetch',passed:true});
  const disposal = fixture('dispose', {renderer:"return {...base,dispose(){base.dispose();if(args.canvas.isConnected)throw new Error('dispose fault')}};"});
  await activate(disposal);await waitBrowsers(disposal.revision);await activate(B);await waitBrowsers(B.revision);
  const beforeDispose=await latest();await activate(A);await waitBrowsers(A.revision);
  assert((await latest()).visual.failures>beforeDispose.visual.failures);report.checks.push({name:'dispose-error-does-not-interrupt-current-ui',passed:true});
  console.log('PASS production UI fault matrix');
}
