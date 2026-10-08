// Real launchd lifecycle on macOS, with test-only labels, ports, app and database.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, cpSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@colyseus/sdk';
import { stepToward } from '../minimal/shared/world.js';
assert.equal(process.platform, 'darwin', 'This test needs macOS launchd');
const root = process.cwd(), fixture = mkdtempSync(resolve(root, '.test-work/minimal-services-')), app = resolve(fixture, 'app');
for (const path of ['colyseus/minimal', 'minimal/shared', 'pocketbase/minimal', 'scripts']) cpSync(resolve(root, path), resolve(app, path), { recursive: true, filter: p => !p.includes('/__pycache__') });
mkdirSync(resolve(fixture, 'Library/LaunchAgents'), { recursive: true });
symlinkSync(resolve(root, 'node_modules'), resolve(app, 'node_modules'), 'dir');
symlinkSync(resolve(root, 'colyseus/node_modules'), resolve(app, 'colyseus/node_modules'), 'dir');
writeFileSync(resolve(app, 'package.json'), '{"type":"module"}');
writeFileSync(resolve(fixture, '.env'), `MINIMAL_BACKEND_ONLY=1\nMINIMAL_PB_PORT=18127\nMINIMAL_GAME_PORT=12627\nMINIMAL_WEB_PORT=5277\nMINIMAL_SETTLE_MS=10000\nMINIMAL_SPAWN_MS=1000\nMINIMAL_PB_BINARY=${resolve(root, 'pocketbase/.local/pocketbase')}\n`, { mode: 0o600 });
// Patch only the test interpreter's module constants, never a real HOME or installed label.
const adapter = resolve(fixture, 'control.py');
writeFileSync(adapter, `import sys,pathlib,os,runpy,plistlib,json,subprocess
sys.path.insert(0, ${JSON.stringify(resolve(app, 'scripts'))})
import minimal_services as m
m.HOME=pathlib.Path(${JSON.stringify(fixture)})
m.ROOT=m.HOME
m.APP=pathlib.Path(${JSON.stringify(app)})
m.NODE=pathlib.Path(${JSON.stringify(process.execPath)})
m.OLD_LABEL=${JSON.stringify('com.fastmake.pixeltown.minimal-test-' + process.pid)}
m.LABELS={'pb':m.OLD_LABEL+'.pocketbase','game':m.OLD_LABEL+'.colyseus'}
action=sys.argv[1]
if action=='install-old':
 value=m.definition('pb');value['Label']=m.OLD_LABEL;value['ProgramArguments'][-1]='scripts/dev-minimal.mjs'
 with m.plist_path(m.OLD_LABEL).open('wb') as stream:plistlib.dump(value,stream)
 m.launch('bootstrap',m.OLD_LABEL);m.wait_ready(12627,'/ready');print(json.dumps({'ready':True}))
elif action=='cleanup':
 for label in list(m.LABELS.values())+[m.OLD_LABEL]:
  subprocess.run(['launchctl','bootout',m.DOMAIN+'/'+label],capture_output=True)
else:
 sys.argv=[str(m.APP/'scripts'/action)]+sys.argv[2:]
 runpy.run_path(sys.argv[0],run_name='__main__')
`);
const report = { passed: false, production: false, fixture, tests: [] }, base = 'http://127.0.0.1:12627', pb = 'http://127.0.0.1:18127';
let room, timer, observing = true, snapshot, pos, seq = 0, drops = 0, fixes = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await sleep(50); } throw new Error('Timeout: ' + label); }
async function control(action, ...args) {
  const child = spawn('python3', [adapter, action, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
  child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const code = await new Promise(r => child.once('exit', r));
  writeFileSync(resolve(fixture, `control-${action}-${Date.now()}.log`), output); return { code, output };
}
async function health() { return (await fetch(base + '/health')).json(); }
async function ready() { try { return (await fetch(base + '/ready')).ok; } catch { return false; } }
async function join(token) { const c = new Client('ws://127.0.0.1:12627'); c.auth.token = token; return c.joinOrCreate('minimal-town', { zone: 'lobby' }); }
try {
  console.log(`Fixture: ${fixture}`);
  const installed = await control('install-old'); assert.equal(installed.code, 0, installed.output);
  const auth = await (await fetch(pb + '/api/minimal/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '서비스분리검증', password: randomBytes(32).toString('hex') }) })).json(); assert(auth.token);
  room = await join(auth.token); room.onMessage('snapshot', () => {}); room.onMessage('deployment', () => {}); room.onMessage('gameEnded', () => {});
  const refused = await control('split-minimal-services.py', '--apply'); assert.notEqual(refused.code, 0); assert(room.connection.isOpen); assert.equal((await health()).players, 1);
  report.tests.push('first split refuses an occupied lobby without stopping the live room');
  await room.leave(); room = null; await until(async () => (await health()).players === 0 && (await health()).persistence.pending === 0, 'empty lobby');
  const applied = await control('split-minimal-services.py', '--apply'); assert.equal(applied.code, 0, applied.output); report.split = JSON.parse(applied.output);
  room = await join(auth.token); room.reconnection.maxRetries = 0; const identity = { roomId: room.roomId, sessionId: room.sessionId };
  let snapshotCount = 0, last = 0, maxGap = 0;
  room.onMessage('snapshot', s => { const now = performance.now(); if (last) maxGap = Math.max(maxGap, now - last); last = now; snapshotCount++; snapshot = s; const p = s.players.find(p => p.id === auth.record.id); if (p) { fixes = p.fix; if (!pos) pos = { x: p.x, y: p.y }; } });
  room.onMessage('deployment', () => {}); room.onMessage('gameEnded', () => {});
  room.onDrop(() => { if (observing) drops++; }); room.onLeave(() => { if (observing) drops++; }); room.onError(() => { if (observing) drops++; });
  await until(() => snapshot, 'snapshot'); const origin = { ...pos };
  timer = setInterval(() => { const next = stepToward(pos, { x: origin.x + (Math.floor(seq / 3) % 2 ? 0 : 12), y: origin.y }); if (next.x === pos.x && next.y === pos.y) return; pos = next; room.send('move', { ...pos, seq: ++seq, fix: 0 }); }, 50);
  const hooks = resolve(app, 'pocketbase/minimal/pb_hooks'), source = resolve(fixture, 'next-hooks'); cpSync(hooks, source, { recursive: true });
  const api = resolve(source, 'api.pb.js'); writeFileSync(api, readFileSync(api, 'utf8') + '\nrouterAdd("GET", "/api/minimal/test-service-revision", (e) => e.json(200, { revision: 2 }));\n');
  const deployed = await control('deploy-minimal-pb.py', '--hooks-source', source); assert.equal(deployed.code, 0, deployed.output); report.deploy = JSON.parse(deployed.output);
  assert.equal((await (await fetch(pb + '/api/minimal/test-service-revision')).json()).revision, 2);
  report.tests.push('actual PB-only launchd deployment changes hooks and preserves game process/room');
  writeFileSync(resolve(source, 'bootstrap.pb.js'), readFileSync(resolve(source, 'bootstrap.pb.js'), 'utf8') + '\nonBootstrap((e) => { throw new Error("deliberate isolated deployment rejection"); });\n');
  const rejected = await control('deploy-minimal-pb.py', '--hooks-source', source); assert.notEqual(rejected.code, 0); await until(ready, 'old hooks recovered', 35000);
  assert.equal((await (await fetch(pb + '/api/minimal/test-service-revision')).json()).revision, 2);
  report.tests.push('actual rejected PB deployment restores previous hooks without overwriting DB or stopping game');
  clearInterval(timer); await until(() => snapshot.players.find(p => p.id === auth.record.id).ack === seq, 'last input acknowledged');
  assert(seq > 100); assert.equal(drops + fixes, 0); assert.equal(room.roomId, identity.roomId); assert.equal(room.sessionId, identity.sessionId); assert(maxGap < 8000);
  Object.assign(report, { inputs: seq, snapshots: snapshotCount, drops, fixes, maxSnapshotGap: maxGap, passed: true });
} catch (error) { report.error = error.stack; process.exitCode = 1; console.error(error.stack); }
finally {
  observing = false; clearInterval(timer); if (room?.connection.isOpen) await room.leave();
  await control('cleanup'); writeFileSync(resolve(fixture, 'report.json'), JSON.stringify(report, null, 2)); console.log(`Report: ${fixture}/report.json`);
}
