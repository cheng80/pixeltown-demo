import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { ROOT, PB_PORT, PB_URL, GAME_PORT, WEB_PORT, STATE_DIR } from '../colyseus/minimal/config.js';
import { startMinimalPocketBase } from './minimal-pocketbase.mjs';
import { prepareRelease, selectRelease, managedEntry, deploymentToken } from './minimal-release.mjs';

const children = []; let stopping = false;
async function stop(code = 0) {
  if (stopping) return; stopping = true;
  // Colyseus gets a chance to commit before the database is stopped.
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode) continue;
    await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  }
  process.exit(code);
}
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
const own = child => {
  children.push(child); child.once('error', error => { console.error(error.message); void stop(1); });
  child.once('exit', code => { if (!stopping) void stop(code || 1); }); return child;
};
async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', () => reject(new Error(`포트 ${port}가 사용 중입니다. 기존 서버는 그대로 둡니다.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
async function ready(url, child) {
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error('Minimal server exited before ready');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Minimal server readiness timed out');
}
try {
  for (const port of [PB_PORT, GAME_PORT, WEB_PORT]) await assertFree(port);
  const release = prepareRelease(); selectRelease(release.directory);
  const { child } = await startMinimalPocketBase(); own(child);
  const env = { ...process.env, MINIMAL_STATE_DIR: STATE_DIR, MINIMAL_WORKER_ENTRY: managedEntry, MINIMAL_SWAP_TOKEN: deploymentToken(), VITE_MINIMAL_PB_URL: PB_URL, VITE_MINIMAL_GAME_URL: `ws://127.0.0.1:${GAME_PORT}` };
  const game = own(spawn(process.execPath, ['colyseus/minimal/server.js'], { cwd: ROOT, env, stdio: 'inherit' }));
  await ready(`http://127.0.0.1:${GAME_PORT}/ready`, game);
  if (process.env.MINIMAL_BACKEND_ONLY !== '1') own(spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.minimal.config.js'], { cwd: ROOT, env, stdio: 'inherit' }));
  console.log(process.env.MINIMAL_BACKEND_ONLY === '1' ? `Minimal backend ready on loopback ports ${PB_PORT}/${GAME_PORT}` : `최소 게임: http://127.0.0.1:${WEB_PORT} — 기존 게임과 데이터가 분리되어 있습니다.`);
} catch (error) { console.error(error.message); await stop(1); }
