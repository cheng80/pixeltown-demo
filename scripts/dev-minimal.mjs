import { spawn } from 'node:child_process';
import { ROOT, PB_PORT, PB_URL, GAME_PORT, WEB_PORT, STATE_DIR } from '../colyseus/minimal/config.js';
import { assertFree, waitReady, stopChild } from './minimal-process.mjs';

const services = []; let stopping = false, starting = true;
async function stop(code = 0) {
  if (stopping) return; stopping = true;
  // Colyseus gets a chance to commit before the database is stopped.
  for (const service of services) clearTimeout(service.retry);
  for (const service of [...services].reverse()) await stopChild(service.child);
  process.exit(code);
}
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
const env = { ...process.env, MINIMAL_STATE_DIR: STATE_DIR, VITE_MINIMAL_PB_URL: PB_URL, VITE_MINIMAL_GAME_URL: `ws://127.0.0.1:${GAME_PORT}` };
function launch(service) {
  service.startedAt = Date.now();
  const child = spawn(process.execPath, service.args, { cwd: ROOT, env, stdio: 'inherit' });
  service.child = child;
  let handled = false;
  const exited = () => {
    if (handled || stopping) return; handled = true;
    // Once the host starts it can already accept a player, even before this
    // launcher prints ready. PB failing in that window must not kill the host.
    if (starting && !services.some(s => s.name === 'game')) return void stop(1);
    // Restart only the failed component. In particular PB must not stop the game.
    service.backoff = Date.now() - service.startedAt > 30000 ? 1000 : Math.min(30000, (service.backoff || 500) * 2);
    console.error(`Minimal ${service.name} stopped; restarting only this component in ${service.backoff}ms`);
    service.retry = setTimeout(() => launch(service), service.backoff);
  };
  child.once('error', exited); child.once('exit', exited);
  return child;
}
function service(name, args) {
  const value = { name, args }; services.push(value); return launch(value);
}
try {
  for (const port of [PB_PORT, GAME_PORT, ...(process.env.MINIMAL_BACKEND_ONLY === '1' ? [] : [WEB_PORT])]) await assertFree(port);
  const pb = service('PB', ['scripts/minimal-pocketbase.mjs']);
  await waitReady(`${PB_URL}/api/health`, pb);
  const game = service('game', ['scripts/start-minimal-game.mjs']);
  await waitReady(`http://127.0.0.1:${GAME_PORT}/ready`, game);
  if (process.env.MINIMAL_BACKEND_ONLY !== '1') service('web', ['node_modules/vite/bin/vite.js', '--config', 'vite.minimal.config.js']);
  starting = false;
  console.log(process.env.MINIMAL_BACKEND_ONLY === '1' ? `Minimal backend ready on loopback ports ${PB_PORT}/${GAME_PORT}` : `최소 게임: http://127.0.0.1:${WEB_PORT} — 기존 게임과 데이터가 분리되어 있습니다.`);
} catch (error) { console.error(error.message); await stop(1); }
