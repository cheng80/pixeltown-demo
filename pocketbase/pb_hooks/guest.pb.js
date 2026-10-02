// Guest sign-up (PLAN-006). The first screen makes a character and a random account in one step: the browser generates
// the password and keeps it (no e-mail involved); the server creates the user and its profile atomically and answers
// with a normal PocketBase auth response. No rate limit yet (user decision, see PROJECT_STATUS).
routerAdd("POST", "/api/pixeltown/guest", (e) => {
  const lib = require(`${__hooks}/shop_lib.js`);
  const body = e.requestInfo().body, out = lib.cleanProfile(lib.catalog(), body);
  if (out.error) throw new BadRequestError(out.error);
  const password = body.password;
  if (typeof password !== "string" || password.length < 32 || password.length > 128) throw new BadRequestError("잘못된 요청이에요.");
  const p = out.profile;
  let user;
  try {
    $app.runInTransaction((tx) => {
      user = new Record(tx.findCollectionByNameOrId("users"));
      user.set("email", "guest-" + $security.randomString(20).toLowerCase() + "@guest.pixeltown.local");
      user.setPassword(password);
      user.setVerified(true);
      user.set("name", p.name);
      tx.save(user);
      const profile = new Record(tx.findCollectionByNameOrId("profiles"));
      profile.set("user", user.id);
      profile.set("name", p.name);
      profile.set("color", p.color);
      profile.set("avatar", p.avatar);
      tx.save(profile);
    });
  } catch (err) {
    // idx_profiles_name_key rolls back the whole sign-up when the nickname is taken.
    if (String(err).toLowerCase().indexOf("unique") >= 0) throw new BadRequestError("이미 쓰는 닉네임이에요. 다른 이름을 지어 주세요.", { name: "taken" });
    throw err;
  }
  return $apis.recordAuthResponse(e, user, "password");
}, $apis.bodyLimit(2048));
