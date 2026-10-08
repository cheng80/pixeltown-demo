import { createHash } from 'node:crypto';
import { Simulation } from './simulation.js';

export const STATE_SCHEMA = 1;
export const RULES_VERSION = 'minimal-move-v1';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// All nondeterministic inputs belong to the host's ordered event, not the worker clock.
export class WorkerRuntime {
  constructor(state, options = {}) {
    this.effects = [];
    this.sim = new Simulation({ ...options, settle: match => {
      if (this.confirmed === match.match_id) return;
      this.effects.push(structuredClone(match));
      throw new Error('Waiting for durable settlement');
    } });
    this.sequence = 0;
    if (state) this.restore(state);
  }
  restore(state) {
    if (state.schema !== STATE_SCHEMA || state.rules !== RULES_VERSION) throw new Error('Incompatible worker state');
    const s = structuredClone(state);
    this.sequence = s.sequence;
    Object.assign(this.sim, s.timing, { players: new Map(s.players), moves: new Map(s.moves), game: s.game,
      starCounter: s.starCounter, nextStarAt: s.nextStarAt, pendingMatch: s.pendingMatch });
  }
  state() {
    const s = this.sim;
    return structuredClone({ schema: STATE_SCHEMA, rules: RULES_VERSION, sequence: this.sequence,
      timing: { durationMs: s.durationMs, spawnMs: s.spawnMs }, players: [...s.players], moves: [...s.moves],
      game: s.game, starCounter: s.starCounter, nextStarAt: s.nextStarAt, pendingMatch: s.pendingMatch || null });
  }
  apply(event) {
    if (event.sequence !== this.sequence + 1) throw new Error('Worker event order mismatch');
    let seed = parseInt(event.entropy.slice(0, 8), 16), counter = 0;
    this.sim.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    this.sim.uuid = () => {
      const h = digest(`${event.entropy}:${counter++}`);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
    };
    this.effects = []; this.confirmed = event.confirmed;
    const outcomes = [];
    for (const command of event.commands) {
      const { type, session, data, now } = command;
      switch (type) {
        case 'join':
          try { this.sim.join(session, data, now); outcomes.push({ ok: true }); }
          catch (error) { outcomes.push({ error: error.message }); }
          break;
        case 'replace': this.sim.players.delete(session); this.sim.moves.delete(session); break;
        case 'leave': this.sim.leave(session, now); break;
        case 'move': this.sim.move(session, data, now); break;
        case 'tick': this.sim.tick(now); break;
        case 'finish': this.sim.finish(now); break;
        default: throw new Error('Unknown worker command');
      }
    }
    this.sequence = event.sequence;
    const state = this.state(), effects = this.effects;
    return { state, effects, outcomes, hash: digest({ state, effects, outcomes }) };
  }
}
