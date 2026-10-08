import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import PocketBase from 'pocketbase';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
function port(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`Invalid ${name}`);
  return value;
}
export const PB_PORT = port('MINIMAL_PB_PORT', 18120);
export const GAME_PORT = port('MINIMAL_GAME_PORT', 12620);
export const WEB_PORT = port('MINIMAL_WEB_PORT', 5270);
if (new Set([PB_PORT, GAME_PORT, WEB_PORT]).size !== 3) throw new Error('Minimal ports must be different');
export const PB_URL = `http://127.0.0.1:${PB_PORT}`;
export const STATE_DIR = resolve(process.env.MINIMAL_STATE_DIR || resolve(ROOT, '.local/minimal'));
const within = (base, value) => { const r = relative(base, value); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const roots = [resolve(ROOT, '.local/minimal'), resolve(ROOT, '.test-work')];
if (!roots.some(base => within(base, STATE_DIR)) || STATE_DIR === resolve(ROOT, '.test-work')) {
  throw new Error('Minimal state must be in .local/minimal or a dedicated .test-work subdirectory');
}
// Refuse a symlink that redirects the isolated state tree into the old database or another project.
let ancestor = STATE_DIR;
while (!existsSync(ancestor)) ancestor = resolve(ancestor, '..');
if (realpathSync(ancestor) !== ancestor.replace(/\/$/, '')) throw new Error('Minimal state path must not traverse a symlink');
export const OUTBOX_DIR = resolve(STATE_DIR, 'outbox');
export function credentials() {
  if (process.env.MINIMAL_PB_ADMIN_EMAIL && process.env.MINIMAL_PB_ADMIN_PASSWORD) {
    return { MINIMAL_PB_ADMIN_EMAIL: process.env.MINIMAL_PB_ADMIN_EMAIL, MINIMAL_PB_ADMIN_PASSWORD: process.env.MINIMAL_PB_ADMIN_PASSWORD };
  }
  return JSON.parse(readFileSync(resolve(STATE_DIR, 'admin.json'), 'utf8'));
}
export function userClient(token) {
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);
  if (token) pb.authStore.save(token);
  pb.beforeSend = (url, options) => ({ url, options: { ...options, signal: AbortSignal.timeout(5000) } });
  return pb;
}
export async function adminClient() {
  const c = credentials(), pb = userClient();
  await pb.collection('_superusers').authWithPassword(c.MINIMAL_PB_ADMIN_EMAIL, c.MINIMAL_PB_ADMIN_PASSWORD);
  return pb;
}
