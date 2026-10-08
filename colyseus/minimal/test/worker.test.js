import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerHost } from '../worker-host.js';
import { WorkerRuntime } from '../worker-runtime.js';
import { mkdtempSync, symlinkSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const worker = new URL('../simulation-worker.js', import.meta.url);
const fixture = name => new URL(`./fixtures/${name}-worker.js`, import.meta.url);
const tick = now => [{ type: 'tick', now }];
const pause = ms => new Promise(r => setTimeout(r, ms));
async function host(t, options = {}) {
  const h = new WorkerHost({ settle() {}, ...options }); t.after(() => h.close()); await h.ready;
  await h.dispatch([{ type: 'join', session: 'a', data: { id: 'u1', name: 'one' }, now: 1000 }]);
  return h;
}

test('candidate catches live ordered input and switches only at an identical tick boundary', async t => {
  const h = await host(t);
  const stages = [];
  h.on('deployment', value => stages.push(value));
  const swapping = h.swap(fixture('slow'));
  let seq = 0;
  const timer = setInterval(() => { const x = ++seq % 2 ? 36 : 32; void h.dispatch([{ type: 'move', session: 'a', data: { x, y: 320, seq, fix: 0 }, now: 1000 + seq * 50 }, ...tick(1000 + seq * 50)]); }, 20);
  t.after(() => clearInterval(timer));
  const result = await swapping; clearInterval(timer);
  assert(result.replayed >= 5); assert.equal(result.generation, 2);
  assert.equal(h.players.get('a').fix, 0); assert(h.players.get('a').ack >= 5);
  assert(h.lastWasTick); assert.equal(h.state.game.endsAt, 181000);
  assert.deepEqual(stages.map(value => value.phase), ['preparing', 'catching-up', 'applied']);
  assert.deepEqual(stages.map(value => value.eventSeq), [1, 2, 3]);
  assert.equal(stages[0].generation, 1);
  assert.equal(stages[2].revision, result.revision);
  assert.equal(h.snapshot().deployment.generation, 2);
  const original = structuredClone(h.state);
  const again = h.swap(worker); await h.dispatch(tick(2000)); await again;
  assert.equal(h.state.game.id, original.game.id); assert.deepEqual(h.state.game.scores, original.game.scores);
  assert.deepEqual(h.state.moves, original.moves);
});

test('candidate mismatch, startup crash and timeout leave the active authority intact', async t => {
  const h = await host(t, { candidateTimeoutMs: 120, responseTimeoutMs: 300 });
  for (const entry of [fixture('bad'), fixture('hung'), new URL('./fixtures/missing.js', import.meta.url)]) {
    const rejected = assert.rejects(h.swap(entry));
    await h.dispatch(tick(1050)); await pause(35); await h.dispatch(tick(1100)); await rejected;
    assert.equal(h.generation, 1); assert.equal(h.players.size, 1);
    assert.equal(h.snapshot().deployment.phase, 'cancelled');
  }
  assert.equal(h.stats.cancelled, 3);
});

test('active failure replays the in-flight event from latest committed state without losing input', async t => {
  const h = await host(t);
  const promoted = h.swap(worker); await h.dispatch(tick(1050)); await promoted;
  const before = h.state.game.id;
  const old = h.active;
  const result = h.dispatch([{ type: 'move', session: 'a', data: { x: 36, y: 320, seq: 1, fix: 0 }, now: 1100 }, ...tick(1100)]);
  h.failed(old, new Error('Injected crash'));
  await result;
  assert.equal(h.players.get('a').ack, 1); assert.equal(h.players.get('a').x, 36);
  assert.equal(h.state.game.id, before); assert.equal(h.stats.recoveries, 1);
  const stable = structuredClone(h.state);
  h.result(old, { state: { sequence: 999 } });
  assert.deepEqual(h.state, stable); assert.equal(h.stats.staleResults, 1);
});

test('active recovery uses the committed artifact when the release pointer names an untrusted candidate', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pixeltown-worker-recovery-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const pointer = join(directory, 'current.mjs');
  symlinkSync(fileURLToPath(worker), pointer);
  const h = await host(t, { entry: pointer });
  const revision = h.active.revision, gameId = h.state.game.id;
  unlinkSync(pointer); symlinkSync(fileURLToPath(fixture('bad')), pointer);
  h.failed(h.active, new Error('Failure while next release is selected'));
  await h.dispatch(tick(1050));
  assert.equal(h.active.revision, revision);
  assert.equal(h.state.game.id, gameId);
  assert.equal(h.players.size, 1);
  assert.equal(h.stats.recoveries, 1);
  assert(!h.fatal);
});

test('durable settlement failure, shadow replay and repeated proposals publish exactly once', async t => {
  const published = []; let fail = true;
  const h = await host(t, { durationMs: 1000, settle: m => { if (fail) throw new Error('disk'); published.push(m); } });
  // Import a nontrivial checkpoint: departure scores, movement credit, stars and pending settlement.
  await h.close();
  const state = structuredClone(h.state); state.game.scores.u1 = 2; state.game.scores.departed = 3;
  const g = new WorkerHost({ settle: m => { if (fail) throw new Error('disk'); published.push(m); } }); t.after(() => g.close());
  g.retire(g.active); g.state = state; g.active = g.start(worker, state); await g.active.ready;
  await g.dispatch(tick(2100)); assert(g.state.pendingMatch); assert.equal(published.length, 0);
  const match = structuredClone(g.state.pendingMatch);
  const swap = g.swap(fixture('slow'));
  for (let n = 0; n < 20; n++) { await g.dispatch(tick(2150 + n * 50)); await pause(20); }
  await swap; assert.deepEqual(g.state.pendingMatch, match);
  fail = false;
  await g.dispatch(tick(3200)); await g.dispatch(tick(3250)); await g.dispatch(tick(3300));
  assert.deepEqual(published, [match]); assert(!g.state.pendingMatch);
  assert.equal(g.state.game.scores.u1, 0); assert.equal(g.state.game.scores.departed, undefined);
});

test('state schema and event ordering are mandatory; deterministic replay retains all state', () => {
  const r = new WorkerRuntime();
  const event = { sequence: 1, entropy: '1234567890abcdef', commands: [{ type: 'join', session: 'a', data: { id: 'u', name: 'U' }, now: 42 }] };
  const first = r.apply(event);
  assert.throws(() => r.apply(event));
  assert.throws(() => new WorkerRuntime({ ...first.state, schema: 2 }));
  const shadow = new WorkerRuntime(first.state);
  const second = { sequence: 2, entropy: '234567890abcdef1', commands: tick(6042) };
  assert.deepEqual(r.apply(second), shadow.apply(second));
});

test('joining, departing, duplicate movement and fix epochs remain ordered while a candidate catches up', async t => {
  const h = await host(t);
  const swap = h.swap(fixture('slow'));
  await h.dispatch([{ type: 'join', session: 'b', data: { id: 'u2', name: 'two' }, now: 1050 }]);
  const duplicate = await h.dispatch([{ type: 'join', session: 'duplicate', data: { id: 'u2', name: 'two' }, now: 1051 }]);
  assert(duplicate.outcomes[0].error);
  await h.dispatch([
    { type: 'move', session: 'a', data: { x: 36, y: 320, seq: 1, fix: 0 }, now: 1100 },
    { type: 'move', session: 'a', data: { x: 40, y: 320, seq: 1, fix: 0 }, now: 1101 },
    { type: 'move', session: 'a', data: { x: 320, y: 180, seq: 2, fix: 0 }, now: 1102 },
    { type: 'move', session: 'a', data: { x: 40, y: 320, seq: 3, fix: 0 }, now: 1103 },
    { type: 'leave', session: 'b', now: 1104 }, ...tick(1150),
  ]);
  for (let n = 0; n < 16; n++) { await pause(20); await h.dispatch(tick(1200 + n * 50)); }
  await swap;
  assert.deepEqual([...h.players.keys()], ['a']);
  assert.equal(h.players.get('a').x, 36); assert.equal(h.players.get('a').ack, 1); assert.equal(h.players.get('a').fix, 1);
  await h.dispatch([{ type: 'move', session: 'a', data: { x: 40, y: 320, seq: 4, fix: 1 }, now: 2100 }, ...tick(2150)]);
  assert.equal(h.players.get('a').ack, 4); assert.equal(h.players.get('a').x, 40);
});
