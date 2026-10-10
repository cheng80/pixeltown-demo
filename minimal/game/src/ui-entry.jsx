import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './main.jsx';
import './style.css';
export { createRenderer } from './visual-release.js';
export default App;

// The UI release entry: every release brings its own React and mounts its own root. Nothing React-made crosses releases.
const COMMANDS = ['enter', 'refreshWallet', 'setUI', 'setPad', 'setInteraction', 'bindWorldSlot', 'nudge'];

class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}
function Committed({ onCommit }) { useLayoutEffect(onCommit, []); return null; }

export function mountUI({ root, runtime, signal }) {
  let active = false, disposed = false, committed = false, reactRoot = null;
  const report = error => { try { runtime.reportUIError(error); } catch { /* Reporting cannot break play. */ } };
  // A candidate or retired release never drives the shared runtime: commands pass only while active,
  // so mount effects, unmount and late callbacks cannot start input or requests.
  const ui = { getSnapshot: () => runtime.getSnapshot(), subscribe: listener => runtime.subscribe(listener), reportUIError: report };
  for (const name of COMMANDS) ui[name] = (...args) => {
    if (!active || disposed) return;
    try {
      const result = runtime[name](...args);
      if (typeof result?.then === 'function') result.then(null, report);
      return result;
    } catch (error) { report(error); }
  };
  const ownError = event => {
    const error = event.error || event.reason;
    if (active && !disposed && (event.filename === import.meta.url || String(error?.stack || '').includes(import.meta.url))) { event.preventDefault(); report(error || new Error('UI callback failed')); }
  };
  window.addEventListener('error', ownError); window.addEventListener('unhandledrejection', ownError);
  const unmount = () => { window.removeEventListener('error', ownError); window.removeEventListener('unhandledrejection', ownError); const r = reactRoot; reactRoot = null; r?.unmount(); };
  const dispose = () => { if (disposed) return; disposed = true; active = false; unmount(); };
  return new Promise((resolve, reject) => {
    const fail = error => {
      if (disposed) return;
      disposed = true; active = false; signal?.removeEventListener('abort', cancel); reject(error);
      queueMicrotask(unmount); // Not inside React's own commit.
    };
    const cancel = () => fail(new Error('UI preparation cancelled'));
    const onError = error => { if (committed) report(error); else fail(error); };
    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    const onCommit = () => {
      if (disposed) return;
      committed = true; signal?.removeEventListener('abort', cancel);
      resolve({
        setActive(next) {
          if (disposed) return;
          active = !!next;
          // The candidate facade ignored the mount-time bind; point the surface at this release's slot now.
          const slot = active && root.querySelector('.world-slot');
          if (slot) ui.bindWorldSlot(slot);
        },
        dispose,
      });
    };
    try {
      reactRoot = createRoot(root, { onUncaughtError: onError });
      reactRoot.render(<Boundary onError={onError}><App runtime={ui}/><Committed onCommit={onCommit}/></Boundary>);
    } catch (error) { fail(error); }
  });
}
