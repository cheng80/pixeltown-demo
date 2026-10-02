import { TICK_MS } from "../../shared/world.js";

// Other players are replayed step by step. Every step the server accepted is 50 ms of that player's walking and its `ack`
// counts them, so the walk plays back at walking pace whatever bursts the network made of it. A stall makes playback wait
// once; after that it runs as far behind as the stall was, so the next burst lands before playback runs dry. It catches up
// faster only while it is more than `want` steps behind: the largest burst seen lately (steps that arrived together) plus 2.
export const MIN_WANT = 2, MAX_WANT = 60;

// One snapshot of player `p` ({x, y, ack}) into its playback `b` (start with {}). `now` in ms.
export function feed(b, p, now) {
  const last = b.pts?.at(-1), ack = p.ack ?? 0;
  // First sight, a reload (ack restarts) or a position the server set itself: show it as it is.
  if (!last || ack < last.ack || (ack === last.ack && (p.x !== last.x || p.y !== last.y)))
    return Object.assign(b, { pts: [{ ack, x: p.x, y: p.y }], head: ack, want: b.want ?? MIN_WANT, burstAt: now, burstFrom: ack });
  if (ack === last.ack) return b;
  if (now - b.burstAt > 25) { b.burstFrom = last.ack; } // snapshots arriving together count as one burst
  b.burstAt = now;
  b.want = Math.min(MAX_WANT, Math.max(b.want, ack - b.burstFrom + 2));
  b.pts.push({ ack, x: p.x, y: p.y });
  if (b.pts.length > 400) { b.pts.shift(); b.head = Math.max(b.head, b.pts[0].ack); } // nothing plays while the tab is hidden
  return b;
}

// Advance playback `b` by `dt` ms and return the position to draw.
export function play(b, dt) {
  const end = b.pts.at(-1).ack, lead = end - b.head;
  b.want = Math.max(MIN_WANT, b.want - dt / 10000); // forget old stalls slowly
  if (lead > b.want + MAX_WANT) b.head = end - b.want; // far behind (a hidden tab): skip ahead
  else b.head = Math.min(end, b.head + dt / TICK_MS * Math.min(3, Math.max(1, 1 + (lead - b.want) / 10)));
  while (b.pts.length > 1 && b.pts[1].ack <= b.head) b.pts.shift();
  const [q, r] = b.pts;
  if (!r || b.head <= q.ack) return q;
  const k = (b.head - q.ack) / (r.ack - q.ack);
  return { x: q.x + (r.x - q.x) * k, y: q.y + (r.y - q.y) * k };
}
