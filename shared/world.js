// Shared map, collision and pathing definitions. Imported by game/, colyseus/ and tests.
import CATALOG from './catalog.json' with { type: 'json' };
// World unit = 1 art pixel. Every actor/prop position is its foot (ground contact) point.
export const TILE = 16;
export const COLS = 40;
export const ROWS = 26;
export const WORLD = { width: COLS * TILE, height: ROWS * TILE };
export const ZONE_IDS = ['lobby', 'garden', 'arcade'];
export const FOOT = { hw: 5, hh: 3 }; // player ground box half extents
export const STEP_PER_TICK = 3; // px per 50ms server tick (60 px/s)
export const TICK_MS = 50;
export const MAX_QUEUED_INPUTS = 60; // 3 s of steps: the server keeps that many, a client stops predicting a few steps before (a 1 s ping alone keeps ~20 in flight)
// Star pickup = the avatar body box overlaps the drawn star box. Boxes are [x, y, w, h] from the foot point and
// match the sprites (render.js draws the avatar body ~25 dots tall, the 13x13 star 3-16 dots above its foot point).
export const BODY_BOX = [-7, -25, 14, 25];
export const STAR_BOX = [-7, -16, 13, 13];
export const touchesStar = (p, s) => p.x + BODY_BOX[0] < s.x + STAR_BOX[0] + STAR_BOX[2] && s.x + STAR_BOX[0] < p.x + BODY_BOX[0] + BODY_BOX[2]
  && p.y + BODY_BOX[1] < s.y + STAR_BOX[1] + STAR_BOX[3] && s.y + STAR_BOX[1] < p.y + BODY_BOX[1] + BODY_BOX[3];
export const STAR_SPAWN_MS = 6000; // one new star per period, until the zone holds 12

// Tiles that block movement. Everything else (grass, path, plaza, bridge, floor, rug, portal) is walkable.
export const SOLID_TILES = new Set(['#', '~', 'F', 'W', 'x', 'V']);

// Star shop catalogue (also read by the PocketBase hook): hats, tops, pets and mini-room furniture.
export { CATALOG };
export const ITEMS = Object.fromEntries(CATALOG.items.map(i => [i.id, i]));

// Prop catalogue: w,h sprite size; ax,ay foot anchor inside the sprite; foot = ground collision box
// relative to the anchor (null = no collision); layer 'sort' = y-sorted with avatars, 'fg' = always above.
export const PROPS = {
  tree: { w: 32, h: 44, ax: 16, ay: 41, foot: [-4, -3, 8, 4] },
  blossom: { w: 32, h: 44, ax: 16, ay: 41, foot: [-4, -3, 8, 4] },
  bush: { w: 22, h: 16, ax: 11, ay: 14, foot: [-8, -4, 16, 5] },
  house: { w: 88, h: 82, ax: 44, ay: 80, foot: [-42, -30, 84, 30] },
  shop: { w: 88, h: 82, ax: 44, ay: 80, foot: [-42, -30, 84, 30] },
  greenhouse: { w: 80, h: 66, ax: 40, ay: 64, foot: [-38, -26, 76, 26] },
  fountain: { w: 60, h: 46, ax: 30, ay: 38, foot: [-25, -17, 50, 19] },
  bench: { w: 28, h: 18, ax: 14, ay: 16, foot: [-13, -6, 26, 7] },
  lamp: { w: 10, h: 38, ax: 5, ay: 36, foot: [-3, -3, 6, 4] },
  board: { w: 44, h: 36, ax: 22, ay: 34, foot: [-20, -4, 40, 5] },
  sign: { w: 30, h: 26, ax: 15, ay: 24, foot: [-2, -3, 4, 4] },
  pot: { w: 14, h: 16, ax: 7, ay: 14, foot: [-5, -4, 10, 5] },
  mailbox: { w: 12, h: 24, ax: 6, ay: 22, foot: [-4, -3, 8, 4] },
  post: { w: 8, h: 50, ax: 4, ay: 48, foot: [-4, -4, 8, 5] },
  arch: { w: 92, h: 70, ax: 46, ay: 68, foot: null, layer: 'fg' },
  vinePost: { w: 8, h: 44, ax: 4, ay: 42, foot: [-4, -4, 8, 5] },
  pergola: { w: 60, h: 100, ax: 30, ay: 96, foot: null, layer: 'fg' },
  rock: { w: 18, h: 12, ax: 9, ay: 10, foot: [-7, -3, 14, 4] },
  lantern: { w: 12, h: 22, ax: 6, ay: 20, foot: [-5, -3, 10, 4] },
  cabinet: { w: 24, h: 42, ax: 12, ay: 40, foot: [-12, -10, 24, 10] },
  claw: { w: 32, h: 50, ax: 16, ay: 48, foot: [-16, -12, 32, 12] },
  counter: { w: 96, h: 34, ax: 48, ay: 32, foot: [-48, -14, 96, 14] },
  shelf: { w: 96, h: 44, ax: 48, ay: 42, foot: [-48, -8, 96, 8] },
  pillar: { w: 16, h: 62, ax: 8, ay: 60, foot: [-8, -6, 16, 6] },
  sofa: { w: 50, h: 26, ax: 25, ay: 24, foot: [-25, -10, 50, 10] },
  vending: { w: 26, h: 46, ax: 13, ay: 44, foot: [-13, -10, 26, 10] },
  plant: { w: 16, h: 30, ax: 8, ay: 28, foot: [-5, -4, 10, 5] },
  // Mini-room furniture (anchor = bottom centre of its cells, footprint stays inside the cells).
  f_chair: { w: 14, h: 20, ax: 7, ay: 18, foot: [-5, -4, 10, 5] },
  f_plant: { w: 16, h: 30, ax: 8, ay: 28, foot: [-5, -4, 10, 5] },
  f_teddy: { w: 14, h: 14, ax: 7, ay: 13, foot: [-5, -3, 10, 4] },
  f_lamp: { w: 10, h: 28, ax: 5, ay: 27, foot: [-3, -3, 6, 4] },
  f_rug: { w: 46, h: 28, ax: 23, ay: 29, foot: null, layer: 'ground' },
  f_desk: { w: 30, h: 24, ax: 15, ay: 22, foot: [-14, -8, 28, 9] },
  f_fishbowl: { w: 14, h: 20, ax: 7, ay: 18, foot: [-5, -4, 10, 5] },
  f_sofa: { w: 46, h: 24, ax: 23, ay: 22, foot: [-22, -9, 44, 10] },
  f_bookcase: { w: 30, h: 40, ax: 15, ay: 38, foot: [-14, -7, 28, 8] },
  f_bed: { w: 30, h: 46, ax: 15, ay: 44, foot: [-14, -38, 28, 39] },
  f_tv: { w: 28, h: 28, ax: 14, ay: 26, foot: [-13, -7, 26, 8] },
  f_piano: { w: 44, h: 34, ax: 22, ay: 32, foot: [-21, -10, 42, 11] },
  // Flat wall decorations baked into the ground layer (walls are already solid tiles).
  neon: { w: 136, h: 30, ax: 68, ay: 30, foot: null, layer: 'ground' },
  window: { w: 40, h: 26, ax: 20, ay: 26, foot: null, layer: 'ground' },
  poster: { w: 20, h: 26, ax: 10, ay: 26, foot: null, layer: 'ground' },
};

function grid(fill) { return Array.from({ length: ROWS }, () => Array(COLS).fill(fill)); }
function rect(g, ch, c0, r0, c1, r1) { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (g[r]?.[c] !== undefined) g[r][c] = ch; }
function ellipse(g, ch, cx, cy, rx, ry) { // center/radii in px
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const x = (c + 0.5) * TILE - cx, y = (r + 0.5) * TILE - cy;
    if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) g[r][c] = ch;
  }
}
function border(g, ch) { rect(g, ch, 0, 0, COLS - 1, 0); rect(g, ch, 0, ROWS - 1, COLS - 1, ROWS - 1); rect(g, ch, 0, 0, 0, ROWS - 1); rect(g, ch, COLS - 1, 0, COLS - 1, ROWS - 1); }
const P = (type, x, y, extra) => ({ type, x, y, ...extra });

function lobby() {
  const g = grid('.');
  border(g, '#');
  rect(g, '=', 1, 12, 38, 15); // east-west street
  rect(g, '=', 18, 1, 21, 24); // north-south street
  rect(g, '=', 3, 6, 36, 7); // shop street in front of the two buildings
  ellipse(g, 'o', 320, 224, 92, 92); // round plaza
  rect(g, 'P', 0, 12, 0, 15); rect(g, 'P', 39, 12, 39, 15);
  const props = [
    P('house', 120, 96, { label: '미니홈피' }), P('shop', 520, 96, { label: '선물가게' }),
    P('fountain', 320, 238), P('board', 392, 90),
    P('pot', 96, 102), P('pot', 144, 102), P('pot', 496, 102), P('pot', 544, 102), P('mailbox', 174, 106),
    P('bench', 260, 178), P('bench', 380, 178), P('bench', 260, 288), P('bench', 380, 288),
    P('lamp', 228, 184), P('lamp', 412, 184), P('lamp', 228, 276), P('lamp', 412, 276), P('lamp', 270, 92), P('lamp', 370, 120),
    P('post', 280, 392), P('post', 360, 392), P('arch', 320, 392, { label: '픽셀타운' }),
    P('sign', 46, 186, { label: '오락실', dir: -1 }), P('sign', 594, 186, { label: '정원', dir: 1 }),
    // groves: between shop street and main street, and the southern meadows
    P('tree', 44, 178), P('tree', 92, 168), P('tree', 146, 182), P('tree', 198, 172), P('bush', 240, 150),
    P('tree', 444, 172), P('tree', 494, 182), P('tree', 548, 168), P('tree', 598, 178), P('bush', 402, 150),
    P('tree', 40, 300), P('tree', 104, 318), P('tree', 176, 300), P('tree', 56, 374), P('tree', 140, 386), P('tree', 222, 352),
    P('tree', 600, 300), P('tree', 536, 318), P('tree', 464, 300), P('tree', 584, 374), P('tree', 500, 386), P('tree', 418, 352),
    P('tree', 28, 60), P('tree', 230, 46), P('tree', 410, 46), P('tree', 612, 60),
    P('bush', 182, 270), P('bush', 458, 270), P('bush', 30, 120), P('bush', 610, 120),
  ];
  return {
    id: 'lobby', title: '타운 광장', slug: 'plaza', tiles: g, props,
    entries: { default: { x: 320, y: 300 }, west: { x: 44, y: 226 }, east: { x: 596, y: 226 } },
    portals: [{ x: 0, y: 192, w: 16, h: 64, to: 'arcade', entry: 'door' }, { x: 624, y: 192, w: 16, h: 64, to: 'garden', entry: 'west' }],
  };
}

function garden() {
  const g = grid('.');
  border(g, '#');
  ellipse(g, '~', 272, 216, 100, 76); // pond
  rect(g, 's', 1, 12, 9, 14); // west stepping-stone path
  rect(g, 'b', 10, 12, 23, 14); // bridge over the pond
  rect(g, 's', 24, 12, 31, 14); // east landing
  rect(g, 's', 29, 6, 30, 11); // to the greenhouse door
  rect(g, 's', 29, 15, 30, 21); rect(g, 's', 6, 21, 30, 22); rect(g, 's', 6, 15, 7, 20); // southern loop around the pond
  rect(g, '#', 32, 16, 38, 16); rect(g, '#', 32, 16, 32, 23); rect(g, '#', 32, 23, 38, 23); // hedge garden room
  rect(g, 's', 31, 19, 36, 20); // room entrance through the hedge
  rect(g, 'F', 33, 17, 37, 17); rect(g, 'F', 33, 22, 37, 22); rect(g, 'F', 13, 23, 18, 23); rect(g, 'F', 22, 23, 27, 23);
  rect(g, 'P', 0, 12, 0, 14);
  const props = [
    P('vinePost', 82, 190), P('vinePost', 114, 190), P('vinePost', 82, 246), P('vinePost', 114, 246), P('pergola', 98, 246),
    P('greenhouse', 480, 96, { label: '온실' }),
    P('bench', 190, 330), P('bench', 350, 330), P('bench', 560, 330), P('lantern', 152, 186), P('lantern', 152, 250), P('lantern', 396, 186), P('lantern', 396, 250),
    P('rock', 176, 140), P('rock', 372, 292), P('rock', 300, 128),
    P('blossom', 40, 70), P('tree', 88, 52), P('blossom', 140, 88), P('tree', 196, 58), P('blossom', 252, 96), P('tree', 312, 70), P('blossom', 366, 106), P('tree', 412, 64),
    P('tree', 600, 64), P('blossom', 572, 150), P('tree', 616, 196), P('tree', 40, 150),
    P('tree', 40, 300), P('blossom', 64, 380), P('tree', 152, 304), P('blossom', 240, 316), P('tree', 312, 308), P('blossom', 420, 304),
    P('tree', 420, 392), P('blossom', 300, 396), P('tree', 160, 396),
    P('bush', 560, 230), P('bush', 600, 250), P('bush', 76, 330), P('bush', 470, 200),
  ];
  return {
    id: 'garden', title: '비밀 정원', slug: 'garden', tiles: g, props,
    entries: { default: { x: 44, y: 218 }, west: { x: 44, y: 218 } },
    portals: [{ x: 0, y: 192, w: 16, h: 48, to: 'lobby', entry: 'east' }],
  };
}

function arcade() {
  const g = grid('w');
  rect(g, 'W', 0, 0, COLS - 1, 2); rect(g, 'W', 0, 0, 0, ROWS - 1); rect(g, 'W', COLS - 1, 0, COLS - 1, ROWS - 1); rect(g, 'W', 0, ROWS - 1, COLS - 1, ROWS - 1);
  rect(g, 'r', 15, 10, 24, 14); // star stage
  rect(g, 'c', 18, 15, 21, 24); // entrance carpet
  rect(g, 'P', 18, 25, 21, 25);
  const props = [
    ...[56, 84, 112, 140, 168].map(x => P('cabinet', x, 74, { hue: x / 28 })),
    ...[456, 484, 512].map(x => P('cabinet', x, 74, { hue: x / 28 })),
    P('claw', 564, 84), P('claw', 604, 84),
    ...[64, 92, 120, 148].map(x => P('cabinet', x, 208, { hue: x / 28 + 1 })),
    ...[492, 520, 548].map(x => P('cabinet', x, 208, { hue: x / 28 + 2 })),
    P('vending', 252, 378), P('plant', 390, 380), P('plant', 236, 250), P('plant', 404, 250),
    P('pillar', 200, 140), P('pillar', 440, 140), P('pillar', 200, 304), P('pillar', 440, 304),
    P('shelf', 540, 290), P('counter', 540, 340), P('sofa', 96, 344), P('vending', 608, 222),
    P('plant', 28, 76), P('plant', 28, 388), P('plant', 612, 388), P('plant', 268, 72), P('plant', 372, 72),
    P('neon', 320, 40, { label: 'STAR ARCADE' }), P('window', 236, 38), P('window', 404, 38), P('poster', 40, 40), P('poster', 600, 40),
  ];
  return {
    id: 'arcade', title: '스타 오락실', slug: 'arcade', tiles: g, props,
    entries: { default: { x: 320, y: 376 }, door: { x: 320, y: 376 } },
    portals: [{ x: 288, y: 400, w: 64, h: 16, to: 'lobby', entry: 'west' }],
  };
}

function prepare(map) {
  map.width = WORLD.width; map.height = WORLD.height;
  map.solid = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) map.solid[r * COLS + c] = SOLID_TILES.has(map.tiles[r][c]) ? 1 : 0;
  map.feet = [];
  for (const p of map.props) {
    const d = PROPS[p.type];
    if (!d) throw new Error(`Unknown prop ${p.type}`);
    p.layer = d.layer || 'sort';
    p.visual = { x: p.x - d.ax, y: p.y - d.ay, w: d.w, h: d.h };
    if (d.foot) { p.footRect = { x: p.x + d.foot[0], y: p.y + d.foot[1], w: d.foot[2], h: d.foot[3] }; map.feet.push(p.footRect); }
  }
  map.spawn = map.entries.default;
  return map;
}
export const MAPS = Object.fromEntries([lobby(), garden(), arcade()].map(m => [m.id, prepare(m)]));

// ---------- personal mini-room ----------
export const HOME = CATALOG.home;
export const furnitureAt = (item, c, r) => {
  const [w, h] = ITEMS[item].cells;
  return P(item, (c + w / 2) * TILE, (r + h) * TILE - 2, { item, c, r });
};
// placements: [{ item, c, r }] with (c,r) = top-left floor cell. Validated by roomProblem() and the PB hook.
export function homeMap(placements = []) {
  const g = grid('x'), [c0, r0, c1, r1] = HOME.floor;
  rect(g, 'W', c0 - 1, r0 - 4, c1 + 1, r1 + 1);
  rect(g, 'V', c0, r0 - 3, c1, r0 - 1);
  rect(g, 'f', c0, r0, c1, r1);
  rect(g, 'P', 19, r1 + 1, 20, r1 + 1);
  const props = [P('window', 216, r0 * TILE - 6), P('window', 424, r0 * TILE - 6), P('poster', 320, r0 * TILE - 8),
    ...placements.filter(p => ITEMS[p.item]?.slot === 'furniture').map(p => furnitureAt(p.item, p.c, p.r))];
  return prepare({
    id: 'home', title: '내 미니룸', slug: 'myroom', tiles: g, props,
    frame: { x: (c0 - 1) * TILE, y: (r0 - 4) * TILE, w: (c1 - c0 + 3) * TILE, h: (r1 - r0 + 6) * TILE }, // whole room on screen
    entries: { default: { x: 320, y: 296 } },
    portals: [{ x: 304, y: (r1 + 1) * TILE, w: 32, h: TILE, to: 'lobby', entry: 'default' }],
  });
}
const overlaps = (a, b) => a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h;
// Same rules as pocketbase/pb_hooks/shop_lib.js validateRoom. Returns an error message or null.
export function roomProblem(placements, owned) {
  if (!Array.isArray(placements) || placements.length > HOME.maxPlacements) return '가구가 너무 많아요.';
  const [c0, r0, c1, r1] = HOME.floor, [dc0, dr0, dc1, dr1] = HOME.door, door = { c: dc0, r: dr0, w: dc1 - dc0 + 1, h: dr1 - dr0 + 1 };
  const boxes = [], seen = new Set();
  for (const p of placements) {
    const it = ITEMS[p?.item];
    if (!it || it.slot !== 'furniture' || !Number.isInteger(p.c) || !Number.isInteger(p.r)) return '알 수 없는 가구예요.';
    if (!owned.has(p.item)) return `${it.name}은(는) 아직 없어요.`;
    if (seen.has(p.item)) return `${it.name}은(는) 하나만 놓을 수 있어요.`;
    seen.add(p.item);
    const b = { c: p.c, r: p.r, w: it.cells[0], h: it.cells[1], flat: Boolean(it.flat) };
    if (b.c < c0 || b.r < r0 || b.c + b.w - 1 > c1 || b.r + b.h - 1 > r1) return '바닥 밖에는 놓을 수 없어요.';
    if (overlaps(b, door)) return '문 앞은 비워 두어야 해요.';
    if (!b.flat && boxes.some(o => overlaps(o, b))) return '다른 가구와 겹쳐요.';
    if (!b.flat) boxes.push(b);
  }
  return null;
}
export const getMap = zone => MAPS[zone] || MAPS.lobby;

export const tileAt = (map, x, y) => map.tiles[Math.floor(y / TILE)]?.[Math.floor(x / TILE)];

// True if the player's ground box at foot point (x,y) overlaps a solid tile, a prop footprint or the map edge.
export function blocked(map, x, y) {
  const x0 = x - FOOT.hw, x1 = x + FOOT.hw, y0 = y - FOOT.hh, y1 = y + FOOT.hh;
  if (x0 < 0 || y0 < 0 || x1 > map.width || y1 > map.height) return true;
  for (let r = Math.floor(y0 / TILE); r <= Math.floor((y1 - 0.001) / TILE); r++)
    for (let c = Math.floor(x0 / TILE); c <= Math.floor((x1 - 0.001) / TILE); c++)
      if (map.solid[r * COLS + c]) return true;
  for (const f of map.feet) if (x0 < f.x + f.w && x1 > f.x && y0 < f.y + f.h && y1 > f.y) return true;
  return false;
}

// Nearest free foot point (spiral search). Used for spawns and to unstick actors.
export function nearestFree(map, x, y, max = 48) {
  if (!blocked(map, x, y)) return { x, y };
  for (let d = 2; d <= max; d += 2)
    for (let a = 0; a < 16; a++) {
      const nx = Math.round(x + Math.cos(a * Math.PI / 8) * d), ny = Math.round(y + Math.sin(a * Math.PI / 8) * d);
      if (!blocked(map, nx, ny)) return { x: nx, y: ny };
    }
  return { ...map.spawn };
}

// Moves a foot point by direction (dx,dy) (length <= 1) over `dist` px with axis sliding and corner nudging.
export function moveActor(map, x, y, dx, dy, dist = STEP_PER_TICK) {
  if (blocked(map, x, y)) ({ x, y } = nearestFree(map, x, y));
  const n = Math.max(1, Math.ceil(dist / 1.5)), sx = dx * dist / n, sy = dy * dist / n;
  for (let i = 0; i < n; i++) {
    let hitX = false, hitY = false;
    if (sx) { if (!blocked(map, x + sx, y)) x += sx; else hitX = true; }
    if (sy) { if (!blocked(map, x, y + sy)) y += sy; else hitY = true; }
    // Corner nudge: pushing (almost) straight into an edge slides toward the nearest opening within 6px. "Almost" matters:
    // a route waypoint 0.03 dot off the rounded position must not disable the slide and leave the player stuck on a corner.
    if (hitX && Math.abs(sy) < Math.abs(sx) * 0.25) y += nudge(map, x, y, sx, 0);
    if (hitY && Math.abs(sx) < Math.abs(sy) * 0.25) x += nudge(map, x, y, 0, sy);
  }
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}
function nudge(map, x, y, sx, sy) {
  for (let o = 1; o <= 6; o++) for (const s of [-1, 1]) {
    const ox = sy ? s * o : 0, oy = sx ? s * o : 0;
    if (!blocked(map, x + ox, y + oy) && !blocked(map, x + ox + sx, y + oy + sy)) return s * Math.min(o, 1.5);
  }
  return 0;
}

// Walk grid of 8px cells for click-to-move and reachability checks.
const CELL = 8, GC = WORLD.width / CELL, GR = WORLD.height / CELL;
function walkGrid(map) {
  if (map.walk) return map.walk;
  map.walk = new Uint8Array(GC * GR);
  for (let r = 0; r < GR; r++) for (let c = 0; c < GC; c++) map.walk[r * GC + c] = blocked(map, c * CELL + 4, r * CELL + 4) ? 0 : 1;
  return map.walk;
}
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function bfs(map, start) {
  const walk = walkGrid(map), prev = new Int32Array(GC * GR).fill(-2);
  const s = cellOf(start.x, start.y); if (!walk[s]) return prev;
  prev[s] = -1; const q = [s];
  for (let i = 0; i < q.length; i++) {
    const cur = q[i], c = cur % GC, r = (cur - c) / GC;
    for (const [dc, dr] of NEIGHBORS) {
      const nc = c + dc, nr = r + dr, n = nr * GC + nc;
      if (nc < 0 || nr < 0 || nc >= GC || nr >= GR || !walk[n] || prev[n] !== -2) continue;
      if (dc && dr && (!walk[r * GC + nc] || !walk[nr * GC + c])) continue; // no corner cutting
      prev[n] = cur; q.push(n);
    }
  }
  return prev;
}
const cellOf = (x, y) => Math.min(GR - 1, Math.max(0, Math.floor(y / CELL))) * GC + Math.min(GC - 1, Math.max(0, Math.floor(x / CELL)));
const cellCenter = i => ({ x: (i % GC) * CELL + 4, y: Math.floor(i / GC) * CELL + 4 });

// Waypoints from `from` to the reachable cell closest to `to`. Empty array if already there.
// Start from the nearest walkable 8-dot cell the player can walk straight to. A free spot next to a prop can sit in a
// cell whose centre is blocked, or behind a footprint corner from its own centre. Returns -1 when no walkable cell is within two cells.
function walkCellNear(map, walk, p) {
  const c0 = Math.floor(p.x / CELL), r0 = Math.floor(p.y / CELL);
  let best = -1, bestD = Infinity, any = -1, anyD = Infinity;
  for (let r = r0 - 2; r <= r0 + 2; r++) for (let c = c0 - 2; c <= c0 + 2; c++) {
    if (c < 0 || r < 0 || c >= GC || r >= GR || !walk[r * GC + c]) continue;
    const q = cellCenter(r * GC + c), d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < anyD) { anyD = d; any = r * GC + c; }
    if (d < bestD && clearWalk(map, p, q)) { bestD = d; best = r * GC + c; }
  }
  return best >= 0 ? best : any; // in a one-dot slot no centre is straight ahead; sliding movement gets there
}
// One movement step for one input. The server applies exactly one step per received input and the client predicts its
// own avatar with the same function, so prediction and server agree. `to` (last leg of a click route) steers from the real
// position and stops on the target.
export function stepInput(map, p, input) {
  if (input.to) {
    const ox = input.to.x - p.x, oy = input.to.y - p.y, left = Math.hypot(ox, oy);
    return left < 0.5 ? { x: p.x, y: p.y } : moveActor(map, p.x, p.y, ox / left, oy / left, Math.min(STEP_PER_TICK, left));
  }
  return input.dx || input.dy ? moveActor(map, p.x, p.y, input.dx, input.dy, STEP_PER_TICK) : { x: p.x, y: p.y };
}
// Sprite facing from a (smoothed) movement vector: 0 down, 1 up, 2 right, 3 left. Diagonals (axes within 2:1) face
// sideways, so walking diagonally keeps one stable sprite instead of flipping between side and front/back every frame.
export function facing(vx, vy) {
  const ax = Math.abs(vx), ay = Math.abs(vy);
  if (ay > ax * 2) return vy > 0 ? 0 : 1;
  return vx > 0 ? 2 : 3;
}
export function findPath(map, from, to) {
  const start = nearestFree(map, from.x, from.y, 12), walk = walkGrid(map);
  const own = cellOf(start.x, start.y), near = walkCellNear(map, walk, start), s = near >= 0 ? near : walk[own] ? own : -1;
  if (s < 0) return [];
  const prev = bfs(map, cellCenter(s));
  let goal = -1, best = Infinity;
  for (let i = 0; i < prev.length; i++) if (prev[i] !== -2) {
    const p = cellCenter(i), d = (p.x - to.x) ** 2 + (p.y - to.y) ** 2;
    if (d < best) { best = d; goal = i; }
  }
  const path = [];
  for (let i = goal; i >= 0; i = prev[i]) path.unshift(cellCenter(i));
  // The start cell centre stays as a fallback first step; string pulling below skips it whenever a straight walk exists.
  if (path.length && !blocked(map, to.x, to.y) && Math.hypot(path[path.length - 1].x - to.x, path[path.length - 1].y - to.y) < 8) path[path.length - 1] = { x: to.x, y: to.y };
  // String pulling: from each corner, head straight for the farthest following point with a clear walk.
  const out = [];
  let a = blocked(map, from.x, from.y) ? start : from;
  for (let i = 0; i < path.length;) {
    let j = i;
    while (j + 1 < path.length && clearWalk(map, a, path[j + 1])) j++;
    out.push(path[j]); a = path[j]; i = j + 1;
  }
  return out;
}

// A straight walk from a to b never overlaps a blocker (sampled every 2px of the foot box).
export function clearWalk(map, a, b) {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2);
  for (let i = 1; i <= n; i++) if (blocked(map, a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n)) return false;
  return true;
}

// Walkable cells not reachable from the zone spawn (should be none).
export function unreachableCells(map) {
  const prev = bfs(map, map.spawn), walk = walkGrid(map), out = [];
  for (let i = 0; i < walk.length; i++) if (walk[i] && prev[i] === -2) out.push(cellCenter(i));
  return out;
}

// Star spots: reachable tile centres that are not covered by any sortable prop drawing and not portals.
export function starSpots(map) {
  if (map.stars) return map.stars;
  const prev = bfs(map, map.spawn);
  map.stars = [];
  for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
    const x = c * TILE + 8, y = r * TILE + 10;
    if (tileAt(map, x, y) === 'P' || blocked(map, x, y) || prev[cellOf(x, y)] === -2) continue;
    if (map.props.some(p => p.layer !== 'ground' && x > p.visual.x - 6 && x < p.visual.x + p.visual.w + 6 && y - 12 < p.visual.y + p.visual.h && y > p.visual.y - 4)) continue;
    map.stars.push({ x, y });
  }
  return map.stars;
}

// Best of 24 random star spots: the one farthest from everything in `taken`, so stars spread over the whole map.
export function spreadSpot(map, taken, rnd = Math.random) {
  const spots = starSpots(map);
  let best, bestD = -1;
  for (let n = 0; n < 24; n++) {
    const s = spots[Math.floor(rnd() * spots.length)], d = Math.min(...taken.map(t => Math.hypot(t.x - s.x, t.y - s.y)));
    if (d > bestD) { best = s; bestD = d; }
  }
  return { ...best };
}

export const portalAt = (map, x, y) => map.portals.find(p => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
export const entryPoint = (map, name) => {
  const e = Object.hasOwn(map.entries, name ?? '') ? map.entries[name] : map.entries.default;
  return nearestFree(map, e.x, e.y);
};
