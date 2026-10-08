import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVisualManifest, createVisualModuleLoader } from '../src/visual-update.js';
const revision = 'a'.repeat(64), compatibility = 'b'.repeat(64), origin = 'https://pixeltown.fastmake.net';
const manifest = () => ({ schema: 1, revision, compatibility, entry: `/visual/releases/${revision}/assets/visual.js`, styles: [], fonts: [], images: [] });
test('visual release accepts only the same origin and immutable version directory', () => {
  assert.equal(validateVisualManifest(manifest(), compatibility, origin).revision, revision);
  for (const entry of ['https://elsewhere.test/file.js', '/src/main.jsx', `/visual/releases/${revision}/../other.js`, `/visual/releases/${revision}/entry.js?change=1`]) {
    assert.throws(() => validateVisualManifest({ ...manifest(), entry }, compatibility, origin));
  }
  assert.throws(() => validateVisualManifest({ ...manifest(), images: [{ name: 'avatar', url: '/avatar.png' }] }, compatibility, origin));
});
test('incompatible shell or map is retained without importing a new renderer', () => {
  assert.equal(validateVisualManifest(manifest(), 'c'.repeat(64), origin), null);
  assert.throws(() => validateVisualManifest({ ...manifest(), schema: 2 }, compatibility, origin));
});

test('failed imports get bounded unique URLs without changing the immutable manifest', async () => {
  const value = manifest(), before = structuredClone(value), urls = [];
  const module = { createRenderer() {} };
  const load = createVisualModuleLoader(async url => { urls.push(url); if (urls.length < 3) throw new TypeError('Failed to fetch dynamically imported module'); return module; }, 'test nonce');
  const signal = new AbortController().signal;
  await assert.rejects(load(value.entry, signal), /attempt 1\/3 failed/);
  await assert.rejects(load(value.entry, signal), /attempt 2\/3 failed/);
  assert.equal(await load(value.entry, signal), module);
  assert.equal(await load(value.entry, signal), module);
  assert.deepEqual(urls, [value.entry, value.entry + '?visualAttempt=test%20nonce-1-2', value.entry + '?visualAttempt=test%20nonce-2-3']);
  assert.deepEqual(value, before);
  for (const url of urls) {
    assert.equal(new URL(url, origin).pathname, value.entry);
    assert.equal(new URL('./shared.js', new URL(url, origin)).href, origin + `/visual/releases/${revision}/assets/shared.js`);
  }
});

test('permanent failure stops imports after three attempts but allows a different release', async () => {
  const urls = [], next = manifest().entry.replace(revision, 'c'.repeat(64));
  const load = createVisualModuleLoader(async url => { urls.push(url); if (url === next) return {}; throw new Error('offline'); }, 'bounded');
  const signal = new AbortController().signal;
  for (let n = 1; n <= 3; n++) await assert.rejects(load(manifest().entry, signal), new RegExp(`attempt ${n}/3`));
  for (let n = 0; n < 5; n++) await assert.rejects(load(manifest().entry, signal), /retry limit reached/);
  assert.equal(urls.length, 3);
  assert.deepEqual(await load(next, signal), {});
});

test('cancelled preparation cannot import or cache a late candidate', async () => {
  let finish, count = 0;
  const load = createVisualModuleLoader(() => { count++; return new Promise(resolve => { finish = resolve; }); }, 'cancel');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(load(manifest().entry, controller.signal), /cancelled/);
  assert.equal(count, 0);
  const active = new AbortController(), pending = load(manifest().entry, active.signal);
  active.abort(); finish({});
  await assert.rejects(pending, /cancelled/);
  const retry = load(manifest().entry, new AbortController().signal); finish({ valid: true });
  assert.deepEqual(await retry, { valid: true }); assert.equal(count, 2);
});

test('new updater instances never reuse a failed retry URL', async () => {
  const urls = [];
  const importing = async url => { urls.push(url); throw new Error('offline'); };
  const signal = new AbortController().signal;
  for (const load of [createVisualModuleLoader(importing), createVisualModuleLoader(importing)]) {
    await assert.rejects(load(manifest().entry, signal)); await assert.rejects(load(manifest().entry, signal));
  }
  assert.notEqual(urls[1], urls[3]);
});

test('non-secure origins need no randomUUID to initialize and retry', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto'), urls = [];
  let entropyCalls = 0;
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      get randomUUID() { throw new Error('secure-only API must not be read'); },
      getRandomValues(words) { entropyCalls++; words.fill(entropyCalls); return words; },
    } });
    const load = createVisualModuleLoader(async url => { urls.push(url); throw new Error('offline'); });
    for (let n = 0; n < 2; n++) await assert.rejects(load(manifest().entry, new AbortController().signal));
    assert.equal(entropyCalls, 1); assert.match(urls[1], /visualAttempt=00000001/);
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});

test('loader keeps at most sixteen entries and preserves active and previous modules', async () => {
  const urls = [], active = '/active.js', previous = '/previous.js';
  const load = createVisualModuleLoader(async url => { urls.push(url); return { url }; }, 'bounded');
  const signal = new AbortController().signal;
  const currentModule = await load(active, signal), previousModule = await load(previous, signal);
  load.retain(active, previous);
  for (let n = 0; n < 100; n++) await load(`/retired-${n}.js`, signal);
  assert.equal(load.size, 16);
  assert.equal(await load(active, signal), currentModule); assert.equal(await load(previous, signal), previousModule);
  assert.equal(urls.filter(url => url === active || url === previous).length, 2);
  load.clear(); assert.equal(load.size, 0);
});

test('evicted retry state cannot reuse a poisoned retry URL', async () => {
  const urls = [];
  const load = createVisualModuleLoader(async url => { urls.push(url); throw new Error('offline'); }, 'eviction');
  const signal = new AbortController().signal;
  for (let n=0; n<2; n++) await assert.rejects(load(manifest().entry, signal));
  const firstRetry = urls.at(-1);
  for (let n=0; n<20; n++) await assert.rejects(load(`/retired-${n}.js`, signal));
  for (let n=0; n<2; n++) await assert.rejects(load(manifest().entry, signal));
  assert.notEqual(urls.at(-1), firstRetry); assert.equal(load.size, 16);
});
