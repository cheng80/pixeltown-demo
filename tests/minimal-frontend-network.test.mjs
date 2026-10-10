import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, cpSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fetchVisualFile, preservePublicVisualHistory } from '../scripts/build-minimal-frontend.mjs';

const root = resolve(import.meta.dirname, '..');
const digest = body => createHash('sha256').update(body).digest('hex');
const work = () => { mkdirSync(resolve(root, '.test-work'), { recursive: true }); return mkdtempSync(resolve(root, '.test-work/visual-network-')); };
const networkFailure = () => new TypeError('https://user:secret@example.test/?token=secret', { cause: new AggregateError([
  Object.assign(new Error('secret IPv4 payload'), { code: 'ETIMEDOUT', syscall: 'connect', address: '192.0.2.1', port: 443 }),
  Object.assign(new Error('secret IPv6 payload'), { code: 'EHOSTUNREACH', syscall: 'connect', address: '2001:db8::1', port: 443 }),
]) });
const listen = async (t, handler) => {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
};

test('GET recovers from two aggregate connection failures and sanitizes all attempts', async () => {
  const logs = []; let attempts = 0;
  const result = await fetchVisualFile('https://user:secret@example.test', '/visual/file.js?token=secret', {
    fetchImpl: async (_url, options) => { assert.equal(options.cache, 'no-store'); assert(options.signal); if (++attempts < 3) throw networkFailure(); return new Response('immutable'); },
    onRetry: message => logs.push(message),
  });
  assert.equal(await result.text(), 'immutable'); assert.equal(attempts, 3); assert.equal(logs.length, 2);
  for (const log of logs) { assert.match(log, /Visual GET "\/visual\/file.js" attempt [12]\/3/); assert.match(log, /ETIMEDOUT.*family=IPv4.*EHOSTUNREACH.*family=IPv6/); assert(!log.includes('secret')); assert(!log.includes('token')); }
});

test('persistent connection failure stops at three and retains final cause codes', async () => {
  let attempts = 0;
  await assert.rejects(fetchVisualFile('https://example.test', '/visual/bad.js', { fetchImpl: async () => { attempts++; throw networkFailure(); }, onRetry() {} }), error => {
    assert.match(error.message, /bad.js.*attempt 3\/3/); assert.match(error.message, /ETIMEDOUT/); assert.match(error.message, /EHOSTUNREACH/); assert(!error.message.includes('secret')); return true;
  });
  assert.equal(attempts, 3);
});

test('real HTTP retries transient status and truncated body', async t => {
  let attempts = 0;
  const base = await listen(t, (_req, res) => {
    attempts++;
    if (attempts === 1) { res.writeHead(503); res.end('do not log this response'); }
    else if (attempts === 2) { res.writeHead(200, { 'Content-Length': '1000' }); res.write('truncated'); setImmediate(() => res.destroy()); }
    else { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end('export const value = 1;'); }
  });
  const logs = [], response = await fetchVisualFile(base, '/visual/module.js', { onRetry: text => logs.push(text) });
  assert.equal(attempts, 3); assert.equal(await response.text(), 'export const value = 1;'); assert.match(logs[0], /HTTP_503/); assert.equal(logs.length, 2);
});

test('body deadline aborts and retries at most three times', async t => {
  let attempts = 0;
  const base = await listen(t, (_req, res) => { attempts++; res.writeHead(200); res.write('never finishes'); });
  const start = Date.now();
  await assert.rejects(fetchVisualFile(base, '/visual/stall.js', { timeoutMs: 60, onRetry() {} }), /stall.js.*attempt 3\/3.*(TimeoutError|AbortError)/);
  assert.equal(attempts, 3); assert(Date.now() - start < 2500);
});

test('404 is retained for bootstrap checks; permanent HTTP failures are not retried', async () => {
  let attempts = 0;
  const missing = await fetchVisualFile('https://example.test', '/visual/releases.json', { fetchImpl: async () => { attempts++; return new Response('missing', { status: 404 }); } });
  assert.equal(missing.status, 404); assert.equal(attempts, 1);
  await assert.rejects(fetchVisualFile('https://user:secret@example.test', '/visual/private.js', { fetchImpl: async () => { attempts++; return new Response('secret', { status: 403 }); } }), /private.js.*attempt 1\/3.*HTTP_403/);
  assert.equal(attempts, 2);
});

const id = 'a'.repeat(64), body = 'export const retained = true;';
const manifest = { revision: id, files: [{ path: 'assets/old.js', sha256: digest(body) }] };
const fixtureFetch = (custom = {}) => async url => {
  const path = new URL(url).pathname;
  if (path in custom) return custom[path]();
  if (path === '/visual/releases.json') return Response.json({ schema: 1, releases: [id] });
  if (path.endsWith('/manifest.json')) return Response.json(manifest);
  if (path.endsWith('/old.js')) return new Response(body);
  return new Response('missing', { status: 404 });
};

test('history remains hash checked; valid local files are reused and mismatches never overwrite them', async () => {
  const store = work(), file = resolve(store, id, 'assets/old.js'); let gets = 0;
  await preservePublicVisualHistory('https://example.test', store, { fetchImpl: fixtureFetch({ [`/visual/releases/${id}/assets/old.js`]: () => { gets++; return new Response(body); } }) });
  assert.equal(readFileSync(file, 'utf8'), body);
  await preservePublicVisualHistory('https://example.test', store, { fetchImpl: fixtureFetch({ [`/visual/releases/${id}/assets/old.js`]: () => { throw new Error('must reuse valid bytes'); } }) });
  assert.equal(gets, 1);
  writeFileSync(file, 'local dirty bytes');
  await assert.rejects(preservePublicVisualHistory('https://example.test', store, { fetchImpl: fixtureFetch({ [`/visual/releases/${id}/assets/old.js`]: () => new Response('incorrect download') }) }), /checksum mismatch.*old.js/);
  assert.equal(readFileSync(file, 'utf8'), 'local dirty bytes');
});

test('missing history and invalid retained paths fail closed', async () => {
  const store = work();
  await assert.rejects(preservePublicVisualHistory('https://example.test', store, { fetchImpl: fixtureFetch({ '/visual/releases.json': () => new Response('missing', { status: 404 }), '/visual/current.json': () => Response.json({ revision: id }) }) }), /history missing/);
  for (const path of ['../escape.js', '/absolute.js', 'assets\\bad.js']) {
    await assert.rejects(preservePublicVisualHistory('https://example.test', store, { fetchImpl: fixtureFetch({ [`/visual/releases/${id}/manifest.json`]: () => Response.json({ revision: id, files: [{ path, sha256: digest(body) }] }) }) }), /Invalid retained file/);
  }
  assert.equal(existsSync(resolve(store, 'escape.js')), false);
});

test('cloned CLI uses 2000ms address timeout and preserves hashed public history in the build', async t => {
  const app = work();
  for (const name of ['minimal', 'scripts', 'vite.minimal.config.js', 'package.json', 'package-lock.json']) cpSync(resolve(root, name), resolve(app, name), { recursive: true });
  symlinkSync(resolve(root, 'node_modules'), resolve(app, 'node_modules'));
  let downloads = 0;
  const base = await listen(t, (req, res) => {
    if (req.url === '/visual/releases.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ schema: 1, releases: [id] })); }
    else if (req.url.endsWith('/manifest.json')) res.end(JSON.stringify(manifest));
    else if (req.url.endsWith('/old.js')) { downloads++; if (downloads === 1) { res.writeHead(503); res.end('transient'); } else res.end(body); }
    else { res.writeHead(404); res.end(); }
  });
  // Instrument only the clone's fetch entry to observe the active Node setting.
  const probe = resolve(app, 'probe.mjs');
  writeFileSync(probe, "import { getDefaultAutoSelectFamilyAttemptTimeout } from 'node:net'; const get=globalThis.fetch; globalThis.fetch=(...args)=>{console.log('ADDRESS_TIMEOUT='+getDefaultAutoSelectFamilyAttemptTimeout());return get(...args);};\n");
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--import', probe, 'scripts/build-minimal-frontend.mjs', '--remote'], { cwd: app, env: { ...process.env, MINIMAL_VISUAL_PUBLIC_URL: base, MINIMAL_VISUAL_STORE: resolve(app, 'history') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', x => { output += x; }); child.stderr.on('data', x => { output += x; }); child.on('error', reject); child.on('close', code => resolveResult({ code, output }));
  });
  assert.equal(result.code, 0, result.output); assert.match(result.output, /ADDRESS_TIMEOUT=2000/); assert(!result.output.includes('ADDRESS_TIMEOUT=250'));
  assert.equal(downloads, 2);
  assert.equal(digest(readFileSync(resolve(app, 'dist/visual/releases', id, 'assets/old.js'))), manifest.files[0].sha256);
  const index = JSON.parse(readFileSync(resolve(app, 'dist/visual/releases.json'))); assert(index.releases.includes(id)); assert(index.releases.length >= 2);
  const current = JSON.parse(readFileSync(resolve(app, 'dist/visual/current.json')));
  assert.match(current.entry, /visual-standalone-/);
  assert.equal(current.files.filter(file => file.path.endsWith('.js')).length, 1);
  for (const file of current.files) assert.equal(digest(readFileSync(resolve(app, 'dist/visual/releases', current.revision, file.path))), file.sha256);
  const { minimalVisualBuild } = await import(pathToFileURL(resolve(app, 'scripts/minimal-visual-build.mjs')));
  const before = minimalVisualBuild().config().define.__MINIMAL_VISUAL_COMPAT__;
  assert.equal(current.schema, 2); assert.equal(current.uiApiVersion, 1); assert.equal(current.uiStateSchema, 1);
  const ui = resolve(app, 'minimal/game/src/main.jsx');
  writeFileSync(ui, readFileSync(ui, 'utf8') + '\n// UI-only dependency fixture\n');
  assert.equal(minimalVisualBuild().config().define.__MINIMAL_VISUAL_COMPAT__, before);
  const lockPath = resolve(app, 'package-lock.json'), lock = JSON.parse(readFileSync(lockPath));
  lock.packages['node_modules/react'].version = '19.999.0'; writeFileSync(lockPath, JSON.stringify(lock));
  assert.equal(minimalVisualBuild().config().define.__MINIMAL_VISUAL_COMPAT__, before, 'UI React dependency does not change the runtime graph');
  const connection = resolve(app, 'minimal/game/src/connection.js');
  writeFileSync(connection, readFileSync(connection, 'utf8') + '\n// changed connection contract fixture\n');
  assert.notEqual(minimalVisualBuild().config().define.__MINIMAL_VISUAL_COMPAT__, before);
});
