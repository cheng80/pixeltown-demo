// Select a complete immutable release, then ask the existing host to swap.
// Never restart the host/PB and never print the control token.
import { GAME_PORT } from '../colyseus/minimal/config.js';
import { prepareRelease, selectRelease, selectedRelease, deploymentToken, deploymentLock } from './minimal-release.mjs';
const base = `http://127.0.0.1:${GAME_PORT}`;
const health = async () => {
  const response = await fetch(base + '/health', { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Connection host is not healthy');
  return response.json();
};
const releaseLock = deploymentLock();
try {
  const before = await health();
  if (!before.hotSwap || before.workerDeployment !== 'managed-release') throw new Error('Host must be started with managed releases');
  if (!before.worker) throw new Error('No active lobby; no release changed');
  const previous = selectedRelease();
  if (!previous) throw new Error('No previous managed release');
  const next = prepareRelease();
  if (next.revision === before.worker.revision) {
    console.log(JSON.stringify({ unchanged: true, revision: next.revision, generation: before.worker.generation }));
  } else {
    const token = deploymentToken(); selectRelease(next.directory);
    let response;
    try {
      response = await fetch(base + '/internal/worker/swap', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    } catch {
      // A lost HTTP response does not prove that promotion failed.
      const observed = await health().catch(() => null);
      if (observed?.worker?.revision === next.revision) console.log(JSON.stringify({ reconciled: true, revision: next.revision, generation: observed.worker.generation }));
      else if (observed?.worker?.revision === before.worker.revision && !observed.worker.candidate) {
        selectRelease(previous); throw new Error('Swap did not complete; previous release selected');
      } else throw new Error('Swap result is unknown; selected release retained. Inspect health before retrying.');
    }
    if (response) {
      if (!response.ok) { selectRelease(previous); throw new Error('Candidate rejected; previous release selected'); }
      const result = await response.json();
      if (result.revision !== next.revision) throw new Error('Unexpected active revision; inspect host before retrying');
      console.log(JSON.stringify(result, null, 2));
    }
  }
} finally { releaseLock(); }
