import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { CATALOG, ITEMS, PROPS, HOME, homeMap, roomProblem, blocked, unreachableCells, entryPoint, portalAt } from '../../shared/world.js';
import { lookOf } from '../town.js';

// Load the PocketBase hook helper the way PB does (CommonJS + $os/toString/__hooks globals).
const hooks = new URL('../../pocketbase/pb_hooks/', import.meta.url).pathname;
const mod = { exports: {} };
runInNewContext(readFileSync(hooks + 'shop_lib.js', 'utf8'), { module: mod, __hooks: hooks.replace(/\/$/, ''), $os: { readFile: p => readFileSync(p) }, toString: b => b.toString() });
const lib = mod.exports;

test('catalogue: every item has a price, slot and drawable prop; PB hook reads the same file', () => {
  assert.equal(JSON.stringify(lib.catalog()), JSON.stringify(CATALOG));
  for (const it of CATALOG.items) {
    assert(Number.isInteger(it.price) && it.price > 0, it.id);
    assert(['hat', 'top', 'pet', 'furniture'].includes(it.slot), it.id);
    if (it.slot === 'furniture') {
      const d = PROPS[it.id];
      assert(d, `${it.id} prop`);
      // footprint stays inside its cells, so non-overlapping cells never overlap in collision
      const cw = it.cells[0] * 16, chh = it.cells[1] * 16;
      if (d.foot) assert(d.foot[0] >= -cw / 2 && d.foot[0] + d.foot[2] <= cw / 2 && d.foot[1] >= -chh + 2 && d.foot[1] + d.foot[3] <= 2, `${it.id} footprint`);
    }
  }
});

test('room rules agree between the shared module and the PB hook', () => {
  const own = new Set(['f_bed', 'f_rug', 'f_chair', 'f_sofa']), ownObj = Object.fromEntries([...own].map(i => [i, true]));
  const cases = [
    [[], true],
    [[{ item: 'f_bed', c: 10, r: 9 }, { item: 'f_rug', c: 14, r: 12 }, { item: 'f_chair', c: 15, r: 12 }], true],
    [[{ item: 'f_piano', c: 12, r: 10 }], false],
    [[{ item: 'f_bed', c: 29, r: 10 }], false],
    [[{ item: 'f_chair', c: 19, r: 18 }], false],
    [[{ item: 'f_bed', c: 12, r: 10 }, { item: 'f_chair', c: 13, r: 11 }], false],
    [[{ item: 'f_chair', c: 12, r: 10 }, { item: 'f_chair', c: 14, r: 10 }], false],
    [[{ item: 'f_chair', c: 12.5, r: 10 }], false],
    [[{ item: 'hat_crown', c: 12, r: 10 }], false],
    ['nope', false],
  ];
  for (const [placements, ok] of cases) {
    assert.equal(roomProblem(placements, own) === null, ok, JSON.stringify(placements));
    assert.equal(lib.validateRoom(CATALOG, placements, ownObj) === null, ok, 'hook ' + JSON.stringify(placements));
  }
});

test('home map: furniture blocks, rug is walkable, door leads back to the lobby, room stays connected', () => {
  const placements = [{ item: 'f_bed', c: 10, r: 9 }, { item: 'f_rug', c: 14, r: 12 }, { item: 'f_sofa', c: 24, r: 15 }];
  const m = homeMap(placements);
  const spawn = entryPoint(m, 'default');
  assert.equal(blocked(m, spawn.x, spawn.y), false);
  assert.equal(blocked(m, 10 * 16 + 16, 9 * 16 + 30), true, 'bed blocks');
  assert.equal(blocked(m, 14 * 16 + 24, 12 * 16 + 16), false, 'rug is walkable');
  assert.equal(blocked(m, 320, HOME.floor[1] * 16 - 4), true, 'wall');
  assert.equal(portalAt(m, 320, (HOME.floor[3] + 1) * 16 + 6)?.to, 'lobby');
  assert.equal(unreachableCells(m).length, 0);
});

test('room server only shows catalogue items in the right slot', () => {
  const none = { skin: null, hair: null, style: null };
  assert.deepEqual(lookOf({ outfit: { hat: 'hat_crown', top: 'pet_puppy', pet: 'x', extra: 'y' } }), { hat: 'hat_crown', top: null, pet: null, ...none });
  assert.deepEqual(lookOf({}), { hat: null, top: null, pet: null, ...none });
  assert.deepEqual(lookOf({ avatar: { skin: 3, hair: 7, style: 2 } }), { hat: null, top: null, pet: null, skin: 3, hair: 7, style: 2 });
  assert.deepEqual(lookOf({ avatar: { skin: 4, hair: -1, style: 1.5 } }), { hat: null, top: null, pet: null, ...none });
  assert.equal(ITEMS.top_sailor.slot, 'top');
});

test('character set-up (FR-014): the PB hook accepts catalogue choices only', () => {
  const ok = { name: '  별  지기 ', color: CATALOG.avatar.shirts[2], avatar: { skin: 1, hair: 4, style: 3 } };
  assert.deepEqual(JSON.parse(JSON.stringify(lib.cleanProfile(CATALOG, ok))), { profile: { name: '별 지기', color: CATALOG.avatar.shirts[2], avatar: { skin: 1, hair: 4, style: 3 } } });
  assert.ok(lib.cleanProfile(CATALOG, { ...ok, name: 'Abc_12-가' }).profile);
  for (const bad of [{ name: '가' }, { name: '가'.repeat(13) }, { name: '<script>' }, { name: 'a\u0000b' }, { name: 7 }, { name: '관리자' }, { name: '진짜 운영자' }, { name: 'Ad min' }, { name: 'PixelTown1' }, { color: '#000000' }, { color: undefined },
    { avatar: { skin: 4, hair: 0, style: 0 } }, { avatar: { skin: 0, hair: 8, style: 0 } }, { avatar: { skin: 0, hair: 0, style: 1.5 } }, { avatar: null }])
    assert.ok(lib.cleanProfile(CATALOG, { ...ok, ...bad }).error, JSON.stringify(bad));
});
