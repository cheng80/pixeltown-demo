import { WORLD } from '../../shared/world.js';
import { feed, play } from './playback.js';

export function createEngine() {
  return { connected: false, self: { ...WORLD.spawn }, previous: { ...WORLD.spawn }, seq: 0, fix: 0,
    pending: [], others: new Map(), stars: [], target: null, keys: new Set(), pad: { x: 0, y: 0 },
    lastTick: performance.now(), lastSnapshot: 0, initialized: false, send: null, userId: null, facing: 0, movedAt: 0 };
}
export function stopMovement(engine) { engine.keys.clear(); engine.pad = { x: 0, y: 0 }; engine.target = null; }
export function applySnapshot(engine, data, userId) {
  const now = performance.now();
  const me = data.players.find(p => p.id === userId);
  if (!me || !Number.isFinite(me.x) || !Number.isFinite(me.y)) return false;
  const fix = Number(me.fix) || 0;
  const ack = Number(me.ack) || 0;
  if (!engine.initialized || fix > engine.fix) {
    engine.self = { x: me.x, y: me.y };
    engine.previous = { ...engine.self };
    engine.pending = [];
    engine.fix = fix;
    engine.seq = Math.max(engine.seq, ack);
    engine.initialized = true;
    engine.lastTick = now;
  } else if (fix === engine.fix) {
    engine.pending = engine.pending.filter(move => move.seq > ack);
    if (!engine.pending.length) engine.self = { x: me.x, y: me.y };
  }
  const ids = new Set();
  for (const player of data.players) {
    if (player.id === userId || !Number.isFinite(player.x) || !Number.isFinite(player.y)) continue;
    ids.add(player.id);
    // Others replay their accepted steps at walking pace (playback.js), so network bursts do not look like teleports.
    const other = engine.others.get(player.id) || { pb: {}, x: player.x, y: player.y, dir: 0, movedAt: 0 };
    feed(other.pb, player, now); other.name = player.name;
    engine.others.set(player.id, other);
  }
  for (const id of engine.others.keys()) if (!ids.has(id)) engine.others.delete(id);
  engine.snapshot = data;
  engine.name = me.name;
  engine.stars = data.game?.stars || [];
  engine.lastSnapshot = Date.now();
  return true;
}

// Advance display playback once per permanent frame, independently of renderer instances.
export function advanceDisplay(engine, now) {
  const facing = (dx, dy) => Math.abs(dy) > Math.abs(dx) * 2 ? (dy > 0 ? 0 : 1) : (dx > 0 ? 2 : 3);
  if (engine.movedAt === engine.lastTick && (engine.self.x !== engine.previous.x || engine.self.y !== engine.previous.y)) engine.facing = facing(engine.self.x - engine.previous.x, engine.self.y - engine.previous.y);
  const dt = engine.lastDraw ? Math.min(1000, now - engine.lastDraw) : 0; engine.lastDraw = now;
  for (const p of engine.others.values()) {
    const q = play(p.pb, dt), dx = q.x - p.x, dy = q.y - p.y;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      p.vx = (p.vx || 0) * 0.75 + dx * 0.25; p.vy = (p.vy || 0) * 0.75 + dy * 0.25;
      p.dir = facing(p.vx, p.vy); p.movedAt = now;
    }
    p.x = q.x; p.y = q.y;
  }
}
