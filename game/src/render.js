// Layered pixel renderer: ground (baked) -> y-sorted props/stars/avatars -> foreground -> screen-res labels.
import { getMap, WORLD } from '../../shared/world.js';
import { paintGround, propSprite, avatarSprite, starSprite, petSprite, LINE } from './sprites.js';

// Keyed by map object: zone maps are singletons, a rebuilt mini-room map gets a fresh scene.
const sceneCache = new WeakMap();
export function scene(zoneOrMap) {
  const map = typeof zoneOrMap === 'string' ? getMap(zoneOrMap) : zoneOrMap;
  if (!sceneCache.has(map)) sceneCache.set(map, { map, ground: paintGround(map), sorted: map.props.filter(p => p.layer === 'sort'), fg: map.props.filter(p => p.layer === 'fg') });
  return sceneCache.get(map);
}

// Integer zoom in CSS px per art px, chosen from the mini-room size (ADR-003).
export const pickZoom = (w, h) => Math.max(2, Math.min(4, Math.round(Math.min(w / 300, h / 196))));

// Where each prop label sits inside its sprite (sign plates).
const LABEL_AT = { house: [44, 49], shop: [44, 49], greenhouse: [40, 38], arch: [46, 8], sign: [15, 6], neon: [68, 15] };

export function createView(display) {
  const low = document.createElement('canvas'), lc = low.getContext('2d'), dc = display.getContext('2d');
  const view = { z: 3, cam: { x: 0, y: 0 }, low, debug: /debug=collision/.test(location.search) };
  view.toWorld = (cssX, cssY) => ({ x: view.cam.x + (cssX * view.dpr) / view.z, y: view.cam.y + (cssY * view.dpr) / view.z });
  view.draw = (sc, frame) => draw(view, sc, frame, lc, dc, display);
  return view;
}

function draw(view, sc, f, lc, dc, display) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3), cw = display.clientWidth, ch = display.clientHeight;
  if (!cw || !ch) return;
  // A map with a `frame` (the mini-room) is shown whole: largest integer zoom that fits it.
  const fr = sc.map.frame, zCss = fr ? Math.max(1, Math.min(4, Math.floor(Math.min(cw / fr.w, ch / fr.h)))) : pickZoom(cw, ch), z = Math.max(1, Math.round(zCss * dpr));
  const devW = Math.round(cw * dpr), devH = Math.round(ch * dpr);
  if (display.width !== devW || display.height !== devH) { display.width = devW; display.height = devH; }
  const lw = Math.ceil(devW / z), lh = Math.ceil(devH / z);
  if (view.low.width !== lw || view.low.height !== lh) { view.low.width = lw; view.low.height = lh; }
  Object.assign(view, { z, dpr, zCss });

  // camera: follow the local avatar, clamp to the map, centre small maps
  const focus = fr ? { x: fr.x + fr.w / 2, y: fr.y + fr.h / 2 + 12 } : f.focus || sc.map.spawn;
  // Camera locked to the avatar in whole art pixels: both use floor() with an integer offset, so the avatar never wobbles
  // a pixel against the screen while the map scrolls (a lagging, separately rounded camera made the view shake).
  const hx = Math.floor(lw / 2), hy = Math.floor(lh / 2) + 12;
  const cx = WORLD.width <= lw ? Math.floor((WORLD.width - lw) / 2) : Math.max(0, Math.min(WORLD.width - lw, Math.floor(focus.x) - hx));
  const cy = WORLD.height <= lh ? Math.floor((WORLD.height - lh) / 2) : Math.max(0, Math.min(WORLD.height - lh, Math.floor(focus.y) - hy));
  view.cam = { x: cx, y: cy };

  lc.imageSmoothingEnabled = false;
  lc.fillStyle = sc.map.id === 'arcade' ? '#2a2238' : '#3a2440';
  lc.fillRect(0, 0, lw, lh);
  lc.drawImage(sc.ground, -cx, -cy);

  // animated water glints on the ground layer
  if (sc.map.id === 'garden') for (let i = 0; i < 10; i++) {
    const gx = 190 + ((i * 53) % 170), gy = 160 + ((i * 37) % 110), on = Math.floor(f.time / 400 + i) % 3 === 0;
    if (on && sc.map.tiles[Math.floor(gy / 16)][Math.floor(gx / 16)] === '~') { lc.fillStyle = '#ffffff'; lc.fillRect(gx - cx, gy - cy, 3, 1); }
  }

  if (f.marker) { // click destination
    const mx = Math.round(f.marker.x) - cx, my = Math.round(f.marker.y) - cy, b = Math.floor(f.time / 250) % 2;
    lc.fillStyle = '#ff5c93'; lc.fillRect(mx - 3 - b, my - 1, 2, 2); lc.fillRect(mx + 1 + b, my - 1, 2, 2); lc.fillRect(mx - 1, my - 3 - b, 2, 2); lc.fillRect(mx - 1, my + 1 + b, 2, 2);
  }

  // y-sorted layer: props, stars and avatars by foot y (props first on ties)
  const items = [];
  for (const p of sc.sorted) items.push({ y: p.y, o: 0, p });
  for (const s of f.stars || []) items.push({ y: s.y, o: 1, s });
  for (const a of f.avatars) { items.push({ y: a.y, o: 2, a }); if (a.pet) items.push({ y: a.pet.y, o: 2, pet: a.pet }); }
  items.sort((a, b) => a.y - b.y || a.o - b.o);
  for (const it of items) {
    if (it.pet) {
      const q = it.pet, spr = petSprite(q.id, q.frame);
      if (!spr) continue;
      lc.globalAlpha = 0.25; lc.fillStyle = '#2a2238'; lc.fillRect(Math.floor(q.x) - 4 - cx, Math.floor(q.y) - 1 - cy, 8, 2); lc.globalAlpha = 1;
      const dx = Math.floor(q.x) - 7 - cx, dy = Math.floor(q.y) - 13 - cy;
      if (q.flip) { lc.save(); lc.translate(dx + spr.width, dy); lc.scale(-1, 1); lc.drawImage(spr, 0, 0); lc.restore(); }
      else lc.drawImage(spr, dx, dy);
    } else if (it.p) {
      const p = it.p;
      lc.drawImage(propSprite(p), p.visual.x - 1 - cx, p.visual.y - 1 - cy);
      if (p.type === 'fountain') for (let i = 0; i < 6; i++) {
        const a = f.time / 500 + i * 1.05, sx = Math.round(p.x + Math.cos(a) * 16), sy = Math.round(p.y - 9 + Math.sin(a) * 5);
        lc.fillStyle = i % 2 ? '#ffffff' : '#bfe6ff'; lc.fillRect(sx - cx, sy - cy, 1, 2);
      }
    } else if (it.s) {
      const s = it.s, bob = Math.round(Math.abs(Math.sin(f.time / 260 + s.x)) * 3);
      lc.globalAlpha = 0.25; lc.fillStyle = '#2a2238'; lc.fillRect(s.x - 5 - cx, s.y - 1 - cy, 10, 2); lc.globalAlpha = 1;
      lc.drawImage(starSprite(), s.x - 7 - cx, s.y - 16 - bob - cy);
    } else {
      const a = it.a;
      lc.globalAlpha = 0.25; lc.fillStyle = '#2a2238'; lc.fillRect(Math.floor(a.x) - 5 - cx, Math.floor(a.y) - 2 - cy, 10, 3); lc.fillRect(Math.floor(a.x) - 6 - cx, Math.floor(a.y) - 1 - cy, 12, 1); lc.globalAlpha = 1;
      const spr = avatarSprite(a.look, a.dir === 3 ? 2 : a.dir, a.frame);
      const dx = Math.floor(a.x) - 9 - cx, dy = Math.floor(a.y) - 30 - cy;
      if (a.dir === 3) { lc.save(); lc.translate(dx + spr.width, dy); lc.scale(-1, 1); lc.drawImage(spr, 0, 0); lc.restore(); }
      else lc.drawImage(spr, dx, dy);
    }
  }
  for (const p of sc.fg) lc.drawImage(propSprite(p), p.visual.x - 1 - cx, p.visual.y - 1 - cy);
  for (const p of f.pops || []) { // star pickup sparkle: four dots fly out from the star for 0.4s
    const k = Math.min(1, (Date.now() - p.at) / 400), r = 3 + Math.round(k * 9), x = p.x - cx, y = p.y - 10 - cy;
    lc.globalAlpha = 1 - k; lc.fillStyle = '#ffd23f';
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) lc.fillRect(x + dx - 1, y + dy - 1, 2, 2);
    lc.globalAlpha = 1;
  }

  if (view.debug) { // collision overlay for verification screenshots
    lc.globalAlpha = 0.45;
    for (const p of sc.map.props) {
      if (p.layer === 'ground') continue;
      lc.strokeStyle = '#4aa8ff'; lc.strokeRect(p.visual.x - cx + 0.5, p.visual.y - cy + 0.5, p.visual.w - 1, p.visual.h - 1);
      if (p.footRect) { lc.fillStyle = '#e0344f'; lc.fillRect(p.footRect.x - cx, p.footRect.y - cy, p.footRect.w, p.footRect.h); }
    }
    lc.fillStyle = '#e0344f';
    for (let r = 0; r < 26; r++) for (let c = 0; c < 40; c++) if (sc.map.solid[r * 40 + c]) lc.fillRect(c * 16 - cx + 6, r * 16 - cy + 6, 4, 4);
    lc.globalAlpha = 1;
  }

  // upscale by an integer factor, then draw text at screen resolution
  dc.imageSmoothingEnabled = false;
  dc.drawImage(view.low, 0, 0, lw * z, lh * z);
  const S = (x, y) => [Math.round((x - cx) * z), Math.round((y - cy) * z)];
  const fs = Math.round(11 * dpr), pad = Math.round(3 * dpr), u = Math.max(1, Math.round(dpr));
  dc.textBaseline = 'middle'; dc.textAlign = 'center';
  for (const p of sc.map.props) {
    if (!p.label || !LABEL_AT[p.type]) continue;
    const [ox, oy] = LABEL_AT[p.type], [sx, sy] = S(p.visual.x + ox, p.visual.y + oy);
    const size = p.type === 'neon' ? Math.round(Math.max(12 * dpr, 3.6 * z)) : Math.round(Math.max(11 * dpr, 3.4 * z));
    dc.font = `${size}px Galmuri11, monospace`;
    if (p.type === 'neon') { dc.fillStyle = '#ff5c93'; dc.fillText(p.label, sx + u, sy + u); dc.fillStyle = '#fff3a3'; }
    else dc.fillStyle = LINE;
    dc.fillText(p.label, sx, sy);
  }
  dc.font = `${fs}px Galmuri11, monospace`;
  for (const a of f.avatars) {
    const [sx, sy] = S(Math.floor(a.x), Math.floor(a.y)); // same whole-pixel spot as the sprite
    const w = Math.ceil(dc.measureText(a.name).width) + pad * 2, h = fs + pad + u;
    dc.fillStyle = a.self ? '#ff5c93' : 'rgba(58,36,64,.82)';
    dc.fillRect(sx - Math.round(w / 2), sy + 2 * u, w, h);
    dc.fillStyle = '#ffffff'; dc.fillText(a.name, sx, sy + 2 * u + h / 2 + u / 2);
    const top = sy - (a.look?.hat ? 32 : 28) * z;
    if (a.bubble) bubble(dc, sx, top, a.bubble, fs, pad, u);
    else if (a.emote) { dc.font = `${Math.round(18 * dpr)}px Galmuri11, sans-serif`; dc.fillStyle = '#ff5c93'; dc.fillText('♥', sx, top - 4 * u); dc.font = `${fs}px Galmuri11, monospace`; }
  }
}

function bubble(dc, x, bottom, text, fs, pad, u) {
  const t = text.length > 18 ? text.slice(0, 17) + '…' : text;
  const w = Math.ceil(dc.measureText(t).width) + pad * 4, h = fs + pad * 2 + u, l = Math.round(x - w / 2), top = bottom - h - 5 * u;
  dc.fillStyle = LINE; dc.fillRect(l - 2 * u, top - 2 * u, w + 4 * u, h + 4 * u);
  dc.fillStyle = '#ffffff'; dc.fillRect(l, top, w, h);
  dc.fillStyle = LINE; dc.fillRect(x - 3 * u, top + h + 2 * u, 6 * u, 2 * u); dc.fillRect(x - u, top + h + 4 * u, 2 * u, 2 * u);
  dc.fillStyle = '#ffffff'; dc.fillRect(x - u, top + h, 2 * u, 2 * u + u);
  dc.fillStyle = LINE; dc.fillText(t, x, top + h / 2 + u / 2);
}
