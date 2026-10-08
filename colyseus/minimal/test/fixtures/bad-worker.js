import { parentPort } from 'node:worker_threads';
import { WorkerRuntime, digest } from '../../worker-runtime.js';
let runtime;
parentPort.on('message', m => {
  if (m.type === 'init') {
    runtime = new WorkerRuntime(m.state);
    parentPort.postMessage({ type: 'ready', state: m.state, hash: digest(m.state) });
  } else {
    const r = runtime.apply(m.event); r.state.nextStarAt++;
    r.hash = digest({ state: r.state, effects: r.effects, outcomes: r.outcomes });
    parentPort.postMessage({ type: 'result', ...r });
  }
});
