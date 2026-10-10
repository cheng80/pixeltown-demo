import * as nodeFs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const SHA = /^[a-f0-9]{64}$/;
const EMPTY_NOTIFICATION = () => ({ state: 'not-attempted', targets: 0, failed: 0 });
const fail = (status, message) => Object.assign(new Error(message), { status });
const safeGeneration = value => Number.isSafeInteger(value) && value >= 0;
const metadata = value => value && typeof value === 'object' && !Array.isArray(value) &&
  SHA.test(value.revision) && SHA.test(value.compatibility) && value.uiApiVersion === 1 && value.uiStateSchema === 1;
const hint = (generation, current) => current && ({ schema: 1, generation, ...current });

export function frontendOrigin(value) {
  const url = new URL(value);
  if (url.origin !== value || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('MINIMAL_FRONTEND_ORIGIN requires an exact HTTPS origin or loopback HTTP origin');
  return value;
}

export function validateFrontendManifest(value, origin) {
  if (!metadata(value) || value.schema !== 2) throw fail(502, 'Invalid frontend manifest');
  const prefix = `/visual/releases/${value.revision}/`;
  const paths = new Set();
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 256) throw fail(502, 'Invalid frontend files');
  for (const file of value.files) {
    const path = file?.path;
    if (typeof path !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(path) || path.startsWith('/') || path.split('/').some(segment => !segment || segment === '.' || segment === '..') || !SHA.test(file.sha256) || paths.has(path)) throw fail(502, 'Invalid frontend file');
    paths.add(path);
  }
  const resource = path => {
    if (typeof path !== 'string' || !path.startsWith(prefix)) throw fail(502, 'Invalid frontend resource');
    const relative = path.slice(prefix.length);
    const url = new URL(path, origin);
    if (!paths.has(relative) || url.origin !== origin || url.pathname !== path || url.search || url.hash) throw fail(502, 'Invalid frontend resource');
  };
  if (!Array.isArray(value.styles) || !Array.isArray(value.fonts) || !Array.isArray(value.images) || [value.styles, value.fonts, value.images].some(items => items.length > 128)) throw fail(502, 'Invalid frontend resources');
  resource(value.entry); if (!value.entry.endsWith('.js')) throw fail(502, 'Invalid frontend entry');
  value.styles.forEach(path => { resource(path); if (!path.endsWith('.css')) throw fail(502, 'Invalid frontend style'); });
  for (const font of value.fonts) {
    if (!font || !['400', '700'].includes(font.weight)) throw fail(502, 'Invalid frontend font');
    resource(font.url);
  }
  for (const image of value.images) {
    if (!image || typeof image.name !== 'string' || !image.name || image.name.length > 200) throw fail(502, 'Invalid frontend image');
    resource(image.url);
  }
  return { revision: value.revision, compatibility: value.compatibility, uiApiVersion: 1, uiStateSchema: 1 };
}

export async function readFrontendCurrent(origin, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(`${origin}/visual/current.json`, { redirect: 'manual', cache: 'no-store', signal: controller.signal });
    if (response.status !== 200) throw fail(502, 'Frontend current unavailable');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 256 * 1024) throw fail(502, 'Frontend current too large');
      chunks.push(Buffer.from(chunk));
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw fail(502, 'Invalid frontend current JSON'); }
    return validateFrontendManifest(value, origin);
  } catch (error) {
    throw error.status === 502 ? error : fail(502, 'Frontend current fetch failed');
  } finally { clearTimeout(timeout); controller.abort(); }
}

export class FrontendCurrent {
  constructor({ dir, origin, clients = () => [], fs = nodeFs, fetchImpl = fetch }) {
    this.dir = dir; this.file = join(dir, 'frontend-current.json'); this.origin = frontendOrigin(origin);
    this.clients = clients; this.fs = fs; this.fetchImpl = fetchImpl; this.queue = Promise.resolve();
    this.state = 'uninitialized'; this.generation = 0; this.current = null; this.notification = EMPTY_NOTIFICATION();
    this.restore();
  }
  restore() {
    try {
      const value = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      if (!safeGeneration(value.generation) || value.generation < 1 || !metadata(value.current) || Object.keys(value.current).sort().join(',') !== 'compatibility,revision,uiApiVersion,uiStateSchema') throw Error('Invalid frontend state');
      this.generation = value.generation; this.current = value.current; this.state = 'ready';
    } catch (error) { if (error.code !== 'ENOENT') this.state = 'error'; }
  }
  status() { return { state: this.state, generation: this.generation, current: this.current, notification: this.notification }; }
  hint() { return this.state === 'error' || this.state === 'reconcile-required' ? null : hint(this.generation, this.current); }
  broadcast() {
    const current = this.hint();
    if (!current) return this.notification = EMPTY_NOTIFICATION();
    let targets = 0, failed = 0;
    for (const client of this.clients()) { targets++; try { client.send('frontendRevision', current); } catch { failed++; } }
    const state = failed === 0 ? 'queued' : failed === targets ? 'failed' : 'partial';
    return this.notification = { state, targets, failed };
  }
  persist(generation, current) {
    this.fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const temporary = join(this.dir, `frontend-current.${randomUUID()}.tmp`);
    let renamed = false;
    try {
      this.fs.writeFileSync(temporary, JSON.stringify({ generation, current }) + '\n', { mode: 0o600, flush: true });
      this.fs.renameSync(temporary, this.file); renamed = true;
      const fd = this.fs.openSync(this.dir, 'r');
      try { this.fs.fsyncSync(fd); } finally { this.fs.closeSync(fd); }
    } catch (error) {
      if (renamed) this.state = 'reconcile-required';
      else { try { this.fs.unlinkSync(temporary); } catch {} }
      throw fail(503, renamed ? 'Frontend activation durability unknown' : 'Frontend activation write failed');
    }
  }
  reconcile() {
    try {
      const value = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      if (!safeGeneration(value.generation) || value.generation <= this.generation || !metadata(value.current) || Object.keys(value.current).sort().join(',') !== 'compatibility,revision,uiApiVersion,uiStateSchema') throw Error('Invalid reconciled state');
      const fd = this.fs.openSync(this.dir, 'r');
      try { this.fs.fsyncSync(fd); } finally { this.fs.closeSync(fd); }
      this.generation = value.generation; this.current = value.current; this.state = 'ready';
      this.broadcast();
    } catch { throw fail(503, 'Frontend state reconciliation required'); }
  }
  activate(input) {
    const operation = this.queue.then(() => this.#activate(input));
    this.queue = operation.catch(() => {});
    return operation;
  }
  async #activate({ expectedGeneration, revision }) {
    if (this.state === 'error') throw fail(503, 'Frontend state invalid');
    if (this.state === 'reconcile-required') this.reconcile();
    const current = await readFrontendCurrent(this.origin, this.fetchImpl);
    if (current.revision !== revision) throw fail(409, 'Frontend public current mismatch');
    if (this.current?.revision === revision) {
      if (JSON.stringify(this.current) !== JSON.stringify(current)) throw fail(409, 'Frontend metadata mismatch');
      const notification = this.broadcast();
      return { status: notification.state === 'queued' ? 200 : 202, activation: 'confirmed', notification, generation: this.generation, current: this.current };
    }
    if (expectedGeneration !== this.generation) throw fail(409, 'Frontend generation mismatch');
    if (this.generation === Number.MAX_SAFE_INTEGER) throw fail(503, 'Frontend generation exhausted');
    try { this.persist(this.generation + 1, current); }
    catch (error) { error.activation = this.state === 'reconcile-required' ? 'unknown' : 'failed'; throw error; }
    this.generation++; this.current = current; this.state = 'ready';
    const notification = this.broadcast();
    return { status: notification.state === 'queued' ? 200 : 202, activation: 'confirmed', notification, generation: this.generation, current };
  }
}
