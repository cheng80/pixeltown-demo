import PocketBase, { LocalAuthStore } from 'pocketbase';
import { PREFIX, readStored, writeStored } from './state.js';
import { createConnection } from './connection.js';

export const PB_URL = import.meta.env.VITE_MINIMAL_PB_URL || 'http://127.0.0.1:18120';
export const GAME_URL = import.meta.env.VITE_MINIMAL_GAME_URL || 'ws://127.0.0.1:12620';
export const createGameConnection = options => createConnection({ ...options, url: GAME_URL });
export const pb = new PocketBase(PB_URL, new LocalAuthStore(PREFIX + 'auth'));
pb.autoCancellation(false);
export const savedGuest = () => {
  const value = readStored('guest');
  return typeof value?.email === 'string' && typeof value?.password === 'string' ? value : null;
};

export async function request(path, { token, body, signal } = {}) {
  const response = await fetch(new URL(path, PB_URL), {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal, cache: 'no-store',
  });
  if (!response.ok) {
    const error = new Error('Request failed');
    error.status = response.status;
    const retryAfter = response.headers.get('Retry-After');
    error.retryAfterMs = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())) : 0;
    throw error;
  }
  return response.json();
}

export async function authenticate(name, signal) {
  const guest = savedGuest();
  if (guest) return pb.collection('users').authWithPassword(guest.email, guest.password, { signal, requestKey: null });
  if (pb.authStore.isValid && pb.authStore.record?.id) return pb.collection('users').authRefresh({ signal, requestKey: null });
  if (!name) throw new Error('Name required');
  // Check persistence before creating an account. Never clear the existing game's credentials.
  if (!writeStored('storage-check', true)) throw new Error('Storage unavailable');
  const password = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
  const auth = await request('/api/minimal/guest', { body: { name: name.trim(), password }, signal });
  if (!auth.token || !auth.record?.id || !auth.record?.email) throw new Error('Invalid guest response');
  pb.authStore.save(auth.token, auth.record);
  if (!writeStored('guest', { email: auth.record.email, password })) {
    const error = new Error('Storage unavailable after creation');
    error.storageFailure = true;
    throw error;
  }
  return auth;
}
