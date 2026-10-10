import { TICK_MS, blocked, stepToward, stepDirection } from '../../shared/world.js';
import { stopMovement, advanceDisplay } from './engine.js';

export function createSurface(runtime) {
  const { engine } = runtime, canvas = document.createElement('canvas'), view = { current: { x: 0, y: 0, scale: 2 } };
  canvas.className = 'world'; canvas.tabIndex = -1;
  canvas.setAttribute('aria-label', '작은 광장. 방향키나 W A S D로 이동하고 별에 다가가 모으세요.');
  document.body.append(canvas);
  let ticks = 0, frames = 0, disposed = false;
  let slot, frame, draw = () => {}, pointer = null;
  const position = () => {
    if (!slot?.isConnected) return;
    const rect = slot.getBoundingClientRect();
    Object.assign(canvas.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  const observer = new ResizeObserver(position);
  function bindWorldSlot(element) { if (!element) return; observer.disconnect(); slot = element; observer.observe(element); position(); }
  runtime.setHooks({ onBindSlot: bindWorldSlot });
  const tick = setInterval(() => {
    ticks++;
    if (!engine.connected || !engine.initialized || document.hidden) return;
    const dx = Number(engine.keys.has('ArrowRight') || engine.keys.has('d')) - Number(engine.keys.has('ArrowLeft') || engine.keys.has('a')) + engine.pad.x;
    const dy = Number(engine.keys.has('ArrowDown') || engine.keys.has('s')) - Number(engine.keys.has('ArrowUp') || engine.keys.has('w')) + engine.pad.y;
    const old = engine.self;
    const next = dx || dy ? stepDirection(old, dx, dy, TICK_MS) : engine.target ? stepToward(old, engine.target, TICK_MS) : old;
    engine.previous = { ...old }; engine.lastTick = performance.now();
    if (!next || !Number.isFinite(next.x) || !Number.isFinite(next.y) || blocked(next.x, next.y)) { engine.target = null; return; }
    if (next.x === old.x && next.y === old.y) { engine.target = null; return; }
    engine.self = { x: next.x, y: next.y }; engine.movedAt = engine.lastTick;
    const movement = { ...engine.self, seq: ++engine.seq, fix: engine.fix };
    engine.pending.push(movement); engine.send?.(movement);
    if (engine.target && Math.hypot(next.x - engine.target.x, next.y - engine.target.y) < 1) engine.target = null;
  }, TICK_MS);
  const loop = now => { frames++; frame = requestAnimationFrame(loop); position(); advanceDisplay(engine, now); draw(now); canvas.tabIndex = runtime.facade.getSnapshot().phase === 'playing' ? 0 : -1; };
  frame = requestAnimationFrame(loop);
  const movementKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']);
  const keyDown = e => {
    const target = e.composedPath()[0];
    if (!engine.connected || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (movementKeys.has(key)) { e.preventDefault(); engine.keys.add(key); engine.target = null; }
  };
  const keyUp = e => engine.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  const stop = () => { stopMovement(engine); pointer = null; runtime.facade.setInteraction('world', false); };
  const aim = e => {
    const rect = canvas.getBoundingClientRect(), v = view.current;
    const target = { x: (e.clientX - rect.left) / v.scale + v.x, y: (e.clientY - rect.top) / v.scale + v.y };
    if (!blocked(target.x, target.y)) { engine.target = target; engine.keys.clear(); }
  };
  canvas.onpointerdown = e => {
    if (!engine.connected) return;
    canvas.focus({ preventScroll: true }); pointer = e.pointerId; runtime.facade.setInteraction('world', true);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* Synthetic pointer. */ } aim(e);
  };
  canvas.onpointermove = e => { if (pointer === e.pointerId && engine.connected) aim(e); };
  const release = e => { if (pointer === e.pointerId) { pointer = null; runtime.facade.setInteraction('world', false); } };
  canvas.onpointerup = release; canvas.onpointercancel = release; canvas.onlostpointercapture = release;
  window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', stop);
  return { canvas, view, bindWorldSlot, get metrics() { return { ticks, frames, inputTimers: disposed ? 0 : 1, drawLoops: disposed ? 0 : 1, inputListeners: disposed ? 0 : 5 }; }, setDraw(callback) { draw = callback; },
    dispose() { disposed = true; clearInterval(tick); cancelAnimationFrame(frame); observer.disconnect(); stop(); canvas.remove();
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', stop); },
  };
}
