// Minimal lobby contract. No legacy catalogue, portals, furniture, or user-owned appearance.
export const ROOM_CAPACITY = 100;
export const TICK_MS = 50;
export const SPEED = 80;
export const BODY = 8;
export const WORLD = Object.freeze({
  width: 640, height: 416, spawn: { x: 320, y: 360 },
  obstacles: [{ x: 272, y: 152, w: 96, h: 64 }],
});
export function blocked(x, y) {
  return !Number.isFinite(x) || !Number.isFinite(y) || x < 16 || x > WORLD.width - 16 || y < 16 || y > WORLD.height - 16 ||
    WORLD.obstacles.some(o => x + BODY > o.x && x - BODY < o.x + o.w && y + BODY > o.y && y - BODY < o.y + o.h);
}
export function stepDirection(p, dx, dy, dt = TICK_MS) {
  const length = Math.hypot(dx, dy);
  if (!length) return { x: p.x, y: p.y };
  const distance = SPEED * Math.max(0, Math.min(dt, TICK_MS)) / 1000;
  const x = p.x + dx / length * distance, y = p.y + dy / length * distance;
  const next = { x: p.x, y: p.y };
  if (!blocked(x, next.y)) next.x = x;
  if (!blocked(next.x, y)) next.y = y;
  return { x: Math.round(next.x * 100) / 100, y: Math.round(next.y * 100) / 100 };
}
export function stepToward(p, target, dt = TICK_MS) {
  const distance = Math.hypot(target.x - p.x, target.y - p.y);
  if (distance < SPEED * dt / 1000 && !blocked(target.x, target.y)) return { x: target.x, y: target.y };
  return stepDirection(p, target.x - p.x, target.y - p.y, dt);
}
export const touchesStar = (p, star) => Math.abs(p.x - star.x) <= 14 && Math.abs(p.y - star.y) <= 16;
