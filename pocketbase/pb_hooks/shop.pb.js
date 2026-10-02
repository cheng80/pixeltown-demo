// Star shop (ADR-004). Signed-in users spend stars from their own ledger; prices come from the catalogue only.
routerAdd("POST", "/api/pixeltown/shop/buy", (e) => {
  const lib = require(`${__hooks}/shop_lib.js`);
  const user = e.auth.id, body = e.requestInfo().body, item = lib.catalog().items.find(i => i.id === body.item);
  if (!item) throw new BadRequestError("알 수 없는 아이템이에요.");
  let left = 0;
  $app.runInTransaction((tx) => {
    if (tx.findRecordsByFilter("purchases", "user = {:user} && item = {:item}", "", 1, 0, { user: user, item: item.id }).length) throw new BadRequestError("이미 가지고 있어요.");
    const record = new Record(tx.findCollectionByNameOrId("purchases"));
    record.set("user", user); record.set("item", item.id); record.set("price", item.price);
    tx.save(record);
    // Write first, then re-read the wallet inside the same transaction: concurrent buys cannot overspend.
    left = lib.balance(tx, user);
    if (left < 0) throw new BadRequestError("별이 부족해요.");
  });
  return e.json(200, { ok: true, item: item.id, balance: left });
}, $apis.requireAuth("users"), $apis.bodyLimit(4096));

routerAdd("POST", "/api/pixeltown/shop/equip", (e) => {
  const lib = require(`${__hooks}/shop_lib.js`);
  const user = e.auth.id, body = e.requestInfo().body, items = lib.catalog().items, outfit = {};
  $app.runInTransaction((tx) => {
    const own = lib.owned(tx, user);
    for (const slot of ["hat", "top", "pet"]) {
      const id = body[slot];
      if (id === null || id === undefined || id === "") { outfit[slot] = null; continue; }
      const it = items.find(i => i.id === id);
      if (!it || it.slot !== slot || !own[id]) throw new BadRequestError("가지고 있는 아이템만 입을 수 있어요.");
      outfit[slot] = id;
    }
    const profile = tx.findFirstRecordByFilter("profiles", "user = {:user}", { user: user });
    profile.set("outfit", outfit);
    tx.save(profile);
  });
  return e.json(200, { ok: true, outfit: outfit });
}, $apis.requireAuth("users"), $apis.bodyLimit(4096));

routerAdd("POST", "/api/pixeltown/shop/room", (e) => {
  const lib = require(`${__hooks}/shop_lib.js`);
  const user = e.auth.id, body = e.requestInfo().body, cat = lib.catalog();
  const placements = Array.isArray(body.placements) ? body.placements.map(p => ({ item: p && p.item, c: p && p.c, r: p && p.r })) : null;
  $app.runInTransaction((tx) => {
    const problem = lib.validateRoom(cat, placements, lib.owned(tx, user));
    if (problem) throw new BadRequestError(problem);
    const profile = tx.findFirstRecordByFilter("profiles", "user = {:user}", { user: user });
    profile.set("room", placements);
    tx.save(profile);
  });
  return e.json(200, { ok: true, placements: placements });
}, $apis.requireAuth("users"), $apis.bodyLimit(16384));
