// Character set-up (FR-014). Signed-in users set their own nickname, look and shirt colour; values come from the catalogue.
routerAdd("POST", "/api/pixeltown/profile", (e) => {
  const lib = require(`${__hooks}/shop_lib.js`);
  const user = e.auth.id, out = lib.cleanProfile(lib.catalog(), e.requestInfo().body);
  if (out.error) throw new BadRequestError(out.error);
  const p = out.profile;
  const profile = $app.findFirstRecordByFilter("profiles", "user = {:user}", { user: user });
  profile.set("name", p.name);
  profile.set("color", p.color);
  profile.set("avatar", p.avatar);
  // The unique index idx_profiles_name (name COLLATE NOCASE) is the only nickname check, so racing saves cannot both win.
  try { $app.save(profile); }
  catch (err) {
    if (String(err).toLowerCase().indexOf("unique") >= 0) throw new BadRequestError("이미 쓰는 닉네임이에요. 다른 이름을 지어 주세요.", { name: "taken" });
    throw err;
  }
  return e.json(200, { ok: true, profile: p });
}, $apis.requireAuth("users"), $apis.bodyLimit(2048));
