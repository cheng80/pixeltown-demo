import { parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { WorkerRuntime, digest } from './worker-runtime.js';
const revision = digest(['simulation-worker.js', 'worker-runtime.js', 'simulation.js', '../../minimal/shared/world.js'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')));
let runtime;
parentPort.on('message', message => {
  try {
    if (message.type === 'init') {
      runtime = new WorkerRuntime(message.state, message.options);
      const state = runtime.state();
      parentPort.postMessage({ type: 'ready', state, hash: digest(state), revision });
    } else if (message.type === 'event') {
      parentPort.postMessage({ type: 'result', ...runtime.apply(message.event) });
    }
  } catch (error) { parentPort.postMessage({ type: 'fault', error: error.message }); }
});
