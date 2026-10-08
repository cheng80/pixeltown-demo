// Procedural pixel art for the minimal plaza. Drawn once at 1 art px into offscreen canvases, then
// upscaled by an integer factor. Every standing object gets a 1px plum outline.
// Only the fountain blocks movement (minimal/shared/world.js); everything inside the walkable
// rectangle is flat ground art, and every tall prop stands outside it.
import { WORLD } from '../../shared/world.js';

export const LINE = '#3a2440';
// Visible area around the world: scenery margins the camera may show but nobody can walk on.
export const EXT = { x: -64, y: -104, w: 768, h: 608 };
const FOUNTAIN = WORLD.obstacles[0];
const PATH = { x: 288, w: 64 };
const PLAZA = { x: 160, y: 88, w: 320, h: 200 };

const R = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const shade = (col, f) => '#' + hex(col).map(v => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0')).join('');
export function seeded(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function hash(str) { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

function disc(c, cx, cy, rx, ry, col) {
  c.fillStyle = col;
  for (let y = -ry; y <= ry; y++) {
    const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y / (ry + 0.5)) ** 2)));
    c.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2, 1);
  }
}
// Pixel rounded rectangle, one row at a time so corners stay crisp.
function rrect(c, x, y, w, h, r, col) {
  c.fillStyle = col;
  for (let i = 0; i < h; i++) {
    const d = Math.min(i, h - 1 - i), inset = d < r ? Math.round(r - Math.sqrt(r * r - (r - d - 0.5) ** 2)) : 0;
    c.fillRect(x + inset, y + i, w - inset * 2, 1);
  }
}
function rrectPath(c, x, y, w, h, r, begin = true) {
  if (begin) c.beginPath();
  for (let i = 0; i < h; i++) {
    const d = Math.min(i, h - 1 - i), inset = d < r ? Math.round(r - Math.sqrt(r * r - (r - d - 0.5) ** 2)) : 0;
    c.rect(x + inset, y + i, w - inset * 2, 1);
  }
}
// 1px outline around every opaque pixel.
function outline(cv, col = LINE) {
  const { width: w, height: h } = cv, c = cv.getContext('2d'), img = c.getImageData(0, 0, w, h), a = img.data, out = new Uint8ClampedArray(a);
  const [r, g, b] = hex(col);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (a[i + 3] > 40) continue;
    if ((x > 0 && a[i - 1] > 40) || (x < w - 1 && a[i + 7] > 40) || (y > 0 && a[i - w * 4 + 3] > 40) || (y < h - 1 && a[i + w * 4 + 3] > 40)) {
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
    }
  }
  img.data.set(out); c.putImageData(img, 0, 0);
  return cv;
}
// Sprite with a 1px transparent margin for the outline. Drawn at (x - 1, y - 1).
function sprite(w, h, paint, line = true) {
  const cv = canvas(w + 2, h + 2), c = cv.getContext('2d');
  c.translate(1, 1); paint(c); c.setTransform(1, 0, 0, 1, 0, 0);
  return line ? outline(cv) : cv;
}

// ---------------------------------------------------------------- scenery sprites
const TREES = {
  green: ['#43a047', '#74c65a', '#2e7d32', '#a5e07a'],
  deep: ['#3b8f4a', '#5fb35c', '#276b38', '#8fd27a'],
  blossom: ['#ff8fbf', '#ffc2dc', '#e0619a', '#fff0f6'],
  lime: ['#7cc348', '#a7dc68', '#5a9a34', '#d4f29a'],
};
const treeCache = new Map();
function tree(kind) {
  if (!treeCache.has(kind)) treeCache.set(kind, sprite(32, 42, c => {
    const [base, light, dark, speck] = TREES[kind];
    R(c, 13, 28, 6, 13, '#8a5a36'); R(c, 14, 28, 2, 12, '#b07848'); R(c, 11, 39, 10, 3, '#7a4b2a'); R(c, 17, 31, 1, 3, '#6b3e26');
    disc(c, 16, 17, 15, 13, dark); disc(c, 15, 15, 14, 12, base); disc(c, 11, 10, 8, 6, light); disc(c, 9, 8, 3, 2, speck);
    disc(c, 22, 21, 6, 4, dark); R(c, 19, 11, 2, 2, light); R(c, 6, 18, 2, 2, light); R(c, 25, 14, 1, 2, light);
    if (kind === 'blossom') { R(c, 8, 20, 2, 2, '#fff'); R(c, 21, 8, 2, 2, '#fff'); R(c, 14, 22, 1, 1, '#fff'); }
    if (kind === 'green' || kind === 'lime') { R(c, 20, 17, 2, 2, '#ff5c93'); R(c, 9, 23, 2, 2, '#fff3a3'); }
  }));
  return treeCache.get(kind);
}
function pine() {
  if (!treeCache.has('pine')) treeCache.set('pine', sprite(24, 40, c => {
    R(c, 10, 32, 4, 8, '#7a4b2a');
    for (let i = 0; i < 3; i++) for (let y = 0; y < 14; y++) {
      const w = 4 + 2 * Math.round(y * (1 + i * 0.25) / 2), top = i * 9;
      R(c, 12 - w / 2, top + y, w, 1, y > 10 ? '#276b38' : (y % 4 === 1 ? '#3b8f4a' : '#2f7d40'));
    }
    R(c, 10, 4, 2, 3, '#6fbf6a'); R(c, 8, 14, 2, 3, '#6fbf6a'); R(c, 7, 24, 2, 3, '#6fbf6a');
  }));
  return treeCache.get('pine');
}

function house(roof, roofDark, roofLight, wall, door) {
  return sprite(84, 76, c => {
    R(c, 6, 38, 72, 36, wall); for (let y = 42; y < 72; y += 6) R(c, 6, y, 72, 1, shade(wall, 0.93));
    R(c, 6, 70, 72, 4, shade(wall, 0.82));
    for (const x of [14, 56]) {
      R(c, x, 46, 14, 14, '#fffafc'); R(c, x + 1, 47, 12, 12, '#9fd8ff'); R(c, x + 6, 47, 2, 12, '#fffafc'); R(c, x + 1, 52, 12, 2, '#fffafc');
      R(c, x + 2, 48, 3, 2, '#ffffff'); R(c, x - 1, 60, 16, 4, '#a86a35'); R(c, x, 59, 3, 2, '#ff5c93'); R(c, x + 5, 59, 3, 2, '#ffd23f'); R(c, x + 10, 59, 3, 2, '#ff9ec4');
    }
    R(c, 34, 50, 16, 24, shade(door, 0.8)); R(c, 36, 52, 12, 22, door); R(c, 45, 62, 2, 2, '#ffd23f'); R(c, 32, 48, 20, 3, roofDark);
    for (let y = 0; y < 40; y++) {
      const inset = Math.max(0, Math.round((22 - y) * 1.75));
      R(c, inset, y, 84 - inset * 2, 1, y > 35 ? roofDark : (y % 6 === 5 ? roofDark : roof));
    }
    for (let y = 4; y < 34; y += 6) { const inset = Math.max(0, Math.round((22 - y) * 1.75)); for (let x = (y / 6) % 2 ? 8 : 14; x < 80; x += 12) if (x > inset + 2 && x < 82 - inset) R(c, x, y, 1, 4, roofDark); }
    R(c, 36, 2, 12, 2, roofLight); R(c, 22, 16, 16, 2, roofLight);
    R(c, 62, 4, 8, 14, '#c8643b'); R(c, 61, 2, 10, 3, '#a8502f');
  });
}
const lampSprite = () => sprite(10, 38, c => {
  R(c, 4, 10, 2, 26, '#4a4a66'); R(c, 2, 34, 6, 4, '#4a4a66'); R(c, 1, 2, 8, 8, '#fff3a3'); R(c, 2, 3, 3, 3, '#ffffff');
  R(c, 0, 0, 10, 2, '#4a4a66'); R(c, 1, 10, 8, 1, '#4a4a66');
});
const bushSprite = flower => sprite(22, 14, c => {
  disc(c, 11, 8, 10, 6, '#2e7d32'); disc(c, 10, 7, 9, 5, '#4caf50'); disc(c, 7, 5, 4, 2, '#7ccf62');
  R(c, 14, 5, 2, 2, flower); R(c, 5, 9, 2, 2, '#fff3a3'); R(c, 17, 9, 2, 2, flower);
});
const potSprite = () => sprite(14, 18, c => {
  R(c, 2, 9, 10, 9, '#c8643b'); R(c, 1, 8, 12, 3, '#e07a4a'); R(c, 3, 12, 2, 4, '#e07a4a');
  disc(c, 7, 5, 6, 4, '#4caf50'); R(c, 3, 1, 3, 3, '#ff5c93'); R(c, 8, 0, 3, 3, '#ffd23f'); R(c, 5, 4, 3, 3, '#ff9ec4');
});

// Picket fence spanning `w` px; base row at y = 13.
function fence(w) {
  return sprite(w, 14, c => {
    R(c, 0, 4, w, 3, '#e9dfe8'); R(c, 0, 9, w, 3, '#e9dfe8'); R(c, 0, 4, w, 1, '#ffffff');
    for (let x = 1; x < w - 2; x += 7) {
      R(c, x, 1, 4, 13, '#fffafc'); R(c, x + 1, 0, 2, 1, '#fffafc'); R(c, x + 3, 2, 1, 12, '#e3d4ea');
    }
  });
}
// Hedge wall seen from above: lit top, darker front face at its southern end.
function hedge(w, h) {
  return sprite(w, h, c => {
    const rnd = seeded(w * 31 + h);
    R(c, 0, 0, w, h, '#3f9a48'); R(c, 0, h - 8, w, 8, '#2b7a3c');
    for (let i = 0; i < (w * h) / 22; i++) {
      const x = Math.floor(rnd() * (w - 3)), y = Math.floor(rnd() * (h - 11));
      R(c, x, y, 3, 2, rnd() < 0.5 ? '#5cb85c' : '#368c42');
    }
    for (let y = 2; y < h - 10; y += 14) R(c, 2 + (y % 3), y, 2, 2, '#ff9ec4');
    R(c, 0, 0, w, 1, '#7ccf62'); for (let x = 1; x < w; x += 4) R(c, x, h - 8, 2, 1, '#3f9a48');
  });
}

// ---------------------------------------------------------------- the fountain
// Footprint is the server obstacle. In this 3/4 view the rim top sits 8px above the footprint and
// the front wall fills the last 8 rows, so the drawing never covers walkable ground.
export const FOUNTAIN_BOX = { x: FOUNTAIN.x - 2, y: FOUNTAIN.y - 46, w: FOUNTAIN.w + 4, h: FOUNTAIN.h + 50 };
let fountainCv;
export function fountain() {
  return (fountainCv ||= sprite(FOUNTAIN_BOX.w, FOUNTAIN_BOX.h, c => {
    c.translate(-FOUNTAIN_BOX.x, -FOUNTAIN_BOX.y);
    const { x, y, w, h } = FOUNTAIN, cx = x + w / 2;
    rrect(c, x, y - 8, w, h + 8, 12, '#cfc5b5');
    rrect(c, x, y - 8, w, h, 12, '#f4eee4');
    R(c, x + 10, y - 7, w - 20, 1, '#fffaf2');
    // front wall bricks
    for (let bx = x + 6; bx < x + w - 6; bx += 12) R(c, bx, y + h - 7, 1, 6, '#b6aa96');
    R(c, x + 4, y + h - 4, w - 8, 1, '#b6aa96'); R(c, x + 2, y + h - 2, w - 4, 2, '#a99c86');
    // inner wall + water
    rrect(c, x + 7, y - 2, w - 14, h - 14, 8, '#c4b8a4');
    rrect(c, x + 7, y + 1, w - 14, h - 17, 8, '#5cb8ea');
    rrect(c, x + 9, y + 3, w - 18, h - 21, 7, '#6cc7f0');
    // pedestal, lower ring, upper bowl, finial
    disc(c, cx, y + 32, 15, 5, '#b6aa96'); disc(c, cx, y + 31, 14, 4, '#e2d9cb'); disc(c, cx, y + 30, 10, 2, '#6cc7f0');
    R(c, cx - 4, y - 6, 8, 36, '#ddd4c6'); R(c, cx - 3, y - 6, 2, 36, '#f6f1e8'); R(c, cx + 2, y - 6, 2, 36, '#c4b8a4');
    disc(c, cx, y - 8, 18, 6, '#b6aa96'); disc(c, cx, y - 9, 18, 5, '#f4eee4'); disc(c, cx, y - 10, 14, 3, '#6cc7f0'); R(c, cx - 8, y - 11, 6, 1, '#bfe6ff');
    R(c, cx - 2, y - 22, 4, 12, '#ddd4c6'); R(c, cx - 1, y - 22, 1, 12, '#f6f1e8');
    disc(c, cx, y - 23, 5, 3, '#f4eee4'); R(c, cx - 1, y - 26, 2, 2, '#fffaf2');
    // rim studs
    for (const sx of [x + 14, x + w - 16]) R(c, sx, y - 6, 3, 2, '#ffd6e7');
  }));
}
// Animated water drawn over the static fountain.
export function fountainWater(c, t, ox, oy) {
  const { x, y, w, h } = FOUNTAIN, cx = x + w / 2 - ox;
  const X = n => n - ox, Y = n => n - oy;
  for (let i = 0; i < 3; i++) {
    const k = ((t / 1600 + i / 3) % 1), rx = Math.round(18 + k * 22), ry = Math.round(5 + k * 7);
    c.globalAlpha = 0.65 * (1 - k); c.fillStyle = '#d9f2ff';
    c.fillRect(Math.round(cx - rx), Y(y + 31) + ry, rx * 2, 1); c.fillRect(Math.round(cx - rx + 4), Y(y + 31) - ry, rx * 2 - 8, 1);
  }
  c.globalAlpha = 1;
  for (let i = 0; i < 9; i++) { // sparkles on the pool
    if (Math.floor(t / 300 + i * 1.7) % 4) continue;
    const sx = X(x + 14 + ((i * 37) % (w - 28))), sy = Y(y + 6 + ((i * 23) % (h - 26)));
    c.fillStyle = '#ffffff'; c.fillRect(sx, sy, 2, 1);
  }
  // jet + arcs falling into the upper bowl, drips into the pool
  c.fillStyle = '#bfe6ff'; c.fillRect(cx - 1, Y(y - 38), 2, 12);
  c.fillStyle = '#ffffff'; c.fillRect(cx - 1, Y(y - 40) + (Math.floor(t / 120) % 3), 2, 2);
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1, k = ((t / 700 + i / 8) % 1), dx = side * (2 + k * 13), dy = -38 + k * 30 - (1 - (2 * k - 1) ** 2) * 6;
    c.fillStyle = i % 4 < 2 ? '#ffffff' : '#bfe6ff'; c.fillRect(Math.round(cx + dx), Y(y) + Math.round(dy), 1, 2);
  }
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, k = ((t / 500 + i / 6) % 1);
    c.fillStyle = '#bfe6ff'; c.fillRect(Math.round(cx + side * (15 + (i % 3))), Y(y - 6) + Math.round(k * 30), 1, 2);
  }
}

// ---------------------------------------------------------------- ground
const flowerColors = ['#ffffff', '#ff9ec4', '#ffd23f', '#c9b6ff', '#ff6fa8'];
function flower(c, x, y, col) { R(c, x, y, 1, 1, col); R(c, x + 2, y, 1, 1, col); R(c, x + 1, y - 1, 1, 1, col); R(c, x + 1, y + 1, 1, 1, col); R(c, x + 1, y, 1, 1, '#ffd23f'); R(c, x + 1, y + 2, 1, 1, '#4f9a3c'); }
function stepStone(c, x, y) { disc(c, x, y + 1, 6, 3, '#9f9484'); disc(c, x, y, 6, 3, '#dcd3c6'); R(c, x - 3, y - 2, 3, 1, '#f3eee6'); }
// Four-petal mosaic inlay on the plaza (never star-shaped: stars are the collectibles).
function inlayFlower(c, cx, cy) {
  for (const [dx, dy] of [[0, -4], [4, 0], [0, 4], [-4, 0]]) { disc(c, cx + dx, cy + dy, 3, 2, '#f7b6cf'); R(c, cx + dx - 1, cy + dy - 1, 2, 1, '#ffd6e7'); }
  R(c, cx - 2, cy - 1, 4, 3, '#e8a0bf'); R(c, cx - 1, cy - 1, 2, 2, '#fff3a3');
}

let groundCv;
export function ground() {
  if (groundCv) return groundCv;
  const cv = canvas(EXT.w, EXT.h), c = cv.getContext('2d'), rnd = seeded(20261008);
  c.translate(-EXT.x, -EXT.y);
  // margins: deep forest floor
  for (let y = EXT.y; y < EXT.y + EXT.h; y += 16) for (let x = EXT.x; x < EXT.x + EXT.w; x += 16) {
    R(c, x, y, 16, 16, ((x + y) / 16) % 2 ? '#6fb35a' : '#69ab55');
    R(c, x + Math.floor(rnd() * 14), y + Math.floor(rnd() * 14), 1, 2, '#5a9a48');
  }
  // meadow
  for (let y = 0; y < WORLD.height; y += 16) for (let x = 0; x < WORLD.width; x += 16) {
    R(c, x, y, 16, 16, ((x + y) / 16) % 2 ? '#a3dd7f' : '#9ad676');
    for (let i = 0; i < 3; i++) { const bx = x + Math.floor(rnd() * 15), by = y + Math.floor(rnd() * 14); R(c, bx, by, 1, 2, '#7fc15e'); R(c, bx + 1, by, 1, 1, '#b8e896'); }
    if (rnd() < 0.18) flower(c, x + 2 + Math.floor(rnd() * 11), y + 3 + Math.floor(rnd() * 10), flowerColors[Math.floor(rnd() * flowerColors.length)]);
  }
  // meadow patches: wild flowers (top-left), heart bed (top-right), fairy ring (bottom-left), clover (bottom-right)
  for (let i = 0; i < 70; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()); flower(c, Math.round(84 + Math.cos(a) * r * 56), Math.round(78 + Math.sin(a) * r * 36), flowerColors[i % flowerColors.length]); }
  const inHeart = (x, y) => { const u = x / 15, v = -(y + 1) / 13; return (u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0; };
  for (let y = -16; y <= 14; y++) for (let x = -20; x <= 20; x++) if (inHeart(x, y)) R(c, 552 + x, 80 + y, 1, 1, inHeart(x, y - 1) && inHeart(x - 1, y) && inHeart(x + 1, y) && inHeart(x, y + 1) ? '#86c464' : '#6faf55');
  for (let y = -12; y <= 10; y += 4) for (let x = -16; x <= 16; x += 4) if (inHeart(x, y) && inHeart(x + 2, y + 2) && inHeart(x - 2, y - 2)) flower(c, 552 + x + (y % 8 ? 2 : 0), 80 + y, (x + y) % 8 ? '#ff5c93' : '#ffd6e7');
  for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; flower(c, Math.round(92 + Math.cos(a) * 30), Math.round(336 + Math.sin(a) * 18), i % 3 ? '#ffd23f' : '#ffffff'); }
  for (const [mx, my] of [[80, 330], [100, 342], [88, 347]]) { R(c, mx, my, 4, 2, '#ff5c5c'); R(c, mx + 1, my, 1, 1, '#ffffff'); R(c, mx + 1, my + 2, 2, 2, '#fff3e0'); }
  for (let i = 0; i < 26; i++) {
    const x = 528 + Math.floor(rnd() * 76), y = 304 + Math.floor(rnd() * 56);
    R(c, x, y, 2, 2, '#6cbf55'); R(c, x + 3, y, 2, 2, '#6cbf55'); R(c, x + 1, y - 2, 3, 2, '#7fcf66'); R(c, x + 2, y + 2, 1, 2, '#4f9a3c');
    if (i % 7 === 0) { R(c, x + 6, y - 1, 2, 2, '#ffffff'); R(c, x + 7, y - 2, 1, 1, '#ffd6e7'); }
  }
  // soft shade under the hedges and fence
  c.globalAlpha = 0.18; R(c, 0, 0, 10, WORLD.height + 8, '#1f4d2a'); R(c, WORLD.width - 10, 0, 10, WORLD.height + 8, '#1f4d2a'); R(c, 0, 0, WORLD.width, 6, '#1f4d2a'); c.globalAlpha = 1;

  // brick road from the plaza to the south gate
  const roadTop = PLAZA.y + PLAZA.h - 8;
  R(c, PATH.x - 2, roadTop, PATH.w + 4, EXT.y + EXT.h - roadTop, '#d4b070');
  for (let y = roadTop; y < EXT.y + EXT.h; y += 8) for (let x = PATH.x - ((y / 8) % 2 ? 8 : 0); x < PATH.x + PATH.w; x += 16) {
    const bx = Math.max(PATH.x, x), bw = Math.min(PATH.x + PATH.w, x + 16) - bx;
    if (bw <= 0) continue;
    R(c, bx, y, bw, 8, rnd() < 0.3 ? '#ecd096' : '#f2d9a3'); R(c, bx, y, bw, 1, '#dcbf82'); R(c, bx, y, 1, 8, '#dcbf82'); R(c, bx + 1, y + 1, Math.min(4, bw - 1), 1, '#f9ebc6');
  }
  // stone plaza with curb, mosaic ring and corner star inlays
  rrect(c, PLAZA.x - 2, PLAZA.y - 2, PLAZA.w + 4, PLAZA.h + 6, 30, '#b9ab94');
  rrect(c, PLAZA.x - 2, PLAZA.y - 2, PLAZA.w + 4, PLAZA.h + 4, 30, '#d6cab6');
  c.save(); rrectPath(c, PLAZA.x, PLAZA.y, PLAZA.w, PLAZA.h, 28); c.clip();
  for (let y = PLAZA.y; y < PLAZA.y + PLAZA.h; y += 8) for (let x = PLAZA.x - ((y / 8) % 2 ? 8 : 0); x < PLAZA.x + PLAZA.w; x += 16) {
    const v = rnd(); R(c, x, y, 16, 8, v < 0.2 ? '#e9e1d3' : v > 0.85 ? '#f6f0e5' : '#f0e9dd');
    R(c, x, y, 16, 1, '#dbd0bf'); R(c, x, y, 1, 8, '#dbd0bf'); R(c, x + 1, y + 1, 3, 1, '#fbf8f2');
  }
  c.restore();
  c.save(); rrectPath(c, PLAZA.x + 10, PLAZA.y + 10, PLAZA.w - 20, PLAZA.h - 20, 20); rrectPath(c, PLAZA.x + 16, PLAZA.y + 16, PLAZA.w - 32, PLAZA.h - 32, 15, false);
  c.clip('evenodd'); R(c, PLAZA.x, PLAZA.y, PLAZA.w, PLAZA.h, '#ddd2c0');
  for (let x = PLAZA.x; x < PLAZA.x + PLAZA.w; x += 6) R(c, x, PLAZA.y, 1, PLAZA.h, '#cfc3ae');
  for (let y = PLAZA.y; y < PLAZA.y + PLAZA.h; y += 6) R(c, PLAZA.x, y, PLAZA.w, 1, '#cfc3ae');
  c.restore();
  R(c, PATH.x, PLAZA.y + PLAZA.h - 6, PATH.w, 10, '#f0e9dd');
  for (let x = PATH.x; x < PATH.x + PATH.w; x += 16) R(c, x, PLAZA.y + PLAZA.h - 6, 1, 10, '#dbd0bf');
  const ring = { x: FOUNTAIN.x - 24, y: FOUNTAIN.y - 26, w: FOUNTAIN.w + 48, h: FOUNTAIN.h + 50 };
  rrect(c, ring.x, ring.y, ring.w, ring.h, 22, '#e8a0bf');
  rrect(c, ring.x + 1, ring.y + 1, ring.w - 2, ring.h - 2, 21, '#fffafc');
  c.save(); rrectPath(c, ring.x + 1, ring.y + 1, ring.w - 2, ring.h - 2, 21); c.clip();
  for (let y = ring.y; y < ring.y + ring.h; y += 6) for (let x = ring.x; x < ring.x + ring.w; x += 6) if (((x - ring.x) / 6 + (y - ring.y) / 6) % 2) R(c, x, y, 6, 6, '#ffd6e7');
  c.restore();
  rrect(c, ring.x + 9, ring.y + 9, ring.w - 18, ring.h - 18, 14, '#e8a0bf');
  rrect(c, ring.x + 10, ring.y + 10, ring.w - 20, ring.h - 20, 13, '#f3ece0');
  for (const [sx, sy] of [[198, 124], [442, 124], [198, 254], [442, 254]]) inlayFlower(c, sx, sy);
  // fountain contact shadow
  c.globalAlpha = 0.22; rrect(c, FOUNTAIN.x + 2, FOUNTAIN.y + FOUNTAIN.h - 4, FOUNTAIN.w, 7, 4, '#3a2440'); c.globalAlpha = 1;

  // stepping-stone trails from the plaza to the meadow patches
  for (const [x, y] of [[150, 152], [134, 138], [124, 120], [112, 104], [150, 236], [134, 254], [122, 274], [110, 296],
    [490, 152], [508, 136], [522, 118], [534, 102], [490, 236], [508, 254], [524, 274], [540, 294]]) stepStone(c, x, y);
  return (groundCv = cv);
}

// ---------------------------------------------------------------- scenery layers
// Everything north of / beside the walkable rectangle: always behind avatars.
let backCv;
export function backdrop() {
  if (backCv) return backCv;
  const cv = canvas(EXT.w, EXT.h), c = cv.getContext('2d'), rnd = seeded(4242);
  c.translate(-EXT.x, -EXT.y);
  const put = (spr, x, baseY) => c.drawImage(spr, Math.round(x - spr.width / 2), Math.round(baseY - spr.height + 1));
  const items = [];
  // far tree line and houses along the north edge
  for (let x = EXT.x + 8; x < EXT.x + EXT.w; x += 22) items.push([rnd() < 0.3 ? pine() : tree(rnd() < 0.5 ? 'deep' : 'green'), x + rnd() * 8, -64 + rnd() * 10]);
  items.push([house('#ff6fa8', '#d93a73', '#ffa3c4', '#fff3e0', '#a86a35'), 128, -8]);
  items.push([house('#4aa8ff', '#2f7fd1', '#9fd0ff', '#fffbe8', '#8a5a36'), 320, -10]);
  items.push([house('#9b6bff', '#6c45c9', '#c8b0ff', '#fff6fb', '#a86a35'), 512, -8]);
  for (const x of [32, 222, 418, 610]) items.push([tree(x % 3 ? 'blossom' : 'lime'), x, -12]);
  // side forests
  for (let y = -40; y < WORLD.height + 40; y += 26) {
    items.push([tree(rnd() < 0.25 ? 'blossom' : rnd() < 0.5 ? 'deep' : 'green'), -36 + rnd() * 8, y + rnd() * 10]);
    items.push([tree(rnd() < 0.25 ? 'blossom' : rnd() < 0.5 ? 'deep' : 'green'), WORLD.width + 36 - rnd() * 8, y + rnd() * 10]);
  }
  items.sort((a, b) => a[2] - b[2]).forEach(([spr, x, y]) => put(spr, x, y));
  // fence on the north edge, hedges on the west/east edges, lamps
  c.drawImage(fence(WORLD.width + 16), -9, -4);
  for (const x of [200, 440]) put(lampSprite(), x, 8);
  c.drawImage(hedge(22, WORLD.height + 12), -15, 0);
  c.drawImage(hedge(22, WORLD.height + 12), WORLD.width + 7, 0);
  for (const [x, y] of [[96, 6], [544, 6], [264, 6], [376, 6]]) put(bushSprite(x % 3 ? '#ff6fa8' : '#ffffff'), x, y);
  return (backCv = cv);
}
// South of the walkable rectangle: always in front of avatars.
let frontCv;
export function foreground() {
  if (frontCv) return frontCv;
  const cv = canvas(EXT.w, EXT.h), c = cv.getContext('2d'), rnd = seeded(77);
  c.translate(-EXT.x, -EXT.y);
  const put = (spr, x, baseY) => c.drawImage(spr, Math.round(x - spr.width / 2), Math.round(baseY - spr.height + 1));
  const base = WORLD.height + 14;
  c.drawImage(fence(PATH.x - 6 + 9), -9, base - 13);
  c.drawImage(fence(WORLD.width + 9 - PATH.x - PATH.w - 6), PATH.x + PATH.w + 6, base - 13);
  // gate arch over the brick road
  put(gate(), PATH.x + PATH.w / 2, base + 2);
  put(lampSprite(), PATH.x - 18, base + 4); put(lampSprite(), PATH.x + PATH.w + 18, base + 4);
  for (const x of [PATH.x - 34, PATH.x + PATH.w + 34]) put(potSprite(), x, base + 6);
  for (const x of [40, 120, 200, 440, 520, 600]) put(bushSprite(x % 80 ? '#ff6fa8' : '#fff3a3'), x + rnd() * 10, base + 8);
  const trees = [];
  for (let x = EXT.x + 6; x < EXT.x + EXT.w; x += 24) if (x < PATH.x - 40 || x > PATH.x + PATH.w + 32) trees.push([x + rnd() * 8, base + 44 + rnd() * 26]);
  trees.sort((a, b) => a[1] - b[1]).forEach(([x, y]) => put(rnd() < 0.2 ? pine() : tree(rnd() < 0.3 ? 'blossom' : 'green'), x, y));
  return (frontCv = cv);
}
export const GATE_SIGN = { x: PATH.x + PATH.w / 2, y: WORLD.height - 22 };
function gate() {
  return sprite(PATH.w + 16, 46, c => {
    const w = PATH.w + 16;
    R(c, 0, 8, 7, 38, '#fff3e0'); R(c, w - 7, 8, 7, 38, '#fff3e0');
    for (let y = 12; y < 44; y += 7) { R(c, 0, y, 7, 3, '#ffa3c4'); R(c, w - 7, y, 7, 3, '#ffa3c4'); }
    for (let x = 0; x < w; x++) { const t = (x - w / 2) / (w / 2), y = Math.round(6 * t * t); R(c, x, y + 2, 1, 6, '#ff5c93'); R(c, x, y + 3, 1, 2, '#ffa3c4'); }
    R(c, 14, 0, w - 28, 13, '#fffafc'); R(c, 14, 0, w - 28, 1, '#ffd6e7'); R(c, 14, 11, w - 28, 2, '#e3d4ff');
    R(c, 9, 4, 4, 4, '#ffd23f'); R(c, w - 13, 4, 4, 4, '#ffd23f');
  });
}
// Ambient chimney smoke and lamp glow (north houses / lamps), drawn behind avatars.
export function ambience(c, t, ox, oy) {
  for (const [x, y] of [[152, -84], [344, -86], [536, -84]]) for (let i = 0; i < 3; i++) {
    const k = (t / 2400 + i / 3) % 1, r = 2 + Math.round(k * 3);
    c.globalAlpha = 0.7 * (1 - k); c.fillStyle = '#ffffff';
    c.fillRect(Math.round(x - ox + Math.sin(k * 6 + i) * 3 - r / 2), Math.round(y - oy - k * 22), r, r);
  }
  c.globalAlpha = 1;
}

// ---------------------------------------------------------------- star collectible
let starCv;
export function star() {
  return (starCv ||= sprite(13, 13, c => {
    [[6, 0, 1], [5, 1, 3], [5, 2, 3], [4, 3, 5], [0, 4, 13], [1, 5, 11], [2, 6, 9], [3, 7, 7], [3, 8, 7],
      [2, 9, 3], [8, 9, 3], [2, 10, 2], [9, 10, 2], [1, 11, 2], [10, 11, 2]].forEach(([x, y, w]) => R(c, x, y, w, 1, '#ffd23f'));
    R(c, 3, 8, 7, 1, '#f0b429'); R(c, 2, 9, 3, 1, '#f0b429'); R(c, 8, 9, 3, 1, '#f0b429');
    R(c, 6, 1, 1, 3, '#fff8d0'); R(c, 2, 4, 3, 1, '#fff3a3'); R(c, 4, 6, 1, 2, LINE); R(c, 8, 6, 1, 2, LINE);
  }));
}

// ---------------------------------------------------------------- avatars (16x24, 2-head chibi)
// The server sends no appearance, so a stable look is derived from the player id.
const SKINS = [['#ffe0c4', '#f3c4a0'], ['#f5c9a0', '#e2ab7e'], ['#d9a074', '#bf855a']];
const HAIRS = ['#4a2f24', '#7a4b2a', '#2a2238', '#c8643b', '#e8b04a', '#ff8fbf', '#4aa8ff', '#9b6bff'];
const SHIRTS = ['#ff9ec4', '#7cc4ec', '#8fd694', '#ffd23f', '#c9b6ff', '#ff9f43', '#fffafc', '#ff6b81'];
const PANTS = ['#3b4a7a', '#5a3f86', '#4f7fd1', '#6b4a3a'];
export function lookFor(id) {
  const h = hash(id || 'guest'), [skin, skinDk] = SKINS[h % 3], hair = HAIRS[(h >>> 3) % HAIRS.length];
  const shirt = SHIRTS[(h >>> 7) % SHIRTS.length], pants = PANTS[(h >>> 11) % PANTS.length], style = (h >>> 14) % 4;
  return { key: `${h % 3}|${hair}|${shirt}|${pants}|${style}`, skin, skinDk, hair, hairDk: shade(hair, 0.72), hairHi: shade(hair, 1.35), shirt, shirtDk: shade(shirt, 0.8), pants, style };
}
// dir: 0 down, 1 up, 2 right (left is mirrored). frame: 0..3 walk cycle, 0 = standing.
function paintAvatar(c, L, dir, frame) {
  const b = frame % 2, shoe = '#2a2238', leftUp = frame === 1, rightUp = frame === 3;
  // legs and shoes
  if (dir === 2) {
    const front = frame === 1 ? 2 : frame === 3 ? -2 : 0;
    R(c, 6 - front, 19, 3, 3, shade(L.pants, 0.8)); R(c, 7 + front, 19, 3, 3, L.pants);
    R(c, 6 - front, 22, 4, 2, shoe); R(c, 7 + front, 22, 4, 2, shoe);
  } else {
    R(c, 5, 19, 3, leftUp ? 2 : 3, L.pants); R(c, 8, 19, 3, rightUp ? 2 : 3, L.pants);
    R(c, 4, leftUp ? 21 : 22, 4, 2, shoe); R(c, 8, rightUp ? 21 : 22, 4, 2, shoe);
  }
  // torso and arms
  const y = b;
  if (dir === 2) {
    R(c, 5, 13 + y, 6, 6 - y, L.shirt); R(c, 5, 17, 6, 2, L.shirtDk);
    const swing = frame === 1 ? 1 : frame === 3 ? -1 : 0;
    R(c, 7 + swing, 14 + y, 3, 4, L.shirtDk); R(c, 7 + swing, 18 + y, 3, 1, L.skin);
  } else {
    R(c, 4, 13 + y, 8, 6 - y, L.shirt); R(c, 4, 17, 8, 2, L.shirtDk);
    const la = frame === 1 ? 1 : frame === 3 ? -1 : 0;
    R(c, 2, 13 + y + Math.max(0, la), 2, 4, L.shirt); R(c, 12, 13 + y + Math.max(0, -la), 2, 4, L.shirt);
    R(c, 2, 17 + y + Math.max(0, la), 2, 1, L.skin); R(c, 12, 17 + y + Math.max(0, -la), 2, 1, L.skin);
    if (dir === 0) { R(c, 6, 13 + y, 4, 1, '#fffafc'); R(c, 7, 14 + y, 2, 1, '#fffafc'); }
  }
  // head
  const hy = y, hair = L.hair;
  R(c, 1, 2 + hy, 14, 10, L.skin); R(c, 2, 1 + hy, 12, 12, L.skin); R(c, 2, 12 + hy, 12, 1, L.skinDk);
  const cap = L.style === 3;
  if (dir === 1) {
    R(c, 1, 1 + hy, 14, 11, hair); R(c, 2, 0 + hy, 12, 13, hair); R(c, 4, 2 + hy, 4, 2, L.hairHi); R(c, 2, 11 + hy, 12, 2, L.hairDk);
    if (L.style === 1) R(c, 1, 12 + hy, 14, 3, hair);
  } else if (dir === 2) {
    R(c, 1, 0 + hy, 12, 5, hair); R(c, 2, 0 + hy, 10, 1, L.hairHi); R(c, 1, 0 + hy, 6, 11, hair); R(c, 2, 11 + hy, 4, 1, L.hairDk);
    R(c, 8, 5 + hy, 4, 1, hair); R(c, 12, 2 + hy, 2, 3, hair);
    R(c, 10, 7 + hy, 2, 2, LINE); R(c, 10, 7 + hy, 1, 1, '#ffffff'); R(c, 12, 10 + hy, 2, 1, '#ff9ec4'); R(c, 13, 10 + hy, 1, 1, '#d97a6a');
    R(c, 6, 7 + hy, 1, 2, L.skinDk); // ear
    if (L.style === 1) R(c, 1, 10 + hy, 5, 5, hair);
  } else {
    R(c, 1, 0 + hy, 14, 5, hair); R(c, 2, 0 + hy, 12, 1, hair); R(c, 3, 1 + hy, 4, 1, L.hairHi);
    R(c, 1, 5 + hy, 4, 1, hair); R(c, 7, 5 + hy, 3, 1, hair); R(c, 12, 5 + hy, 3, 1, hair);
    R(c, 1, 6 + hy, 2, 4, hair); R(c, 13, 6 + hy, 2, 4, hair);
    R(c, 4, 7 + hy, 2, 2, LINE); R(c, 10, 7 + hy, 2, 2, LINE); R(c, 4, 7 + hy, 1, 1, '#ffffff'); R(c, 10, 7 + hy, 1, 1, '#ffffff');
    R(c, 3, 10 + hy, 2, 1, '#ff9ec4'); R(c, 11, 10 + hy, 2, 1, '#ff9ec4'); R(c, 7, 10 + hy, 2, 1, '#d97a6a');
    if (L.style === 1) { R(c, 0, 5 + hy, 2, 10, hair); R(c, 14, 5 + hy, 2, 10, hair); }
  }
  if (L.style === 2) { // buns
    disc(c, 2, hy - 1, 2, 2, L.hairDk); if (dir !== 2) disc(c, 14, hy - 1, 2, 2, L.hairDk); else disc(c, 3, hy - 1, 2, 2, L.hairDk);
    R(c, dir === 2 ? 0 : 1, 3 + hy, 2, 2, '#ff5c93');
  }
  if (cap) {
    const col = L.shirt === '#fffafc' ? '#ff5c93' : L.shirtDk;
    R(c, 1, -1 + hy, 14, 5, col); R(c, 2, -2 + hy, 12, 1, col); R(c, 4, -1 + hy, 3, 1, shade(col, 1.25));
    if (dir === 0) R(c, 1, 4 + hy, 14, 1, shade(col, 0.75));
    if (dir === 2) R(c, 10, 4 + hy, 6, 1, shade(col, 0.75));
  }
}
const avatarCache = new Map();
// Sprite is 18x29: 3 rows of headroom for buns/caps, feet on the last opaque row (y = 27).
export function avatar(look, dir, frame) {
  const key = `${look.key}|${dir}|${frame}`;
  if (!avatarCache.has(key)) avatarCache.set(key, sprite(16, 27, c => { c.translate(0, 3); paintAvatar(c, look, dir, frame); }));
  return avatarCache.get(key);
}
