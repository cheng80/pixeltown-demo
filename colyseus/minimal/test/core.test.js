import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Simulation } from '../simulation.js';
import { MinimalOutbox } from '../outbox.js';
import { blocked, stepDirection } from '../../../minimal/shared/world.js';

test('movement validation preserves sequence, collision and room state for 100 players', () => {
  const game = new Simulation({ settle() {} });
  for (let i = 0; i < 100; i++) game.join(`s${i}`, { id: `u${i}`, name: `User ${i}` }, 1000);
  assert.equal(game.players.size, 100);
  const p = game.players.get('s99');
  const target = stepDirection(p, 1, 0);
  game.move('s99', { ...target, seq: 1, fix: 0 }, 1050);
  assert.equal(p.ack, 1);
  const x = p.x;
  game.move('s99', { x: x + 4, y: p.y, seq: 1, fix: 0 }, 1100);
  assert.equal(p.x, x, 'duplicate input must not move twice');
  game.move('s99', { x: 320, y: 180, seq: 2, fix: 0 }, 1150);
  assert.equal(p.fix, 1); assert.equal(p.x, x); assert(blocked(320, 180));
  assert.throws(() => game.join('again', { id: 'u99' }), /이미/);
});

test('100 distinct scorers settle through 64-point bounded batches without losing departure points', () => {
  const matches = [], game = new Simulation({ settle: m => matches.push(structuredClone(m)), durationMs: 3000 });
  for (let i = 0; i < 100; i++) game.join(`s${i}`, { id: `u${i}`, name: 'P' }, 1000);
  for (let i = 0; i < 100; i++) {
    const p = game.players.get(`s${i}`);
    game.game.stars = [{ id: `test${i}`, x: p.x, y: p.y }];
    game.tick(1100 + i);
  }
  game.finish(5000);
  assert.equal(matches.length, 2);
  const totals = Object.assign({}, ...matches.map(m => m.scores));
  assert.equal(Object.keys(totals).length, 100);
  assert(Object.values(totals).every(score => score === 1));
  assert.deepEqual(matches.map(m => Object.keys(m.scores).length), [64, 36]);
  const separate = new Simulation({ settle: m => matches.push(m) });
  separate.join('a', { id: 'a' }, 1000); separate.join('b', { id: 'b' }, 1000);
  separate.game.scores.a = 2; separate.leave('a', 1050);
  assert.equal(separate.game.scores.a, 2);
  separate.leave('b', 1100); assert.equal(matches.at(-1).scores.a, 2);
});

test('failed durable write freezes awards and retries the identical settlement before continuing', () => {
  let fail = true; const attempts = [];
  const game = new Simulation({ durationMs: 1000, settle: m => { attempts.push(structuredClone(m)); if (fail) throw Error('disk full'); } });
  game.join('a', { id: 'a' }, 1000); game.game.scores.a = 3;
  const id = game.game.id;
  game.tick(2000); assert.equal(game.game.id, id); assert.equal(game.game.scores.a, 3);
  game.tick(2050); assert.deepEqual(attempts[1], attempts[0]);
  fail = false; game.tick(2100);
  assert.deepEqual(attempts[2], attempts[0]); assert.notEqual(game.game.id, id); assert.equal(game.game.scores.a, 0);
});

test('outbox keeps a failed match while unrelated rewards finish; retry and new process preserve identity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'minimal-outbox-'));
  try {
    const a = { match_id: randomUUID(), scores: { a: 1 } }, b = { match_id: randomUUID(), scores: { b: 1 } };
    const calls = [];
    const box = new MinimalOutbox(dir, async () => ({ send: async (_, { body }) => { calls.push(body.match_id); if (body.match_id === a.match_id) throw Error('deleted user'); } }));
    box.enqueue(a); box.enqueue(b); box.enqueue(a);
    assert.throws(() => box.enqueue({ ...a, scores: { a: 2 } }), /Conflicting/);
    await Promise.all([box.flush(), box.flush()]);
    assert.equal(calls.length, 2); assert.equal(box.status().pending, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, a.match_id + '.json'))), a);
    const recovered = new MinimalOutbox(dir, async () => ({ send: async () => {} }));
    await recovered.flush(); assert.equal(recovered.status().pending, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
