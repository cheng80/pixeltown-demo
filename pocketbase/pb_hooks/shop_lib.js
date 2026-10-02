// Helpers for shop.pb.js (CommonJS, loaded with require inside each handler).
// Same catalogue and room rules as shared/world.js (roomProblem); colyseus/test/shop.test.js checks they agree.
// Repo layout reads shared/catalog.json; a server install copies it next to the hooks (pb_hooks/catalog.json).
function catalog() {
  let raw;
  try { raw = $os.readFile(__hooks + "/catalog.json"); } catch (e) { raw = $os.readFile(__hooks + "/../../shared/catalog.json"); }
  return JSON.parse(toString(raw));
}
function rows(tx, collection, user) {
  return tx.findRecordsByFilter(collection, "user = {:user}", "", 0, 0, { user: user });
}
// Wallet = stars earned from settled matches - stars spent in the shop.
function balance(tx, user) {
  let earned = 0, spent = 0;
  for (const r of rows(tx, "inventory", user)) if (r.getString("item") === "star") earned += r.getInt("quantity");
  for (const r of rows(tx, "purchases", user)) spent += r.getInt("price");
  return earned - spent;
}
function owned(tx, user) {
  const set = {};
  for (const r of rows(tx, "purchases", user)) set[r.getString("item")] = true;
  return set;
}
function overlaps(a, b) { return a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h; }
// Returns an error message or null. `own` is { itemId: true }.
function validateRoom(cat, placements, own) {
  if (!Array.isArray(placements) || placements.length > cat.home.maxPlacements) return "가구가 너무 많아요.";
  const f = cat.home.floor, d = cat.home.door, door = { c: d[0], r: d[1], w: d[2] - d[0] + 1, h: d[3] - d[1] + 1 };
  const boxes = [], seen = {};
  for (const p of placements) {
    const it = p && cat.items.find(i => i.id === p.item);
    if (!it || it.slot !== "furniture" || !Number.isInteger(p.c) || !Number.isInteger(p.r)) return "알 수 없는 가구예요.";
    if (!own[p.item]) return it.name + "은(는) 아직 없어요.";
    if (seen[p.item]) return it.name + "은(는) 하나만 놓을 수 있어요.";
    seen[p.item] = true;
    const b = { c: p.c, r: p.r, w: it.cells[0], h: it.cells[1], flat: Boolean(it.flat) };
    if (b.c < f[0] || b.r < f[1] || b.c + b.w - 1 > f[2] || b.r + b.h - 1 > f[3]) return "바닥 밖에는 놓을 수 없어요.";
    if (overlaps(b, door)) return "문 앞은 비워 두어야 해요.";
    if (!b.flat && boxes.some(o => overlaps(o, b))) return "다른 가구와 겹쳐요.";
    if (!b.flat) boxes.push(b);
  }
  return null;
}
// Character set-up (FR-014). Returns { profile } with cleaned values or { error }. Only catalogue choices are accepted.
function cleanProfile(cat, body) {
  const a = cat.avatar, av = (body && body.avatar) || {};
  const name = body && typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  const length = [...name].length;
  if (length < a.nameMin || length > a.nameMax) return { error: "닉네임은 " + a.nameMin + "–" + a.nameMax + "자로 지어 주세요." };
  if (!/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 _-]+$/.test(name)) return { error: "닉네임에는 한글·영문·숫자·공백·_·-만 쓸 수 있어요." };
  const lower = name.toLowerCase();
  if (a.reserved.some(w => lower.replace(/\s/g, "").indexOf(w) >= 0)) return { error: "운영진으로 오해할 수 있는 이름은 쓸 수 없어요." };
  if (a.shirts.indexOf(body.color) < 0) return { error: "고를 수 있는 옷 색이 아니에요." };
  const pick = (v, list) => Number.isInteger(v) && v >= 0 && v < list.length;
  if (!pick(av.skin, a.skins) || !pick(av.hair, a.hairs) || !pick(av.style, a.styles)) return { error: "고를 수 없는 모습이에요." };
  return { profile: { name: name, color: body.color, avatar: { skin: av.skin, hair: av.hair, style: av.style } } };
}
module.exports = { catalog, balance, owned, validateRoom, cleanProfile };
