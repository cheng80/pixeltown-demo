import { Worker } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, realpathSync } from 'node:fs';
import { WorkerRuntime, digest } from './worker-runtime.js';

const DEFAULT_ENTRY = new URL('./simulation-worker.js', import.meta.url);
// Only this host owns sockets, committed state and durable effects. Workers are replaceable.
export class WorkerHost extends EventEmitter {
  constructor({ entry = DEFAULT_ENTRY, durationMs, spawnMs, settle, candidateTimeoutMs = 3000, responseTimeoutMs = 1500 } = {}) {
    super();
    this.entry = entry; this.settle = settle; this.candidateTimeoutMs = candidateTimeoutMs; this.responseTimeoutMs = responseTimeoutMs;
    this.state = new WorkerRuntime(null, { durationMs, spawnMs }).state();
    this.generation = 1; this.queue = []; this.journal = []; this.completed = new Set(); this.inFlight = null;
    this.stats = { swaps: 0, cancelled: 0, recoveries: 0, staleResults: 0, lastSwap: null };
    this.deployment = { phase: 'idle', eventSeq: 0, updatedAt: Date.now() };
    this.active = this.start(entry, this.state); this.ready = this.active.ready;
  }
  get players() { return new Map(this.state.players); }
  deploymentStatus() { return { ...this.deployment, revision: this.active.revision || null, generation: this.generation }; }
  publishDeployment(phase) {
    this.deployment = { phase, eventSeq: this.deployment.eventSeq + 1, updatedAt: Date.now() };
    this.emit('deployment', this.deploymentStatus());
  }
  snapshot() { return { zone: 'lobby', players: this.state.players.map(([, p]) => p), game: this.state.game, deployment: this.deploymentStatus() }; }
  status() { return { generation: this.generation, sequence: this.state.sequence, revision: this.active.revision, candidate: !!this.candidate, deployment: this.deploymentStatus(), ...this.stats }; }
  start(entry, state) {
    const resolvedEntry = existsSync(entry) ? realpathSync(entry) : entry;
    const slot = { entry: resolvedEntry, worker: new Worker(resolvedEntry), sequence: state.sequence, initialized: false, pending: null };
    slot.ready = new Promise((resolve, reject) => { slot.resolve = resolve; slot.reject = reject; });
    slot.ready.catch(() => {});
    slot.timer = setTimeout(() => this.failed(slot, new Error('Worker response timeout')), this.responseTimeoutMs);
    slot.worker.on('error', error => this.failed(slot, error));
    slot.worker.on('exit', code => { if (!slot.retired) this.failed(slot, new Error(`Worker exited: ${code}`)); });
    slot.worker.on('message', message => {
      if (slot.retired || this.closed) { this.stats.staleResults++; return; }
      if (message.type === 'fault') return this.failed(slot, new Error(message.error));
      if (message.type === 'ready') {
        if (message.hash !== digest(state) || digest(message.state) !== digest(state)) return this.failed(slot, new Error('Worker state contract mismatch'));
        clearTimeout(slot.timer); slot.revision = message.revision; slot.initialized = true; slot.resolve();
        if (slot === this.active) this.pump(); else { this.publishDeployment('catching-up'); this.catchUp(); }
      } else if (message.type === 'result') this.result(slot, message);
    });
    slot.worker.postMessage({ type: 'init', state });
    return slot;
  }
  retire(slot) { if (!slot) return; slot.retired = true; clearTimeout(slot.timer); slot.reject(new Error('Worker retired')); void slot.worker.terminate(); }
  dispatch(commands) {
    if (this.closed || this.fatal) return Promise.reject(new Error('Worker host unavailable'));
    return new Promise((resolve, reject) => {
      this.queue.push({ commands: structuredClone(commands), resolve, reject }); this.pump();
    });
  }
  pump() {
    if (this.closed || this.fatal || this.inFlight || this.reloading || !this.active.initialized || !this.queue.length) return;
    const item = this.queue.shift();
    const event = { sequence: this.state.sequence + 1, entropy: randomBytes(16).toString('hex'), commands: item.commands,
      confirmed: this.state.pendingMatch && this.completed.has(this.state.pendingMatch.match_id) ? this.state.pendingMatch.match_id : null };
    this.inFlight = { ...item, event };
    this.send(this.active, event);
  }
  send(slot, event) {
    slot.pending = event;
    slot.timer = setTimeout(() => this.failed(slot, new Error('Worker response timeout')), this.responseTimeoutMs);
    slot.worker.postMessage({ type: 'event', event });
  }
  result(slot, message) {
    if (slot !== this.active && slot !== this.candidate?.slot) { this.stats.staleResults++; return; }
    const event = slot.pending;
    if (!event || message.state?.sequence !== event.sequence || message.hash !== digest({ state: message.state, effects: message.effects, outcomes: message.outcomes })) {
      return this.failed(slot, new Error('Invalid worker result'));
    }
    clearTimeout(slot.timer); slot.pending = null; slot.sequence = event.sequence;
    if (slot === this.active) {
      const item = this.inFlight; this.inFlight = null; this.recovering = false;
      this.state = message.state;
      if (this.candidate) this.journal.push({ event, hash: message.hash });
      for (const match of message.effects) {
        if (this.completed.has(match.match_id)) continue;
        try { this.settle(match); this.completed.add(match.match_id); }
        catch { /* Retain pendingMatch and retry on the next tick. */ }
      }
      // Only the current pending match needs deduplication; earlier events cannot regain authority.
      for (const id of this.completed) if (id !== this.state.pendingMatch?.match_id) this.completed.delete(id);
      this.lastWasTick = event.commands.at(-1)?.type === 'tick';
      this.emit('state', this.snapshot(), event);
      item.resolve(message);
      this.catchUp(); this.pump();
    } else {
      const expected = this.journal.find(x => x.event.sequence === event.sequence);
      if (!expected || expected.hash !== message.hash) return this.cancel(new Error('Candidate replay mismatch'));
      this.candidate.replayed++;
      this.journal = this.journal.filter(x => x.event.sequence > event.sequence);
      this.catchUp();
    }
  }
  swap(entry = this.entry) {
    if (this.closed || this.fatal || this.candidate) return Promise.reject(new Error('Worker swap unavailable'));
    const state = structuredClone(this.state), slot = this.start(entry, state);
    return new Promise((resolve, reject) => {
      this.journal = [];
      this.candidate = { slot, entry, resolve, reject, started: performance.now(), replayed: 0,
        timer: setTimeout(() => this.cancel(new Error('Candidate catch-up timeout')), this.candidateTimeoutMs) };
      this.publishDeployment('preparing');
    });
  }
  catchUp() {
    const c = this.candidate;
    if (!c || !c.slot.initialized || c.slot.pending) return;
    const next = this.journal.find(x => x.event.sequence === c.slot.sequence + 1);
    if (next) return this.send(c.slot, next.event);
    if (!c.replayed || c.slot.sequence !== this.state.sequence || this.inFlight || !this.lastWasTick) return;
    const start = performance.now(), old = this.active;
    this.active = c.slot; this.entry = c.entry; this.generation++; this.candidate = null; this.journal = [];
    clearTimeout(c.timer); this.retire(old);
    const result = { revision: this.active.revision, generation: this.generation, sequence: this.state.sequence, replayed: c.replayed,
      preparationMs: performance.now() - c.started, authoritySwitchMs: performance.now() - start };
    this.stats.swaps++; this.stats.lastSwap = result;
    this.publishDeployment('applied');
    this.emit('swap', result); c.resolve(result);
  }
  cancel(error) {
    const c = this.candidate; if (!c) return;
    this.candidate = null; this.journal = []; clearTimeout(c.timer); this.retire(c.slot);
    this.stats.cancelled++; this.publishDeployment('cancelled'); c.reject(error);
  }
  failed(slot, error) {
    if (slot.retired || this.closed) return;
    if (slot === this.candidate?.slot) return this.cancel(error);
    if (slot !== this.active) return;
    this.retire(slot); this.cancel(new Error('Active worker recovery'));
    // A replay starts from the latest committed state, never the deployment checkpoint.
    if (this.recovering) {
      this.fatal = true;
      this.inFlight?.reject(error); this.inFlight = null;
      for (const item of this.queue.splice(0)) item.reject(error);
      this.emit('unavailable', error); return;
    }
    this.recovering = true; this.reloading = true; this.stats.recoveries++; this.generation++;
    const pending = this.inFlight; this.inFlight = null;
    // The selected pointer may already name an untrusted candidate. Recover
    // with the actual committed artifact, keeping the latest committed state.
    this.active = this.start(slot.entry, this.state);
    this.active.ready.then(() => {
      this.reloading = false;
      this.publishDeployment('idle');
      if (pending) { this.inFlight = pending; this.send(this.active, pending.event); } else this.pump();
    }).catch(() => {});
  }
  async close() {
    this.closed = true; this.cancel(new Error('Worker host closed'));
    this.inFlight?.reject(new Error('Worker host closed'));
    for (const item of this.queue.splice(0)) item.reject(new Error('Worker host closed'));
    this.retire(this.active);
  }
}
