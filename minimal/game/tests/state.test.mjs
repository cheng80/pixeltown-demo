import test from 'node:test';
import assert from 'node:assert/strict';
import { WalletState, rememberScore, reconcileLedger, pendingTotal, failureMessage, retryDelay, isDuplicateGuest } from '../src/state.js';
const wallet = (balance, ids = []) => ({ balance, settledMatchIds: ids, profile: { name: '이웃' } });

test('a failed wallet request retains its last successful value as unconfirmed', () => {
  const state = new WalletState(); state.accept(state.begin(), wallet(12));
  state.fail(state.begin());
  assert.equal(state.value.balance, 12); assert.equal(state.status, 'unknown');
});
test('a slow previous response cannot overwrite a newer success or failure', () => {
  const state = new WalletState(); const old = state.begin(), latest = state.begin();
  assert.equal(state.accept(latest, wallet(9)), true);
  assert.equal(state.accept(old, wallet(1)), false);
  assert.equal(state.fail(old), false); assert.equal(state.value.balance, 9);
  const older = state.begin(), newer = state.begin(); state.fail(newer);
  assert.equal(state.accept(older, wallet(100)), false); assert.equal(state.value.balance, 9);
});
test('invalid wallet payload cannot erase a confirmed balance', () => {
  const state = new WalletState(); state.accept(state.begin(), wallet(8)); const generation = state.begin();
  assert.throws(() => state.accept(generation, wallet(-1))); state.fail(generation);
  assert.equal(state.value.balance, 8);
});
test('disposed requests cannot publish results', () => {
  const state = new WalletState(); const generation = state.begin(); state.invalidate();
  assert.equal(state.accept(generation, wallet(1)), false);
});
test('disk acknowledgement is still pending until this users wallet confirms that match', () => {
  let ledger = rememberScore({}, 'round-a', 4);
  ledger = rememberScore(ledger, 'round-a', 4, true);
  assert.equal(pendingTotal(ledger), 4); assert.equal(ledger['round-a'].durable, true);
  ledger = reconcileLedger(ledger, ['someone-elses-round']); assert.equal(pendingTotal(ledger), 4);
  ledger = reconcileLedger(ledger, ['round-a']); assert.equal(pendingTotal(ledger), 0);
});
test('late snapshots and duplicate gameEnded do not count an already settled match twice', () => {
  let ledger = rememberScore({}, 'a', 2); ledger = rememberScore(ledger, 'a', 2, true);
  assert.equal(pendingTotal(ledger), 2);
  ledger = reconcileLedger(ledger, ['a']); ledger = rememberScore(ledger, 'a', 2, true, ['a']);
  assert.equal(pendingTotal(ledger), 0);
});
test('rate limits show a wait rather than a server outage and honor Retry-After', () => {
  const error = { status: 429, retryAfterMs: 120000 };
  assert.match(failureMessage(error, 'guest'), /기다린/);
  assert.doesNotMatch(failureMessage(error, 'game'), /연결하지 못/);
  assert.equal(retryDelay(error), 120000);
});
test('a duplicate guest tab is distinguished from an unrelated conflict or outage', () => {
  const duplicate = { code: 409, message: '이미 입장한 사용자입니다.' };
  assert.equal(isDuplicateGuest(duplicate), true);
  assert.match(failureMessage(duplicate, 'game'), /다른 탭/);
  assert.doesNotMatch(failureMessage(duplicate, 'game'), /연결하지 못/);
  assert.equal(isDuplicateGuest({ code: 409, message: 'Other conflict' }), false);
  assert.equal(isDuplicateGuest({ code: 503, message: duplicate.message }), false);
  assert.match(failureMessage({ code: 409, message: 'Other conflict' }, 'game'), /연결하지 못/);
});
