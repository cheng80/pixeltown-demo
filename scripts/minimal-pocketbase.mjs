// Localhost development ONLY: isolated DB and hooks, no remote configuration,
// no imports from legacy init/config, no legacy users copied or migrated.
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, STATE_DIR, PB_URL, PB_PORT, credentials, adminClient } from '../colyseus/minimal/config.js';

const FORMAT = 'pixeltown-minimal-v1';
const within = (parent, path) => {
  const part = relative(parent, path);
  return part !== '' && part !== '..' && !part.startsWith('..' + '/') && !isAbsolute(part);
};

function assertIsolation() {
  const root = resolve(ROOT), state = resolve(STATE_DIR);
  if (state !== join(root, '.local/minimal') && !within(join(root, '.local/minimal'), state) && !within(join(root, '.test-work'), state)) {
    throw new Error('MINIMAL_STATE_DIR must be .local/minimal or a child of .test-work');
  }
  // Reject symlink ancestors before mkdir/chmod/open can touch a legacy DB.
  let current = root;
  for (const part of relative(root, state).split('/')) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('Minimal state must not contain symlinks');
  }
  for (const name of ['pb_data', 'pb_public', 'pb_migrations', 'admin.json', 'minimal-db.json', 'pb.lock']) {
    const path = join(state, name);
    try {
      const info = lstatSync(path);
      if (info.isSymbolicLink() || (!info.isDirectory() && info.nlink !== 1)) throw new Error('Minimal state must not contain linked files');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const data = join(state, 'pb_data');
  if (existsSync(data)) {
    for (const name of readdirSync(data)) {
      const info = lstatSync(join(data, name));
      if (info.isSymbolicLink() || (!info.isDirectory() && info.nlink !== 1)) throw new Error('Minimal DB must not contain linked files');
    }
  }
  const url = new URL(PB_URL);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      Number(url.port) !== Number(PB_PORT) || !Number.isInteger(Number(PB_PORT)) || Number(PB_PORT) < 1024 || Number(PB_PORT) > 65535) {
    throw new Error('Minimal PocketBase requires a matching localhost HTTP port');
  }
  return { state, data };
}

async function assertFreePort() {
  // Binding catches any TCP service, including one that doesn't answer HTTP.
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', () => reject(new Error(`Minimal PocketBase port ${PB_PORT} is occupied or unavailable`)));
    server.listen({ host: '127.0.0.1', port: Number(PB_PORT), exclusive: true }, resolvePromise);
  });
  await new Promise((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
}

async function inspectDatabase(state, data) {
  const marker = join(state, 'minimal-db.json');
  if (existsSync(marker)) {
    if (JSON.parse(readFileSync(marker, 'utf8')).format !== FORMAT) throw new Error('Unknown minimal DB marker');
  } else if (existsSync(data) && readdirSync(data).length) {
    // Refuse before even opening an unowned SQLite DB, including its WAL/SHM.
    throw new Error('Refusing an existing unmarked DB; use a new minimal state directory');
  }
  const database = join(data, 'data.db');
  if (!existsSync(database)) return;
  // Node 22.13+/24 built-in SQLite, read-only. This runs BEFORE PocketBase can
  // apply system migrations or initialize anything in an existing database.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const allowed = ['users', 'profiles', 'results', 'inventory'];
    const rows = db.prepare('SELECT name, system, fields FROM _collections').all();
    for (const row of rows) {
      if (!row.system && !allowed.includes(row.name)) throw new Error('Refusing a legacy/non-minimal database');
      if (row.name === 'profiles') {
        const names = ['id', 'created', 'updated', 'user', 'name'];
        if (JSON.parse(row.fields).some(field => !names.includes(field.name))) throw new Error('Refusing legacy profile data');
      }
    }
  } finally { db.close(); }
}

function acquireLock(state) {
  const path = join(state, 'pb.lock');
  const value = JSON.stringify({ pid: process.pid, nonce: randomBytes(16).toString('hex') });
  // A live launcher retains the lock for the entire lifetime of its child.
  try { writeFileSync(path, value, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let pid;
    try { pid = JSON.parse(readFileSync(path, 'utf8')).pid; } catch { throw new Error('Invalid minimal DB lock; inspect it before retrying'); }
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid minimal DB lock');
    try { process.kill(pid, 0); }
    catch (probe) {
      if (probe.code !== 'ESRCH') throw new Error('Minimal DB lock owner cannot be checked');
      // A crashed parent may have left its child running. Do not steal its DB
      // lock automatically; manual recovery requires verifying both processes.
      throw new Error('Stale minimal DB lock; verify no PocketBase child is running before removing pb.lock');
    }
    throw new Error('Minimal DB is already owned by another launcher');
  }
  return () => {
    try { if (readFileSync(path, 'utf8') === value) unlinkSync(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}

function prepareCredentials(state) {
  const path = join(state, 'admin.json');
  const email = process.env.MINIMAL_PB_ADMIN_EMAIL, password = process.env.MINIMAL_PB_ADMIN_PASSWORD;
  if (!!email !== !!password) throw new Error('Both MINIMAL_PB_ADMIN_EMAIL and MINIMAL_PB_ADMIN_PASSWORD are required');
  if (!email && !existsSync(path)) {
    writeFileSync(path, JSON.stringify({
      MINIMAL_PB_ADMIN_EMAIL: `minimal-${randomBytes(12).toString('hex')}@pixeltown.local`,
      MINIMAL_PB_ADMIN_PASSWORD: randomBytes(32).toString('hex'),
    }) + '\n', { flag: 'wx', mode: 0o600 });
  }
  if (existsSync(path)) chmodSync(path, 0o600);
  let value;
  try { value = credentials(); }
  catch { throw new Error('Cannot read minimal admin credentials'); }
  const adminEmail = value?.MINIMAL_PB_ADMIN_EMAIL;
  const adminPassword = value?.MINIMAL_PB_ADMIN_PASSWORD;
  if (typeof adminEmail !== 'string' || !adminEmail.includes('@') || typeof adminPassword !== 'string' || adminPassword.length < 8) {
    throw new Error('Invalid minimal admin credentials');
  }
  return { email: adminEmail, password: adminPassword };
}

async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolvePromise => child.once('exit', resolvePromise));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(3000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(2000, undefined, { ref: false })]);
  }
  if (child.exitCode === null && child.signalCode === null) throw new Error('Minimal PocketBase child did not stop; DB lock retained');
}

/** Start only our isolated child; callers own its shutdown. Always { child, admin }. */
export async function startMinimalPocketBase() {
  const { state, data } = assertIsolation();
  await assertFreePort();
  const binary = realpathSync(resolve(process.env.MINIMAL_PB_BINARY || join(ROOT, 'pocketbase/.local/pocketbase')));
  accessSync(binary, constants.X_OK);
  await inspectDatabase(state, data);
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const release = acquireLock(state);
  let child, spawnError, interrupted = false;
  const onSignal = () => {
    interrupted = true;
    void stopChild(child).catch(() => { process.exitCode = 1; });
  };
  // The parent exiting unexpectedly should not leave an unmanaged PB server.
  const onExit = () => child?.kill('SIGTERM');
  const detach = () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('exit', onExit);
  };
  try {
    const auth = prepareCredentials(state);
    const marker = join(state, 'minimal-db.json');
    if (!existsSync(marker)) writeFileSync(marker, JSON.stringify({ format: FORMAT }) + '\n', { flag: 'wx', mode: 0o600 });
    for (const path of [data, join(state, 'pb_public'), join(state, 'pb_migrations')]) mkdirSync(path, { recursive: true, mode: 0o700 });
    const nonce = randomBytes(24).toString('hex');
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    process.on('exit', onExit);
    child = spawn(binary, ['serve', `--http=127.0.0.1:${PB_PORT}`, '--dir', data,
      '--hooksDir', join(ROOT, 'pocketbase/minimal/pb_hooks'), '--hooksWatch=false', '--automigrate=false',
      '--migrationsDir', join(state, 'pb_migrations'), '--publicDir', join(state, 'pb_public'), '--dev=false'], {
      cwd: state,
      // Never print credentials, command output, first-admin links or PB logs.
      stdio: 'ignore',
      env: { ...process.env, MINIMAL_PB_ADMIN_EMAIL: auth.email, MINIMAL_PB_ADMIN_PASSWORD: auth.password, MINIMAL_BOOTSTRAP_NONCE: nonce },
    });
    child.on('error', error => { spawnError = error; });
    child.once('exit', () => { detach(); release(); });
    const deadline = Date.now() + 20000;
    let ready = false;
    while (Date.now() < deadline) {
      if (interrupted) throw new Error('Minimal PocketBase startup interrupted');
      if (spawnError) throw new Error('Cannot spawn minimal PocketBase');
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Minimal PocketBase exited during bootstrap');
      try {
        const response = await fetch(`${PB_URL}/api/minimal/ready`, { signal: AbortSignal.timeout(750), redirect: 'error' });
        if (response.ok) {
          const body = await response.json();
          if (body.mode !== 'minimal' || body.nonce !== nonce) throw new Error('Unexpected process on minimal PocketBase port');
          ready = true;
          break;
        }
      } catch (error) { if (error.message === 'Unexpected process on minimal PocketBase port') throw error; }
      await delay(100);
    }
    if (!ready) throw new Error('Minimal PocketBase startup timed out');
    const admin = await adminClient();
    if (interrupted || child.exitCode !== null || child.signalCode !== null) throw new Error('Minimal PocketBase stopped before authentication completed');
    // An embedding launcher controls shutdown order (game/outbox before PB).
    // Keep only the exit fallback once ownership is returned to the caller.
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    return { child, admin };
  } catch (error) {
    await stopChild(child);
    detach();
    release();
    // SDK error objects may contain request credentials; expose only a safe message.
    if (error?.name === 'ClientResponseError') throw new Error('Minimal PocketBase admin authentication failed');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { child } = await startMinimalPocketBase();
    const stop = () => { void stopChild(child).catch(() => { process.exitCode = 1; }); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    let stopping = false;
    process.on('SIGINT', () => { stopping = true; });
    process.on('SIGTERM', () => { stopping = true; });
    child.once('exit', code => { if (!stopping) process.exitCode = code || 1; });
    console.log(`Minimal PocketBase ready at ${PB_URL} (isolated loopback service)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
