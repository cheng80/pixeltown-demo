// Publish only the Pages frontend. No server process or worker is restarted.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, openSync, closeSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { fetchVisualFile } from './build-minimal-frontend.mjs';
setDefaultAutoSelectFamilyAttemptTimeout(2000);
const root = resolve(import.meta.dirname, '..');
const lock = resolve(root, '.local/minimal/frontend-deploy.lock'); mkdirSync(resolve(lock, '..'), { recursive: true });
const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
try {
const publicRevision = async () => {
  const r = await fetchVisualFile('https://pixeltown.fastmake.net', '/visual/current.json');
  if (!r.ok) throw new Error('Public frontend unavailable; publication cancelled');
  return createHash('sha256').update(await r.text()).digest('hex');
};
const before = await publicRevision();
execFileSync(process.execPath, ['scripts/build-minimal-frontend.mjs', '--remote'], { cwd: root, stdio: 'inherit' });
const out = resolve(root, 'dist');
const history = JSON.parse(readFileSync(resolve(out, 'visual/releases.json')));
for (const id of history.releases) {
  const dir = resolve(out, 'visual/releases', id), manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json')));
  for (const file of manifest.files) {
    const path = resolve(dir, file.path);
    if (!existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== file.sha256) throw new Error('Visual history incomplete; publication cancelled');
  }
}
const args = ['pages', 'deploy', out, '--project-name', 'pixeltown', '--branch', 'main', '--commit-dirty=true', '--commit-message', '미니멀 화면 코드와 리소스 교체'];
if (await publicRevision() !== before) throw new Error('Another frontend deployment became active; rebuild before publishing');
if (process.env.MINIMAL_WRANGLER_PATH) execFileSync(process.execPath, [process.env.MINIMAL_WRANGLER_PATH, ...args], { cwd: root, stdio: 'inherit' });
else execFileSync('npx', ['--yes', 'wrangler', ...args], { cwd: root, stdio: 'inherit' });
} finally { if (existsSync(lock) && readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock); }
