// Isolated localhost development API. Never load the legacy pb_hooks tree.
routerAdd("POST", "/api/minimal/guest", (e) => {
  const body = e.requestInfo().body;
  const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  const key = name.replace(/[ _-]/g, "").toLowerCase();
  if (name.length < 2 || name.length > 12 || !/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 _-]+$/.test(name) || !key) {
    throw new BadRequestError("닉네임은 한글·영문·숫자·공백·_·-로 2–12자여야 합니다.");
  }
  const reserved = ["관리자", "운영자", "운영팀", "픽셀타운", "admin", "system", "moderator", "pixeltown"];
  if (reserved.some((word) => key.indexOf(word) >= 0)) throw new BadRequestError("운영진으로 오해할 수 있는 이름은 사용할 수 없습니다.");
  if (typeof body.password !== "string" || body.password.length < 32 || body.password.length > 128) {
    throw new BadRequestError("비밀번호는 32–128자여야 합니다.");
  }
  let user;
  try {
    e.app.runInTransaction((tx) => {
      user = new Record(tx.findCollectionByNameOrId("users"));
      user.setEmail("guest-" + $security.randomString(24).toLowerCase() + "@minimal.pixeltown.local");
      user.setPassword(body.password);
      user.setVerified(true);
      user.set("name", name);
      tx.save(user);
      const profile = new Record(tx.findCollectionByNameOrId("profiles"));
      profile.set("user", user.id);
      profile.set("name", name);
      tx.save(profile);
    });
  } catch (err) {
    if (String(err).toLowerCase().indexOf("unique") >= 0) {
      throw new BadRequestError("이미 쓰는 닉네임입니다.", { name: "taken" });
    }
    throw err;
  }
  return $apis.recordAuthResponse(e, user, "password");
}, $apis.bodyLimit(2048));

routerAdd("GET", "/api/minimal/wallet", (e) => {
  let wallet;
  e.app.runInTransaction((tx) => {
    const profile = tx.findFirstRecordByFilter("profiles", "user = {:user}", { user: e.auth.id });
    // An unlimited query is deliberate: the balance and confirmation IDs must
    // cover the same complete ledger in the same DB snapshot.
    const rows = tx.findRecordsByFilter("inventory", "user = {:user} && item = 'star'", "match_id", 0, 0, { user: e.auth.id });
    wallet = { balance: 0, settledMatchIds: [], profile: { name: profile.getString("name") } };
    for (const row of rows) {
      wallet.balance += row.getInt("quantity");
      wallet.settledMatchIds.push(row.getString("match_id"));
    }
  });
  return e.json(200, wallet);
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/minimal/commit-match", (e) => {
  const body = e.requestInfo().body;
  if (typeof body.match_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.match_id) ||
      body.zone !== "lobby" || typeof body.ended_at !== "string" ||
      !body.scores || typeof body.scores !== "object" || Array.isArray(body.scores)) throw new BadRequestError("Invalid match");
  const date = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(body.ended_at);
  const ended = Date.parse(body.ended_at);
  if (!date || !Number.isFinite(ended) || +date[1] < 1000 || +date[2] < 1 || +date[2] > 12 || +date[3] < 1 ||
      +date[3] > new Date(Date.UTC(+date[1], +date[2], 0)).getUTCDate()) throw new BadRequestError("Invalid ended_at");
  const match = body.match_id.toLowerCase();
  const entries = Object.entries(body.scores).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  if (!entries.length || entries.length > 64) throw new BadRequestError("Invalid participants");
  let total = 0;
  for (const [user, score] of entries) {
    if (!/^[a-z0-9]{15}$/.test(user) || !Number.isInteger(score) || score < 1 || score > 64) throw new BadRequestError("Invalid score");
    total += score;
  }
  if (total > 64) throw new BadRequestError("Invalid total score");
  e.app.runInTransaction((tx) => {
    // Missing/deleted players fail the whole transaction, including replays.
    for (const [user] of entries) tx.findRecordById("users", user);
    const results = tx.findRecordsByFilter("results", "match_id = {:match}", "user", 65, 0, { match: match });
    const inventory = tx.findRecordsByFilter("inventory", "match_id = {:match}", "user", 65, 0, { match: match });
    if (results.length || inventory.length) {
      // Compare the entire match, not just submitted rows: subsets, supersets,
      // changed timestamps and partial/corrupted ledgers must never succeed.
      if (results.length !== entries.length || inventory.length !== entries.length) throw new BadRequestError("Conflicting match replay");
      for (let i = 0; i < entries.length; i++) {
        const [user, score] = entries[i], result = results[i], item = inventory[i];
        if (result.getString("user") !== user || item.getString("user") !== user ||
            result.getInt("score") !== score || result.getString("zone") !== body.zone ||
            result.getDateTime("ended_at").time().unixMilli() !== ended ||
            item.getString("item") !== "star" || item.getInt("quantity") !== score) throw new BadRequestError("Conflicting match replay");
      }
      return;
    }
    const resultCollection = tx.findCollectionByNameOrId("results");
    const inventoryCollection = tx.findCollectionByNameOrId("inventory");
    for (const [user, score] of entries) {
      const result = new Record(resultCollection);
      result.set("user", user);
      result.set("match_id", match);
      result.set("score", score);
      result.set("zone", body.zone);
      result.set("ended_at", new Date(ended).toISOString());
      tx.save(result);
      const item = new Record(inventoryCollection);
      item.set("user", user);
      item.set("match_id", match);
      item.set("item", "star");
      item.set("quantity", score);
      tx.save(item);
    }
  });
  return e.json(200, { ok: true, match_id: match });
}, $apis.requireSuperuserAuth(), $apis.bodyLimit(16384));

// Explicitly suspend every legacy mutation, including guest/profile/shop/room
// and cleanup endpoints, regardless of whether the caller is a superuser.
for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
  routerAdd(method, "/api/pixeltown/{path...}", () => {
    throw new ForbiddenError("최소 게임 모드에서는 이 기능이 보류되었습니다.");
  });
}
