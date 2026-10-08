// Keep the public immutable visual history even on a fresh CI checkout.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const remote = process.argv.includes('--remote');
const store = resolve(process.env.MINIMAL_VISUAL_STORE || resolve(root, '.local/minimal/frontend-releases'));
const base = process.env.MINIMAL_VISUAL_PUBLIC_URL || 'https://pixeltown.fastmake.net';
const get = async path => fetch(base + path, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
if (remote) {
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
        if (createHash('sha256').update(body).digest('hex') !== file.sha256) throw new Error('Retained file checksum mismatch');
        mkdirSync(resolve(dest, '..'), { recursive: true }); writeFileSync(dest, body);
      }
      writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    }
    console.log(`Preserved ${history.releases.length} public visual releases`);
  }
}
await build({ configFile: resolve(root, 'vite.minimal.config.js'), ...(remote ? { mode: 'minimal-remote', build: { outDir: '../../dist' } } : {}) });
