import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { FrontendCurrent } from '../colyseus/minimal/frontend-current.js';
import { publishFrontend } from '../scripts/deploy-minimal-frontend.mjs';
import { activatePublished, verifyPublication } from '../scripts/frontend-publication.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const make = value => {
  const revision = sha('revision-' + value), compatibility = sha('compatibility');
  const file = Buffer.from('export default ' + JSON.stringify(value));
  return { manifest: { schema: 2, revision, compatibility, uiApiVersion: 1, uiStateSchema: 1, entry: `/visual/releases/${revision}/entry.js`, styles: [], fonts: [], images: [], files: [{ path: 'entry.js', sha256: sha(file) }, { path: 'unavailable.html', sha256: sha('<!doctype html><p>offline</p>') }] }, file };
};
async function setup(t) {
  const dir = mkdtempSync(resolve(tmpdir(), 'ota-publish-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const releases = [make('A'), make('B')], state = { current: 0, posts: 0, failPublish: false, corrupt: false, redirect: false, status: 200, responseLoss: false, clients: [], stale: false };
  let frontend;
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/health') return json(res, { frontend: frontend.status(), rooms: 0 });
    if (req.url === '/internal/frontend/activate') {
      state.posts++;
      if (state.status !== 200) return json(res, { activation: 'failed', notification: { state: 'not-attempted', targets: 0, failed: 0 } }, state.status);
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      try {
        const result = await frontend.activate(JSON.parse(Buffer.concat(chunks).toString()));
        if (state.responseLoss) { state.responseLoss = false; req.socket.destroy(); return; }
        return json(res, result, result.status);
      } catch (error) { return json(res, { activation: error.activation || 'not-attempted', notification: { state: 'not-attempted', targets: 0, failed: 0 } }, error.status || 503); }
    }
    if (req.url === '/visual/current.json') {
      if (state.redirect) { res.writeHead(302, { Location: '/visual/current.json' }); res.end(); return; }
      return json(res, releases[state.current].manifest);
    }
    for (const release of releases) {
      const prefix = `/visual/releases/${release.manifest.revision}/`;
      if (req.url === prefix + 'manifest.json') return json(res, release.manifest);
      if (req.url === prefix + 'unavailable.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><p>offline</p>'); return; }
      if (req.url === prefix + 'entry.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(state.corrupt ? 'corrupt' : release.file); return; }
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  frontend = new FrontendCurrent({ dir: resolve(dir, 'state'), origin, clients: () => state.clients });
  const request = async (method, path, body) => {
    const response = await fetch(origin + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(2000) });
    return { status: response.status, body: await response.json() };
  };
  const out = resolve(dir, 'dist'), receiptPath = resolve(dir, 'receipt.json');
  const build = () => {
    for (const release of releases) {
      const releaseDir = resolve(out, 'visual/releases', release.manifest.revision);
      mkdirSync(releaseDir, { recursive: true });
      writeFileSync(resolve(releaseDir, 'manifest.json'), JSON.stringify(release.manifest));
      writeFileSync(resolve(releaseDir, 'entry.js'), release.file);
      writeFileSync(resolve(releaseDir, 'unavailable.html'), '<!doctype html><p>offline</p>');
    }
    writeFileSync(resolve(out, 'visual/releases.json'), JSON.stringify({ schema: 1, releases: releases.map(item => item.manifest.revision) }));
    writeFileSync(resolve(out, 'visual/current.json'), JSON.stringify(releases[1].manifest));
  };
  const publish = () => { if (state.failPublish) throw Error('fake Pages failed'); state.current = 1; };
  return { dir, releases, state, frontend, origin, request, out, receiptPath, build, publish };
}
function json(res, body, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

for (const scenario of ['success-empty-lobby', 'publish-fail', 'verify-fail', 'activate-502', 'partial-202', 'response-loss', 'stale-current']) {
  test(scenario, async t => {
    const f = await setup(t);
    if (scenario === 'publish-fail') f.state.failPublish = true;
    if (scenario === 'verify-fail') f.state.corrupt = true;
    if (scenario === 'activate-502') f.state.status = 502;
    if (scenario === 'partial-202') f.state.clients = [{ send() {} }, { send() { throw Error('queue'); } }];
    if (scenario === 'response-loss') f.state.responseLoss = true;
    if (scenario === 'stale-current') f.publish = () => {};
    const receipt = await publishFrontend({ origin: f.origin, out: f.out, build: f.build, publish: f.publish, request: f.request, receiptPath: f.receiptPath });
    assert.deepEqual(JSON.parse(readFileSync(f.receiptPath)), receipt);
    if (scenario === 'publish-fail') { assert.equal(receipt.publication, 'unknown'); assert.equal(f.state.posts, 0); return; }
    if (scenario === 'verify-fail') { assert.equal(receipt.publication, 'failed'); assert.equal(f.state.posts, 0); return; }
    if (scenario === 'activate-502') { assert.equal(receipt.activation, 'failed'); assert.equal(f.state.posts, 1); return; }
    if (scenario === 'partial-202') { assert.equal(receipt.activation, 'confirmed'); assert.equal(receipt.notification, 'partial'); assert.equal(f.state.posts, 2); assert.equal(receipt.generation, 1); return; }
    if (scenario === 'response-loss') { assert.equal(receipt.activation, 'confirmed'); assert.equal(receipt.generation, 1); assert.equal(f.state.posts, 2); return; }
    if (scenario === 'stale-current') { assert.equal(receipt.publication, 'failed'); assert.equal(f.state.posts, 0); return; }
    assert.equal(receipt.publication, 'confirmed'); assert.equal(receipt.activation, 'confirmed'); assert.equal(receipt.notification, 'queued'); assert.equal(receipt.generation, 1); assert.equal(f.state.posts, 1);
  });
}

test('activate-only validates publication and re-sends same revision without increment', async t => {
  const f = await setup(t);
  f.state.current = 1;
  const first = await activatePublished({ origin: f.origin, revision: f.releases[1].manifest.revision, request: f.request, receiptPath: f.receiptPath });
  const second = await activatePublished({ origin: f.origin, revision: f.releases[1].manifest.revision, request: f.request, receiptPath: f.receiptPath });
  assert.equal(first.generation, 1); assert.equal(second.generation, 1); assert.equal(f.state.posts, 2);
  assert.equal(f.frontend.status().generation, 1);
});

test('redirect and wrong schema prevent activation; unknown receipt survives response loss', async t => {
  const f = await setup(t); f.state.current = 1; f.state.redirect = true;
  await assert.rejects(verifyPublication({ origin: f.origin, revision: f.releases[1].manifest.revision }));
  f.state.redirect = false; f.releases[1].manifest.schema = 1;
  const bad = await activatePublished({ origin: f.origin, revision: f.releases[1].manifest.revision, request: f.request, receiptPath: f.receiptPath });
  assert.equal(bad.publication, 'failed'); assert.equal(f.state.posts, 0);
  f.releases[1].manifest.schema = 2;
  const request = async (method, path, body) => {
    if (method === 'POST') {
      await f.request(method, path, body);
      throw Error('lost response');
    }
    return f.request(method, path, body);
  };
  const receipt = await activatePublished({ origin: f.origin, revision: f.releases[1].manifest.revision, request, receiptPath: f.receiptPath, attempts: 1 });
  assert.equal(receipt.activation, 'unknown'); assert.equal(JSON.parse(readFileSync(f.receiptPath)).activation, 'unknown');
  assert.equal(f.frontend.status().generation, 1);
});

test('current changes between verification and POST: server rejects stale activation', async t => {
  const f = await setup(t); f.state.current = 1;
  const request = async (method, path, body) => {
    if (method === 'POST') f.state.current = 0;
    return f.request(method, path, body);
  };
  const receipt = await activatePublished({ origin: f.origin, revision: f.releases[1].manifest.revision, request, receiptPath: f.receiptPath });
  assert.equal(receipt.publication, 'confirmed'); assert.equal(receipt.activation, 'failed');
  assert.equal(f.frontend.status().generation, 0); assert.equal(f.state.posts, 1);
});

test('unreachable publication stays unknown and never activates', async t => {
  const f = await setup(t);
  const receipt = await activatePublished({ origin: f.origin, revision: f.releases[1].manifest.revision, request: f.request,
    fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(receipt.publication, 'unknown'); assert.equal(receipt.activation, 'not-attempted'); assert.equal(f.state.posts, 0);
});
