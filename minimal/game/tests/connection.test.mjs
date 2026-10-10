import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection, RECOVERY } from '../src/connection.js';
import { createEngine, applySnapshot } from '../src/engine.js';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function signal() { const listeners = []; const s = fn => listeners.push(fn); s.emit = (...args) => listeners.forEach(fn => fn(...args)); return s; }
function fakeRoom(id = 'session') {
  const messages = new Map(), sent = [];
  return { roomId: 'room', sessionId: id, reconnectionToken: 'room:private-token', reconnection: {}, sent,
    connection: { isOpen: true, close() { this.isOpen = false; } },
    onDrop: signal(), onLeave: signal(), onError: signal(), onMessage(type, fn) { messages.set(type, fn); },
    emit(type, data) { messages.get(type)?.(data); }, send(type, data) { sent.push({ type, data }); },
    leave() { this.connection.isOpen = false; return Promise.resolve(); },
  };
}
const snapshot = (ack = 0, fix = 0, x = 32) => ({ zone: 'lobby', players: [{ id: 'guest', name: 'G', x, y: 320, ack, fix }], game: { id: 'match', scores: { guest: 2 }, stars: [] } });
async function fixture({ reconnect, policy, apply = applySnapshot } = {}) {
  const engine = createEngine(), first = fakeRoom(), second = fakeRoom(), failures = [], transitions = [];
  let reconnects = 0;
  const client = { auth: { settings: {} }, joinOrCreate: async () => first, reconnect: async token => { assert.equal(token, 'room:private-token'); reconnects++; return reconnect ? reconnect(second) : second; } };
  const connection = createConnection({ engine, userId: 'guest', token: 'auth', url: 'ws://localhost', client,
    onSnapshot: data => apply(engine, data, 'guest'), onFailure: err => failures.push(err), onRecovery: s => transitions.push(s), policy: { ...RECOVERY, ...policy } });
  await delay(0); first.emit('snapshot', snapshot());
  return { engine, first, second, connection, failures, transitions, get reconnects() { return reconnects; } };
}
test('resume keeps identity and pending; acked input is not sent twice, remaining seq is replayed in order', async () => {
  const f = await fixture();
  try {
    f.engine.seq = 4; f.engine.pending = [1,2,3,4].map(seq => ({ x: 32 + seq * 4, y: 320, seq, fix: 0 }));
    f.first.onDrop.emit(1006); f.first.onLeave.emit(1006);
    assert.equal(f.connection.status.phase, 'recovering'); assert(f.engine.connected); assert.equal(f.failures.length, 0);
    f.connection.send(f.engine.pending.at(-1)); assert.equal(f.first.sent.length, 0);
    await delay(225); assert.equal(f.reconnects, 1); assert.equal(f.engine.room, f.second);
    f.second.emit('snapshot', snapshot(2, 0, 40)); assert(!f.engine.connected);
    await delay(65); assert.deepEqual(f.second.sent.map(m => m.data.seq), [3,4]);
    f.second.emit('snapshot', snapshot(3, 0, 44)); assert(!f.engine.connected, 'new steps cannot overtake replay');
    f.second.emit('snapshot', snapshot(4, 0, 48));
    assert.equal(f.connection.status.phase, 'playing'); assert.equal(f.connection.status.acknowledged, 4);
    assert.equal(f.connection.status.replayed, 2); assert.equal(f.connection.status.recovered, 1);
    assert.deepEqual(f.engine.self, { x: 48, y: 320 }); assert.equal(f.engine.seq, 4); assert.deepEqual(f.engine.pending, []);
  } finally { f.connection.dispose(); }
});
test('server correction is counted instead of pretending old pending was acknowledged', async () => {
  const f = await fixture();
  try {
    f.engine.seq = 2; f.engine.pending = [{ x: 36, y: 320, seq: 1, fix: 0 }, { x: 40, y: 320, seq: 2, fix: 0 }];
    f.first.onDrop.emit(1001); await delay(225); f.second.emit('snapshot', snapshot(1, 1, 36));
    assert.equal(f.connection.status.corrected, 1); assert.equal(f.connection.status.acknowledged, 1);
    assert.equal(f.connection.status.replayed, 0); assert.equal(f.engine.fix, 1); assert.equal(f.engine.seq, 2);
    assert.deepEqual(f.engine.self, { x: 36, y: 320 }); assert.equal(f.connection.status.phase, 'playing');
  } finally { f.connection.dispose(); }
});
test('a replacement session is rejected and unconfirmed input remains available', async () => {
  const f = await fixture({ reconnect: async () => fakeRoom('different') });
  try { f.engine.pending = [{ seq: 1, fix: 0 }]; f.engine.seq = 1; f.first.onDrop.emit(1006); await delay(225);
    assert.equal(f.connection.status.phase, 'failed'); assert.match(f.failures[0].message, /Different session/); assert.equal(f.engine.pending.length, 1);
  } finally { f.connection.dispose(); }
});
test('deadline stops recovery; dispose cancels a queued attempt; terminal rate rejection is not retried', async () => {
  const f = await fixture({ reconnect: () => new Promise(() => {}), policy: { deadlineMs: 300, predictionMs: 50 } });
  f.engine.seq = 1; f.engine.pending = [{ seq: 1, fix: 0 }]; f.first.onDrop.emit(1006);
  await delay(70); assert(!f.engine.connected); assert.equal(f.engine.pending.length, 1);
  await delay(260); assert.equal(f.connection.status.phase, 'failed'); assert.equal(f.failures.length, 1); f.connection.dispose();
  const g = await fixture(); g.first.onDrop.emit(1006); g.connection.dispose(); await delay(225); assert.equal(g.reconnects, 0);
  const h = await fixture(); h.first.onLeave.emit(4002, 'rate limited'); await delay(225); assert.equal(h.reconnects, 0); assert.equal(h.failures[0].code, 4002); h.connection.dispose();
});
test('stale snapshot initiates recovery once, and backwards ack fails', async () => {
  const f = await fixture();
  try { f.engine.seq = 5; f.engine.snapshot = snapshot(3); f.engine.lastSnapshot = Date.now() - 9000;
    f.connection.checkStale(); f.connection.checkStale(); await delay(225); assert.equal(f.reconnects, 1);
    f.second.emit('snapshot', snapshot(2)); assert.equal(f.connection.status.phase, 'failed'); assert.match(f.failures[0].message, /backwards/);
  } finally { f.connection.dispose(); }
});

test('installed SDK disposed-room code is terminal and does not fall back to new join', async () => {
  const f = await fixture({ reconnect: async () => { throw Object.assign(new Error('Room disposed'), { code:522 }); } });
  try { f.first.onDrop.emit(1006); await delay(225); assert.equal(f.reconnects,1); assert.equal(f.connection.status.phase,'failed'); assert.equal(f.failures[0].code,522); } finally { f.connection.dispose(); }
});

test('an open but unresponsive socket stops at three seconds of pending input and resumes from ack', async () => {
  const f = await fixture();
  try {
    f.engine.keys.add('d'); f.engine.target = { x: 200, y: 320 };
    for (let seq=1; seq<=60; seq++) {
      const movement={x:32+(seq%2)*4,y:320,seq,fix:0};
      f.engine.seq=seq; f.engine.pending.push(movement); f.connection.send(movement);
      // Snapshots without a new ack must not reset the pending budget.
      if(seq%10===0 && seq<60) f.first.emit('snapshot',snapshot());
    }
    assert.equal(f.connection.status.phase,'recovering'); assert(!f.engine.connected);
    assert.equal(f.engine.pending.length,60); assert(f.engine.keys.has('d'));
    assert.deepEqual(f.engine.target,{x:200,y:320}); assert.equal(f.first.sent.length,59);
    await delay(225); f.second.emit('snapshot',snapshot(45)); await delay(225);
    assert.deepEqual(f.second.sent.map(m=>m.data.seq),Array.from({length:15},(_,i)=>46+i));
    f.second.emit('snapshot',snapshot(60));
    assert.equal(f.connection.status.phase,'playing'); assert(f.engine.connected);
    assert.equal(f.engine.pending.length,0); assert.equal(f.engine.seq,60);
    assert.equal(f.connection.status.corrected,0); assert.deepEqual(f.failures,[]);
  } finally { f.connection.dispose(); }
});

test('prediction already queued before drop shares the recovery budget, while healthy acks allow continuous movement', async () => {
  const f=await fixture();
  try {
    for(let seq=1;seq<=30;seq++){const m={x:32+(seq%2)*4,y:320,seq,fix:0};f.engine.seq=seq;f.engine.pending.push(m);f.connection.send(m);}
    f.first.onDrop.emit(1006);
    for(let seq=31;seq<=60;seq++){const m={x:32+(seq%2)*4,y:320,seq,fix:0};f.engine.seq=seq;f.engine.pending.push(m);f.connection.send(m);}
    assert(!f.engine.connected); assert.equal(f.engine.pending.length,60);
    assert.equal(f.first.sent.length,30); assert.equal(f.connection.status.drops,1);
  } finally { f.connection.dispose(); }
  const g=await fixture();
  try {
    for(let seq=1;seq<=200;seq++){const m={x:32+(seq%2)*4,y:320,seq,fix:0};g.engine.seq=seq;g.engine.pending.push(m);g.connection.send(m);g.first.emit('snapshot',snapshot(seq));}
    assert(g.engine.connected); assert.equal(g.connection.status.phase,'playing');
    assert.equal(g.connection.status.drops,0); assert.equal(g.engine.pending.length,0);
  } finally { g.connection.dispose(); }
});

test('frontend hints use the existing room and current is requested on bind and explicit visibility reconciliation', async () => {
  const engine = createEngine(), room = fakeRoom(), hints = [];
  const connection = createConnection({ url: 'ws://localhost', engine, userId: 'guest', token: 'auth',
    client: { auth: {}, joinOrCreate: async () => room }, onSnapshot: data => applySnapshot(engine, data, 'guest'), onFrontend: value => hints.push(value) });
  try {
    await delay(0); assert.deepEqual(room.sent.map(x => x.type), ['frontendCurrent']);
    room.emit('frontendCurrent', null); room.emit('frontendRevision', { generation: 1 });
    connection.requestFrontend(); assert.equal(room.sent.length, 2); assert.deepEqual(hints, [null, { generation: 1 }]);
    connection.dispose(); room.emit('frontendRevision', { generation: 2 }); assert.equal(hints.length, 2);
  } finally { connection.dispose(); }
});
