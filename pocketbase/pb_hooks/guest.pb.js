// Guest sign-up (PLAN-006). The first screen makes a character and a random account in one step: the browser generates
// the password and keeps it (no e-mail involved); the server creates the user and its profile atomically and answers
// with a normal PocketBase auth response. Sign-ups per IP are limited by PocketBase's rate limiter (applyAbuseLimits).
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

// Remember when each player last signed in (any auth, including the game server's authRefresh on every join),
// at most once an hour, so idle guests can be cleaned up.
onRecordAuthRequest((e) => {
  e.next();
  try {
    const profile = e.app.findFirstRecordByFilter("profiles", "user = {:user}", { user: e.record.id });
    const last = profile.getDateTime("last_seen");
    if (last.isZero() || Date.now() - last.time().unixMilli() > 3600000) {
      profile.set("last_seen", new DateTime());
      e.app.save(profile);
    }
  } catch (err) {} // no profile yet (or a non-game account): nothing to record
}, "users");

// Daily clean-up of guests idle for 30 days; superusers can run it now (and choose the age) through the route.
cronAdd("pixeltown_guest_cleanup", "17 4 * * *", () => {
  const lib = require(`${__hooks}/shop_lib.js`);
  const deleted = lib.cleanupGuests($app, 30, 500);
  if (deleted) console.log("pixeltown guest cleanup: deleted " + deleted);
});
routerAdd("POST", "/api/pixeltown/guest-cleanup", (e) => {
  const lib = require(`${__hooks}/shop_lib.js`);
  const days = Number(e.requestInfo().body.days || 30);
  if (!Number.isInteger(days) || days < 1) throw new BadRequestError("days must be a positive integer");
  return e.json(200, { deleted: lib.cleanupGuests($app, days, 500) });
}, $apis.requireSuperuserAuth());
