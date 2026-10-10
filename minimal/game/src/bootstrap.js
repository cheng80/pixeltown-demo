import { createRuntime } from './runtime.js';
import { createSurface } from './surface.js';
import { createVisualUpdater } from './visual-update.js';
import './bootstrap.css';

async function boot() {
  const runtime = createRuntime(), surface = createSurface(runtime);
  window.__minimal = Object.freeze({
    get snapshot() { return structuredClone(runtime.engine.snapshot || null); },
    get current() { return structuredClone(runtime.engine.snapshot || null); },
    get room() { return runtime.engine.room ? { roomId: runtime.engine.room.roomId, sessionId: runtime.engine.room.sessionId } : null; },
    get userId() { return runtime.facade.getSnapshot().user?.id || null; },
    get connection() { return runtime.connection ? { ...runtime.connection.status } : null; },
  });
  if (import.meta.env.DEV) {
    const module = await import('./ui-entry.jsx');
    const host = document.createElement('div'); host.className = 'ui-release';
    const shadow = host.attachShadow({ mode: 'open' }), root = document.createElement('div'); root.id = 'ui-root'; shadow.append(root);
    document.getElementById('root').append(host);
    for (const href of [...document.querySelectorAll('link[rel=stylesheet]')].map(link => link.href).concat('/src/style.css?direct')) {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; shadow.append(link);
    }
    const ui = await module.mountUI({ root, runtime: runtime.facade, resources: {}, signal: new AbortController().signal }); ui.setActive(true);
    const renderer = module.createRenderer({ canvas: surface.canvas, engine: runtime.engine, view: surface.view }); surface.setDraw(now => renderer.draw(now));
    window.__minimalDebug = { engine: runtime.engine };
    runtime.start();
  } else {
    const updater = createVisualUpdater({ runtime, surface });
    let started = false;
    surface.setDraw(now => { updater.draw(now); if (!started && updater.ready) { started = true; runtime.start(); void updater.checkCurrent(); } });
    await updater.start();
  }
}
void boot().catch(() => { document.getElementById('root').textContent = '화면을 불러오지 못했어요. 잠시 후 새로고침해 주세요.'; });
