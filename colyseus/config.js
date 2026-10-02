import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import PocketBase from 'pocketbase';
export const backendDir = fileURLToPath(new URL('.', import.meta.url));
export const pocketbaseDir = fileURLToPath(new URL('../pocketbase/', import.meta.url));
export const localDir = resolve(process.env.PIXELTOWN_LOCAL_DIR || pocketbaseDir + '.local') + '/';
export const envFile = resolve(process.env.PIXELTOWN_ENV_FILE || pocketbaseDir + '.env.local');
export const pbDataDir = resolve(process.env.PB_DATA_DIR || localDir + 'pb_data');
export const outboxDir = resolve(process.env.OUTBOX_PATH || backendDir + '.local/outbox') + '/';
export const PB_URL = process.env.PB_URL || `http://127.0.0.1:${process.env.PIXELTOWN_PB_PORT || 18090}`;
export { ZONE_IDS as ZONES } from '../shared/world.js';
function requestTimeout(pb) {
  pb.beforeSend=(url,options)=>({url,options:{...options,signal:AbortSignal.timeout(5000)}});
  return pb;
}
export function userClient(token) {
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);
  pb.authStore.save(token);
  return requestTimeout(pb);
}
export function credentials() {
  const env = Object.fromEntries(readFileSync(envFile,'utf8').trim().split('\n').map(line=>line.split('=')));
  if (!env.PB_ADMIN_EMAIL || !env.PB_ADMIN_PASSWORD) throw new Error('Run npm run init first');
  return env;
}
export async function adminClient() {
  const pb = requestTimeout(new PocketBase(PB_URL)); pb.autoCancellation(false);
  const env = credentials();
  await pb.collection('_superusers').authWithPassword(env.PB_ADMIN_EMAIL,env.PB_ADMIN_PASSWORD);
  return pb;
}
