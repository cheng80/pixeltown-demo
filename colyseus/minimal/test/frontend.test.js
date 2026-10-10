import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FrontendCurrent, validateFrontendManifest, readFrontendCurrent } from '../frontend-current.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const manifest = revision => ({ schema: 2, revision, compatibility: C, uiApiVersion: 1, uiStateSchema: 1,
  entry: `/visual/releases/${revision}/assets/app.js`, styles: [], fonts: [], images: [],
  files: [{ path: 'assets/app.js', sha256: C }] });
const fakeFetch = current => async () => Response.json(current());
const fixture = t => { const dir = mkdtempSync(resolve(process.cwd(), '.test-work/frontend-unit-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

test('schema 2 manifest validates release paths and inventory SHA separately from schema 1 hint', () => {
  assert.deepEqual(validateFrontendManifest(manifest(A), 'http://127.0.0.1:5270'), { revision: A, compatibility: C, uiApiVersion: 1, uiStateSchema: 1 });
  for (const altered of [
    { ...manifest(A), schema: 1 }, { ...manifest(A), entry: `/visual/releases/${B}/assets/app.js` },
    { ...manifest(A), entry: `/visual/releases/${A}/assets/../assets/app.js` },
    { ...manifest(A), entry: `/visual/releases/${A}/assets/app.js?x=1` },
    { ...manifest(A), files: [{ path: '../app.js', sha256: C }] },
    { ...manifest(A), files: [{ path: 'assets/app.js', sha256: 'bad' }] },
  ]) assert.throws(() => validateFrontendManifest(altered, 'http://127.0.0.1:5270'));
});

test('current fetch rejects redirects, oversize bodies and deadline failures', async () => {
  await assert.rejects(readFrontendCurrent('http://127.0.0.1:5270', async () => new Response('', { status: 302 })), { status: 502 });
  await assert.rejects(readFrontendCurrent('http://127.0.0.1:5270', async () => new Response('x'.repeat(512 * 1024 + 1))), { status: 502 });
  await assert.rejects(readFrontendCurrent('http://127.0.0.1:5270', async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('timeout'))))), { status: 502 });
});

test('durable activation, duplicate rebroadcast, CAS, rollback and restart', async t => {
  const dir = fixture(t), sent = [], clients = [{ send(type, value) { sent.push({ type, value }); } }];
  let publicCurrent = manifest(A);
  const options = { dir, origin: 'http://127.0.0.1:5270', clients: () => clients, fetchImpl: fakeFetch(() => publicCurrent) };
  const current = new FrontendCurrent(options);
  assert.deepEqual(current.status(), { state: 'uninitialized', generation: 0, current: null, notification: { state: 'not-attempted', targets: 0, failed: 0 } });
  assert.equal((await current.activate({ expectedGeneration: 0, revision: A })).status, 200);
  assert.equal(current.hint().schema, 1); assert.equal(current.hint().generation, 1);
  assert.equal(JSON.parse(readFileSync(resolve(dir, 'frontend-current.json'))).generation, 1);
  assert.equal((await current.activate({ expectedGeneration: 0, revision: A })).generation, 1);
  assert.equal(sent.length, 2);
  publicCurrent = manifest(B);
  await assert.rejects(current.activate({ expectedGeneration: 1, revision: A }), { status: 409 });
  await assert.rejects(current.activate({ expectedGeneration: 0, revision: B }), { status: 409 });
  assert.equal((await current.activate({ expectedGeneration: 1, revision: B })).generation, 2);
  publicCurrent = manifest(A);
  assert.equal((await current.activate({ expectedGeneration: 2, revision: A })).generation, 3);
  const restored = new FrontendCurrent(options);
  assert.equal(restored.status().generation, 3); assert.equal(restored.hint().revision, A);
});

test('rename before failure preserves old state; post-rename fsync failure requires reconciliation', async t => {
  const dir = fixture(t); let publicCurrent = manifest(A), failRename = false, failSync = false;
  const injected = { ...fs,
    renameSync(...args) { if (failRename) throw Error('rename failed'); return fs.renameSync(...args); },
    fsyncSync(fd) { if (failSync) throw Error('directory sync failed'); return fs.fsyncSync(fd); } };
  const current = new FrontendCurrent({ dir, origin: 'http://127.0.0.1:5270', fs: injected, fetchImpl: fakeFetch(() => publicCurrent) });
  failRename = true;
  await assert.rejects(current.activate({ expectedGeneration: 0, revision: A }), { status: 503, activation: 'failed' });
  assert.equal(current.status().generation, 0); assert.equal(current.status().state, 'uninitialized');
  failRename = false;
  await current.activate({ expectedGeneration: 0, revision: A });
  publicCurrent = manifest(B); failSync = true;
  await assert.rejects(current.activate({ expectedGeneration: 1, revision: B }), { status: 503, activation: 'unknown' });
  assert.equal(current.status().state, 'reconcile-required'); assert.equal(current.status().generation, 1);
  assert.equal(JSON.parse(readFileSync(resolve(dir, 'frontend-current.json'))).generation, 2);
  await assert.rejects(current.activate({ expectedGeneration: 2, revision: B }), { status: 503 });
  assert.equal(current.status().generation, 1);
  failSync = false;
  assert.equal((await current.activate({ expectedGeneration: 1, revision: B })).generation, 2);
  assert.equal(current.status().state, 'ready');
});

test('partial broadcast is reported and duplicate retry resends without a generation advance', async t => {
  const dir = fixture(t); let received = 0;
  const clients = [{ send() { received++; } }, { send() { throw Error('socket closed'); } }];
  const current = new FrontendCurrent({ dir, origin: 'http://127.0.0.1:5270', clients: () => clients, fetchImpl: fakeFetch(() => manifest(A)) });
  const first = await current.activate({ expectedGeneration: 0, revision: A });
  assert.equal(first.status, 202); assert.deepEqual(first.notification, { state: 'partial', targets: 2, failed: 1 });
  const second = await current.activate({ expectedGeneration: 0, revision: A });
  assert.equal(second.generation, 1); assert.equal(received, 2);
});

test('concurrent activation requests serialize and stale CAS cannot replace the winner', async t => {
  const dir = fixture(t); let calls = 0;
  const current = new FrontendCurrent({ dir, origin: 'http://127.0.0.1:5270', fetchImpl: async () => Response.json(manifest(++calls === 1 ? A : B)) });
  const [first, second] = await Promise.allSettled([
    current.activate({ expectedGeneration: 0, revision: A }),
    current.activate({ expectedGeneration: 0, revision: B }),
  ]);
  assert.equal(first.status, 'fulfilled'); assert.equal(second.status, 'rejected'); assert.equal(second.reason.status, 409);
  assert.equal(current.status().generation, 1); assert.equal(current.hint().revision, A);
});

test('corrupt persisted state is an error and cannot be overwritten as generation zero', async t => {
  const dir = fixture(t); const file = resolve(dir, 'frontend-current.json'); writeFileSync(file, '{corrupt');
  const current = new FrontendCurrent({ dir, origin: 'http://127.0.0.1:5270', fetchImpl: fakeFetch(() => manifest(A)) });
  assert.equal(current.status().state, 'error'); assert.equal(current.hint(), null);
  await assert.rejects(current.activate({ expectedGeneration: 0, revision: A }), { status: 503 });
  assert.equal(readFileSync(file, 'utf8'), '{corrupt');
});
