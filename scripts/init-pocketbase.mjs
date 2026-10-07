import { mkdirSync, existsSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { pocketbaseDir, localDir, PB_URL, adminClient, credentials, envFile, pbDataDir } from '../colyseus/config.js';
import { ROOM_CAPACITY } from '../shared/world.js';
const version = '0.40.4';
export async function download() {
  mkdirSync(localDir,{recursive:true,mode:0o700});
  const binary = localDir + 'pocketbase';
  if (existsSync(binary)) return binary;
  const platform = {darwin:'darwin',linux:'linux'}[process.platform];
  const arch = {arm64:'arm64',x64:'amd64'}[process.arch];
  if (!platform || !arch) throw new Error('Requires macOS/Linux and unzip');
  const name = `pocketbase_${version}_${platform}_${arch}.zip`;
  const base = `https://github.com/pocketbase/pocketbase/releases/download/v${version}/`;
  const zip = localDir + name;
  // curl follows release asset redirects; never runs downloaded shell scripts.
  execFileSync('curl',['-fL','--retry','2',base + name,'-o',zip],{stdio:'inherit'});
  execFileSync('curl',['-fsSL',base + 'checksums.txt','-o',localDir+'checksums.txt']);
  const expected = readFileSync(localDir+'checksums.txt','utf8').split('\n').find(line=>line.includes(name))?.split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(zip)).digest('hex');
  if (!expected || actual !== expected) throw new Error('PocketBase checksum mismatch');
  execFileSync('unzip',['-o',zip,'pocketbase','-d',localDir]); chmodSync(binary,0o700);
  return binary;
}
export async function startPocketBase() {
  const pbURL = new URL(PB_URL);
  if (pbURL.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(pbURL.hostname) || !pbURL.port) throw new Error('Development initializer rejects external PB_URL');
  if (process.env.SERVER_HOST && !['127.0.0.1','localhost'].includes(process.env.SERVER_HOST)) throw new Error('Development launcher requires loopback SERVER_HOST');
  // Refuse any already running instance: initializer must only touch its own child.
  try { await fetch(PB_URL+'/api/health',{signal:AbortSignal.timeout(1000)}); throw new Error(`Port ${pbURL.port} is already occupied; stop that local service first`); }
  catch(e) { if (e.message.includes('occupied')) throw e; }
  const binary = await download();
  if (!existsSync(envFile)) writeFileSync(envFile,`PB_ADMIN_EMAIL=local-${randomBytes(8).toString('hex')}@pixeltown.local\nPB_ADMIN_PASSWORD=${randomBytes(32).toString('hex')}\n`,{mode:0o600});
  chmodSync(envFile,0o600);
  const env = credentials();
  execFileSync(binary,['superuser','upsert',env.PB_ADMIN_EMAIL,env.PB_ADMIN_PASSWORD,'--dir',pbDataDir],{stdio:'pipe'});
  const child = spawn(binary,['serve',`--http=127.0.0.1:${pbURL.port}`,'--dir',pbDataDir,'--automigrate=0','--hooksDir',pocketbaseDir+'pb_hooks'],{stdio:'inherit'});
  try {
    for(let n=0;n<100;n++) {
      if(child.exitCode!==null) throw new Error('PocketBase exited');
      try { if((await fetch(PB_URL+'/api/health')).ok) return child; } catch {}
      await new Promise(r=>setTimeout(r,100));
    }
    throw new Error('PocketBase startup timed out');
  } catch(e) {child.kill();throw e;}
}
// Same comparison key as idx_profiles_name_key: spaces, '_' and '-' ignored, ASCII letters lower-cased (SQLite lower()).
const nameKey = name => name.replace(/[ _-]/g, '').replace(/[A-Z]/g, c => c.toLowerCase());
// Keeps the oldest profile's nickname and gives later duplicates a numbered name, e.g. "쇼핑왕" -> "쇼핑왕2".
async function uniqueNames(pb) {
  const taken = new Set(); let renamed = 0;
  for (const p of await pb.collection('profiles').getFullList({ sort: 'created' })) {
    let name = p.name;
    for (let n = 2; taken.has(nameKey(name)); n++) name = `${p.name.slice(0, 12 - String(n).length)}${n}`;
    if (name !== p.name) { await pb.collection('profiles').update(p.id, { name }); renamed++; }
    taken.add(nameKey(name));
  }
  if (renamed) console.log(`Unique nickname index: renamed ${renamed} duplicate profile name(s)`);
}
// Abuse limits for a public server behind Cloudflare (PLAN-006): PocketBase's own rate limiter keyed by the visitor IP that
// Cloudflare puts in CF-Connecting-IP (PB listens on loopback only, so nobody can reach it without the tunnel), at most
// GUEST_PER_HOUR guest sign-ups per IP, and PB's default rules (auth brute force etc.). Loopback callers (the Colyseus
// server: authRefresh on every join, outbox saves) are excluded so the game server is never throttled.
export const GUEST_PER_HOUR = 20; // several people can share one office or home IP
export async function applyAbuseLimits(pb) {
  const { rateLimits } = await pb.settings.getAll();
  const label = 'POST /api/pixeltown/guest';
  const rules = [...rateLimits.rules.filter(r => r.label !== label), { label, audience: '', duration: 3600, maxRequests: GUEST_PER_HOUR }];
  const excludedIPs = [...new Set([...(rateLimits.excludedIPs || []), '127.0.0.1', '::1'])];
  await pb.settings.update({ trustedProxy: { headers: ['CF-Connecting-IP'], useLeftmostIP: false }, rateLimits: { enabled: true, excludedIPs, rules } });
}
// Upgrade only the room capacity field and known zone rows. Safe to repeat on an existing database.
export async function migrateRoomCapacity(pb) {
  const schema = await pb.collections.getOne('rooms');
  const capacity = schema.fields.find(f => f.name === 'max_players');
  if (!capacity || capacity.type !== 'number') throw new Error('Missing rooms.max_players number field');
  if (capacity.max !== ROOM_CAPACITY) {
    await pb.collections.update(schema.id, { fields: schema.fields.map(f => f.name === 'max_players' ? { ...f, max: ROOM_CAPACITY } : f) });
  }
  for (const [zone, title] of [['lobby', 'Town Lobby'], ['garden', 'Star Garden'], ['arcade', 'Town Arcade']]) {
    try {
      const room = await pb.collection('rooms').getFirstListItem(pb.filter('zone={:zone}', { zone }));
      if (room.max_players !== ROOM_CAPACITY) await pb.collection('rooms').update(room.id, { max_players: ROOM_CAPACITY });
    } catch (e) {
      if (e.status !== 404) throw e;
      await pb.collection('rooms').create({ zone, title, max_players: ROOM_CAPACITY });
    }
  }
}
// remote: true keeps existing users/rules, adds game schema and upgrades room capacity.
export async function seed(client, { remote = false } = {}) {
  const target=new URL(client?.baseURL || PB_URL);
  if (!['127.0.0.1','localhost'].includes(target.hostname) || target.protocol!=='http:') throw new Error('Development seed rejects external PB_URL');
  const pb = client || await adminClient();
  let users = await pb.collections.getOne('users');
  if (!users.fields.some(f=>f.name==='name')) {
    users = await pb.collections.update(users.id,{fields:[...users.fields,{name:'name',type:'text',max:40}]});
  }
  if (!remote) await pb.collections.update(users.id,{listRule:'id = @request.auth.id',viewRule:'id = @request.auth.id',createRule:null,updateRule:null,deleteRule:null});
  const ownerRule = 'user = @request.auth.id';
  const relation = {name:'user',type:'relation',collectionId:users.id,maxSelect:1,required:true,cascadeDelete:true};
  const timestamps = [
    {name:'created',type:'autodate',onCreate:true,onUpdate:false},
    {name:'updated',type:'autodate',onCreate:true,onUpdate:true}
  ];
  const schemas = [
    {name:'rooms',listRule:"@request.auth.id != ''",viewRule:"@request.auth.id != ''",fields:[...timestamps,{name:'zone',type:'text',required:true},{name:'title',type:'text',required:true,max:80},{name:'max_players',type:'number',required:true,min:1,max:ROOM_CAPACITY}],indexes:['CREATE UNIQUE INDEX idx_rooms_zone ON rooms (zone)']},
    {name:'profiles',fields:[...timestamps,relation,{name:'name',type:'text',required:true,max:40},{name:'color',type:'text',required:true},{name:'outfit',type:'json',maxSize:2000},{name:'room',type:'json',maxSize:8000},{name:'avatar',type:'json',maxSize:200},{name:'last_seen',type:'date'}],indexes:['CREATE UNIQUE INDEX idx_profiles_user ON profiles (user)',"CREATE UNIQUE INDEX idx_profiles_name_key ON profiles (lower(replace(replace(replace(name, ' ', ''), '_', ''), '-', '')))"]},
    {name:'results',fields:[...timestamps,relation,{name:'match_id',type:'text',required:true},{name:'zone',type:'text',required:true},{name:'score',type:'number',min:0},{name:'ended_at',type:'date',required:true}],indexes:['CREATE UNIQUE INDEX idx_results_match_user ON results (match_id, user)']},
    // Star shop ledger (ADR-004): written only by the shop hook, one row per owned item.
    {name:'purchases',fields:[...timestamps,relation,{name:'item',type:'text',required:true,max:40},{name:'price',type:'number',required:true,min:0}],indexes:['CREATE UNIQUE INDEX idx_purchases_user_item ON purchases (user, item)']},
    {name:'inventory',fields:[...timestamps,relation,{name:'match_id',type:'text',required:true},{name:'item',type:'text',required:true},{name:'quantity',type:'number',min:0}],indexes:['CREATE UNIQUE INDEX idx_inventory_match_user ON inventory (match_id, user)']}
  ];
  for(const schema of schemas) {
    try {
      const existing = await pb.collections.getOne(schema.name);
      // Older databases: add fields introduced later (timestamps, profile outfit/room) without touching existing data.
      const missing = schema.fields.filter(field=>!existing.fields.some(current=>current.name===field.name));
      if(missing.length) await pb.collections.update(existing.id,{fields:[...existing.fields,...missing]});
      // Indexes introduced later (unique nickname, PLAN-005). Existing duplicates would block the index, so rename them first.
      const indexName = sql => sql.match(/INDEX\s+(\w+)/)[1];
      const newIndexes = (schema.indexes||[]).filter(sql=>!existing.indexes.some(current=>indexName(current)===indexName(sql)));
      if(newIndexes.length) {
        if(newIndexes.some(sql=>indexName(sql)==='idx_profiles_name_key')) await uniqueNames(pb);
        await pb.collections.update(existing.id,{indexes:[...existing.indexes,...newIndexes]});
      }
    }
    catch(e) { if(e.status!==404)throw e; await pb.collections.create({...schema,type:'base',listRule:schema.listRule??ownerRule,viewRule:schema.viewRule??ownerRule,createRule:null,updateRule:null,deleteRule:null}); }
  }
  await migrateRoomCapacity(pb);
  if (remote) { await applyAbuseLimits(pb); console.log('Game schema and abuse limits ready (existing users and rules kept)'); return; }
  for(let n=1;n<=2;n++) {
    const email = `demo${n}@pixeltown.local`;
    let user;
    try {user=await pb.collection('users').getFirstListItem(pb.filter('email={:email}',{email}));}
    catch(e) {if(e.status!==404)throw e;user=await pb.collection('users').create({email,password:'PixelTown123!',passwordConfirm:'PixelTown123!',name:`Demo ${n}`,verified:true});}
    // Demo accounts are ready-made characters, so they skip the first-entry set-up screen (FR-014).
    const avatar=n===1?{skin:0,hair:1,style:0}:{skin:1,hair:5,style:1};
    try {const profile=await pb.collection('profiles').getFirstListItem(pb.filter('user={:id}',{id:user.id}));if(!profile.avatar)await pb.collection('profiles').update(profile.id,{avatar});}
    catch(e) {if(e.status!==404)throw e;await pb.collection('profiles').create({user:user.id,name:`Demo ${n}`,color:n===1?'#ffb347':'#89cff0',avatar});}
  }
  console.log('Local PocketBase seeded: demo1/demo2; admin credentials in pocketbase/.env.local');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let child;
  try {child=await startPocketBase();await seed();} catch(e) {console.error(e.message);process.exitCode=1;} finally {child?.kill();}
}
