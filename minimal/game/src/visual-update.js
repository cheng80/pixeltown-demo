import { createUIFacade } from './runtime.js';
// The room, input timer and engine outlive every visual release.
const COMPATIBILITY = typeof __MINIMAL_VISUAL_COMPAT__ === 'undefined' ? 'development' : __MINIMAL_VISUAL_COMPAT__;
const INITIAL_REVISION = typeof __MINIMAL_VISUAL_REVISION__ === 'undefined' ? 'development' : __MINIMAL_VISUAL_REVISION__;
const SHA = /^[a-f0-9]{64}$/;
let loaderSequence = 0;
function visualNonce() {
  // getRandomValues also works on non-secure LAN HTTP origins; randomUUID does not.
  if (globalThis.crypto?.getRandomValues) {
    return Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), word => word.toString(16).padStart(8, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++loaderSequence}`;
}

// A failed import can remain in the browser's module map. Keep relative imports
// rooted at the immutable release, and cap new module identities per entry.
export function createVisualModuleLoader(importModule = url => import(/* @vite-ignore */ url), nonce = visualNonce()) {
  const entries = new Map();
  let retained = new Set(), identity = 0;
  const prune = () => {
    for (const entry of entries.keys()) {
      if (entries.size <= 16) break;
      if (!retained.has(entry)) entries.delete(entry);
    }
  };
  const load = async (entry, signal) => {
    if (signal.aborted) throw new Error('Visual preparation cancelled');
    let state = entries.get(entry);
    if (!state) state = { attempts: 0, module: null };
    entries.delete(entry); entries.set(entry, state); prune();
    if (state.module) return state.module;
    if (state.attempts >= 3) throw new Error('Visual module retry limit reached (3 attempts)');
    const attempt = ++state.attempts;
    const url = attempt === 1 ? entry : `${entry}?visualAttempt=${encodeURIComponent(nonce)}-${++identity}-${attempt}`;
    try {
      const module = await importModule(url);
      if (signal.aborted) throw new Error('Visual preparation cancelled');
      state.module = module;
      return module;
    } catch (error) {
      throw new Error(`Visual module attempt ${attempt}/3 failed: ${String(error?.message || 'Import failed').slice(0, 100)}`);
    }
  };
  load.retain = (active, previous) => { retained = new Set([active, previous].filter(Boolean)); prune(); };
  load.clear = () => { entries.clear(); retained.clear(); };
  Object.defineProperty(load, 'size', { get: () => entries.size });
  return load;
}

export function validateFrontendHint(value) {
  if (value === null) return null;
  if (!value || value.schema !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 1 || !SHA.test(value.revision) || !SHA.test(value.compatibility) || value.uiApiVersion !== 1 || value.uiStateSchema !== 1) throw new Error('Invalid frontend hint');
  return { schema: 1, generation: value.generation, revision: value.revision, compatibility: value.compatibility, uiApiVersion: 1, uiStateSchema: 1 };
}
export function acceptFrontendHint(current, value) {
  const next = validateFrontendHint(value); if (!next) return null;
  if (current && next.generation < current.generation) return null;
  if (current && next.generation === current.generation) {
    if (JSON.stringify(next) !== JSON.stringify(current)) throw new Error('Conflicting frontend generation');
    return null;
  }
  return next;
}
export function validateVisualManifest(value, compatibility, origin) {
  if (!value || value.schema !== 2 || !SHA.test(value.revision) || !SHA.test(value.compatibility) || value.uiApiVersion !== 1 || value.uiStateSchema !== 1) throw new Error('Invalid visual manifest');
  const prefix = `/visual/releases/${value.revision}/`;
  const validURL = path => {
    if (typeof path !== 'string' || !path.startsWith(prefix) || !/^[\w./-]+$/.test(path) || path.includes('//') || path.split('/').some(x => x === '.' || x === '..')) throw new Error('Invalid resource URL');
    const url = new URL(path, origin);
    if (url.origin !== origin || url.pathname !== path || url.search || url.hash) throw new Error('Invalid resource URL');
  };
  if (![value.styles, value.fonts, value.images].every(a => Array.isArray(a) && a.length <= 128) || !Array.isArray(value.files) || value.files.length > 256) throw new Error('Invalid resource list');
  const inventory = new Map();
  for (const f of value.files) {
    if (!f || typeof f.path !== 'string' || !SHA.test(f.sha256) || inventory.has(prefix + f.path)) throw new Error('Invalid file inventory');
    validURL(prefix + f.path); inventory.set(prefix + f.path, f.sha256);
  }
  const resource = path => { validURL(path); if (!inventory.has(path)) throw new Error('Resource missing from inventory'); };
  resource(value.entry); if (!value.entry.endsWith('.js')) throw new Error('Invalid entry');
  value.styles.forEach(path => { resource(path); if (!path.endsWith('.css')) throw new Error('Invalid style'); });
  for (const f of value.fonts) { if (!f || !['400', '700'].includes(f.weight)) throw new Error('Invalid font'); resource(f.url); }
  for (const i of value.images) { if (!i || typeof i.name !== 'string' || !i.name || i.name.length > 200) throw new Error('Invalid image'); resource(i.url); }
  if (value.compatibility !== compatibility) return null;
  return value;
}

export function previewEngine(engine) {
  return { ...engine, room: null, send: null, self: { ...engine.self }, previous: { ...engine.previous },
    keys: new Set(engine.keys), pad: { ...engine.pad }, target: engine.target && { ...engine.target },
    pending: structuredClone(engine.pending), others: new Map([...engine.others].map(([id, p]) => [id, structuredClone(p)])),
    stars: structuredClone(engine.stars), snapshot: engine.snapshot && structuredClone(engine.snapshot) };
}
const digest = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join('');
async function fetchBytes(url, signal, limit = 4 * 1024 * 1024) {
  const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal });
  if (!response.ok || /text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('Frontend resource unavailable');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error('Frontend resource too large'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
function captureDOM(shadow) {
  if (!shadow) return null;
  const selector = element => element?.id ? `#${CSS.escape(element.id)}` : element?.getAttribute('name') ? `[name="${CSS.escape(element.getAttribute('name'))}"]` : null;
  const active = shadow.activeElement;
  return { focus: selector(active), start: active?.selectionStart, end: active?.selectionEnd, direction: active?.selectionDirection,
    scroll: [...shadow.querySelectorAll('[id], [name]')].filter(el => el.scrollTop || el.scrollLeft).map(el => ({ selector: selector(el), top: el.scrollTop, left: el.scrollLeft })) };
}
function restoreDOM(shadow, saved) {
  if (!saved) return;
  for (const row of saved.scroll) { const el = shadow.querySelector(row.selector); if (el) { el.scrollTop = row.top; el.scrollLeft = row.left; } }
  const active = saved.focus && shadow.querySelector(saved.focus);
  if (active) { active.focus({ preventScroll: true }); if (Number.isInteger(saved.start) && typeof active.setSelectionRange === 'function') { try { active.setSelectionRange(saved.start, saved.end, saved.direction); } catch { /* Non-text input. */ } } }
}

export function createVisualUpdater({ runtime, surface, compatibility = COMPATIBILITY, initialRevision = INITIAL_REVISION }) {
  const { canvas, view } = surface, { engine } = runtime;
  let current = null, previous = null, pending = null, preparing = null, disposed = false, goal = 0, highest = null, currentCheck = null, retryTimer;
  const quarantine = new Set(), code = new Map();
  const loadModule = createVisualModuleLoader(async entry => {
    const text = code.get(new URL(entry, location.origin).pathname);
    if (!text) throw new Error('Verified entry unavailable');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    try { return await import(/* @vite-ignore */ url); } finally { URL.revokeObjectURL(url); }
  });
  const status = { phase: 'idle', revision: null, compatibility, generation: 0, applied: 0, failures: 0, rollbacks: 0, checkedAt: null, checks: 0, preparing: 0, roots: 0 };
  const bootMessage = document.createElement('p'); bootMessage.setAttribute('role', 'alert');
  function publish() {
    if (current) bootMessage.remove();
    else if (status.failures) { bootMessage.textContent = '화면을 불러오지 못했어요. 잠시 후 새로고침해 주세요.'; document.getElementById('root').append(bootMessage); }
    status.roots = document.querySelectorAll('.ui-release').length; canvas.dataset.visualRevision = status.revision || ''; runtime.publishVisual({ ...status }); }
  function fail(error) { status.failures++; status.phase = 'retained'; status.reason = String(error?.message || 'UI failed').slice(0, 160); publish(); }
  function clean(release) {
    if (!release || release.cleaned) return; release.cleaned = true;
    release.lease?.dispose();
    for (const action of [() => release.ui?.dispose(), () => release.renderer?.dispose?.()]) try { action(); } catch (error) { fail(error); }
    release.host?.remove(); release.fonts?.forEach(font => document.fonts.delete(font));
    status.roots = document.querySelectorAll('.ui-release').length;
  }
  function disable(release) { if (!release) return; release.lease.setActive(false); release.ui.setActive(false); release.host.hidden = true; release.host.inert = true; }
  function enable(release) {
    release.host.hidden = false; release.host.style.visibility = ''; release.host.inert = false;
    release.fonts.forEach(font => document.fonts.add(font)); release.lease.setActive(true); release.ui.setActive(true);
  }
  function rollback(error) {
    if (!current) { fail(error); return; }
    quarantine.add(current.revision);
    if (!previous) { fail(error); return; }
    const saved = captureDOM(current.shadow), broken = current;
    current = previous; previous = null; disable(broken);
    try { enable(current); restoreDOM(current.shadow, saved); } catch (restoreError) { fail(restoreError); }
    status.revision = current.revision; status.rollbacks++; clean(broken); loadModule.retain(current.entry); fail(error);
  }
  function uiError(release, error) {
    release.error = error;
    if (release === current) queueMicrotask(() => { if (release === current && !disposed) rollback(error); });
  }
  async function verified(url, manifest, signal) {
    const bytes = await fetchBytes(url, signal);
    const path = url.slice(`/visual/releases/${manifest.revision}/`.length), file = manifest.files.find(f => f.path === path);
    if (!file || await digest(bytes) !== file.sha256) throw new Error('Frontend resource hash mismatch');
    return bytes;
  }
  async function prepare(manifest, signal) {
    const host = document.createElement('div'); host.className = 'ui-release'; host.style.visibility = 'hidden'; host.inert = true;
    const shadow = host.attachShadow({ mode: 'open' }), root = document.createElement('div'); root.id = 'ui-root'; shadow.append(root);
    document.getElementById('root').append(host);
    const release = { host, shadow, root, fonts: [], resources: { images: new Map() }, revision: manifest.revision, entry: manifest.entry };
    release.lease = createUIFacade(runtime, error => uiError(release, error));
    const family = `PixelTown_${manifest.revision}`;
    const abort = () => clean(release); signal.addEventListener('abort', abort, { once: true });
    try {
      await Promise.all([
        ...manifest.styles.map(async href => {
          const text = new TextDecoder().decode(await verified(href, manifest, signal));
          if (/@import\b/i.test(text)) throw new Error('External style import rejected');
          for (const match of text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
            if (!manifest.files.some(f => `/visual/releases/${manifest.revision}/${f.path}` === match[1])) throw new Error('Unlisted style resource');
          }
          if (signal.aborted) throw new Error('Preparation cancelled');
          const style = document.createElement('style'); style.textContent = text; shadow.append(style);
        }),
        ...manifest.fonts.map(async f => { const bytes = await verified(f.url, manifest, signal); const font = new FontFace(family, bytes, { weight: f.weight }); release.fonts.push(font); await font.load(); }),
        ...manifest.images.map(async i => {
          const bytes = await verified(i.url, manifest, signal), url = URL.createObjectURL(new Blob([bytes], { type: i.url.endsWith('.svg') ? 'image/svg+xml' : undefined }));
          try { const image = new Image(); image.src = url; await image.decode(); release.resources.images.set(i.name, image); } finally { URL.revokeObjectURL(url); }
        }),
        (async () => {
          const bytes = await verified(manifest.entry, manifest, signal); code.set(manifest.entry, new TextDecoder().decode(bytes));
          try { release.module = await loadModule(manifest.entry, signal); } finally { code.delete(manifest.entry); }
          if (typeof release.module.mountUI !== 'function' || typeof release.module.createRenderer !== 'function') throw new Error('Invalid UI entry');
        })(),
      ]);
      if (signal.aborted || disposed) throw new Error('Preparation cancelled');
      release.ui = await release.module.mountUI({ root, runtime: release.lease.facade, resources: release.resources, signal });
      if (signal.aborted || release.cleaned) { release.ui.dispose(); throw new Error('Preparation cancelled'); }
      if (typeof release.ui?.setActive !== 'function' || typeof release.ui?.dispose !== 'function' || release.error) throw release.error || new Error('Invalid UI lifecycle');
      const testCanvas = document.createElement('canvas');
      Object.defineProperties(testCanvas, { clientWidth: { value: canvas.clientWidth || 640 }, clientHeight: { value: canvas.clientHeight || 416 } });
      const test = release.module.createRenderer({ canvas: testCanvas, engine: previewEngine(engine), view: { current: { ...view.current } }, fontFamily: family, resources: release.resources });
      try { if (typeof test?.draw !== 'function') throw new Error('Invalid renderer'); test.draw(performance.now()); } finally { test?.dispose?.(); }
      release.renderer = release.module.createRenderer({ canvas, engine, view, fontFamily: family, resources: release.resources });
      if (typeof release.renderer?.draw !== 'function') throw new Error('Invalid renderer');
      if (signal.aborted || release.error) throw release.error || new Error('Preparation cancelled');
      return release;
    } catch (error) { clean(release); throw error; }
    finally { signal.removeEventListener('abort', abort); }
  }
  async function attempt(target, ticket, n = 0) {
    if (disposed || ticket !== goal) return;
    const controller = new AbortController(); preparing = controller; status.preparing = 1;
    const deadline = setTimeout(() => controller.abort(), 12000);
    const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('UI preparation timed out or cancelled')), { once: true }));
    aborted.catch(() => {});
    try {
      status.phase = 'preparing'; publish(); status.checks++; status.checkedAt = Date.now();
      const value = target.manifest || JSON.parse(new TextDecoder().decode(await fetchBytes(`/visual/releases/${target.revision}/manifest.json`, controller.signal, 262144)));
      const manifest = validateVisualManifest(value, compatibility, location.origin);
      if (!manifest) { status.phase = 'incompatible'; publish(); return; }
      if (target.hint && ['revision', 'compatibility', 'uiApiVersion', 'uiStateSchema'].some(key => manifest[key] !== target.hint[key])) throw new Error('Frontend hint does not match manifest');
      if (manifest.revision !== target.revision) throw new Error('Wrong immutable manifest');
      const preparation = prepare(manifest, controller.signal);
      preparation.then(release => { if (controller.signal.aborted || ticket !== goal || disposed) clean(release); }, () => {});
      const release = await Promise.race([preparation, aborted]);
      if (ticket !== goal || disposed) { clean(release); return; }
      pending = release; status.phase = 'waiting'; publish();
    } catch (error) {
      controller.abort();
      if (ticket === goal && !disposed) { fail(error); if (n < 2) retryTimer = setTimeout(() => void attempt(target, ticket, n + 1), (n + 1) * 1000); }
    } finally { clearTimeout(deadline); if (preparing === controller) { preparing = null; status.preparing = 0; } }
  }
  function target(value) {
    clearTimeout(retryTimer); preparing?.abort(); clean(pending); pending = null; const ticket = ++goal;
    if (quarantine.has(value.revision)) { status.phase = 'retained'; publish(); return; }
    if (value.revision === current?.revision) { status.phase = 'idle'; publish(); return; }
    void attempt(value, ticket);
  }
  function hint(value) {
    try {
      const next = acceptFrontendHint(highest, value); if (!next) return;
      highest = next; status.generation = next.generation;
      target({ revision: next.revision, hint: next });
    } catch (error) { fail(error); }
  }
  function checkCurrent() {
    if (disposed || currentCheck) return currentCheck || Promise.resolve();
    currentCheck = (async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      try {
        status.checks++; status.checkedAt = Date.now();
        const manifest = JSON.parse(new TextDecoder().decode(await fetchBytes('/visual/current.json', controller.signal, 262144)));
        const valid = validateVisualManifest(manifest, compatibility, location.origin);
        if (!valid) { status.phase = 'incompatible'; publish(); return; }
        if (!highest && manifest.revision !== current?.revision && manifest.revision !== pending?.revision) target({ revision: manifest.revision, manifest });
      } catch (error) { if (!disposed) fail(error); }
      finally { clearTimeout(timeout); currentCheck = null; }
    })(); return currentCheck;
  }
  const visibility = () => { if (!document.hidden) runtime.facade.getSnapshot().phase === 'playing' ? runtime.requestFrontend() : void checkCurrent(); };
  document.addEventListener('visibilitychange', visibility);
  runtime.setHooks({ onFrontend: hint, checkBeforeEnter: checkCurrent });
  const diagnostic = Object.freeze({
    get status() { return { ...status, surface: surface.metrics, renderers: Number(!!current?.renderer) + Number(!!previous?.renderer) }; },
    get movement() { const me = engine.snapshot?.players?.find(p => p.id === engine.userId); return {
      connected: engine.connected, userId: engine.userId, roomId: engine.room?.roomId, sessionId: engine.room?.sessionId,
      seq: engine.seq, ack: me?.ack, fix: engine.fix, x: engine.self.x, y: engine.self.y, pending: engine.pending.length,
      keys: [...engine.keys], pad: { ...engine.pad }, target: engine.target && { ...engine.target }, lastSnapshot: engine.lastSnapshot,
      score: engine.snapshot?.game?.scores?.[engine.userId] || 0, others: engine.others.size, facing: engine.facing, movedAt: engine.movedAt,
    }; },
  });
  window.__minimalVisual = diagnostic;
  return {
    hint, checkCurrent,
    async start() { await attempt({ revision: initialRevision }, ++goal); },
    draw(now) {
      if (pending && runtime.safeToSwap) {
        const candidate = pending; pending = null; const saved = captureDOM(current?.shadow), oldView = { ...view.current };
        if (saved) runtime.facade.setUI({ dom: saved });
        try {
          if (candidate.error) throw candidate.error;
          enable(candidate); candidate.renderer.draw(now); disable(current);
          clean(previous); previous = current; current = candidate; restoreDOM(current.shadow, saved);
          loadModule.retain(current.entry, previous?.entry);
          if (previous) status.applied++; status.revision = current.revision; status.phase = 'applied'; publish(); return;
        } catch (error) {
          quarantine.add(candidate.revision); disable(candidate); clean(candidate); view.current = oldView;
          if (current) { enable(current); restoreDOM(current.shadow, saved); } fail(error);
        }
      }
      try { current?.renderer.draw(now); } catch (error) { rollback(error); }
    },
    get ready() { return !!current; },
    dispose() {
      disposed = true; goal++; clearTimeout(retryTimer); preparing?.abort(); document.removeEventListener('visibilitychange', visibility);
      clean(pending); clean(previous); clean(current); bootMessage.remove(); loadModule.clear(); code.clear();
      if (window.__minimalVisual === diagnostic) delete window.__minimalVisual;
    },
  };
}
