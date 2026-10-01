import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, ZONE_IDS, PROPS, blocked, moveActor, findPath, unreachableCells, starSpots, entryPoint, portalAt, tileAt, TILE } from '../../shared/world.js';
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
