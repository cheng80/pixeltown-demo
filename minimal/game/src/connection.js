import { Client, ErrorCode } from '@colyseus/sdk';
import { recoveryPlan } from './state.js';
import { TICK_MS } from '../../shared/world.js';

export const RECOVERY = Object.freeze({ deadlineMs: 12000, attempts: 10, predictionMs: 3000, pendingLimit: 240, staleMs: 8000 });
const retryable = code => [1001, 1005, 1006, 4010].includes(Number(code));

// Own the movement queue: the SDK's ten-message offline queue cannot preserve it.
export function createConnection({ url, engine, userId, token, onSnapshot, onGameEnded = () => {},
  onDeployment = () => {}, onFrontend = null, onFeatureUnavailable = () => {}, onFailure = () => {}, onRecovery = () => {},
  client = new Client(url), policy = RECOVERY }) {
  if (client.auth.settings) client.auth.settings.key = 'pixeltown.minimal.room-auth';
  client.auth.token = token;
  const status = { phase: 'joining', drops: 0, attempts: 0, recovered: 0, failures: 0, acknowledged: 0, replayed: 0, corrected: 0 };
  // An open socket can stop confirming input before onDrop/checkStale fires.
  // Count all outstanding predicted steps, including those queued before recovery.
  const predictionLimit = Math.max(1, Math.ceil(policy.predictionMs / TICK_MS));
  let room, identity, resumeToken, stopped = false, recoveringAt = 0, lastAck = 0;
  let retryTimer, deadline, predictionTimer, replayTimer, joinTimer, attempt = 0, replay = [];
  const timers = () => { clearTimeout(retryTimer); clearTimeout(deadline); clearTimeout(predictionTimer); clearInterval(replayTimer); clearTimeout(joinTimer); };
  const notify = () => onRecovery({ ...status });
  function close(value) {
    if (!value) return;
    value.reconnection.enabled = false;
    value.reconnection.maxRetries = 0;
    // Also close a socket in CONNECTING state. A late successful promise is closed below.
    try { if (value.connection?.isOpen) void value.leave().catch(() => {}); else value.connection?.close(); } catch { /* Already closed. */ }
  }
  function fail(error) {
    if (stopped) return;
    stopped = true; timers(); status.phase = 'failed'; status.failures++; engine.connected = false;
    // Keep pending and the last server state for diagnosis / explicit reentry.
    status.unconfirmed = engine.pending.length; close(room); notify(); onFailure(error);
  }
  function complete() {
    clearTimeout(deadline); clearTimeout(predictionTimer); clearInterval(replayTimer);
    replay = []; status.phase = 'playing'; status.recovered++; recoveringAt = 0;
    engine.connected = true; notify();
  }
  function receive(value, data) {
    if (stopped || value !== room || data?.zone !== 'lobby' || !Array.isArray(data.players)) return;
    const me = data.players.find(p => p.id === userId);
    if (!me) return;
    const resuming = status.phase === 'recovering' && value.connection?.isOpen;
    // Snapshots on the old socket before a replacement is bound are ignored.
    if (status.phase === 'recovering' && value === droppedRoom) return;
    let plan;
    try { if (resuming) plan = recoveryPlan(engine, data, userId); }
    catch (error) { fail(error); return; }
    if (!onSnapshot(data)) return;
    lastAck = me.ack; resumeToken = value.reconnectionToken;
    clearTimeout(joinTimer);
    if (!resuming) { status.phase = 'playing'; engine.connected = true; return; }
    status.acknowledged += plan.acknowledged; status.corrected += plan.corrected;
    engine.connected = false;
    if (!replayTimer) {
      replay = plan.replay.map(p => ({ ...p })); engine.connected = false;
      if (!replay.length) { complete(); return; }
      replayTimer = setInterval(() => {
        if (stopped || status.phase !== 'recovering' || !room.connection?.isOpen) return;
        // Acked and corrected inputs are removed by the snapshot reconciler.
        replay = replay.filter(p => p.seq > lastAck && p.fix === engine.fix);
        try {
          for (let n = 0; n < 4 && replay.length; n++) { room.send('move', replay.shift()); status.replayed++; }
        } catch (error) { restart(error); }
      }, 50);
    }
    if (!engine.pending.length) complete();
  }
  let droppedRoom;
  function bind(value, resumed = false) {
    if (stopped) { close(value); return; }
    value.reconnection.enabled = false; value.reconnection.maxRetries = 0;
    if (resumed && (value.roomId !== identity.roomId || value.sessionId !== identity.sessionId)) { close(value); fail(new Error('Different session on recovery')); return; }
    room = value; engine.room = value; resumeToken = value.reconnectionToken;
    identity ??= { roomId: value.roomId, sessionId: value.sessionId };
    value.onMessage('snapshot', data => receive(value, data));
    value.onMessage('gameEnded', data => { if (!stopped && room === value) onGameEnded(data); });
    value.onMessage('deployment', data => { if (!stopped && room === value) onDeployment(data); });
    for (const type of ['frontendRevision', 'frontendCurrent']) value.onMessage(type, data => { if (!stopped && room === value) onFrontend?.(data); });
    value.onMessage('featureUnavailable', data => { if (!stopped && room === value) onFeatureUnavailable(data); });
    if (onFrontend) { try { value.send('frontendCurrent'); } catch { /* Reconnect/visibility requests reconcile missed hints. */ } }
    value.onDrop((code, reason) => { if (!stopped && room === value && value !== droppedRoom) retryable(code) ? restart({ code, message: reason }) : fail({ code, message: reason }); });
    value.onLeave((code, reason) => {
      if (stopped || room !== value || value === droppedRoom) return;
      retryable(code) ? restart({ code, message: reason }) : fail({ code, message: reason });
    });
    value.onError((code, reason) => {
      if (stopped || room !== value || value === droppedRoom) return;
      if (Number(code) >= 4000 && Number(code) !== 4010) fail({ code, message: reason });
      else if (engine.initialized) restart({ code, message: reason });
      else fail({ code, message: reason });
    });
  }
  function schedule() {
    if (stopped || attempt >= policy.attempts || Date.now() - recoveringAt >= policy.deadlineMs) { fail(new Error('Session recovery timed out')); return; }
    retryTimer = setTimeout(async () => {
      if (stopped) return;
      attempt++; status.attempts++; notify();
      try { bind(await client.reconnect(resumeToken), true); }
      catch (error) {
        if (stopped) return;
        // Expired/missing room and invalid token cannot be repaired by a new join.
        if ([401, 403, ErrorCode.MATCHMAKE_INVALID_ROOM_ID, ErrorCode.MATCHMAKE_EXPIRED, ErrorCode.AUTH_FAILED].includes(Number(error.code || error.status))) fail(error);
        else schedule();
      }
    }, Math.min(1000, 200 * 2 ** attempt));
  }
  function restart(error, cause = 'transport') {
    if (stopped) return;
    if (!engine.initialized || !resumeToken) { fail(error); return; }
    status.drops++; droppedRoom = room;
    status.lastCause = cause;
    status.lastCode = Number.isInteger(Number(error?.code)) ? Number(error.code) : null;
    clearInterval(replayTimer); replayTimer = null; replay = [];
    // Multiple drop/error/leave notifications belong to one recovery deadline.
    if (status.phase !== 'recovering') {
      status.phase = 'recovering'; recoveringAt = Date.now(); attempt = 0;
      deadline = setTimeout(() => fail(new Error('Session recovery timed out')), policy.deadlineMs);
      predictionTimer = setTimeout(() => { engine.connected = false; }, policy.predictionMs);
    }
    clearTimeout(retryTimer); notify();
    try { room.connection?.close(4010, 'Session recovery'); } catch { /* Network already gone. */ }
    schedule();
  }
  joinTimer = setTimeout(() => fail(new Error('Join timeout')), 12000);
  void client.joinOrCreate('minimal-town', { zone: 'lobby' }).then(value => bind(value)).catch(fail);
  return {
    status,
    send(movement) {
      if (stopped) return;
      if (engine.pending.length >= policy.pendingLimit) { engine.connected = false; if (status.phase === 'playing') restart(new Error('Input confirmation stalled'), 'pending-limit'); return; }
      if (engine.pending.length >= predictionLimit) { engine.connected = false; if (status.phase === 'playing') restart(new Error('Input prediction limit reached'), 'prediction-limit'); return; }
      if (status.phase === 'recovering') return;
      if (!room?.connection?.isOpen) { restart(new Error('Connection closed'), 'socket-closed'); return; }
      try { room.send('move', movement); } catch (error) { restart(error); }
    },
    requestFrontend() { if (!stopped && room?.connection?.isOpen) { try { room.send('frontendCurrent'); } catch { /* Version checks do not restart gameplay. */ } } },
    checkStale() {
      if (!stopped && status.phase === 'playing' && engine.initialized && Date.now() - engine.lastSnapshot > policy.staleMs) restart(new Error('Snapshot stale'), 'snapshot-stale');
    },
    dispose() { if (stopped && status.phase === 'closed') return; stopped = true; timers(); if (status.phase !== 'failed') status.phase = 'closed'; engine.connected = false; close(room); },
  };
}
