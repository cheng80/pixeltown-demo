// Publish only Pages, verify public bytes, then activate the already-running host.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, openSync, closeSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { fetchVisualFile } from './build-minimal-frontend.mjs';
import { activatePublished, emptyReceipt, saveReceipt } from './frontend-publication.mjs';
import { remoteRequest } from './activate-minimal-frontend.mjs';
import { validateFrontendManifest } from '../colyseus/minimal/frontend-current.js';
setDefaultAutoSelectFamilyAttemptTimeout(2000);
const root = resolve(import.meta.dirname, '..');

export async function publishFrontend({ origin, out, build, publish, request, receiptPath, fetchImpl = fetch }) {
  const publicRevision = async () => {
    const response = await fetchVisualFile(origin, '/visual/current.json', { fetchImpl: (url, options) => fetchImpl(url, { ...options, redirect: 'manual' }) });
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('Public frontend unavailable; publication cancelled');
    const body = await response.arrayBuffer();
    if (body.byteLength > 512 * 1024) throw new Error('Public frontend current too large');
    return createHash('sha256').update(Buffer.from(body)).digest('hex');
  };
  const before = await publicRevision();
  await build();
  const history = JSON.parse(readFileSync(resolve(out, 'visual/releases.json')));
  if (history.schema !== 1 || !Array.isArray(history.releases) || history.releases.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error('Invalid visual history');
  for (const id of history.releases) {
    const dir = resolve(out, 'visual/releases', id), manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json')));
    if (manifest.revision !== id || !Array.isArray(manifest.files)) throw new Error('Invalid visual history');
    for (const file of manifest.files) {
      const path = resolve(dir, file.path);
      if (!file || typeof file.path !== 'string' || file.path.startsWith('/') || file.path.split('/').includes('..') || !existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== file.sha256) throw new Error('Visual history incomplete; publication cancelled');
    }
  }
  const manifest = JSON.parse(readFileSync(resolve(out, 'visual/current.json')));
  validateFrontendManifest(manifest, origin);
  if (!history.releases.includes(manifest.revision)) throw new Error('Current frontend missing from visual history');
  const receipt = emptyReceipt(manifest.revision);
  if (receiptPath) saveReceipt(receiptPath, receipt);
  if (await publicRevision() !== before) throw new Error('Another frontend deployment became active; rebuild before publishing');
  try { await publish(); }
  catch { receipt.publication = 'unknown'; if (receiptPath) saveReceipt(receiptPath, receipt); return receipt; }
  return activatePublished({ origin, revision: manifest.revision, expectedManifest: manifest, request, receiptPath, fetchImpl });
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const origin = process.env.MINIMAL_VISUAL_PUBLIC_URL || 'https://pixeltown.fastmake.net';
  const receiptPath = process.env.MINIMAL_FRONTEND_RECEIPT || resolve(root, '.local/minimal/frontend-publication-receipt.json');
  const request = remoteRequest(); // Missing remote target stops before a Pages publication.
  const lock = resolve(root, '.local/minimal/frontend-deploy.lock'); mkdirSync(resolve(lock, '..'), { recursive: true });
  const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
  try {
    const out = resolve(root, 'dist');
    const receipt = await publishFrontend({ origin, out, receiptPath, request,
      build: () => execFileSync(process.execPath, ['scripts/build-minimal-frontend.mjs', '--remote'], { cwd: root, stdio: 'inherit' }),
      publish: () => {
        const args = ['pages', 'deploy', out, '--project-name', 'pixeltown', '--branch', 'main', '--commit-dirty=true', '--commit-message', '미니멀 화면 코드와 리소스 교체'];
        if (process.env.MINIMAL_WRANGLER_PATH) execFileSync(process.execPath, [process.env.MINIMAL_WRANGLER_PATH, ...args], { cwd: root, stdio: 'inherit' });
        else execFileSync('npx', ['--yes', 'wrangler', ...args], { cwd: root, stdio: 'inherit' });
      } });
    console.log(JSON.stringify(receipt));
    if (receipt.publication !== 'confirmed' || receipt.activation !== 'confirmed' || receipt.notification !== 'queued') process.exitCode = 1;
  } finally { if (existsSync(lock) && readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock); }
}
