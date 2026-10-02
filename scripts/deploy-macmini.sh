#!/bin/sh
# Deploy game server code to the Mac mini (PLAN-004, docs/SERVER_OPERATIONS.md).
# Copies colyseus/ + shared/ + server scripts to pixeltown-colyseus/app, game hooks + catalog to pixeltown/pb_hooks,
# installs the pinned packages in app/colyseus, adds missing game schema (seed remote mode, additive only)
# and restarts only com.fastmake.pixeltown.colyseus.
# One-time setup (outbox superuser, .env keys, schema, test accounts) is described in SERVER_OPERATIONS.md, not here.
set -eu
HOST=${PIXELTOWN_SSH_HOST:-cheng80@100.92.43.82}
KEY=${PIXELTOWN_SSH_KEY:-$HOME/.ssh/stonematch_macmini_ed25519}
RT=/Users/cheng80/Servers/pixeltown-colyseus
PB=/Users/cheng80/Servers/pixeltown
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10 -i $KEY"
cd "$(dirname "$0")/.."
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/app/colyseus" "$stage/app/shared" "$stage/app/scripts" "$stage/pb_hooks"
cp colyseus/server.js colyseus/town.js colyseus/outbox.js colyseus/config.js colyseus/monitor-auth.js colyseus/package.json colyseus/package-lock.json "$stage/app/colyseus/"
cp shared/world.js shared/catalog.json "$stage/app/shared/"
cp scripts/init-pocketbase.mjs scripts/provision-accounts.mjs "$stage/app/scripts/"
# app/ is ESM on its own (shared/world.js is a .js module); the server folder root no longer needs a package.json.
printf '{ "private": true, "type": "module" }\n' > "$stage/app/package.json"
cp pocketbase/pb_hooks/matches.pb.js pocketbase/pb_hooks/shop.pb.js pocketbase/pb_hooks/profile.pb.js pocketbase/pb_hooks/guest.pb.js pocketbase/pb_hooks/shop_lib.js shared/catalog.json "$stage/pb_hooks/"
# app/colyseus/node_modules lives only on the server; --delete never touches it (excluded).
rsync -a --delete --exclude node_modules -e "$SSH" "$stage/app/" "$HOST:$RT/app/"
# Only the game hook files are written; realtime.pb.js and any other hook stay as they are.
# A changed hook file makes PocketBase restart itself: about 2-3 s of failed API calls.
rsync -a -e "$SSH" "$stage/pb_hooks/" "$HOST:$PB/pb_hooks/"
$SSH "$HOST" "set -e; cd $RT/app/colyseus; PATH=$RT/runtime/bin:\$PATH npm ci --no-fund --no-audit >/dev/null; \
  for i in 1 2 3 4 5 6 7 8 9 10; do curl -fsS http://127.0.0.1:8091/api/health >/dev/null 2>&1 && break; sleep 1; done; \
  ../../runtime/bin/node --env-file=../../.env --input-type=module -e 'const m=await import(\"../scripts/init-pocketbase.mjs\");await m.seed(undefined,{remote:true})'; \
  launchctl kickstart -k gui/\$(id -u)/com.fastmake.pixeltown.colyseus; sleep 3; \
  curl -fsS http://127.0.0.1:8091/api/health >/dev/null && curl -fsS http://127.0.0.1:2567/health && echo && curl -fsS http://127.0.0.1:2567/health/pocketbase && echo"
