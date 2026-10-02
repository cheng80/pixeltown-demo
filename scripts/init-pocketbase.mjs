import { mkdirSync, existsSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { pocketbaseDir, localDir, PB_URL, adminClient, credentials, envFile, pbDataDir } from '../colyseus/config.js';
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
export async function seed(client) {
  const target=new URL(client?.baseURL || PB_URL);
  if (!['127.0.0.1','localhost'].includes(target.hostname) || target.protocol!=='http:') throw new Error('Development seed rejects external PB_URL');
  const pb = client || await adminClient();
  let users = await pb.collections.getOne('users');
  if (!users.fields.some(f=>f.name==='name')) {
    users = await pb.collections.update(users.id,{fields:[...users.fields,{name:'name',type:'text',max:40}]});
  }
  await pb.collections.update(users.id,{listRule:'id = @request.auth.id',viewRule:'id = @request.auth.id',createRule:null,updateRule:null,deleteRule:null});
  const ownerRule = 'user = @request.auth.id';
  const relation = {name:'user',type:'relation',collectionId:users.id,maxSelect:1,required:true,cascadeDelete:true};
  const timestamps = [
    {name:'created',type:'autodate',onCreate:true,onUpdate:false},
    {name:'updated',type:'autodate',onCreate:true,onUpdate:true}
  ];
  const schemas = [
    {name:'rooms',listRule:"@request.auth.id != ''",viewRule:"@request.auth.id != ''",fields:[...timestamps,{name:'zone',type:'text',required:true},{name:'title',type:'text',required:true,max:80},{name:'max_players',type:'number',required:true,min:1,max:32}],indexes:['CREATE UNIQUE INDEX idx_rooms_zone ON rooms (zone)']},
    {name:'profiles',fields:[...timestamps,relation,{name:'name',type:'text',required:true,max:40},{name:'color',type:'text',required:true},{name:'outfit',type:'json',maxSize:2000},{name:'room',type:'json',maxSize:8000}],indexes:['CREATE UNIQUE INDEX idx_profiles_user ON profiles (user)']},
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
    }
    catch(e) { if(e.status!==404)throw e; await pb.collections.create({...schema,type:'base',listRule:schema.listRule??ownerRule,viewRule:schema.viewRule??ownerRule,createRule:null,updateRule:null,deleteRule:null}); }
  }
  for(const [zone,title] of [['lobby','Town Lobby'],['garden','Star Garden'],['arcade','Town Arcade']]) {
    try {await pb.collection('rooms').getFirstListItem(pb.filter('zone={:zone}',{zone}));}
    catch(e) {if(e.status!==404)throw e;await pb.collection('rooms').create({zone,title,max_players:32});}
  }
  for(let n=1;n<=2;n++) {
    const email = `demo${n}@pixeltown.local`;
    let user;
    try {user=await pb.collection('users').getFirstListItem(pb.filter('email={:email}',{email}));}
    catch(e) {if(e.status!==404)throw e;user=await pb.collection('users').create({email,password:'PixelTown123!',passwordConfirm:'PixelTown123!',name:`Demo ${n}`,verified:true});}
    try {await pb.collection('profiles').getFirstListItem(pb.filter('user={:id}',{id:user.id}));}
    catch(e) {if(e.status!==404)throw e;await pb.collection('profiles').create({user:user.id,name:`Demo ${n}`,color:n===1?'#ffb347':'#89cff0'});}
  }
  console.log('Local PocketBase seeded: demo1/demo2; admin credentials in pocketbase/.env.local');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let child;
  try {child=await startPocketBase();await seed();} catch(e) {console.error(e.message);process.exitCode=1;} finally {child?.kill();}
}
