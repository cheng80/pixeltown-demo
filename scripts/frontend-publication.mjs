import { createHash } from 'node:crypto';
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateFrontendManifest, frontendOrigin } from '../colyseus/minimal/frontend-current.js';

const SHA = /^[a-f0-9]{64}$/;
const digest = body => createHash('sha256').update(body).digest('hex');
const failure = message => new Error(message);

async function publicFile(origin, path, fetchImpl, maxBytes = 32 * 1024 * 1024, allowHTML = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(origin + path, { redirect: 'manual', cache: 'no-store', signal: controller.signal });
    if (response.status !== 200 || !allowHTML && response.headers.get('content-type')?.includes('text/html')) throw failure('Public frontend file unavailable');
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw failure('Public frontend file too large');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error.message?.startsWith('Public frontend file') || error.message === 'Public frontend file unavailable') throw error;
    throw Object.assign(failure('Public frontend verification unavailable'), { verificationUnknown: true });
  } finally { clearTimeout(timeout); controller.abort(); }
}

export async function verifyPublication({ origin, revision, expectedManifest, fetchImpl = fetch }) {
  frontendOrigin(origin);
  if (!SHA.test(revision)) throw failure('Invalid frontend revision');
  const current = JSON.parse((await publicFile(origin, '/visual/current.json', fetchImpl, 256 * 1024)).toString());
  validateFrontendManifest(current, origin);
  if (current.revision !== revision) throw failure('Public current revision mismatch');
  const prefix = `/visual/releases/${revision}/`;
  const manifest = JSON.parse((await publicFile(origin, prefix + 'manifest.json', fetchImpl, 256 * 1024)).toString());
  validateFrontendManifest(manifest, origin);
  if (JSON.stringify(manifest) !== JSON.stringify(current) || expectedManifest && JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) throw failure('Public frontend manifest mismatch');
  for (const file of manifest.files) {
    const body = await publicFile(origin, prefix + file.path, fetchImpl, 32 * 1024 * 1024, true);
    if (digest(body) !== file.sha256) throw failure('Public frontend SHA mismatch');
  }
  return manifest;
}

export const emptyReceipt = revision => ({ revision, publication: 'unknown', activation: 'not-attempted', notification: 'not-attempted', notificationTargets: 0, notificationFailed: 0, generation: null });
export function saveReceipt(path, receipt) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}

export async function activatePublished({ origin, revision, request, receiptPath, expectedManifest, fetchImpl = fetch, attempts = 2 }) {
  const receipt = emptyReceipt(revision);
  const save = () => { if (receiptPath) saveReceipt(receiptPath, receipt); return receipt; };
  save();
  try { await verifyPublication({ origin, revision, expectedManifest, fetchImpl }); receipt.publication = 'confirmed'; save(); }
  catch (error) { receipt.publication = error.verificationUnknown ? 'unknown' : 'failed'; return save(); }
  for (let attempt = 0; attempt < attempts; attempt++) {
    let generation;
    try {
      const health = await request('GET', '/health');
      generation = health.body?.frontend?.generation;
      if (health.status !== 200 || !['uninitialized', 'ready', 'reconcile-required'].includes(health.body?.frontend?.state) || !Number.isSafeInteger(generation) || generation < 0) throw failure('Frontend health unavailable');
      const response = await request('POST', '/internal/frontend/activate', { expectedGeneration: generation, revision });
      const body = response.body;
      if ([200, 202].includes(response.status) && body?.activation === 'confirmed' && Number.isSafeInteger(body.generation) && body.generation >= generation && ['queued', 'partial', 'failed'].includes(body.notification?.state) && Number.isSafeInteger(body.notification.targets) && Number.isSafeInteger(body.notification.failed) && body.notification.targets >= 0 && body.notification.failed >= 0 && body.notification.failed <= body.notification.targets) {
        receipt.activation = 'confirmed'; receipt.generation = body.generation; receipt.notification = body.notification.state; receipt.notificationTargets = body.notification.targets; receipt.notificationFailed = body.notification.failed; save();
        if (receipt.notification === 'queued') return receipt;
        continue;
      }
      if (receipt.activation === 'confirmed') receipt.notification = 'unknown';
      else {
        receipt.activation = response.status === 503 && body?.activation === 'unknown' ? 'unknown' : 'failed';
        receipt.notification = 'not-attempted';
      }
      save();
      if (response.status === 409 || response.status === 502 || response.status === 400 || response.status === 403 || response.status === 503) return receipt;
    } catch {
      if (receipt.activation !== 'confirmed') receipt.activation = 'unknown';
      receipt.notification = 'unknown'; save();
      // Health is read again before retry: a lost response may have committed the activation.
    }
  }
  return save();
}
