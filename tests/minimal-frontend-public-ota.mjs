// Run only after the whole-UI runtime is public. Never deploys or activates a release.
// MINIMAL_OPERATIONAL=1 MINIMAL_OPERATIONAL_ACCOUNTS=/private/accounts.json
// CHROME_PATH=/path/to/chromium node tests/minimal-frontend-public-ota.mjs
// Optional OTA_ACCOUNT_INDICES=98,99 (default 0,1); choose two idle test accounts.
// Or omit MINIMAL_OPERATIONAL_ACCOUNTS and set OTA_CREATE_GUESTS=1 to create exactly
// two guests in empty, independent contexts. Credentials are never written to reports.
// READY prints a fresh .test-work directory. Atomically rename command-N.json into it:
// {"action":"snapshot"}, {"action":"swap","revision":"<64 hex>"}, {"action":"finish"}
// N starts at 1. Wait for result-N.json before sending the next command. Activate
// externally after READY/snapshot; swap may be sent before or after activation.
// Verify B then the initial A, followed by finish. Every swap requires a different UI root and material CSS change (revision-only
// font/asset substitutions do not count). Optional title/background assert visible proof:
// {"action":"swap","revision":"...","title":"새 작은 광장","background":"rgb(222, 240, 255)"}
// node tests/minimal-frontend-public-ota.mjs --self-test is entirely offline.
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

const SHA = /^[a-f0-9]{64}$/;
const cssHash = text => createHash('sha256').update(text.replace(/[a-f0-9]{64}/g, '<revision>')).digest('hex');
function commandValue(value) {
  assert(value && ['snapshot', 'swap', 'finish'].includes(value.action), 'Invalid control action');
  if (value.action === 'swap') assert(SHA.test(value.revision), 'swap needs a full release revision');
  for (const field of ['title', 'background']) if (value[field] !== undefined) assert.equal(typeof value[field], 'string');
  return value;
}
function checkContinuity(before, after, drained = false) {
  assert(after.probe, 'Browser probe lost (possible navigation)');
  assert.equal(after.navigations, 1, 'Main frame navigated');
  assert.equal(after.navigation, 1);
  assert.equal(after.debugExposed, false, 'Production debug/engine exposed');
  assert.equal(after.canvasSame, true, 'Canvas replaced');
  assert.equal(after.canvases, 1);
  assert.equal(after.roots.filter(r => r.active).length, 1, 'Exactly one active UI root');
  assert(after.roots.length <= 3, 'Old UI roots leaked (current, previous, candidate maximum)');
  assert.deepEqual(after.room, before.room, 'Room/session changed');
  for (const key of ['roomId', 'sessionId', 'userId']) assert.equal(after.movement[key], before.movement[key]);
  assert.equal(after.movement.connected, true);
  assert.equal(after.connection.phase, 'playing');
  for (const key of ['drops', 'recovered', 'failures', 'corrected']) assert.equal(after.connection[key], 0, key);
  assert.equal(after.movement.fix, before.movement.fix, 'Server correction');
  assert(after.movement.seq >= before.movement.seq && after.movement.ack >= before.movement.ack, 'Input counters regressed');
  for (const key of ['covers', 'disconnected', 'identityChanges', 'canvasChanges', 'seqRegressions', 'fixChanges']) assert.equal(after.probe[key], 0, key);
  assert.equal(after.socketCloses, 0, 'WebSocket closed');
  assert.equal(after.socketErrors, 0, 'WebSocket error');
  assert.equal(after.pageErrors, 0, 'Page error');
  assert.equal(after.visual.failures, 0, 'UI preparation/execution failure');
  assert.equal(after.visual.rollbacks, 0, 'UI rollback');
  assert.equal(after.visual.compatibility, before.visual.compatibility);
  if (drained) {
    assert.equal(after.movement.pending, 0);
    assert.equal(after.movement.seq, after.movement.ack, 'Unacknowledged input');
    assert(after.movement.seq > before.movement.seq, 'No movement recorded');
  }
}
function checkSwap(before, after, command) {
  checkContinuity(before, after);
  assert.notEqual(command.revision, before.visual.revision, 'Target already active at previous checkpoint');
  assert.equal(after.visual.revision, command.revision);
  assert(after.roots.length <= 2, 'Candidate root remained after swap');
  assert(after.visual.applied > before.visual.applied, 'No UI swap recorded');
  assert.notEqual(after.activeRoot, before.activeRoot, 'Whole UI root not replaced');
  assert.equal(after.canvasRevision, command.revision);
  const active = after.roots.find(r => r.active);
  assert.deepEqual(active.versions, [command.revision], 'Active root styles use another release');
  assert.notEqual(after.cssHash, before.cssHash, 'No material full-UI CSS change');
  assert(after.movement.seq > before.movement.seq && after.movement.ack > before.movement.ack, 'Input did not advance through swap');
  if (command.title !== undefined) assert.equal(after.title, command.title);
  if (command.background !== undefined) assert.equal(after.background, command.background);
}

// Test-owned state contains DOM references and read-only measurements, never runtime/room objects.
function installProbe() {
  const canvas = document.querySelector('canvas.world'), initial = window.__minimalVisual.movement;
  const roots = new WeakMap(); let nextRoot = 0, direction = 'd', last = initial, lastAt = performance.now();
  const q = { covers: 0, disconnected: 0, identityChanges: 0, canvasChanges: 0, seqRegressions: 0,
    fixChanges: 0, maxPending: 0, maxSampleGapMs: 0, maxSnapshotAgeMs: 0, maxInputPauseMs: 0, samples: 0 };
  let advancedAt = lastAt;
  const rootId = root => { if (!roots.has(root)) roots.set(root, ++nextRoot); return roots.get(root); };
  const active = root => !root.hidden && !root.inert && getComputedStyle(root).visibility !== 'hidden';
  const key = (type, value) => window.dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true }));
  const sample = () => {
    const now = performance.now(), m = window.__minimalVisual.movement;
    q.samples++; q.maxSampleGapMs = Math.max(q.maxSampleGapMs, now - lastAt); lastAt = now;
    q.maxPending = Math.max(q.maxPending, m.pending);
    q.maxSnapshotAgeMs = Math.max(q.maxSnapshotAgeMs, Date.now() - m.lastSnapshot);
    if (m.seq > last.seq) advancedAt = now;
    if (q.moving) q.maxInputPauseMs = Math.max(q.maxInputPauseMs, now - advancedAt);
    if (!m.connected) q.disconnected++;
    if (m.roomId !== initial.roomId || m.sessionId !== initial.sessionId || m.userId !== initial.userId) q.identityChanges++;
    if (canvas !== document.querySelector('canvas.world')) q.canvasChanges++;
    if (m.seq < last.seq || m.ack < last.ack) q.seqRegressions++;
    if (m.fix !== initial.fix) q.fixChanges++;
    for (const root of document.querySelectorAll('.ui-release')) {
      rootId(root);
      if (active(root) && root.shadowRoot?.querySelector('.cover')) q.covers++;
    }
    if (q.moving) {
      const next = m.x > 490 ? 'a' : m.x < 100 ? 'd' : direction;
      if (next !== direction) { key('keyup', direction); direction = next; }
      if (!m.keys.includes(direction)) key('keydown', direction);
    }
    last = m;
  };
  window.__publicOTA = {
    read() {
      const list = [...document.querySelectorAll('.ui-release')];
      const host = list.find(active), shadow = host?.shadowRoot, titlebar = shadow?.querySelector('.titlebar');
      const styles = root => [...(root.shadowRoot?.querySelectorAll('style') || [])].map(s => s.textContent).join('\n');
      return { at: Date.now(), visual: window.__minimalVisual.status, movement: window.__minimalVisual.movement,
        connection: window.__minimal.connection, room: window.__minimal.room,
        debugExposed: !!window.__minimalDebug || 'engine' in window.__minimal || 'engine' in window.__minimalVisual,
        navigation: performance.getEntriesByType('navigation').length,
        canvasSame: canvas === document.querySelector('canvas.world'), canvases: document.querySelectorAll('canvas.world').length,
        canvasRevision: canvas.dataset.visualRevision, activeRoot: host && rootId(host),
        roots: list.map(root => ({ id: rootId(root), active: active(root),
          versions: [...new Set([...styles(root).matchAll(/PixelTown_([a-f0-9]{64})/g)].map(m => m[1]))] })),
        css: host ? styles(host) : '', title: shadow?.querySelector('.place')?.textContent?.trim(),
        background: titlebar && getComputedStyle(titlebar).backgroundColor, probe: { ...q } };
    },
    stop() { q.moving = false; for (const value of ['a', 'd']) key('keyup', value); },
    dispose() { this.stop(); clearInterval(timer); },
  };
  q.moving = true; sample(); const timer = setInterval(sample, 50);
}

async function main() {
  assert.equal(process.env.MINIMAL_OPERATIONAL, '1', 'Explicit operational authorization required');
  assert(process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH), 'CHROME_PATH must point to Chromium');
  const createGuests = process.env.OTA_CREATE_GUESTS === '1';
  assert(createGuests !== !!process.env.MINIMAL_OPERATIONAL_ACCOUNTS, 'Choose existing accounts or explicit OTA_CREATE_GUESTS=1');
  const indices = (process.env.OTA_ACCOUNT_INDICES || '0,1').split(',').map(Number);
  assert(indices.length === 2 && indices.every(i => Number.isSafeInteger(i) && i >= 0) && indices[0] !== indices[1]);
  const accounts = createGuests ? [] : JSON.parse(readFileSync(process.env.MINIMAL_OPERATIONAL_ACCOUNTS, 'utf8'));
  const selected = createGuests ? [] : indices.map(i => accounts[i]); assert(selected.every(a => typeof a?.token === 'string' && a.token));
  const work = resolve(import.meta.dirname, '../.test-work'); mkdirSync(work, { recursive: true });
  const directory = mkdtempSync(resolve(work, 'minimal-frontend-public-ota-'));
  const report = { passed: false, production: true, directory, startedAt: Date.now(), accountIndices: createGuests ? [] : indices, createdGuests: 0,
    controls: [], swaps: [], limitations: 'Two Chromium pages; 50ms sampled read-only diagnostics, synthetic keyboard events. No raw snapshot timing or hardware/IME coverage.' };
  const save = (name, value) => { const file = resolve(directory, name); writeFileSync(file + '.tmp', JSON.stringify(value, null, 2)); renameSync(file + '.tmp', file); };
  let browser, stopped = false, baseline, lastSwap, nextSample = 0;
  const pages = [], meters = [];
  const onSignal = () => { stopped = true; };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const read = () => Promise.all(pages.map(async (page, i) => {
    const value = await page.evaluate(() => window.__publicOTA?.read() || { probe: null });
    const { css, ...state } = value;
    return { ...state, cssHash: cssHash(css || ''), ...meters[i] };
  }));
  async function sample(force = false) {
    if (!force && Date.now() < nextSample) return;
    nextSample = Date.now() + 1000;
    const states = await read();
    appendFileSync(resolve(directory, 'samples.jsonl'), JSON.stringify(states) + '\n');
    states.forEach((state, i) => checkContinuity(baseline[i], state));
    return states;
  }
  async function waitFor(fn, label, timeout) {
    const end = Date.now() + timeout;
    while (!stopped && Date.now() < end) { const value = await fn(); if (value) return value; await sample(); await sleep(250); }
    throw new Error(stopped ? 'Interrupted; verification incomplete' : 'Timeout: ' + label);
  }
  try {
    // Refresh exactly two existing credentials once. Never log auth payloads or socket URLs.
    const auths = [];
    for (const account of selected) {
      const response = await fetch('https://pixeltown-minimal-pb.fastmake.net/api/collections/users/auth-refresh', {
        method: 'POST', headers: { Authorization: account.token }, signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200, 'Existing test account refresh failed');
      const auth = await response.json(); assert(auth.token && auth.record?.id);
      auths.push({ token: auth.token, record: auth.record });
    }
    if (!createGuests) assert.notEqual(auths[0].record.id, auths[1].record.id, 'Two distinct accounts required');
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    report.browser = browser.version();
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      if (!createGuests) await context.addInitScript(auth => localStorage.setItem('pixeltown.minimal.auth', JSON.stringify(auth)), auths[i]);
      const page = await context.newPage(); pages.push(page);
      const meter = { navigations: 0, socketCloses: 0, socketErrors: 0, pageErrors: 0 }; meters.push(meter);
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) meter.navigations++; });
      page.on('pageerror', () => meter.pageErrors++);
      page.on('websocket', socket => { socket.on('close', () => meter.socketCloses++); socket.on('socketerror', () => meter.socketErrors++); });
      const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await page.goto('https://pixeltown.fastmake.net/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (createGuests) {
        await page.locator('input[name="nickname"]').fill(`OTA${i}${Date.now().toString().slice(-6)}`);
        await page.getByRole('button', { name: '광장 들어가기' }).click();
      }
      await page.waitForFunction(() => window.__minimalVisual?.movement.connected && window.__minimal?.room, null, { timeout: 30000 });
      if (createGuests) report.createdGuests++;
      await page.evaluate(installProbe);
    }
    baseline = await read(); baseline.forEach(state => checkContinuity(state, state));
    assert.equal(baseline[0].room.roomId, baseline[1].room.roomId, 'Pages must share the lobby');
    assert.notEqual(baseline[0].room.sessionId, baseline[1].room.sessionId);
    assert.equal(baseline[0].visual.revision, baseline[1].visual.revision, 'Initial versions differ');
    report.initial = baseline; lastSwap = baseline;
    // Confirm both pages generate and acknowledge movement before asking for deployment.
    await waitFor(async () => (await read()).every((s, i) => s.movement.seq > baseline[i].movement.seq + 10 && s.movement.ack > baseline[i].movement.ack), 'initial movement', 15000);
    save('ready.json', { pid: process.pid, directory, pages: await read(), nextCommand: 1 });
    save('report.json', report);
    console.log('READY ' + directory);
    for (let index = 1; ; index++) {
      const path = resolve(directory, `command-${index}.json`);
      await waitFor(() => existsSync(path), `command-${index}.json`, 600000);
      const command = commandValue(JSON.parse(readFileSync(path, 'utf8')));
      report.controls.push({ index, at: Date.now(), ...command });
      if (command.action === 'swap') {
        assert(report.swaps.length < 2, 'Only B then A are expected');
        if (report.swaps.length === 1) assert.equal(command.revision, baseline[0].visual.revision, 'Second swap must restore initial A');
        await waitFor(async () => (await read()).every(s => s.visual?.revision === command.revision), 'public UI revision', 90000);
        // Observe movement on the new UI too, before recording success.
        const applied = await read();
        await waitFor(async () => (await read()).every((s, i) => s.movement.seq > applied[i].movement.seq + 10 && s.movement.ack > applied[i].movement.ack), 'post-swap movement', 15000);
        const states = await sample(true);
        states.forEach((state, i) => checkSwap(lastSwap[i], state, command));
        report.swaps.push({ index, command, states }); lastSwap = states;
      }
      if (command.action === 'finish') {
        assert.equal(report.swaps.length, 2, 'Both B and restored A must be verified');
        for (const page of pages) await page.evaluate(() => window.__publicOTA.stop());
        await waitFor(async () => (await read()).every(s => s.movement?.pending === 0 && s.movement.seq === s.movement.ack), 'input drain', 20000);
        report.final = await sample(true);
        report.final.forEach((state, i) => checkContinuity(baseline[i], state, true));
        report.final.forEach((state, i) => assert.equal(state.visual.revision, baseline[i].visual.revision, 'Initial A not restored'));
      }
      const states = await sample(true);
      for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: resolve(directory, `command-${index}-page-${i + 1}.png`) });
      save(`result-${index}.json`, { index, command, passed: true, states });
      save('report.json', report); console.log(`RESULT ${index} ${command.action}`);
      if (command.action === 'finish') { report.passed = true; break; }
    }
  } catch (error) {
    // Avoid assertion actual/expected payloads or Playwright URLs leaking credentials.
    report.error = { name: error.name, message: String(error.message).replace(/([?&](?:token|access_token|reconnectionToken)=)[^\s&"']+/gi, '$1<redacted>').slice(0, 1000) };
    report.failedState = await read().catch(() => null); process.exitCode = 1;
    const control = report.controls.at(-1);
    if (control && !existsSync(resolve(directory, `result-${control.index}.json`)))
      save(`result-${control.index}.json`, { index: control.index, passed: false, error: report.error, states: report.failedState });
    console.error('FAILED; see ' + resolve(directory, 'report.json'));
  } finally {
    for (const page of pages) await page.evaluate(() => window.__publicOTA?.dispose()).catch(() => {});
    await browser?.close().catch(() => {});
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    report.finishedAt = Date.now(); save('report.json', report); console.log('Report: ' + resolve(directory, 'report.json'));
  }
}

function selfTest() {
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  assert.equal(cssHash(`font:PixelTown_${a}; color:red`), cssHash(`font:PixelTown_${b}; color:red`));
  assert.notEqual(cssHash('color:red'), cssHash('color:blue'));
  assert.throws(() => commandValue({ action: 'deploy' }));
  assert.throws(() => commandValue({ action: 'swap', revision: '../bad' }));
  commandValue({ action: 'swap', revision: b }); commandValue({ action: 'snapshot' }); commandValue({ action: 'finish' });
  const before = { navigations: 1, navigation: 1, debugExposed: false, canvasSame: true, canvases: 1,
    room: { roomId: 'room', sessionId: 'session' }, roots: [{ id: 1, active: true, versions: [a] }], activeRoot: 1,
    movement: { roomId: 'room', sessionId: 'session', userId: 'user', connected: true, seq: 10, ack: 10, fix: 0, pending: 0 },
    connection: { phase: 'playing', drops: 0, recovered: 0, failures: 0, corrected: 0 },
    probe: { covers: 0, disconnected: 0, identityChanges: 0, canvasChanges: 0, seqRegressions: 0, fixChanges: 0 },
    socketCloses: 0, socketErrors: 0, pageErrors: 0,
    visual: { failures: 0, rollbacks: 0, compatibility: a, revision: a, applied: 0 }, cssHash: 'red' };
  const after = structuredClone(before);
  Object.assign(after, { roots: [{ id: 2, active: true, versions: [b] }], activeRoot: 2, canvasRevision: b, cssHash: 'blue' });
  Object.assign(after.visual, { revision: b, applied: 1 }); Object.assign(after.movement, { seq: 20, ack: 20 });
  checkSwap(before, after, { revision: b }); checkContinuity(before, after, true);
  const preparing = structuredClone(before);
  preparing.roots.push({ id: 2, active: false }, { id: 3, active: false });
  checkContinuity(before, preparing);
  for (const mutate of [s => s.canvasSame = false, s => s.navigations++, s => s.room.sessionId = 'other',
    s => s.connection.drops++, s => s.connection.recovered++, s => s.movement.fix++, s => s.probe.covers++,
    s => s.activeRoot = 1, s => s.cssHash = 'red', s => s.roots[0].versions = [a], s => s.debugExposed = true]) {
    const bad = structuredClone(after); mutate(bad); assert.throws(() => checkSwap(before, bad, { revision: b }));
  }
  const pending = structuredClone(after); pending.movement.pending = 1;
  assert.throws(() => checkContinuity(before, pending, true));
  console.log('PASS offline control/CSS/continuity/swap/drain self-check (no browser or network)');
}

if (process.argv.includes('--self-test')) selfTest();
else await main();
