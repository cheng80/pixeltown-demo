import { WORLD } from '../../shared/world.js';
import { feed } from './playback.js';

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
