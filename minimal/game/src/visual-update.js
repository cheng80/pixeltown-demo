// The room, input timer and engine outlive every visual release.
const COMPATIBILITY = typeof __MINIMAL_VISUAL_COMPAT__ === 'undefined' ? 'development' : __MINIMAL_VISUAL_COMPAT__;
const INITIAL_REVISION = typeof __MINIMAL_VISUAL_REVISION__ === 'undefined' ? 'development' : __MINIMAL_VISUAL_REVISION__;
const SHA = /^[a-f0-9]{64}$/;

export function validateVisualManifest(value, compatibility, origin) {
  if (!value || value.schema !== 1 || !SHA.test(value.revision) || !SHA.test(value.compatibility)) throw new Error('Invalid visual manifest');
  if (value.compatibility !== compatibility) return null;
  const prefix = `/visual/releases/${value.revision}/`;
  const validURL = path => {
    if (typeof path !== 'string') throw new Error('Invalid resource URL');
    const url = new URL(path, origin);
    if (url.origin !== origin || !url.pathname.startsWith(prefix) || url.search || url.hash || !path.startsWith(prefix)) throw new Error('Invalid resource URL');
    return url.href;
  };
  if (![value.styles, value.fonts, value.images].every(a => Array.isArray(a) && a.length <= 128)) throw new Error('Invalid resource list');
  validURL(value.entry);
  value.styles.forEach(validURL);
  for (const f of value.fonts) {
    if (!f || !['400', '700'].includes(f.weight)) throw new Error('Invalid font');
    validURL(f.url);
  }
  for (const i of value.images) {
    if (!i || typeof i.name !== 'string' || !i.name || i.name.length > 200) throw new Error('Invalid image');
    validURL(i.url);
  }
  return value;
}

function previewEngine(engine) {
  return { ...engine, room: null, send: null, self: { ...engine.self }, previous: { ...engine.previous },
    keys: new Set(engine.keys), pad: { ...engine.pad }, target: engine.target && { ...engine.target },
    pending: structuredClone(engine.pending), others: new Map([...engine.others].map(([id, p]) => [id, structuredClone(p)])),
    stars: structuredClone(engine.stars), snapshot: engine.snapshot && structuredClone(engine.snapshot) };
}

export function createVisualUpdater({ canvas, engine, view, createRenderer }) {
  let current = { renderer: createRenderer({ canvas, engine, view }), styles: [...document.querySelectorAll('link[rel="stylesheet"]')], fonts: [] };
  let previous = null, pending = null, disposed = false, busy = false, timer, controller;
  const status = { phase: 'idle', revision: INITIAL_REVISION, compatibility: COMPATIBILITY, applied: 0, failures: 0, rollbacks: 0, checkedAt: null };
  const diag = Object.freeze({
    get status() { return { ...status }; },
    get movement() { const me = engine.snapshot?.players?.find(p => p.id === engine.userId); return {
      connected: engine.connected, userId: engine.userId, roomId: engine.room?.roomId, sessionId: engine.room?.sessionId,
      seq: engine.seq, ack: me?.ack, fix: engine.fix, x: engine.self.x, y: engine.self.y, pending: engine.pending.length,
      keys: [...engine.keys], pad: { ...engine.pad }, target: engine.target && { ...engine.target },
      lastSnapshot: engine.lastSnapshot, score: engine.snapshot?.game?.scores?.[engine.userId] || 0,
      others: engine.others.size, facing: engine.facing, movedAt: engine.movedAt,
    }; },
  });
  window.__minimalVisual = diag;
  const publish = () => {
    canvas.dataset.visualRevision = status.revision;
    window.dispatchEvent(new CustomEvent('minimal-visual-status', { detail: { ...status } }));
  };
  publish();
  const clean = release => {
    if (!release) return;
    try { release.renderer?.dispose?.(); } catch { /* Disposal cannot interrupt play. */ }
    release.styles.forEach(link => link.remove());
    release.fonts.forEach(font => document.fonts.delete(font));
  };
  const enable = release => { release.styles.forEach(link => { link.media = 'all'; link.disabled = false; }); release.fonts.forEach(font => document.fonts.add(font)); };
  const disable = release => release.styles.forEach(link => { link.disabled = true; });
  const fail = error => { status.failures++; status.phase = 'retained'; status.reason = String(error?.message || 'Renderer failed').slice(0, 160); publish(); };
  async function prepare(manifest, signal) {
    const release = { styles: [], fonts: [], resources: { images: new Map() }, revision: manifest.revision };
    const family = `PixelTown_${manifest.revision}`;
    const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Visual preparation timed out')), { once: true }));
    try {
      await Promise.race([Promise.all([
        ...manifest.styles.map(href => new Promise((resolve, reject) => {
          const link = document.createElement('link'); link.rel = 'stylesheet'; link.media = 'not all'; link.href = href;
          release.styles.push(link); link.onload = resolve; link.onerror = () => reject(new Error('Style unavailable')); document.head.append(link);
        })),
        ...manifest.fonts.map(async f => {
          const font = new FontFace(family, `url("${f.url}")`, { weight: f.weight });
          release.fonts.push(font); await font.load();
        }),
        ...manifest.images.map(async i => {
          const image = new Image(); image.src = i.url; await image.decode(); release.resources.images.set(i.name, image);
        }),
        (async () => {
          const module = await import(/* @vite-ignore */ manifest.entry);
          if (typeof module.createRenderer !== 'function') throw new Error('Renderer unavailable');
          release.factory = module.createRenderer;
        })(),
      ]), aborted]);
      if (signal.aborted || disposed) throw new Error('Visual preparation cancelled');
      const testCanvas = document.createElement('canvas');
      Object.defineProperties(testCanvas, { clientWidth: { value: canvas.clientWidth || 640 }, clientHeight: { value: canvas.clientHeight || 416 } });
      const test = release.factory({ canvas: testCanvas, engine: previewEngine(engine), view: { current: { ...view.current } }, fontFamily: family, resources: release.resources });
      try { if (typeof test?.draw !== 'function') throw new Error('Invalid renderer'); test.draw(performance.now()); } finally { test?.dispose?.(); }
      release.renderer = release.factory({ canvas, engine, view, fontFamily: family, resources: release.resources });
      if (typeof release.renderer?.draw !== 'function') throw new Error('Invalid renderer');
      return release;
    } catch (error) { clean(release); throw error; }
  }
  async function check() {
    if (disposed || busy || pending) return;
    busy = true; controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`/visual/current.json?check=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Visual manifest unavailable');
      const manifest = validateVisualManifest(await response.json(), COMPATIBILITY, location.origin);
      status.checkedAt = Date.now();
      if (!manifest) { status.phase = 'incompatible'; publish(); return; }
      if (manifest.revision === status.revision) { status.phase = 'idle'; publish(); return; }
      status.phase = 'preparing'; publish();
      const candidate = await prepare(manifest, controller.signal);
      if (disposed) { clean(candidate); return; }
      pending = candidate;
    } catch (error) { if (!disposed) fail(error); }
    finally { clearTimeout(deadline); busy = false; }
  }
  // Development continues to use Vite. Production uses the immutable manifest.
  if (!import.meta.env.DEV) { timer = setInterval(() => { void check(); }, 15000); void check(); }
  return {
    draw(now) {
      if (pending) {
        const candidate = pending; pending = null;
        const display = { others: new Map([...engine.others].map(([id, p]) => [id, structuredClone(p)])), facing: engine.facing, view: { ...view.current } };
        try {
          enable(candidate); disable(current); candidate.renderer.draw(now);
          clean(previous); previous = current; current = candidate;
          current.priorRevision = status.revision; status.revision = candidate.revision; status.phase = 'applied'; status.applied++; publish();
          return;
        } catch (error) {
          engine.others = display.others; engine.facing = display.facing; view.current = display.view;
          disable(candidate); enable(current); clean(candidate); fail(error);
        }
      }
      try { current.renderer.draw(now); }
      catch (error) {
        if (previous) {
          const failed = current; current = previous; previous = null;
          disable(failed); enable(current); status.revision = failed.priorRevision; status.rollbacks++; clean(failed); fail(error);
          try { current.renderer.draw(now); } catch { /* Keep movement and the last painted frame alive. */ }
        } else fail(error);
      }
    },
    dispose() {
      disposed = true; clearInterval(timer); controller?.abort(); clean(pending); clean(previous);
      // Initial host styles belong to React's page, not the renderer lifecycle.
      if (current.revision) clean(current); else { try { current.renderer.dispose?.(); } catch {} }
      if (window.__minimalVisual === diag) delete window.__minimalVisual;
    },
  };
}
