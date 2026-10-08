// Keep the public immutable visual history even on a fresh CI checkout.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isIP, setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');

// Only structured network fields are logged: fetch messages can contain URLs,
// credentials or response bodies. Preserve both IPv4 and IPv6 aggregate causes.
export function visualNetworkError(error) {
  const seen = new Set(), causes = [];
  const visit = value => {
    if (!value || typeof value !== 'object' || seen.has(value) || seen.size >= 16) return;
    seen.add(value);
    const fields = ['name', 'code', 'syscall'].flatMap(key => typeof value[key] === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value[key]) ? [`${key}=${value[key]}`] : []);
    const family = typeof value.address === 'string' ? isIP(value.address) : 0;
    if (family) fields.push(`address=${value.address}`, `family=IPv${family}`);
    if (Number.isInteger(value.port) && value.port > 0 && value.port <= 65535) fields.push(`port=${value.port}`);
    if (fields.length) causes.push(fields.join(' '));
    visit(value.cause);
    if (Array.isArray(value.errors)) value.errors.forEach(visit);
  };
  visit(error);
  return causes.join('; ') || 'Network error';
}

export async function fetchVisualFile(base, path, { fetchImpl = fetch, timeoutMs = 20000, onRetry = message => console.warn(message) } = {}) {
  const file = JSON.stringify(new URL(path, base).pathname);
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      // The same deadline covers headers AND body; retry truncated downloads too.
      response = await fetchImpl(base + path, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok && response.status !== 404) {
        const error = new Error(); error.code = `HTTP_${response.status}`; throw error;
      }
      const body = await response.arrayBuffer();
      return new Response([204, 205].includes(response.status) ? null : body, { status: response.status, headers: response.headers });
    } catch (error) {
      await response?.body?.cancel().catch(() => {});
      const message = `Visual GET ${file} attempt ${attempt}/3 failed: ${visualNetworkError(error)}`;
      const retryable = !response || response.ok || [408, 429, 500, 502, 503, 504].includes(response.status);
      if (attempt === 3 || !retryable) throw new Error(message);
      onRetry(message);
      await delay(100 * attempt);
    }
  }
}

export async function preservePublicVisualHistory(base, store, options) {
  const get = path => fetchVisualFile(base, path, options);
  const index = await get('/visual/releases.json');
  const type = index.headers.get('content-type') || '';
  // Before this feature exists Pages' SPA fallback returns index.html with 200 for missing paths.
  if (index.status === 404 || (index.ok && type.includes('text/html'))) {
    const current = await get('/visual/current.json');
    if (index.status === 404) {
      if (current.status !== 404) throw new Error('Visual release history missing; refuse to discard old releases');
    } else {
      const home = await get('/');
      const [a, b, c] = await Promise.all([index.text(), current.text(), home.text()]);
      if (!current.ok || !home.ok || a !== b || b !== c || !c.includes('픽셀타운')) throw new Error('Unrecognized visual history response');
    }
  } else {
    if (!index.ok) throw new Error('Unable to preserve visual history');
    const history = await index.json();
    if (history.schema !== 1 || !Array.isArray(history.releases) || history.releases.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error('Invalid visual history');
    for (const id of history.releases) {
      const response = await get(`/visual/releases/${id}/manifest.json`);
      if (!response.ok) throw new Error(`Missing retained release ${id}`);
      const manifest = await response.json();
      if (manifest.revision !== id || !Array.isArray(manifest.files)) throw new Error('Invalid retained manifest');
      const dir = resolve(store, id); mkdirSync(dir, { recursive: true });
      for (const file of manifest.files) {
        if (!file || typeof file.path !== 'string' || file.path.includes('..') || file.path.startsWith('/') || file.path.includes('\\') || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid retained file');
        const dest = resolve(dir, file.path);
        if (existsSync(dest) && createHash('sha256').update(readFileSync(dest)).digest('hex') === file.sha256) continue;
        const r = await get(`/visual/releases/${id}/${file.path}`);
        if (!r.ok) throw new Error(`Retained file unavailable: ${file.path}`);
        const body = Buffer.from(await r.arrayBuffer());
        if (createHash('sha256').update(body).digest('hex') !== file.sha256) throw new Error(`Retained file checksum mismatch: ${JSON.stringify(file.path)}`);
        mkdirSync(resolve(dest, '..'), { recursive: true }); writeFileSync(dest, body);
      }
      writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    }
    console.log(`Preserved ${history.releases.length} public visual releases`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const remote = process.argv.includes('--remote');
  if (remote) {
    setDefaultAutoSelectFamilyAttemptTimeout(2000);
    const store = resolve(process.env.MINIMAL_VISUAL_STORE || resolve(root, '.local/minimal/frontend-releases'));
    const base = process.env.MINIMAL_VISUAL_PUBLIC_URL || 'https://pixeltown.fastmake.net';
    await preservePublicVisualHistory(base, store);
  }
  const { build } = await import('vite');
  await build({ configFile: resolve(root, 'vite.minimal.config.js'), ...(remote ? { mode: 'minimal-remote', build: { outDir: '../../dist' } } : {}) });
}
