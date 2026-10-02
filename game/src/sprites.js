// Procedural dot sprites. Everything is drawn at 1 art pixel, then outlined with a 1px plum line.
import { PROPS, TILE, COLS, ROWS } from '../../shared/world.js';

export const LINE = '#3a2440';
const R = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
function disc(c, cx, cy, rx, ry, col) {
  c.fillStyle = col;
  for (let y = -ry; y <= ry; y++) {
    const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y / (ry + 0.5)) ** 2)));
    c.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2, 1);
  }
}
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function seeded(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function hash(str) { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

// Adds a 1px outline around every opaque pixel (sprite must have 1px transparent padding).
function outline(cv, col = LINE) {
  const { width: w, height: h } = cv, c = cv.getContext('2d'), img = c.getImageData(0, 0, w, h), a = img.data, out = new Uint8ClampedArray(a);
  const [r, g, b] = hex(col);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (a[i + 3] > 40) continue;
    const near = (x > 0 && a[i - 1] > 40) || (x < w - 1 && a[i + 7] > 40) || (y > 0 && a[i - w * 4 + 3] > 40) || (y < h - 1 && a[i + w * 4 + 3] > 40);
    if (near) { out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255; }
  }
  img.data.set(out); c.putImageData(img, 0, 0);
  return cv;
}
function sprite(w, h, paint, line = true) {
  const cv = canvas(w + 2, h + 2), c = cv.getContext('2d');
  c.translate(1, 1); paint(c); c.setTransform(1, 0, 0, 1, 0, 0);
  return line ? outline(cv) : cv;
}

// ---------- props ----------
function canopy(c, cx, cy, base, light, dark, speck) {
  disc(c, cx, cy + 2, 14, 12, dark);
  disc(c, cx - 1, cy, 13, 11, base);
  disc(c, cx - 4, cy - 4, 7, 5, light);
  disc(c, cx - 5, cy - 6, 3, 2, speck);
  disc(c, cx + 6, cy + 5, 5, 3, dark);
  R(c, cx + 3, cy - 3, 2, 2, light); R(c, cx - 9, cy + 3, 2, 2, light); R(c, cx + 8, cy - 1, 1, 2, light);
}
function trunk(c) {
  R(c, 13, 27, 6, 14, '#8a5a36'); R(c, 14, 27, 2, 13, '#b07848'); R(c, 11, 38, 10, 3, '#7a4b2a'); R(c, 13, 30, 1, 2, '#6b3e26');
}
const PAINT = {
  tree: c => { trunk(c); canopy(c, 16, 15, '#43a047', '#74c65a', '#2e7d32', '#a5e07a'); },
  blossom: c => { trunk(c); canopy(c, 16, 15, '#ff8fbf', '#ffc2dc', '#e0619a', '#fff0f6'); R(c, 9, 20, 2, 2, '#fff'); R(c, 20, 9, 2, 2, '#fff'); },
  bush: c => { disc(c, 11, 9, 10, 6, '#2e7d32'); disc(c, 10, 8, 9, 5, '#4caf50'); disc(c, 7, 6, 4, 2, '#7ccf62'); R(c, 14, 6, 2, 2, '#ff6fa8'); R(c, 5, 10, 2, 2, '#fff3a3'); },
  house: (c, p) => building(c, p, { roof: '#ff6fa8', roofDark: '#d93a73', roofLight: '#ffa3c4', wall: '#fff3e0', trim: '#ffd6e7' }),
  shop: (c, p) => building(c, p, { roof: '#4aa8ff', roofDark: '#2f7fd1', roofLight: '#9fd0ff', wall: '#fffbe8', trim: '#d4f1ff', awning: true }),
  greenhouse: c => {
    R(c, 2, 26, 76, 38, '#cfeff6'); for (let x = 2; x < 78; x += 12) R(c, x, 26, 2, 38, '#ffffff');
    R(c, 2, 44, 76, 2, '#ffffff'); R(c, 2, 58, 76, 6, '#9b7851');
    for (let i = 0; i < 26; i++) { const x = 4 + (i * 13) % 70, y = 48 + (i * 7) % 9; R(c, x, y, 3, 3, i % 3 ? '#4caf50' : '#ff8fbf'); }
    for (let y = 0; y < 26; y++) { const inset = Math.round((26 - y) * 0.55); R(c, inset, y, 80 - inset * 2, 1, y % 6 < 1 ? '#ffffff' : '#a9e4f2'); }
    R(c, 34, 44, 12, 20, '#7cc4ec'); R(c, 39, 44, 2, 20, '#ffffff'); R(c, 28, 34, 24, 8, '#fffafc');
  },
  fountain: c => {
    disc(c, 30, 32, 29, 12, '#b9b0a3'); disc(c, 30, 31, 28, 11, '#e9e4dc'); disc(c, 30, 30, 23, 8, '#4aa8ff'); disc(c, 30, 29, 21, 6, '#6cc7f0');
    R(c, 14, 28, 6, 1, '#bfe6ff'); R(c, 38, 31, 5, 1, '#bfe6ff');
    R(c, 27, 12, 6, 18, '#d6cec2'); R(c, 28, 12, 2, 18, '#f4f1ea');
    disc(c, 30, 12, 10, 3, '#d6cec2'); disc(c, 30, 11, 8, 2, '#6cc7f0');
    R(c, 29, 1, 2, 9, '#bfe6ff'); R(c, 27, 3, 1, 5, '#bfe6ff'); R(c, 32, 3, 1, 5, '#bfe6ff'); R(c, 29, 0, 2, 2, '#ffffff');
  },
  bench: c => {
    R(c, 1, 1, 26, 4, '#c68642'); R(c, 1, 2, 26, 1, '#e0a868'); R(c, 0, 6, 28, 5, '#a86a35'); R(c, 0, 7, 28, 1, '#d99a5c');
    R(c, 2, 11, 3, 6, '#5a3a22'); R(c, 23, 11, 3, 6, '#5a3a22'); R(c, 3, 5, 2, 2, '#5a3a22'); R(c, 23, 5, 2, 2, '#5a3a22');
  },
  lamp: c => { R(c, 4, 10, 2, 26, '#4a4a66'); R(c, 2, 34, 6, 3, '#4a4a66'); R(c, 1, 2, 8, 8, '#fff3a3'); R(c, 2, 3, 3, 3, '#ffffff'); R(c, 0, 0, 10, 2, '#4a4a66'); R(c, 1, 10, 8, 1, '#4a4a66'); },
  board: c => {
    R(c, 4, 14, 3, 21, '#7a4b2a'); R(c, 37, 14, 3, 21, '#7a4b2a');
    R(c, 0, 0, 44, 24, '#a86a35'); R(c, 2, 2, 40, 20, '#e8c08a');
    [[4, 4, '#ff9ec4'], [14, 6, '#fff3a3'], [25, 3, '#bfe6ff'], [33, 8, '#c8f2b0'], [8, 13, '#fff3a3'], [20, 13, '#ff9ec4'], [30, 15, '#e3d4ff']].forEach(([x, y, col]) => { R(c, x, y, 8, 6, col); R(c, x + 3, y, 2, 1, '#e0344f'); });
  },
  sign: (c, p) => {
    R(c, 14, 8, 3, 18, '#7a4b2a');
    const left = p.dir < 0;
    R(c, 3, 2, 24, 9, '#e0a868'); R(c, 3, 3, 24, 1, '#f4c98a');
    if (left) { R(c, 1, 4, 2, 5, '#e0a868'); R(c, 0, 5, 1, 3, '#e0a868'); } else { R(c, 27, 4, 2, 5, '#e0a868'); R(c, 29, 5, 1, 3, '#e0a868'); }
  },
  pot: c => { R(c, 2, 8, 10, 8, '#c8643b'); R(c, 1, 7, 12, 3, '#e07a4a'); disc(c, 7, 4, 6, 4, '#4caf50'); R(c, 3, 1, 3, 3, '#ff5c93'); R(c, 8, 0, 3, 3, '#ffd23f'); R(c, 5, 4, 3, 3, '#ff9ec4'); },
  mailbox: c => { R(c, 5, 12, 2, 12, '#5a3a22'); R(c, 0, 2, 12, 10, '#e0344f'); R(c, 1, 3, 10, 2, '#ff6b81'); R(c, 2, 7, 8, 1, '#8b0000'); R(c, 10, 0, 2, 6, '#ffd23f'); },
  post: c => { R(c, 0, 4, 8, 46, '#fff3e0'); for (let y = 8; y < 48; y += 8) R(c, 0, y, 8, 3, '#ffa3c4'); R(c, 0, 0, 8, 5, '#ff5c93'); R(c, 1, 1, 3, 1, '#ffd6e7'); },
  arch: c => {
    for (let x = 0; x < 92; x++) { const t = (x - 46) / 46, y = Math.round(10 * t * t); R(c, x, y + 6, 1, 7, '#ff5c93'); R(c, x, y + 7, 1, 2, '#ffa3c4'); }
    R(c, 22, 0, 48, 16, '#fffafc'); R(c, 22, 0, 48, 2, '#ffd6e7'); R(c, 22, 14, 48, 2, '#e3d4ff');
    R(c, 18, 5, 4, 4, '#ffd23f'); R(c, 70, 5, 4, 4, '#ffd23f');
  },
  vinePost: c => { R(c, 1, 0, 6, 44, '#a86a35'); R(c, 2, 0, 2, 44, '#c68642'); for (let y = 4; y < 40; y += 7) { R(c, 0, y, 3, 3, '#4caf50'); R(c, 5, y + 3, 3, 3, '#2e7d32'); } },
  pergola: c => {
    // lattice roof lifted above the path; gaps let the avatar show through
    for (let y = 2; y < 58; y += 10) R(c, 0, y, 60, 3, '#c68642');
    R(c, 6, 0, 3, 58, '#a86a35'); R(c, 51, 0, 3, 58, '#a86a35');
    const rnd = seeded(7);
    for (let i = 0; i < 34; i++) { const x = 6 + Math.floor(rnd() * 46), y = Math.floor(rnd() * 56); R(c, x, y, 3, 2, i % 4 ? '#4caf50' : '#ff8fbf'); }
    for (let x = 2; x < 58; x += 13) { const len = 2 + ((x * 7) % 4); R(c, x, 56, 2, len, '#2e7d32'); R(c, x, 56 + len, 2, 2, '#ff8fbf'); }
  },
  rock: c => { disc(c, 9, 6, 8, 5, '#9a93a6'); disc(c, 7, 5, 5, 3, '#c4bdd0'); R(c, 5, 3, 2, 1, '#e6e0ee'); },
  lantern: c => { R(c, 3, 10, 6, 10, '#b9b0a3'); R(c, 0, 6, 12, 4, '#d6cec2'); R(c, 2, 0, 8, 6, '#d6cec2'); R(c, 4, 2, 4, 3, '#ffd23f'); R(c, 1, 18, 10, 3, '#9a93a6'); },
  cabinet: (c, p) => {
    const hues = [['#ff5c93', '#d93a73'], ['#4aa8ff', '#2f7fd1'], ['#9b6bff', '#6c45c9'], ['#ffb020', '#d98a00']];
    const [main, dark] = hues[Math.floor(p.hue || 0) % hues.length];
    R(c, 0, 4, 24, 36, main); R(c, 0, 4, 3, 36, dark); R(c, 21, 4, 3, 36, dark);
    R(c, 2, 0, 20, 6, '#fff3a3'); R(c, 4, 1, 16, 3, dark);
    R(c, 3, 8, 18, 13, '#2a2238'); R(c, 4, 9, 16, 11, '#3b2f6b');
    const rnd = seeded(Math.floor((p.hue || 1) * 97));
    for (let i = 0; i < 9; i++) R(c, 5 + Math.floor(rnd() * 14), 10 + Math.floor(rnd() * 9), 2, 1, ['#ffd23f', '#4cd07d', '#ff6fa8', '#bfe6ff'][i % 4]);
    R(c, 1, 22, 22, 6, '#3a2440'); R(c, 6, 23, 2, 3, '#e0344f'); R(c, 5, 22, 4, 2, '#ff6b81'); R(c, 13, 24, 2, 2, '#ffd23f'); R(c, 17, 24, 2, 2, '#4cd07d');
    R(c, 3, 30, 18, 8, dark); R(c, 9, 32, 6, 3, '#ffd23f');
  },
  claw: c => {
    R(c, 0, 34, 32, 16, '#ff5c93'); R(c, 0, 34, 32, 2, '#ffa3c4'); R(c, 4, 40, 8, 6, '#2a2238'); R(c, 22, 38, 6, 4, '#ffd23f');
    R(c, 0, 0, 32, 6, '#ff5c93'); R(c, 2, 1, 28, 3, '#fff3a3');
    R(c, 1, 6, 30, 28, '#d4f1ff'); R(c, 3, 8, 3, 22, '#ffffff');
    R(c, 15, 6, 2, 9, '#4a4a66'); R(c, 12, 15, 8, 2, '#4a4a66'); R(c, 12, 17, 2, 3, '#4a4a66'); R(c, 18, 17, 2, 3, '#4a4a66');
    [[4, 26, '#ff9ec4'], [10, 27, '#fff3a3'], [17, 25, '#bfe6ff'], [23, 27, '#c8f2b0'], [7, 22, '#e3d4ff'], [20, 22, '#ffb020']].forEach(([x, y, col]) => disc(c, x + 2, y + 2, 3, 2, col));
  },
  counter: c => {
    R(c, 0, 0, 96, 8, '#c68642'); R(c, 0, 1, 96, 2, '#e0a868'); R(c, 2, 8, 92, 24, '#9b6bff'); R(c, 2, 8, 92, 2, '#6c45c9');
    for (let x = 10; x < 90; x += 20) star(c, x, 18, '#ffd23f');
    R(c, 70, -2, 10, 4, '#e9e4dc'); R(c, 72, -4, 6, 2, '#4cd07d');
  },
  shelf: c => {
    R(c, 0, 0, 96, 42, '#a86a35'); R(c, 2, 2, 92, 38, '#7a4b2a');
    for (const y of [14, 28]) R(c, 2, y, 92, 3, '#c68642');
    const cols = ['#ff9ec4', '#fff3a3', '#bfe6ff', '#c8f2b0', '#e3d4ff', '#ffb020'];
    for (let i = 0; i < 18; i++) { const x = 6 + (i % 9) * 10, y = i < 9 ? 6 : 20; disc(c, x + 3, y + 4, 4, 4, cols[i % 6]); R(c, x + 1, y + 2, 1, 1, '#2a2238'); R(c, x + 4, y + 2, 1, 1, '#2a2238'); }
  },
  pillar: c => { R(c, 1, 6, 14, 52, '#7a58ab'); R(c, 3, 6, 3, 52, '#9b7bd0'); R(c, 0, 0, 16, 7, '#ffd23f'); R(c, 0, 55, 16, 7, '#ffd23f'); R(c, 1, 2, 14, 2, '#fff3a3'); R(c, 0, 28, 16, 3, '#ff5c93'); },
  sofa: c => { R(c, 0, 4, 50, 18, '#ff6fa8'); R(c, 4, 0, 42, 10, '#ff8fbf'); R(c, 5, 1, 40, 2, '#ffc2dc'); R(c, 0, 8, 7, 14, '#d93a73'); R(c, 43, 8, 7, 14, '#d93a73'); R(c, 7, 12, 36, 2, '#ffc2dc'); R(c, 3, 22, 3, 4, '#5a3a22'); R(c, 44, 22, 3, 4, '#5a3a22'); },
  vending: c => {
    R(c, 0, 0, 26, 46, '#4aa8ff'); R(c, 0, 0, 26, 3, '#9fd0ff'); R(c, 2, 4, 16, 30, '#d4f1ff');
    const cols = ['#ff5c93', '#ffd23f', '#4cd07d', '#ff9f43'];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) R(c, 4 + k * 4, 6 + r * 7, 2, 5, cols[(r + k) % 4]);
    R(c, 20, 8, 4, 6, '#2a2238'); R(c, 20, 18, 4, 2, '#ffd23f'); R(c, 4, 37, 16, 5, '#2a2238');
  },
  plant: c => { R(c, 3, 20, 10, 10, '#c8643b'); R(c, 2, 19, 12, 3, '#e07a4a'); for (const [x, y, w, h] of [[7, 2, 2, 18], [2, 6, 5, 3], [9, 4, 6, 3], [1, 12, 6, 3], [9, 10, 6, 3], [4, 0, 3, 4]]) R(c, x, y, w, h, '#4caf50'); R(c, 8, 2, 1, 16, '#74c65a'); },
  neon: c => {
    R(c, 0, 0, 136, 30, '#2a2238'); R(c, 2, 2, 132, 26, '#3b2f6b');
    for (let x = 4; x < 132; x += 6) { R(c, x, 3, 3, 2, x % 12 ? '#ff5c93' : '#ffd23f'); R(c, x, 25, 3, 2, x % 12 ? '#ffd23f' : '#ff5c93'); }
    star(c, 12, 15, '#ffd23f'); star(c, 124, 15, '#ffd23f');
  },
  window: c => { R(c, 0, 0, 40, 26, '#fffafc'); R(c, 2, 2, 36, 20, '#bfe6ff'); R(c, 19, 2, 2, 20, '#fffafc'); R(c, 2, 11, 36, 2, '#fffafc'); R(c, 5, 5, 8, 2, '#ffffff'); R(c, 0, 22, 40, 4, '#d6cec2'); },
  poster: c => { R(c, 0, 0, 20, 26, '#ffd23f'); R(c, 2, 2, 16, 22, '#ff5c93'); star(c, 10, 10, '#fff3a3'); R(c, 4, 18, 12, 2, '#fffafc'); R(c, 6, 21, 8, 1, '#fffafc'); },
};
function star(c, cx, cy, col) { R(c, cx - 1, cy - 4, 2, 9, col); R(c, cx - 4, cy - 1, 9, 2, col); R(c, cx - 2, cy - 2, 5, 5, col); R(c, cx - 3, cy + 2, 2, 2, col); R(c, cx + 2, cy + 2, 2, 2, col); }
function building(c, p, k) {
  // wall body
  R(c, 4, 42, 80, 38, k.wall); for (let y = 46; y < 78; y += 5) R(c, 4, y, 80, 1, '#f1e2c8');
  R(c, 4, 76, 80, 4, '#d6c3a5');
  // windows
  for (const x of [12, 62]) { R(c, x, 52, 14, 14, '#fffafc'); R(c, x + 1, 53, 12, 12, '#bfe6ff'); R(c, x + 6, 53, 2, 12, '#fffafc'); R(c, x + 1, 58, 12, 2, '#fffafc'); R(c, x + 2, 54, 3, 2, '#ffffff'); R(c, x - 1, 66, 16, 2, k.trim); }
  if (k.awning) for (let x = 8; x < 80; x += 6) { R(c, x, 46, 6, 5, x % 12 ? '#ff5c93' : '#ffffff'); }
  // door
  R(c, 35, 58, 18, 22, '#8a5a36'); R(c, 37, 60, 14, 20, '#a86a35'); R(c, 48, 69, 2, 2, '#ffd23f'); R(c, 33, 56, 22, 3, k.trim);
  // sign plate (label drawn by renderer)
  R(c, 24, 44, 40, 10, '#fffafc'); R(c, 24, 44, 40, 1, k.trim);
  // roof: stepped gable with shingles
  for (let y = 0; y < 44; y++) {
    const inset = Math.max(0, Math.round((20 - y) * 1.6));
    const col = y > 38 ? k.roofDark : (y % 6 === 5 ? k.roofDark : k.roof);
    R(c, inset, y, 88 - inset * 2, 1, col);
  }
  for (let y = 4; y < 38; y += 6) { const inset = Math.max(0, Math.round((20 - y) * 1.6)); for (let x = (y / 6) % 2 ? 6 : 12; x < 82; x += 12) if (x > inset + 2 && x < 86 - inset) R(c, x, y, 1, 4, k.roofDark); }
  R(c, 34, 2, 20, 2, k.roofLight); R(c, 20, 18, 18, 2, k.roofLight);
  R(c, 66, 4, 8, 14, '#c8643b'); R(c, 65, 2, 10, 3, '#a8502f'); // chimney
}

const propCache = new Map();
export function propSprite(p) {
  const key = `${p.type}|${p.dir || 0}|${p.hue || 0}`;
  if (!propCache.has(key)) {
    const d = PROPS[p.type], flat = d.layer === 'ground';
    propCache.set(key, sprite(d.w, d.h, c => PAINT[p.type](c, p), !flat));
  }
  return propCache.get(key);
}

// ---------- avatar (16x24, 2-head chibi) ----------
const SKINS = ['#ffe0c2', '#f6c9a0', '#d9a066', '#a86a3c'];
const HAIRS = ['#3a2440', '#6b3e26', '#c8643b', '#ffd23f', '#ff6fa8', '#4aa8ff', '#9b6bff', '#f4f1ea'];
export function lookFor(player) {
  const h = hash(player.id || player.name || 'guest');
  return { skin: SKINS[h % 3], hair: HAIRS[(h >>> 3) % HAIRS.length], style: (h >>> 7) % 4, shirt: /^#[0-9a-f]{6}$/i.test(player.color || '') ? player.color : '#ff9ec4', key: `${h % 3}|${(h >>> 3) % HAIRS.length}|${(h >>> 7) % 4}|${player.color}` };
}
const shade = (col, f) => '#' + hex(col).map(v => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0')).join('');
function paintAvatar(c, L, dir, frame) {
  const y0 = frame ? 0 : 1; // walking frames lift the body by 1px. dir: 0 down, 1 up, 2 side(right)
  const shirt = L.shirt, shirtD = shade(shirt, 0.78), pants = '#3b4a7a', shoe = '#2a2238';
  // legs
  const lA = frame === 1 ? 2 : 3, lB = frame === 2 ? 2 : 3;
  if (dir === 2) {
    R(c, 6, 18 + y0, 3, lA + 1, pants); R(c, 9, 18 + y0, 3, lB + 1, shade(pants, 0.8));
    R(c, frame === 1 ? 4 : 6, 22 + y0, 4, 2, shoe); R(c, frame === 2 ? 10 : 9, 22 + y0, 4, 2, shoe);
  } else {
    R(c, 5, 18 + y0, 3, lA + 1, pants); R(c, 8, 18 + y0, 3, lB + 1, pants);
    R(c, 4, 18 + y0 + lA + 1, 4, 2, shoe); R(c, 8, 18 + y0 + lB + 1, 4, 2, shoe);
  }
  // body + arms
  R(c, 4, 13 + y0, 8, 6, shirt); R(c, 4, 17 + y0, 8, 2, shirtD);
  if (dir === 2) { R(c, 7, 14 + y0, 3, 4, shirtD); R(c, 7, 18 + y0, 3, 1, L.skin); }
  else {
    const sw = frame ? 1 : 0;
    R(c, 2, 13 + y0 + sw, 2, 4, shirt); R(c, 12, 13 + y0 + (frame ? 0 : 1) - (sw ? 1 : 0), 2, 4, shirt);
    R(c, 2, 17 + y0 + sw, 2, 1, L.skin); R(c, 12, 17 + y0, 2, 1, L.skin);
    if (dir === 0) { R(c, 7, 13 + y0, 2, 2, '#fffafc'); }
  }
  // head
  const hy = y0, hair = L.hair, hairD = shade(hair, 0.75);
  R(c, 1, 2 + hy, 14, 10, L.skin); R(c, 2, 1 + hy, 12, 12, L.skin);
  if (dir === 1) { R(c, 1, 1 + hy, 14, 11, hair); R(c, 2, 0 + hy, 12, 13, hair); R(c, 3, 3 + hy, 4, 2, shade(hair, 1.25)); R(c, 2, 11 + hy, 12, 2, hairD); }
  else if (dir === 2) {
    R(c, 1, 0 + hy, 12, 6, hair); R(c, 1, 0 + hy, 6, 12, hair); R(c, 2, 12 + hy, 4, 1, hairD); R(c, 12, 2 + hy, 3, 2, hair);
    R(c, 11, 7 + hy, 1, 2, LINE); R(c, 12, 10 + hy, 2, 1, '#ff9ec4'); R(c, 8, 9 + hy, 2, 2, L.skin);
  } else {
    R(c, 1, 0 + hy, 14, 5, hair); R(c, 2, 0 + hy, 12, 1, hair); R(c, 1, 5 + hy, 2, 5, hair); R(c, 13, 5 + hy, 2, 5, hair);
    R(c, 4, 5 + hy, 4, 1, hair); R(c, 10, 5 + hy, 2, 1, hair); R(c, 3, 1 + hy, 4, 1, shade(hair, 1.3));
    R(c, 4, 7 + hy, 2, 2, LINE); R(c, 10, 7 + hy, 2, 2, LINE); R(c, 4, 7 + hy, 1, 1, '#ffffff'); R(c, 10, 7 + hy, 1, 1, '#ffffff');
    R(c, 3, 10 + hy, 2, 1, '#ff9ec4'); R(c, 11, 10 + hy, 2, 1, '#ff9ec4'); R(c, 7, 10 + hy, 2, 1, '#d97a6a');
  }
  // hair styles
  if (L.style === 1 && dir !== 1) { R(c, 0, 4 + hy, 2, 10, hair); if (dir === 0) R(c, 14, 4 + hy, 2, 10, hair); }
  if (L.style === 1 && dir === 1) R(c, 1, 11 + hy, 14, 4, hair);
  if (L.style === 2) { R(c, -1 + 1, 1 + hy, 3, 3, hairD); if (dir !== 2) R(c, 13, 1 + hy, 3, 3, hairD); R(c, 0, 4 + hy, 2, 2, '#ff5c93'); }
  if (L.style === 3) { R(c, 1, -1 + hy + 1, 14, 3, shirtD); R(c, dir === 2 ? 12 : 3, 3 + hy, dir === 2 ? 4 : 10, 1, shirtD); }
}
const avatarCache = new Map();
export function avatarSprite(look, dir, frame) {
  const key = `${look.key}|${dir}|${frame}`;
  if (!avatarCache.has(key)) avatarCache.set(key, sprite(16, 25, c => paintAvatar(c, look, dir, frame)));
  return avatarCache.get(key);
}

// ---------- star collectible ----------
let starCv;
export function starSprite() {
  return (starCv ||= sprite(13, 13, c => {
    // 행별 [x, y, 폭] — 다리 사이를 비워 세로 막대(코처럼 보임)가 생기지 않게 한다
    [[6, 0, 1], [5, 1, 3], [5, 2, 3], [4, 3, 5], [0, 4, 13], [1, 5, 11], [2, 6, 9], [3, 7, 7], [3, 8, 7],
      [2, 9, 3], [8, 9, 3], [2, 10, 2], [9, 10, 2], [1, 11, 2], [10, 11, 2]].forEach(([x, y, w]) => R(c, x, y, w, 1, '#ffd23f'));
    R(c, 6, 1, 1, 3, '#fff3a3'); R(c, 4, 6, 1, 2, LINE); R(c, 8, 6, 1, 2, LINE);
  }));
}

// ---------- ground ----------
const GROUND = {
  lobby: { grass: ['#9fdc7c', '#95d572'], blade: '#7cc05c', flowers: ['#ffffff', '#ff9ec4', '#ffd23f', '#c9b6ff'] },
  garden: { grass: ['#84cc6c', '#7bc464'], blade: '#5ea84f', flowers: ['#ffffff', '#ff8fbf', '#fff3a3', '#9fd0ff', '#ff6fa8'] },
  arcade: { grass: ['#9fdc7c', '#95d572'], blade: '#7cc05c', flowers: [] },
};
export function paintGround(map) {
  const cv = canvas(COLS * TILE, ROWS * TILE), c = cv.getContext('2d'), pal = GROUND[map.id], rnd = seeded(hash(map.id));
  const T = (cc, r) => map.tiles[r]?.[cc];
  const isPath = ch => ch === '=' || ch === 'o' || ch === 'P';
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const ch = T(cc, r), x = cc * TILE, y = r * TILE, odd = (cc + r) % 2;
    if ('.s#F~b'.includes(ch) || (ch === 'P' && map.id === 'garden')) {
      R(c, x, y, TILE, TILE, pal.grass[odd]);
      for (let i = 0; i < 3; i++) R(c, x + Math.floor(rnd() * 15), y + Math.floor(rnd() * 14), 1, 2, pal.blade);
      if (ch === '.' && rnd() < 0.22) { const col = pal.flowers[Math.floor(rnd() * pal.flowers.length)], fx = x + 2 + Math.floor(rnd() * 11), fy = y + 2 + Math.floor(rnd() * 11); R(c, fx, fy, 2, 2, col); R(c, fx + 2, fy + 1, 1, 1, '#ffd23f'); }
    }
    if (ch === '=' || (ch === 'P' && map.id === 'lobby')) {
      R(c, x, y, TILE, TILE, '#f0d9a0');
      for (let i = 0; i < 4; i++) R(c, x + Math.floor(rnd() * 15), y + Math.floor(rnd() * 15), 2, 1, i % 2 ? '#e2c48a' : '#f7e6bd');
    }
    if (ch === 'o') {
      R(c, x, y, TILE, TILE, '#ece6dc');
      R(c, x, y + 7, TILE, 1, '#d6cec2'); R(c, x, y + 15, TILE, 1, '#d6cec2'); R(c, x + (r % 2 ? 3 : 11), y, 1, 7, '#d6cec2'); R(c, x + (r % 2 ? 11 : 3), y + 8, 1, 7, '#d6cec2');
      R(c, x + 1, y + 1, 3, 1, '#f8f5ef');
    }
    if (ch === 's') { disc(c, x + 8, y + 8, 5, 4, '#b9b0a3'); disc(c, x + 8, y + 7, 5, 3, '#e9e4dc'); R(c, x + 5, y + 5, 3, 1, '#f8f5ef'); }
    if (ch === '~') {
      R(c, x, y, TILE, TILE, '#6cc7f0');
      if (rnd() < 0.5) R(c, x + Math.floor(rnd() * 10), y + Math.floor(rnd() * 14), 5, 1, '#bfe6ff');
    }
    if (ch === 'b') { R(c, x, y, TILE, TILE, '#c68642'); for (let k = 0; k < TILE; k += 4) R(c, x + k, y, 1, TILE, '#a86a35'); R(c, x, y + 1, TILE, 1, '#e0a868'); }
    if (ch === 'F') { R(c, x, y, TILE, TILE, '#8a5a36'); R(c, x, y, TILE, 2, '#a86a35'); for (let i = 0; i < 4; i++) { const fx = x + 1 + Math.floor(rnd() * 12), fy = y + 3 + Math.floor(rnd() * 10); R(c, fx, fy + 2, 1, 2, '#4caf50'); R(c, fx - 1, fy, 3, 2, pal.flowers[(i + r) % pal.flowers.length] || '#ff8fbf'); } }
    if (ch === '#') {
      R(c, x, y, TILE, TILE, '#2e7d32'); R(c, x, y, TILE, 11, '#43a047');
      for (let i = 0; i < 5; i++) R(c, x + Math.floor(rnd() * 14), y + Math.floor(rnd() * 9), 2, 2, '#66bb55');
      R(c, x, y + 11, TILE, 1, '#1f5e24');
    }
    if (ch === 'w') { R(c, x, y, TILE, TILE, odd ? '#f4d6ff' : '#e8c6f7'); R(c, x + 2, y + 2, 3, 1, '#fff0ff'); }
    if (ch === 'r') { R(c, x, y, TILE, TILE, '#ff7eb6'); if ((cc + r) % 3 === 0) R(c, x + 7, y + 6, 2, 4, '#ffd23f'), R(c, x + 6, y + 7, 4, 2, '#ffd23f'); }
    if (ch === 'c') { R(c, x, y, TILE, TILE, '#d9536f'); R(c, x + 7, y, 2, TILE, '#e8758c'); }
    if (ch === 'W') {
      if (r <= 2 && cc > 0 && cc < COLS - 1) { // north wall face with wallpaper and wainscot
        R(c, x, y, TILE, TILE, r === 2 ? '#5a3f86' : (cc % 2 ? '#7a58ab' : '#6b4a9a'));
        if (r < 2) for (let k = 2; k < TILE; k += 8) R(c, x + k, y + (cc % 2 ? 3 : 9), 2, 2, '#9b7bd0');
        if (r === 2) { R(c, x, y, TILE, 2, '#ffd23f'); R(c, x, y + 13, TILE, 3, '#3b2f6b'); }
        if (r === 0) R(c, x, y, TILE, 3, '#3a2440');
      } else { R(c, x, y, TILE, TILE, '#3a2440'); R(c, x + (cc === 0 ? TILE - 3 : 0), y, cc === 0 || cc === COLS - 1 ? 3 : TILE, r === ROWS - 1 ? 3 : TILE, '#5a3f86'); }
    }
    if (ch === 'P' && map.id === 'arcade') { R(c, x, y, TILE, TILE, '#3a2440'); R(c, x + 1, y + 2, TILE - 2, TILE - 2, '#ff5c93'); R(c, x + 6, y + 6, 4, 4, '#fff3a3'); }
    // path edge shading where sand meets grass
    if (isPath(ch)) {
      if (!isPath(T(cc, r - 1)) && T(cc, r - 1) !== undefined) R(c, x, y, TILE, 2, ch === 'o' ? '#c9c0b2' : '#d9bb7a');
      if (!isPath(T(cc - 1, r)) && T(cc - 1, r) !== undefined) R(c, x, y, 1, TILE, ch === 'o' ? '#c9c0b2' : '#d9bb7a');
      if (!isPath(T(cc + 1, r)) && T(cc + 1, r) !== undefined) R(c, x + TILE - 1, y, 1, TILE, ch === 'o' ? '#c9c0b2' : '#d9bb7a');
    }
    // pond shoreline
    if (ch === '~') {
      if (T(cc, r - 1) !== '~' && T(cc, r - 1) !== 'b') R(c, x, y, TILE, 3, '#e9e4dc');
      if (T(cc - 1, r) !== '~' && T(cc - 1, r) !== 'b') R(c, x, y, 2, TILE, '#e9e4dc');
      if (T(cc + 1, r) !== '~' && T(cc + 1, r) !== 'b') R(c, x + TILE - 2, y, 2, TILE, '#e9e4dc');
      if (T(cc, r + 1) !== '~' && T(cc, r + 1) !== 'b') R(c, x, y + TILE - 2, TILE, 2, '#4aa8ff');
    }
    if (ch === 'b' && (T(cc, r - 1) === '~' || T(cc, r + 1) === '~')) { const top = T(cc, r - 1) === '~'; R(c, x, top ? y : y + TILE - 3, TILE, 3, '#8a5a36'); if (cc % 2) R(c, x + 6, top ? y - 4 : y + TILE - 7, 3, 7, '#7a4b2a'); }
  }
  // portal arrows on the lobby/garden mats
  for (const p of map.portals) if (map.id !== 'arcade') {
    const left = p.x < 10, ax = left ? p.x + 3 : p.x + 4, mid = p.y + p.h / 2;
    R(c, p.x, p.y, p.w, p.h, '#ffa3c4'); for (let k = 0; k < p.h; k += 8) R(c, p.x, p.y + k, p.w, 1, '#ff6fa8');
    for (let i = 0; i < 5; i++) R(c, left ? ax + i : ax + 8 - i, mid - i, 1, i * 2 + 1, '#fffafc');
  }
  // soft prop shadows, then flat wall decorations
  for (const p of map.props) {
    if (p.layer === 'ground') continue;
    const fw = p.footRect ? Math.max(8, p.footRect.w) : 0;
    if (fw) { c.globalAlpha = 0.22; disc(c, p.x, p.y - 1, Math.round(fw / 2 + 2), 3, '#2a2238'); c.globalAlpha = 1; }
  }
  for (const p of map.props) if (p.layer === 'ground') c.drawImage(propSprite(p), p.visual.x - 1, p.visual.y - 1);
  return cv;
}
