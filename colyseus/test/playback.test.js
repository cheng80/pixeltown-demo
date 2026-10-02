import test from 'node:test';
import assert from 'node:assert/strict';
import { feed, play } from '../../game/src/playback.js';

// A walker steps 3 dots every 50 ms; its steps reach the watcher in bursts (snapshots every 50 ms, a stall every `stall` ms).
// After a short warm-up the drawn walker must glide: no jumps and no long freezes.
function watch(stall, seconds = 20) {
  const b = {}, drawn = [];
  let delivered = 0;
  for (let now = 0; now < seconds * 1000; now += 16) {
    const due = Math.floor(now / stall) * stall, ack = Math.floor(due / 50); // everything up to the last stall arrives at once
    if (now % 50 < 16 && ack !== delivered) { delivered = ack; feed(b, { ack, x: ack * 3, y: 0 }, now); }
    if (!b.pts) feed(b, { ack: 0, x: 0, y: 0 }, now);
    if (now > 4000) drawn.push(play(b, 16).x); else play(b, 16);
  }
  const steps = drawn.slice(1).map((x, i) => x - drawn[i]);
  let run = 0, longest = 0; for (const d of steps) { run = d < 0.05 ? run + 1 : 0; longest = Math.max(longest, run); }
  return { maxStep: Math.max(...steps), longestFreeze: longest, behind: delivered * 3 - drawn.at(-1) };
}

test('other players glide at walking pace through bursty delivery, staying only as far behind as the stalls', () => {
  for (const stall of [50, 300, 1000, 1500]) {
    const r = watch(stall);
    assert(r.maxStep <= 2, `stall ${stall}: jump ${r.maxStep}`); // walking is ~1 dot per 16 ms frame
    assert(r.longestFreeze <= 2, `stall ${stall}: froze ${r.longestFreeze} frames`);
    assert(r.behind <= stall / 50 * 3 * 2 + 9, `stall ${stall}: ${r.behind} dots behind`);
  }
});

test('a player seen first, reloaded, or moved by the server is shown where it is', () => {
  const b = {};
  feed(b, { ack: 10, x: 5, y: 5 }, 0); assert.deepEqual(play(b, 16), { ack: 10, x: 5, y: 5 });
  feed(b, { ack: 3, x: 50, y: 5 }, 32); assert.equal(play(b, 16).x, 50);
  feed(b, { ack: 3, x: 80, y: 5 }, 64); assert.equal(play(b, 16).x, 80);
});
