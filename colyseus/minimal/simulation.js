import { randomUUID } from 'node:crypto';
import { WORLD, blocked, touchesStar, SPEED, TICK_MS } from '../../minimal/shared/world.js';

export class Simulation {
  constructor({ settle, durationMs = 180000, spawnMs = 6000, random = Math.random, uuid = randomUUID } = {}) {
    this.settleEffect = settle; this.durationMs = durationMs; this.spawnMs = spawnMs; this.random = random; this.uuid = uuid;
    this.players = new Map(); this.moves = new Map(); this.game = { active: false, stars: [], scores: {}, endsAt: 0 };
    this.starCounter = 0; this.nextStarAt = 0;
  }
  join(session, auth, now = Date.now()) {
    if ([...this.players.values()].some(p => p.id === auth.id)) throw new Error('이미 입장한 사용자입니다.');
    const i = this.players.size;
    this.players.set(session, { id: auth.id, name: auth.name, x: 32 + (i % 25) * 24, y: 320 + Math.floor(i / 25) * 20, ack: 0, fix: 0 });
    if (!this.game.active) this.start(now);
    this.game.scores[auth.id] ??= 0;
  }
  start(now, carry = []) {
    this.game = { id: this.uuid(), active: true, stars: carry, scores: Object.fromEntries([...this.players.values()].map(p => [p.id, 0])), endsAt: now + this.durationMs };
    this.starCounter = 0; this.nextStarAt = now + this.spawnMs;
    while (this.game.stars.length < 5) this.spawn();
  }
  spawn() {
    if (this.game.stars.length >= 12) return;
    const spots = [];
    for (let y = 40; y < WORLD.height - 24; y += 32) for (let x = 40; x < WORLD.width - 24; x += 32) if (!blocked(x, y)) spots.push({ x, y });
    const occupied = [...this.game.stars, ...this.players.values()];
    let best, distance = -1;
    for (let i = 0; i < 24; i++) {
      const p = spots[Math.floor(this.random() * spots.length)];
      const d = occupied.length ? Math.min(...occupied.map(o => Math.hypot(o.x - p.x, o.y - p.y))) : 999;
      if (d > distance) { best = p; distance = d; }
    }
    this.game.stars.push({ id: `${this.game.id}:${this.starCounter++}`, ...best });
  }
  move(session, data, now = Date.now()) {
    const p = this.players.get(session);
    if (!p || !data || data.fix !== p.fix || !Number.isSafeInteger(data.seq) || data.seq <= p.ack) return;
    const m = this.moves.get(session) || { budget: 0, at: now - 3000 };
    m.budget = Math.min(SPEED * 1.5 * 3, m.budget + SPEED * 1.5 * Math.max(0, now - m.at) / 1000); m.at = now;
    this.moves.set(session, m);
    const d = Math.hypot(data.x - p.x, data.y - p.y);
    if (!blocked(data.x, data.y) && d <= SPEED * TICK_MS / 1000 * 1.5 + 0.02 && d <= m.budget) {
      p.x = Math.round(data.x * 100) / 100; p.y = Math.round(data.y * 100) / 100; p.ack = data.seq; m.budget -= d;
    } else { p.fix++; }
  }
  tick(now = Date.now()) {
    if (!this.game.active) return;
    if (this.pendingMatch) { this.finish(now, true); return; }
    if (now >= this.game.endsAt || this.total() >= 64) { this.finish(now, true); return; }
    for (const p of this.players.values()) {
      for (let i = this.game.stars.length - 1; i >= 0; i--) {
        if (!touchesStar(p, this.game.stars[i])) continue;
        this.game.stars.splice(i, 1); this.game.scores[p.id] = (this.game.scores[p.id] || 0) + 1;
        if (this.total() === 64) { this.finish(now, true); return; }
      }
    }
    if (now >= this.nextStarAt) { this.nextStarAt = now + this.spawnMs; this.spawn(); }
  }
  total() { return Object.values(this.game.scores).reduce((n, s) => n + s, 0); }
  finish(now = Date.now(), restart = false) {
    if (!this.game.active) return true;
    const scores = Object.fromEntries(Object.entries(this.game.scores).filter(([, n]) => n > 0));
    if (Object.keys(scores).length) {
      // A failed durable write retains the current game and retries before accepting more stars.
      this.pendingMatch ??= { match_id: this.game.id, zone: 'lobby', ended_at: new Date(now).toISOString(), scores };
      try { this.settleEffect(this.pendingMatch); } catch { return false; }
      this.pendingMatch = null;
    }
    const carry = this.game.stars;
    this.game = { ...this.game, active: false, stars: [] };
    if (restart && this.players.size) this.start(now, carry);
    return true;
  }
  leave(session, now = Date.now()) {
    const p = this.players.get(session);
    if (p && this.game.scores[p.id] === 0) delete this.game.scores[p.id];
    this.players.delete(session); this.moves.delete(session);
    if (!this.players.size) this.finish(now);
  }
  snapshot() { return { zone: 'lobby', players: [...this.players.values()], game: this.game }; }
}
