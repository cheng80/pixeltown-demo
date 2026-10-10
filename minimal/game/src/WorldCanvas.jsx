import React, { useCallback, useRef, useState } from 'react';

// The canvas, draw loop, keyboard and canvas pointer input belong to the runtime surface (surface.js) and outlive every UI
// release. The UI only marks where the world goes; the surface tracks this slot's box and keeps the canvas beneath it.
export default function WorldCanvas({ runtime, ready, moving, controls }) {
  const bind = useCallback(element => { if (element) runtime.bindWorldSlot(element); }, [runtime]);
  return <>
    <div ref={bind} className="world-slot" aria-hidden="true"/>
    {controls && <Controls runtime={runtime} ready={ready} moving={moving}/>}
  </>;
}

const PAD = [['위로 이동', 0, -1, 'up'], ['왼쪽으로 이동', -1, 0, 'left'], ['오른쪽으로 이동', 1, 0, 'right'], ['아래로 이동', 0, 1, 'down']];
// One pad element tracks the finger so sliding between arrows (and diagonals) keeps walking.
// While the pad holds a pointer capture the runtime defers any UI swap; unmounting sends nothing.
function Controls({ runtime, ready, moving }) {
  const pointer = useRef(null);
  const [active, setActive] = useState('');
  const steer = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2, dy = e.clientY - rect.top - rect.height / 2, dead = rect.width * 0.12;
    const x = Math.abs(dx) > dead && Math.abs(dx) > Math.abs(dy) * 0.45 ? Math.sign(dx) : 0;
    const y = Math.abs(dy) > dead && Math.abs(dy) > Math.abs(dx) * 0.45 ? Math.sign(dy) : 0;
    runtime.setPad(x, y);
    setActive(`${y < 0 ? 'up ' : y > 0 ? 'down ' : ''}${x < 0 ? 'left' : x > 0 ? 'right' : ''}`);
  };
  const release = e => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null; runtime.setPad(0, 0); runtime.setInteraction('pad', false); setActive('');
  };
  return <div className="controls">
    <div className={`dpad ${active}`} role="group" aria-label="이동 터치패드"
      onPointerDown={e => {
        if (!moving) return;
        e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* Synthetic pointer. */ }
        pointer.current = e.pointerId; runtime.setInteraction('pad', true); steer(e);
      }}
      onPointerMove={e => { if (pointer.current === e.pointerId) steer(e); }}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
      {PAD.map(([label, x, y, position]) => <button key={position} type="button" className={position} aria-label={label} disabled={!ready}
        onClick={e => { if (e.detail === 0 && moving) runtime.nudge(x, y); }}><i/></button>)}
      <span className="hub" aria-hidden="true"/>
    </div>
    <p className="hint"><kbd>WASD</kbd><kbd>←↑↓→</kbd> 걷기 <span>·</span> <kbd>클릭</kbd> 그곳으로 이동 <span>·</span> 별에 닿으면 획득</p>
  </div>;
}
