// Only the local game server's superuser can commit authoritative outcomes.
routerAdd("POST", "/api/pixeltown/commit-match", (e) => {
  const body = e.requestInfo().body;
  if (typeof body.match_id !== "string" || !/^[0-9a-f-]{36}$/.test(body.match_id) ||
      !["lobby", "garden", "arcade"].includes(body.zone) ||
      typeof body.ended_at !== "string" || !body.scores || typeof body.scores !== "object" || Array.isArray(body.scores)) {
    throw new BadRequestError("Invalid match");
  }
  const entries = Object.entries(body.scores);
  // 60s maximum: 5 initial + fewer than 40 periodic stars => total <=44.
  // Allow a bounded 64 for compatible replay, but reject forged inflated totals.
  const totalScore=entries.reduce((sum,entry)=>sum+entry[1],0);
  if (!Number.isInteger(totalScore) || totalScore < 0 || totalScore > 64) throw new BadRequestError("Invalid total score");
  if (!entries.length || entries.length > 64) throw new BadRequestError("Invalid participants");
  $app.runInTransaction((tx) => {
    for (const [user, score] of entries) {
      if (!/^[a-z0-9]{15}$/.test(user) || !Number.isInteger(score) || score < 0 || score > 64) throw new BadRequestError("Invalid score");
      tx.findRecordById("users", user);
      for (const collectionName of ["results", "inventory"]) {
        const found = tx.findRecordsByFilter(collectionName, "match_id = {:match} && user = {:user}", "", 1, 0, {match:body.match_id,user});
        if (found.length) {
          const record=found[0];
          if ((collectionName === "results" && (record.getInt("score") !== score || record.getString("zone") !== body.zone)) ||
              (collectionName === "inventory" && (record.getInt("quantity") !== score || record.getString("item") !== "star"))) throw new BadRequestError("Conflicting match replay");
          continue;
        }
        const record = new Record(tx.findCollectionByNameOrId(collectionName));
        record.set("user",user); record.set("match_id",body.match_id);
        if (collectionName === "results") {
          record.set("score",score); record.set("zone",body.zone); record.set("ended_at",body.ended_at);
        } else {record.set("item","star"); record.set("quantity",score);}
        tx.save(record);
      }
    }
  });
  return e.json(200, {ok:true,match_id:body.match_id});
}, $apis.requireSuperuserAuth(), $apis.bodyLimit(16384));
