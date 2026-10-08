import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync, readlinkSync, symlinkSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { ROOT, STATE_DIR } from '../colyseus/minimal/config.js';

const sources = ['colyseus/minimal/simulation-worker.js', 'colyseus/minimal/worker-runtime.js', 'colyseus/minimal/simulation.js', 'minimal/shared/world.js'];
export const releases = resolve(STATE_DIR, 'releases');
export const current = resolve(STATE_DIR, 'worker-current');
export const managedEntry = resolve(current, sources[0]);
const inside = path => { const part = relative(releases, path); return part && !part.startsWith('..') && !isAbsolute(part); };

export function prepareRelease() {
  const content = sources.map(path => readFileSync(resolve(ROOT, path), 'utf8'));
  const revision = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  mkdirSync(releases, { recursive: true, mode: 0o700 });
  if (lstatSync(releases).isSymbolicLink()) throw new Error('Release directory must not be a symlink');
  const directory = resolve(releases, revision);
  if (existsSync(directory)) {
    if (lstatSync(directory).isSymbolicLink() || sources.some((path, i) => readFileSync(resolve(directory, path), 'utf8') !== content[i])) throw new Error('Existing release differs from its revision');
  } else {
    const stage = resolve(releases, `.stage-${randomBytes(8).toString('hex')}`);
    mkdirSync(stage, { mode: 0o700 });
    for (let i = 0; i < sources.length; i++) {
      const path = resolve(stage, sources[i]); mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, content[i], { flag: 'wx', mode: 0o444 });
    }
    writeFileSync(resolve(stage, 'package.json'), '{"private":true,"type":"module"}\n', { flag: 'wx', mode: 0o444 });
    writeFileSync(resolve(stage, 'release.json'), JSON.stringify({ revision, sources }) + '\n', { flag: 'wx', mode: 0o444 });
    renameSync(stage, directory);
  }
  return { directory, revision };
}

export function selectedRelease() {
  try {
    if (!lstatSync(current).isSymbolicLink()) throw new Error('worker-current must be a release symlink');
    const directory = resolve(STATE_DIR, readlinkSync(current));
    if (!inside(directory)) throw new Error('Release pointer is outside the managed directory');
    return directory;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function selectRelease(directory) {
  if (!inside(directory) || lstatSync(directory).isSymbolicLink()) throw new Error('Invalid managed release');
  selectedRelease();
  const temp = resolve(STATE_DIR, `.worker-current-${randomBytes(8).toString('hex')}`);
  symlinkSync(relative(STATE_DIR, directory), temp, 'dir');
  try { renameSync(temp, current); } finally { if (existsSync(temp)) unlinkSync(temp); }
}

export function deploymentToken() {
  if (process.env.MINIMAL_SWAP_TOKEN) {
    if (process.env.MINIMAL_SWAP_TOKEN.length < 32) throw new Error('Invalid MINIMAL_SWAP_TOKEN');
    return process.env.MINIMAL_SWAP_TOKEN;
  }
  const path = resolve(STATE_DIR, 'swap-token');
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || (lstatSync(path).mode & 0o077)) throw new Error('Deployment token requires a private regular file');
  const token = readFileSync(path, 'utf8').trim();
  if (token.length < 32) throw new Error('Invalid deployment token file');
  return token;
}

export function deploymentLock() {
  const path = resolve(STATE_DIR, 'deployment.lock');
  writeFileSync(path, JSON.stringify({ pid: process.pid }) + '\n', { flag: 'wx', mode: 0o600 });
  return () => unlinkSync(path);
}
