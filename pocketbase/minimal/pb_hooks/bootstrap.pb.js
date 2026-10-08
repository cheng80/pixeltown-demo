// Isolated minimal database only. No legacy migrations, seeds, shop,
// room metadata, or automatic account deletion belong in this hook tree.
onBootstrap((e) => {
  e.next();
  if (!$os.getenv("MINIMAL_BOOTSTRAP_NONCE")) throw new Error("Use scripts/minimal-pocketbase.mjs");

  const allowed = ["users", "profiles", "results", "inventory"];
  const existing = e.app.findAllCollections();
  for (const collection of existing) {
    if (!collection.system && allowed.indexOf(collection.name) < 0) {
      throw new Error("Refusing a non-minimal database");
    }
  }
  e.app.runInTransaction((tx) => {
    const users = tx.findCollectionByNameOrId("users");
    if (!users.fields.getByName("name")) users.fields.add(new TextField({ name: "name", max: 12 }));
    users.listRule = "@request.auth.id != '' && id = @request.auth.id";
    users.viewRule = users.listRule;
    users.createRule = null;
    users.updateRule = null;
    users.deleteRule = null;
    users.manageRule = null;
    tx.save(users);

    const timestamps = [
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ];
    // Required non-cascading relations prevent an admin deleting an account
    // from silently erasing its settled ledger. There is no cleanup job.
    const user = { name: "user", type: "relation", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: false };
    const match = { name: "match_id", type: "text", required: true, min: 36, max: 36 };
    const schemas = [
      {
        name: "profiles",
        fields: [...timestamps, user, { name: "name", type: "text", required: true, min: 2, max: 12 }],
        indexes: [
          "CREATE UNIQUE INDEX idx_minimal_profiles_user ON profiles (user)",
          "CREATE UNIQUE INDEX idx_minimal_profiles_name ON profiles (lower(replace(replace(replace(name, ' ', ''), '_', ''), '-', '')))",
        ],
      },
      {
        name: "results",
        fields: [...timestamps, user, match,
          { name: "score", type: "number", required: true, onlyInt: true, min: 1, max: 64 },
          { name: "zone", type: "text", required: true, pattern: "^lobby$" },
          { name: "ended_at", type: "date", required: true }],
        indexes: ["CREATE UNIQUE INDEX idx_minimal_results_match_user ON results (match_id, user)"],
      },
      {
        name: "inventory",
        fields: [...timestamps, user, match,
          { name: "item", type: "text", required: true, pattern: "^star$" },
          { name: "quantity", type: "number", required: true, onlyInt: true, min: 1, max: 64 }],
        indexes: ["CREATE UNIQUE INDEX idx_minimal_inventory_match_user ON inventory (match_id, user)"],
      },
    ];
    for (const schema of schemas) {
      const old = existing.find((collection) => collection.name === schema.name);
      // Never migrate an incompatible database or rename existing nicknames.
      if (old) {
        // JSVM exposes Field.type() as a Go method. JSON.stringify() omits
        // that method, so its result cannot validate persisted field types.
        const fields = Array.from(old.fields, (field) => ({ name: field.getName(), type: field.type() }));
        const names = ["id", ...schema.fields.map((field) => field.name)];
        if (fields.some((field) => names.indexOf(field.name) < 0) ||
            schema.fields.some((field) => !fields.some((value) => value.name === field.name && value.type === field.type))) {
          throw new Error("Refusing incompatible minimal schema");
        }
        // Existing rows and field IDs are preserved; only access rules/indexes
        // are enforced again. An invalid unique index aborts the transaction.
        old.listRule = "@request.auth.id != '' && user = @request.auth.id";
        old.viewRule = old.listRule;
        old.createRule = null;
        old.updateRule = null;
        old.deleteRule = null;
        old.indexes = schema.indexes;
        tx.save(old);
      } else {
        tx.save(new Collection({ ...schema, type: "base",
          listRule: "@request.auth.id != '' && user = @request.auth.id",
          viewRule: "@request.auth.id != '' && user = @request.auth.id",
          createRule: null, updateRule: null, deleteRule: null }));
      }
    }
    const email = $os.getenv("MINIMAL_PB_ADMIN_EMAIL");
    const password = $os.getenv("MINIMAL_PB_ADMIN_PASSWORD");
    if (!email || password.length < 8) throw new Error("Missing minimal admin credentials");
    const admins = tx.findRecordsByFilter("_superusers", "", "", 1, 0);
    if (!admins.length) {
      const admin = new Record(tx.findCollectionByNameOrId("_superusers"));
      admin.setEmail(email);
      admin.setPassword(password);
      tx.save(admin);
    }
    // Restarts authenticate the existing admin; never upsert/reset a password.
  });
  const settings = e.app.settings();
  // Public mode uses Cloudflare visitor IPs; direct backend loopback stays exempt.
  const publicMode = $os.getenv("MINIMAL_PUBLIC_MODE") === "1";
  settings.trustedProxy.headers = publicMode ? ["CF-Connecting-IP"] : [];
  settings.trustedProxy.useLeftmostIP = false;
  settings.rateLimits.enabled = true;
  settings.rateLimits.excludedIPs = ["127.0.0.1", "::1"];
  const label = "POST /api/minimal/guest";
  settings.rateLimits.rules = Array.from(settings.rateLimits.rules).filter((rule) => rule.label !== label);
  if (publicMode) settings.rateLimits.rules.push({ label, audience: "", duration: 3600, maxRequests: 20 });
  e.app.save(settings);
});

// The nonce lets the launcher distinguish its own ready child from a process
// that raced it to the same TCP port. It is unrelated to admin credentials.
routerAdd("GET", "/api/minimal/ready", (e) => {
  if (e.request.header.get("CF-Connecting-IP") || e.request.header.get("X-Forwarded-For") || e.request.header.get("Forwarded")) throw new ForbiddenError("Local readiness only");
  return e.json(200, { mode: "minimal", nonce: $os.getenv("MINIMAL_BOOTSTRAP_NONCE") });
});
