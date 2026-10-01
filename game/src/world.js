export const OBSTACLES=[[128,116,151,93],[664,119,148,94],[669,445,130,80],[158,450,123,78],[404,284,145,81]];
export const blocked=(x,y,pad=14)=>OBSTACLES.some(([rx,ry,w,h])=>x>rx-pad&&x<rx+w+pad&&y>ry-pad&&y<ry+h+pad);
export function soloStar(id){for(let i=0;i<1000;i++){const x=48+Math.random()*864,y=48+Math.random()*544;if(!blocked(x,y,40))return {id,x,y};}return {id,x:480,y:430};}
export const WORLD = { width: 960, height: 640 };
const palettes = {
  lobby: ["#89ba70", "#95c47c", "#79ab63"],
  garden: ["#7cab70", "#88b67a", "#689961"],
  arcade: ["#86ada0", "#91b8a8", "#739c8c"],
};
const rect = (c, x, y, w, h, color) => {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), w, h);
};
function tree(c, x, y, scale = 1) {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  rect(c, -21, 6, 48, 12, "#568552");
  rect(c, -4, -17, 9, 34, "#775d42");
  rect(c, 2, -15, 3, 31, "#9b7851");
  for (const [a, b, w, h, col] of [
    [-23, -48, 46, 28, "#386d4b"],
    [-29, -42, 56, 23, "#437e50"],
    [-22, -58, 41, 27, "#4a8854"],
    [-13, -65, 26, 24, "#5b975a"],
    [-20, -48, 20, 7, "#6eab64"],
    [-11, -60, 17, 6, "#80b86c"],
    [9, -35, 15, 7, "#326546"],
  ])
    rect(c, a, b, w, h, col);
  c.restore();
}
function building(c, x, y, w, h, roof, label) {
  rect(c, x + 6, y + 16, w + 8, h + 7, "#659457");
  rect(c, x, y, w, h, "#f2e6c6");
  rect(c, x, y + h - 8, w, 8, "#c9b995");
  rect(c, x + 5, y + 5, w - 10, h - 17, "#e9d9b7");
  rect(c, x - 6, y - 22, w + 12, 31, "#784a43");
  rect(c, x - 10, y - 27, w + 20, 25, roof);
  rect(c, x - 4, y - 32, w + 8, 8, roof);
  for (let i = 0; i < w; i += 14) rect(c, x + i, y - 21, 2, 16, "#ffffff19");
  rect(c, x - 10, y - 4, w + 20, 5, "#462f34");
  for (let i = 15; i < w - 16; i += 34) {
    rect(c, x + i, y + 18, 22, 26, "#ab997b");
    rect(c, x + i + 2, y + 20, 18, 20, "#507c80");
    rect(c, x + i + 3, y + 21, 7, 8, "#acd7cd");
    rect(c, x + i + 10, y + 20, 2, 20, "#e9d9b7");
  }
  rect(c, x + w / 2 - 10, y + h - 35, 20, 35, "#6b7161");
  rect(c, x + w / 2 - 7, y + h - 32, 14, 32, "#414f4d");
  rect(c, x + w / 2 + 4, y + h - 16, 2, 3, "#eac98b");
  rect(c, x + w / 2 - 27, y + 1, 54, 12, "#ffefd1");
  c.fillStyle = "#635d4c";
  c.font = "7px monospace";
  c.textAlign = "center";
  c.fillText(label, x + w / 2, y + 10);
}
function flower(c, x, y, col) {
  rect(c, x, y, 2, 6, "#55804a");
  rect(c, x - 2, y - 2, 6, 3, col);
  rect(c, x, y - 4, 2, 7, col);
  rect(c, x, y - 1, 2, 2, "#fce6a1");
}
function bench(c, x, y) {
  rect(c, x + 3, y + 8, 3, 8, "#5c6552");
  rect(c, x + 29, y + 8, 3, 8, "#5c6552");
  rect(c, x, y, 36, 4, "#ae8051");
  rect(c, x, y + 5, 36, 4, "#c39763");
  rect(c, x - 2, y + 10, 40, 4, "#9a7149");
}
export function createTerrain(zone) {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 640;
  const c = canvas.getContext("2d");
  const p = palettes[zone] || palettes.lobby;
  rect(c, 0, 0, 960, 640, p[0]);
  let seed = 47;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 5500; i++) {
    const x = rand() * 960,
      y = rand() * 640;
    rect(c, x, y, rand() > 0.7 ? 3 : 1, 2, p[Math.floor(rand() * 3)]);
  }
  // Sunlit stone promenade with inset edging and small paving joints.
  rect(c, 0, 291, 960, 86, "#769760");
  rect(c, 0, 296, 960, 76, "#dfd3af");
  rect(c, 434, 0, 86, 640, "#769760");
  rect(c, 439, 0, 76, 640, "#dfd3af");
  rect(c, 282, 206, 392, 248, "#d0c39e");
  rect(c, 287, 211, 382, 238, "#e5d9b6");
  for (let y = 0; y < 640; y += 20)
    for (let x = 0; x < 960; x += 26) {
      if (
        (y > 298 && y < 368) ||
        (x > 440 && x < 513) ||
        (x > 289 && x < 666 && y > 213 && y < 447)
      ) {
        rect(c, x + (y % 40 ? 13 : 0), y, 20, 1, "#cabb981f");
        rect(c, x, y, 1, 13, "#b9ab8d26");
      }
    }
  building(c, 128, 116, 151, 93, "#cc795b", "TOWN HALL");
  building(
    c,
    664,
    119,
    148,
    94,
    zone === "arcade" ? "#9276a9" : "#687f95",
    "STAR ARCADE",
  );
  building(c, 669, 445, 130, 80, "#bf9270", "LITTLE CAFE");
  building(c, 158, 450, 123, 78, "#90a478", "GREEN HOUSE");
  for (const [x, y, s] of [
    [48, 109, 1.3],
    [335, 136, 1.05],
    [577, 140, 1.12],
    [899, 118, 1.35],
    [62, 247, 1],
    [876, 259, 1.1],
    [83, 467, 1.2],
    [350, 543, 1],
    [580, 548, 1.1],
    [887, 513, 1.4],
    [35, 623, 1.1],
    [925, 632, 1.2],
    [300, 45, 0.85],
    [618, 46, 0.85],
  ])
    tree(c, x, y, s);
  for (const [x, y] of [
    [309, 260],
    [603, 260],
    [309, 410],
    [603, 410],
  ]) {
    rect(c, x - 7, y - 9, 49, 22, "#718d59");
    rect(c, x - 4, y - 6, 43, 16, "#597d51");
    for (let i = 0; i < 10; i++)
      flower(
        c,
        x + rand() * 34,
        y + rand() * 8,
        ["#efd18d", "#e8a29a", "#fff0d0"][i % 3],
      );
  }
  bench(c, 339, 246);
  bench(c, 574, 246);
  bench(c, 339, 411);
  bench(c, 574, 411);
  for (const [x, y] of [
    [307, 310],
    [645, 310],
    [422, 187],
    [519, 467],
  ]) {
    rect(c, x - 3, y, 6, 6, "#746f5b");
    rect(c, x - 1, y - 30, 2, 31, "#4b5c52");
    rect(c, x - 5, y - 37, 10, 9, "#f8e6a5");
    rect(c, x - 6, y - 39, 12, 3, "#44574d");
    rect(c, x - 6, y - 28, 12, 2, "#44574d");
  }
  // Rounded pool rendered in deliberate pixel steps.
  rect(c, 412, 296, 129, 69, "#b3a78c");
  rect(c, 404, 308, 145, 45, "#b3a78c");
  rect(c, 413, 299, 127, 62, "#f4e9cb");
  rect(c, 407, 311, 139, 38, "#f4e9cb");
  rect(c, 417, 306, 118, 47, "#659da0");
  rect(c, 411, 314, 130, 29, "#659da0");
  rect(c, 422, 311, 109, 36, "#82c4c0");
  rect(c, 426, 318, 95, 3, "#b1e1ce");
  rect(c, 421, 337, 107, 2, "#afe0d0");
  rect(c, 468, 313, 19, 31, "#c2c8b2");
  rect(c, 464, 310, 27, 7, "#f5eacc");
  rect(c, 473, 287, 9, 26, "#e2dec3");
  rect(c, 464, 284, 27, 7, "#f7ebca");
  rect(c, 470, 281, 15, 4, "#c9d6c5");
  for (let i = 0; i < 85; i++) {
    let x = rand() * 960,
      y = rand() * 640;
    if ((x < 280 || x > 680) && (y < 80 || y > 550))
      flower(c, x, y, ["#fff2c7", "#d99998", "#b8cee9"][i % 3]);
  }
  return canvas;
}
function person(c, p, time, moving, self) {
  const x = Math.round(p.x),
    y = Math.round(p.y),
    step = moving ? Math.sin(time / 95) * 2 : 0;
  rect(c, x - 8, y + 6, 19, 5, "#35563a50");
  rect(c, x - 5, y + 1, 4, 8 + step, "#344b54");
  rect(c, x + 2, y + 1, 4, 8 - step, "#344b54");
  rect(c, x - 6, y + 8 + step, 5, 3, "#f3e7ca");
  rect(c, x + 2, y + 8 - step, 5, 3, "#f3e7ca");
  rect(c, x - 8, y - 11, 16, 14, p.color || "#dc9471");
  rect(c, x - 10, y - 8, 3, 9, "#edc09e");
  rect(c, x + 8, y - 8, 3, 9, "#edc09e");
  rect(c, x - 6, y - 24, 13, 14, "#f5cba6");
  rect(c, x - 7, y - 25, 15, 5, "#54493f");
  rect(c, x - 7, y - 20, 3, 5, "#54493f");
  rect(c, x + 2, y - 17, 2, 2, "#3e4c45");
  rect(c, x - 3, y - 17, 2, 2, "#3e4c45");
  rect(c, x - 3, y - 10, 6, 2, "#edb08c");
  if (self) {
    rect(c, x - 3, y - 36, 7, 3, "#fff1bd");
    rect(c, x - 1, y - 33, 3, 3, "#fff1bd");
  }
  c.font = "bold 9px system-ui";
  c.textAlign = "center";
  const name = p.name || "방문자";
  const w = c.measureText(name).width + 12;
  rect(c, x - w / 2, y + 17, w, 15, self ? "#24483ee8" : "#24483eb0");
  c.fillStyle = "#fff6df";
  c.fillText(name, x, y + 28);
}
export function renderWorld(
  c,
  terrain,
  players,
  selfId,
  stars,
  time,
  camera,
  emotes,
  scale,
) {
  c.imageSmoothingEnabled = false;
  c.setTransform(scale, 0, 0, scale, -camera.x * scale, -camera.y * scale);
  c.drawImage(terrain, 0, 0);
  for (const s of stars || []) {
    const pulse = Math.sin(time / 230 + s.x) * 2;
    c.fillStyle = "#6a864b44";
    c.fillRect(s.x - 7, s.y + 7, 14, 4);
    c.fillStyle = "#fff0a1";
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2,
        r = i % 2 ? 4 : 9;
      c.lineTo(
        Math.round(s.x + Math.cos(a) * r),
        Math.round(s.y + Math.sin(a) * r + pulse),
      );
    }
    c.closePath();
    c.fill();
    rect(c, s.x - 1, s.y - 3 + pulse, 3, 5, "#fff9d7");
  }
  // Water sparkle and gently drifting fountain spray.
  for (let i = 0; i < 8; i++) {
    const a = time / 650 + i * 0.8;
    rect(c, 476 + Math.cos(a) * 23, 298 + Math.sin(a) * 8, 2, 4, "#e4fff2");
  }
  for (const p of [...players].sort((a, b) => a.y - b.y)) {
    person(c, p, time, p.moving, p.id === selfId);
    const e = emotes[p.id];
    if (e && e.until > Date.now()) {
      c.font = "21px serif";
      c.textAlign = "center";
      c.fillText(e.text || "♥", p.x, p.y - 43);
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
}
