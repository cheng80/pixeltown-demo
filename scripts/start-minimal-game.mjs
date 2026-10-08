// Own only the connection host. PocketBase has a separate lifetime.
import { spawn } from 'node:child_process';
import { ROOT, GAME_PORT, STATE_DIR, credentials } from '../colyseus/minimal/config.js';
import { prepareRelease, selectRelease, selectedRelease, managedEntry, deploymentToken, deploymentLock } from './minimal-release.mjs';
import { assertFree, waitReady, stopChild } from './minimal-process.mjs';

let child, stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await stopChild(child);
  process.exit(code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('exit', () => child?.kill('SIGTERM'));
try {
  await assertFree(GAME_PORT);
  credentials(); // Provision the PB account before first start, without requiring PB online.
  const unlock = deploymentLock();
  try {
    // A host restart must not silently deploy source files over the selected release.
    if (!selectedRelease()) selectRelease(prepareRelease().directory);
  } finally { unlock(); }
  if (stopping) process.exit(0);
  child = spawn(process.execPath, ['colyseus/minimal/server.js'], {
    cwd: ROOT, stdio: 'inherit',
    env: { ...process.env, MINIMAL_STATE_DIR: STATE_DIR, MINIMAL_WORKER_ENTRY: managedEntry, MINIMAL_SWAP_TOKEN: deploymentToken() },
  });
  child.once('error', () => { console.error('Cannot start minimal game host'); void stop(1); });
  child.once('exit', code => { if (!stopping) void stop(code || 1); });
  // /ready checks PB admission. /health checks the independently running game host.
  await waitReady(`http://127.0.0.1:${GAME_PORT}/health`, child);
  console.log(`Minimal game host ready on loopback port ${GAME_PORT}; PB lifecycle is independent`);
} catch (error) { console.error(error.message); await stop(1); }
