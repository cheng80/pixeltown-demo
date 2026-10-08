import React, { useEffect, useRef, useState } from 'react';
import { TICK_MS, blocked, stepToward, stepDirection } from '../../shared/world.js';
import { createRenderer } from './visual-release.js';
import { createVisualUpdater } from './visual-update.js';
import { stopMovement } from './engine.js';
export { createEngine, applySnapshot, stopMovement } from './engine.js';

export default function WorldCanvas({ engine, ready, controls }) {
  const canvasRef = useRef(null);
  const view = useRef({ x: 0, y: 0, scale: 2 });
  const steering = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    let frame = 0;
    const updater = createVisualUpdater({ canvas, engine, view, createRenderer });
    const tick = setInterval(() => {
      // Local-first (ADR-005): lag never holds the avatar back. Unacknowledged steps stay pending; the server only checks them,
      // and a refused step comes back as a fix. The connection object (api.js) owns send failures, recovery resends and
      // the prediction limit: it clears engine.connected when the avatar must stop, and keeps keys, target and pending.
      if (!engine.connected || !engine.initialized || document.hidden) return;
      const dx = Number(engine.keys.has('ArrowRight') || engine.keys.has('d')) - Number(engine.keys.has('ArrowLeft') || engine.keys.has('a')) + engine.pad.x;
      const dy = Number(engine.keys.has('ArrowDown') || engine.keys.has('s')) - Number(engine.keys.has('ArrowUp') || engine.keys.has('w')) + engine.pad.y;
      const old = engine.self;
      const next = dx || dy ? stepDirection(old, dx, dy, TICK_MS) : engine.target ? stepToward(old, engine.target, TICK_MS) : old;
      engine.previous = { ...old }; engine.lastTick = performance.now();
      if (!next || !Number.isFinite(next.x) || !Number.isFinite(next.y) || blocked(next.x, next.y)) { engine.target = null; return; }
      if (next.x === old.x && next.y === old.y) { engine.target = null; return; }
      engine.self = { x: next.x, y: next.y };
      engine.movedAt = engine.lastTick;
      const movement = { ...engine.self, seq: ++engine.seq, fix: engine.fix };
      engine.pending.push(movement);
      engine.send?.(movement);
      if (engine.target && Math.hypot(next.x - engine.target.x, next.y - engine.target.y) < 1) engine.target = null;
    }, TICK_MS);

    const draw = now => { frame = requestAnimationFrame(draw); updater.draw(now); };
    frame = requestAnimationFrame(draw);
    const movementKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']);
    const keyDown = e => {
      if (!engine.connected || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (movementKeys.has(key)) { e.preventDefault(); engine.keys.add(key); engine.target = null; }
    };
    const keyUp = e => engine.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    const stop = () => stopMovement(engine);
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => { clearInterval(tick); cancelAnimationFrame(frame); updater.dispose(); stop();
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', stop); };
  }, [engine]);
  const aim = e => {
    const rect = e.currentTarget.getBoundingClientRect(), v = view.current;
    const target = { x: (e.clientX - rect.left) / v.scale + v.x, y: (e.clientY - rect.top) / v.scale + v.y };
    if (!blocked(target.x, target.y)) { engine.target = target; engine.keys.clear(); }
  };
  return <>
    <canvas ref={canvasRef} className="world" tabIndex={ready ? 0 : -1} aria-label="작은 광장. 방향키나 W A S D로 이동하고 별에 다가가 모으세요." onPointerDown={e => {
      if (!engine.connected) return;
      e.currentTarget.focus({ preventScroll: true });
      steering.current = e.pointerId;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* Synthetic pointer. */ }
      aim(e);
    }} onPointerMove={e => { if (steering.current === e.pointerId && engine.connected) aim(e); }}
    onPointerUp={() => { steering.current = null; }} onPointerCancel={() => { steering.current = null; }} />
    {controls && <Controls engine={engine} ready={ready}/>}
  </>;
}

const PAD = [['위로 이동', 0, -1, 'up'], ['왼쪽으로 이동', -1, 0, 'left'], ['오른쪽으로 이동', 1, 0, 'right'], ['아래로 이동', 0, 1, 'down']];
// One pad element tracks the finger so sliding between arrows (and diagonals) keeps walking.
function Controls({ engine, ready }) {
  const pointer = useRef(null);
  const [active, setActive] = useState('');
  const steer = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2, dy = e.clientY - rect.top - rect.height / 2, dead = rect.width * 0.12;
    const x = Math.abs(dx) > dead && Math.abs(dx) > Math.abs(dy) * 0.45 ? Math.sign(dx) : 0;
    const y = Math.abs(dy) > dead && Math.abs(dy) > Math.abs(dx) * 0.45 ? Math.sign(dy) : 0;
    engine.target = null; engine.pad = { x, y };
    setActive(`${y < 0 ? 'up ' : y > 0 ? 'down ' : ''}${x < 0 ? 'left' : x > 0 ? 'right' : ''}`);
  };
  const release = e => { if (pointer.current === e.pointerId) { pointer.current = null; engine.pad = { x: 0, y: 0 }; setActive(''); } };
  return <div className="controls">
    <div className={`dpad ${active}`} role="group" aria-label="이동 터치패드"
      onPointerDown={e => {
        if (!ready || !engine.connected) return;
        e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* Synthetic pointer. */ }
        pointer.current = e.pointerId; steer(e);
      }}
      onPointerMove={e => { if (pointer.current === e.pointerId) steer(e); }}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
      {PAD.map(([label, x, y, position]) => <button key={position} type="button" className={position} aria-label={label} disabled={!ready}
        onClick={e => { if (e.detail === 0 && engine.connected) engine.target = { x: engine.self.x + x * 16, y: engine.self.y + y * 16 }; }}><i/></button>)}
      <span className="hub" aria-hidden="true"/>
    </div>
    <p className="hint"><kbd>WASD</kbd><kbd>←↑↓→</kbd> 걷기 <span>·</span> <kbd>클릭</kbd> 그곳으로 이동 <span>·</span> 별에 닿으면 획득</p>
  </div>;
}
