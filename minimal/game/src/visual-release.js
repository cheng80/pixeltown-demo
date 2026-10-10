import { WORLD, TICK_MS } from '../../shared/world.js';
import { EXT, LINE, FOUNTAIN_BOX, GATE_SIGN, ambience, avatar, backdrop, foreground, fountain, fountainWater, ground, lookFor, star } from './art.js';
import './style.css';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const mix = (a, b, t) => a + (b - a) * t;
const FALLBACK_FONT = ' "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const shadow = (c, x, y) => { c.globalAlpha = 0.24; c.fillStyle = LINE; c.fillRect(x - 5, y - 1, 10, 3); c.fillRect(x - 6, y, 12, 1); c.globalAlpha = 1; };
function blit(c, spr, x, y, flip) {
  if (!flip) { c.drawImage(spr, x, y); return; }
  c.save(); c.translate(x + spr.width, y); c.scale(-1, 1); c.drawImage(spr, 0, 0); c.restore();
}
const BUTTERFLIES = [['#ff9ec4', 90, 90, 0], ['#fff3a3', 560, 300, 2], ['#ffffff', 520, 110, 4], ['#c9b6ff', 110, 320, 1]];

export function createRenderer({ canvas, engine, view, fontFamily = 'Galmuri11', resources = {} }) {
  const FONT = `${fontFamily}, ${FALLBACK_FONT}`;
    const dc = canvas.getContext('2d');
    const low = document.createElement('canvas'), lc = low.getContext('2d');
    const looks = new Map(), lookOf = id => looks.get(id) || looks.set(id, lookFor(id)).get(id);
    let pops = [], lastStars = [], lastGame = null, lastScore = 0;
  // Prepare procedural art before activation. No input listeners or movement timers live here.
  ground(); backdrop(); foreground(); fountain(); star();
  for (const id of [engine.userId, ...engine.others.keys()].filter(Boolean)) avatar(lookOf(id), 0, 0);
  const draw = now => {
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return;
      // Integer zoom: 2 art px per CSS px, 3 on large screens; device pixels multiply it.
      const dpr = Math.min(window.devicePixelRatio || 1, 3), z = Math.max(1, Math.round((cw >= 1500 && ch >= 860 ? 3 : 2) * dpr));
      const devW = Math.round(cw * dpr), devH = Math.round(ch * dpr);
      if (canvas.width !== devW || canvas.height !== devH) { canvas.width = devW; canvas.height = devH; }
      const lw = Math.ceil(devW / z), lh = Math.ceil(devH / z);
      if (low.width !== lw || low.height !== lh) { low.width = lw; low.height = lh; }
      const t = clamp((now - engine.lastTick) / TICK_MS, 0, 1);
      const self = { x: mix(engine.previous.x, engine.self.x, t), y: mix(engine.previous.y, engine.self.y, t) };
      // Camera locked to the avatar in whole art px (no lag, so the avatar never wobbles against the map).
      // Title screen: frame the fountain beside (wide) or above (tall) the entry dialog.
      const focus = engine.initialized ? self : lw > 450 ? { x: WORLD.width / 2 + Math.round(lw * 0.2), y: 150 } : { x: WORLD.width / 2, y: 104 + Math.floor(lh / 2) };
      const cam = (f, size, start, total) => size >= total ? Math.floor(start - (size - total) / 2) : clamp(Math.floor(f) - Math.floor(size / 2), start, start + total - size);
      const cx = cam(focus.x, lw, EXT.x, EXT.w), cy = cam(focus.y - 12, lh, EXT.y, EXT.h);
      view.current = { x: cx, y: cy, scale: z / dpr };

      // pickup feedback: stars that vanish in the same round sparkle; my score rising pops "+n"
      const game = engine.snapshot?.game, score = Number(game?.scores?.[engine.userId]) || 0;
      if (engine.initialized && game?.active && game.id === lastGame) {
        const ids = new Set(engine.stars.map(s => s.id));
        for (const s of lastStars) if (!ids.has(s.id)) pops.push({ x: s.x, y: s.y, at: now });
        if (score > lastScore) pops.push({ x: self.x, y: self.y, at: now, text: `+${score - lastScore}` });
      }
      lastGame = game?.id || null; lastStars = engine.stars; lastScore = score;
      pops = pops.filter(p => now - p.at < 900);

      lc.imageSmoothingEnabled = false;
      lc.fillStyle = '#5a9a48'; lc.fillRect(0, 0, lw, lh);
      lc.drawImage(ground(), EXT.x - cx, EXT.y - cy);
      lc.drawImage(backdrop(), EXT.x - cx, EXT.y - cy);
      ambience(lc, now, cx, cy);
      if (engine.target && engine.connected) {
        const mx = Math.round(engine.target.x) - cx, my = Math.round(engine.target.y) - cy, b = Math.floor(now / 220) % 2;
        lc.fillStyle = '#ff5c93';
        for (const [x, y] of [[-4 - b, 0], [3 + b, 0], [0, -3 - b], [0, 2 + b]]) lc.fillRect(mx + x - 1 + (x > 0), my + y - 1 + (y > 0), 2, 2);
      }

      // y-sorted layer: fountain, stars and avatars by foot y
      const items = [{ y: FOUNTAIN_BOX.y + FOUNTAIN_BOX.h - 4, kind: 'fountain' }];
      for (const s of engine.stars) items.push({ y: s.y, kind: 'star', s });
      for (const [id, p] of engine.others) {
        items.push({ y: p.y, x: p.x, kind: 'avatar', id, name: p.name, dir: p.dir, walking: now - p.movedAt < 160 });
      }
      if (engine.initialized) items.push({ ...self, kind: 'avatar', id: engine.userId, name: engine.name, dir: engine.facing, walking: now - engine.movedAt < 120, mine: true });
      items.sort((a, b) => a.y - b.y);
      for (const it of items) {
        if (it.kind === 'fountain') { lc.drawImage(fountain(), FOUNTAIN_BOX.x - 1 - cx, FOUNTAIN_BOX.y - 1 - cy); fountainWater(lc, now, cx, cy); continue; }
        if (it.kind === 'star') {
          const s = it.s, bob = Math.round((Math.sin(now / 280 + s.x) + 1) * 1.5), x = s.x - cx, y = s.y - cy;
          lc.globalAlpha = 0.22; lc.fillStyle = LINE; lc.fillRect(x - 4 + (bob > 1), y - 1, 8 - 2 * (bob > 1), 2); lc.globalAlpha = 1;
          lc.drawImage(star(), x - 7, y - 18 - bob);
          if (Math.floor(now / 160 + s.x) % 9 === 0) { lc.fillStyle = '#ffffff'; lc.fillRect(x + 5, y - 19 - bob, 1, 3); lc.fillRect(x + 4, y - 18 - bob, 3, 1); }
          continue;
        }
        const x = Math.floor(it.x) - cx, y = Math.floor(it.y) - cy, step = it.walking ? Math.floor(now / 130) % 4 : 0;
        if (it.mine) { lc.fillStyle = '#ff5c93'; lc.fillRect(x - 7, y - 2, 14, 1); lc.fillRect(x - 7, y + 2, 14, 1); lc.fillRect(x - 9, y - 1, 2, 3); lc.fillRect(x + 7, y - 1, 2, 3); }
        shadow(lc, x, y);
        blit(lc, avatar(lookOf(it.id), it.dir === 3 ? 2 : it.dir, step), x - 9, y - 28, it.dir === 3);
        if (it.mine) { // bobbing arrow so you can find yourself in a crowd
          const b = Math.floor(now / 300) % 2, ay = y - 37 - b;
          lc.fillStyle = LINE; lc.fillRect(x - 4, ay - 1, 8, 1); lc.fillRect(x - 4, ay, 1, 1); lc.fillRect(x + 3, ay, 1, 1);
          lc.fillStyle = '#ff5c93'; lc.fillRect(x - 3, ay, 6, 2); lc.fillRect(x - 2, ay + 2, 4, 1); lc.fillRect(x - 1, ay + 3, 2, 1);
          lc.fillStyle = LINE; lc.fillRect(x - 4, ay + 1, 1, 1); lc.fillRect(x + 3, ay + 1, 1, 1); lc.fillRect(x - 3, ay + 2, 1, 1); lc.fillRect(x + 2, ay + 2, 1, 1); lc.fillRect(x - 2, ay + 3, 1, 1); lc.fillRect(x + 1, ay + 3, 1, 1); lc.fillRect(x - 1, ay + 4, 2, 1);
        }
      }
      lc.drawImage(foreground(), EXT.x - cx, EXT.y - cy);
      for (const [col, bx, by, ph] of BUTTERFLIES) {
        const x = Math.round(bx + Math.sin(now / 2600 + ph) * 46 + Math.sin(now / 900 + ph) * 8) - cx, y = Math.round(by + Math.sin(now / 1900 + ph * 2) * 24) - cy, open = Math.floor(now / 140 + ph) % 2;
        lc.fillStyle = LINE; lc.fillRect(x, y, 1, 3);
        lc.fillStyle = col; if (open) { lc.fillRect(x - 2, y - 1, 2, 2); lc.fillRect(x + 1, y - 1, 2, 2); lc.fillRect(x - 1, y + 1, 1, 1); lc.fillRect(x + 1, y + 1, 1, 1); } else { lc.fillRect(x - 1, y - 1, 1, 2); lc.fillRect(x + 1, y - 1, 1, 2); }
      }
      for (const p of pops) if (!p.text) { // four sparks fly out of a collected star
        const k = Math.min(1, (now - p.at) / 450), r = 3 + Math.round(k * 10), x = p.x - cx, y = p.y - 10 - cy;
        if (k >= 1) continue;
        lc.globalAlpha = 1 - k; lc.fillStyle = k < 0.3 ? '#ffffff' : '#ffd23f';
        for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, r * 0.7]]) lc.fillRect(Math.round(x + dx) - 1, Math.round(y + dy) - 1, 2, 2);
        lc.globalAlpha = 1;
      }

      // integer upscale, then crisp text at screen resolution
      dc.imageSmoothingEnabled = false;
      dc.drawImage(low, 0, 0, lw * z, lh * z);
      const S = (x, y) => [Math.round((x - cx) * z), Math.round((y - cy) * z)];
      const u = Math.max(1, Math.round(dpr)), fs = 12 * u, pad = 3 * u;
      dc.textBaseline = 'middle'; dc.textAlign = 'center'; dc.font = `${fs}px ${FONT}`;
      const [gx, gy] = S(GATE_SIGN.x, GATE_SIGN.y); dc.fillStyle = LINE; dc.fillText('작은 광장', gx, gy);
      for (const it of items) {
        if (it.kind !== 'avatar') continue;
        const [sx, sy] = S(Math.floor(it.x), Math.floor(it.y)), name = String(it.name || '이웃').slice(0, 12);
        const w = Math.ceil(dc.measureText(name).width) + pad * 2, h = fs + 2 * u, top = sy + 4 * u;
        if (it.mine) { dc.fillStyle = LINE; dc.fillRect(sx - Math.round(w / 2) - u, top - u, w + 2 * u, h + 2 * u); dc.fillStyle = '#ff5c93'; }
        else dc.fillStyle = 'rgba(58,36,64,.74)';
        dc.fillRect(sx - Math.round(w / 2), top, w, h);
        dc.fillStyle = '#ffffff'; dc.fillText(name, sx, top + h / 2 + u);
      }
      for (const p of pops) if (p.text) {
        const k = Math.min(1, (now - p.at) / 900), [sx, sy] = S(p.x, p.y - 44 - k * 12);
        dc.globalAlpha = 1 - k * k; dc.font = `${fs * 1.5}px ${FONT}`;
        dc.fillStyle = LINE; for (const [ox, oy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) dc.fillText(`★${p.text}`, sx + ox * u, sy + oy * u);
        dc.fillStyle = '#ffd23f'; dc.fillText(`★${p.text}`, sx, sy); dc.globalAlpha = 1; dc.font = `${fs}px ${FONT}`;
      }
    };
  return { draw, dispose() {} };
}
