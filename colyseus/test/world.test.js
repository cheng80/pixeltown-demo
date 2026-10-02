import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, ZONE_IDS, PROPS, blocked, moveActor, findPath, facing, unreachableCells, starSpots, entryPoint, portalAt, tileAt, TILE } from '../../shared/world.js';
import * as server from '../town.js';

const walk = (map, from, dx, dy, ticks) => { let p = { ...from }; for (let i = 0; i < ticks; i++) p = moveActor(map, p.x, p.y, dx, dy); return p; };
const lobby = MAPS.lobby, garden = MAPS.garden, arcade = MAPS.arcade;
const find = (map, type) => map.props.find(p => p.type === type);

test('every zone: spawn/entries free, all walkable cells connected, portals reachable, star spots exist', () => {
  for (const id of ZONE_IDS) {
    const m = MAPS[id];
    for (const [name, e] of Object.entries(m.entries)) assert.equal(blocked(m, e.x, e.y), false, `${id}.${name}`);
    assert.deepEqual(unreachableCells(m), [], `${id} has isolated walkable cells`);
    for (const p of m.portals) {
      const path = findPath(m, m.spawn, { x: p.x + p.w / 2, y: p.y + p.h / 2 });
      const end = path.at(-1);
      assert.ok(portalAt(m, end.x, end.y), `${id} portal to ${p.to} reachable`);
      assert.ok(MAPS[p.to].entries[p.entry], `${id} portal entry ${p.entry} exists in ${p.to}`);
    }
    assert.ok(starSpots(m).length > 100, `${id} star spots`);
  }
});

test('zones are distinct layouts, not palette swaps', () => {
  const sig = m => m.tiles.map(r => r.join('')).join('');
  assert.notEqual(sig(lobby), sig(garden)); assert.notEqual(sig(garden), sig(arcade)); assert.notEqual(sig(lobby), sig(arcade));
  const types = m => new Set(m.props.map(p => p.type));
  assert.ok(types(lobby).has('fountain') && types(garden).has('pergola') && types(arcade).has('cabinet'));
  assert.ok(garden.tiles.flat().includes('~') && !lobby.tiles.flat().includes('~'));
  assert.ok(arcade.tiles.flat().includes('W') && !garden.tiles.flat().includes('W'));
});

test('footprints are small ground boxes inside the drawing', () => {
  for (const m of Object.values(MAPS)) for (const p of m.props) {
    if (!p.footRect) continue;
    const v = p.visual, f = p.footRect;
    assert.ok(f.x >= v.x && f.x + f.w <= v.x + v.w && f.y >= v.y && f.y + f.h <= v.y + v.h + 1, `${m.id} ${p.type} foot inside visual`);
    assert.ok(f.w * f.h < v.w * v.h * 0.6, `${m.id} ${p.type} footprint smaller than drawing`);
    assert.ok(f.y + f.h >= p.y - 1, `${m.id} ${p.type} footprint touches the foot line`);
  }
});

test('tree canopy is walkable, trunk blocks, walking north of the trunk passes under the canopy', () => {
  const tree = lobby.props.find(p => p.type === 'tree' && p.x === 146);
  const under = { x: tree.x, y: tree.y - 14 }; // inside canopy drawing, above trunk
  assert.ok(under.y > tree.visual.y && under.y < tree.visual.y + tree.visual.h);
  assert.equal(blocked(lobby, under.x, under.y), false, 'canopy area walkable');
  assert.equal(blocked(lobby, tree.x, tree.y - 1), true, 'trunk blocks');
  const start = { x: tree.x - 20, y: tree.y - 14 };
  const end = walk(lobby, start, 1, 0, 14);
  assert.ok(end.x > tree.x + 10 && Math.abs(end.y - start.y) < 1, `walked under canopy: ${JSON.stringify(end)}`);
});

test('building wall blocks but space behind the roof is walkable', () => {
  const house = find(lobby, 'house');
  assert.equal(blocked(lobby, house.x, house.y - 2), true, 'front wall base blocks');
  const behind = { x: house.x, y: house.visual.y + 20 }; // under the roof drawing, north of the footprint
  assert.equal(blocked(lobby, behind.x, behind.y), false, 'behind building walkable');
  const end = walk(lobby, { x: house.x, y: house.y + 8 }, 0, -1, 30); // walk north into the wall
  assert.ok(end.y >= house.footRect.y + house.footRect.h + 2, `stopped at wall: ${end.y}`);
  const path = findPath(lobby, lobby.spawn, behind);
  assert.ok(Math.hypot(path.at(-1).x - behind.x, path.at(-1).y - behind.y) < 6, 'path exists to the back of the building');
});

test('water, hedges and arcade walls block; bridge crosses the pond', () => {
  const water = { x: 272, y: 160 };
  assert.equal(tileAt(garden, water.x, water.y), '~'); assert.equal(blocked(garden, water.x, water.y), true);
  const crossed = walk(garden, garden.entries.west, 1, 0, 140);
  assert.ok(crossed.x > 24 * TILE, `bridge crossing reached ${crossed.x}`);
  const wall = walk(arcade, arcade.spawn, 0, -1, 200);
  assert.ok(wall.y >= 3 * TILE + 3, `arcade wall stops at ${wall.y}`);
});

test('corner nudging slides around a trunk instead of sticking', () => {
  const tree = lobby.props.find(p => p.type === 'tree' && p.x === 146);
  const start = { x: tree.x + 3, y: tree.y + 12 }; // slightly off-centre below the trunk, walking straight up
  const end = walk(lobby, start, 0, -1, 20);
  assert.ok(end.y < tree.y - 6, `passed the trunk: ${JSON.stringify(end)}`);
});

test('arcade cabinet island hides players walking behind it and pillars only block their base', () => {
  const cab = arcade.props.find(p => p.type === 'cabinet' && p.y === 208);
  const behind = { x: cab.x, y: cab.y - 16 };
  assert.equal(blocked(arcade, behind.x, behind.y), false);
  assert.ok(behind.y < cab.y && behind.y > cab.visual.y, 'behind point is inside the cabinet drawing and sorts before it');
  const pillar = find(arcade, 'pillar');
  assert.equal(blocked(arcade, pillar.x, pillar.y - 30), false); assert.equal(blocked(arcade, pillar.x, pillar.y - 2), true);
});

test('server uses the shared module and validates entry names', () => {
  assert.equal(typeof server.Town, 'function');
  assert.deepEqual(entryPoint(lobby, 'east'), lobby.entries.east);
  assert.deepEqual(entryPoint(lobby, '__proto__'), lobby.entries.default);
  assert.deepEqual(entryPoint(lobby, 'nope'), lobby.entries.default);
  assert.ok(PROPS.arch.layer === 'fg' && PROPS.pergola.layer === 'fg' && !PROPS.arch.foot);
});

test('click routes start from any free spot, even next to a prop where the 8-dot cell centre is blocked', () => {
  // Regression: a player standing at arcade (233.8, 371.6) got an empty route and walked straight into a cabinet.
  for (const zone of ZONE_IDS) {
    const m = MAPS[zone], home = entryPoint(m, 'default');
    let tried = 0;
    for (let y = 2; y < m.tiles.length * TILE; y += 5.3) for (let x = 2; x < m.tiles[0].length * TILE; x += 6.1) {
      if (blocked(m, x, y)) continue;
      // only spots a player can actually stand on and walk away from (the server never puts anyone inside a closed pocket)
      if (![[3, 0], [-3, 0], [0, 3], [0, -3]].some(([dx, dy]) => { const q = moveActor(m, x, y, dx / 3, dy / 3, 3); return q.x !== x || q.y !== y; })) continue;
      const path = findPath(m, { x, y }, home);
      if (Math.hypot(home.x - x, home.y - y) < 4) continue;
      tried++;
      assert.ok(path.length, `${zone} (${x.toFixed(1)}, ${y.toFixed(1)}): empty route`);
      // Follow it the way the client does (2-dot arrival) with the server's movement, including wall sliding.
      let p = { x, y }, route = [...path];
      for (let t = 0; t < 1500 && route.length; t++) {
        while (route.length && Math.hypot(route[0].x - p.x, route[0].y - p.y) < 2) route.shift();
        if (!route.length) break;
        const dx = route[0].x - p.x, dy = route[0].y - p.y, l = Math.hypot(dx, dy);
        p = moveActor(m, p.x, p.y, dx / l, dy / l, 3);
      }
      assert.ok(Math.hypot(home.x - p.x, home.y - p.y) < 4, `${zone} (${x.toFixed(1)}, ${y.toFixed(1)}) stuck at (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
    }
    assert.ok(tried > 500, zone);
  }
  const arcade = MAPS.arcade, p = findPath(arcade, { x: 233.8, y: 371.6 }, { x: 536, y: 378 });
  assert.ok(p.length && Math.hypot(p.at(-1).x - 536, p.at(-1).y - 378) < 8);
});

test('sprite facing: axes face their way, diagonals keep the side view', () => {
  assert.deepEqual([facing(0, 1), facing(0, -1), facing(1, 0), facing(-1, 0)], [0, 1, 2, 3]);
  // keyboard diagonals (1:1) and route segments up to 2:1 all face sideways, on both sides of the 45° line
  for (const [vx, vy, d] of [[1, 1, 2], [1, -1, 2], [-1, 1, 3], [-1, -1, 3], [1, 1.9, 2], [1.02, 0.98, 2], [0.98, 1.02, 2], [-0.6, 1.1, 3]]) assert.equal(facing(vx, vy), d, `${vx},${vy}`);
  assert.equal(facing(0.4, 1), 0); assert.equal(facing(-0.4, -1), 1);
});
