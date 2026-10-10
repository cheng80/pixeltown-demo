import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';

test('UI subscriptions cannot reset runtime; requests complete once after remount', async () => {
  let authCount = 0, joins = 0, leaves = 0, resolveWallet;
  const api = { pb: { authStore: { token: 'private-token' } }, savedGuest: () => null,
    authenticate: async () => { authCount++; return { record: { id: 'guest', email: 'secret-email' } }; },
    request: () => new Promise(resolve => { resolveWallet = resolve; }),
    createGameConnection: () => { joins++; return { send() {}, checkStale() {}, dispose() { leaves++; } }; },
  };
  const runtime = createRuntime({ api });
  try {
    assert.equal(runtime.facade.getSnapshot(), runtime.facade.getSnapshot());
    runtime.facade.setUI({ name: '초안' });
    await runtime.facade.enter();
    const remove = runtime.facade.subscribe(() => {}); remove();
    const again = runtime.facade.subscribe(() => {});
    runtime.engine.pending.push({ seq: 7 }); runtime.engine.seq = 7;
    resolveWallet({ balance: 12, settledMatchIds: [] }); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(runtime.facade.getSnapshot().ui.name, '초안');
    assert.equal(authCount, 1); assert.equal(joins, 1); assert.equal(leaves, 0);
    assert.equal(runtime.engine.seq, 7); assert.equal(runtime.engine.pending.length, 1);
    assert.ok(!JSON.stringify(runtime.facade.getSnapshot()).includes('private-token'));
    assert.ok(!JSON.stringify(runtime.facade.getSnapshot()).includes('secret-email'));
    assert.throws(() => { runtime.facade.getSnapshot().ui.name = 'overwrite'; });
    again();
  } finally { runtime.dispose(); }
  assert.equal(leaves, 1);
});

test('candidate and retired command leases reject mutations; snapshot contains immutable UI state', async () => {
  const { createUIFacade } = await import('../src/runtime.js');
  const runtime = createRuntime({ api: { savedGuest: () => null, pb: { authStore: {} } } });
  const old = createUIFacade(runtime, () => {}), next = createUIFacade(runtime, () => {});
  try {
    assert.throws(() => next.facade.setUI({ name: 'candidate' }), /Inactive/);
    old.setActive(true); old.facade.setUI({ name: '한글' });
    old.setActive(false); next.setActive(true);
    assert.equal(next.facade.getSnapshot().ui.name, '한글');
    assert.throws(() => old.facade.setUI({ name: 'late callback' }), /Inactive/);
    next.facade.setInteraction('composition', true); assert.equal(runtime.safeToSwap, false);
    next.facade.setInteraction('composition', false); assert.equal(runtime.safeToSwap, true);
    next.dispose(); assert.throws(() => next.facade.setPad(1, 0), /Inactive/);
  } finally { old.dispose(); runtime.dispose(); }
});

test('authentication timeout begins after the version check; disposed runtime never authenticates', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finishCheck, authSignal, calls = 0;
  const api = { savedGuest: () => null, pb: { authStore: {} }, authenticate: async (_, signal) => { calls++; authSignal = signal; throw Error('test stops before join'); } };
  const runtime = createRuntime({ api });
  runtime.setHooks({ checkBeforeEnter: () => new Promise(resolve => { finishCheck = resolve; }) });
  const entering = runtime.facade.enter();
  t.mock.timers.tick(12000); finishCheck(); await entering;
  assert.equal(authSignal.aborted, false); assert.equal(calls, 1);
  runtime.dispose();
  const other = createRuntime({ api });
  other.setHooks({ checkBeforeEnter: () => new Promise(resolve => { finishCheck = resolve; }) });
  const stopped = other.facade.enter(); other.dispose(); finishCheck(); await stopped;
  assert.equal(calls, 1);
});
