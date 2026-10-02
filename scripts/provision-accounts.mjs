// Server-side test account provisioning (Mac mini). Reads [{email,password,name,color}] JSON from stdin so passwords
// never appear in argv or logs; creates or updates each user and its profile idempotently with the outbox superuser.
import { adminClient } from '../colyseus/config.js';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const pb = await adminClient();
for (const { email, password, name, color } of JSON.parse(input)) {
  let user;
  try { user = await pb.collection('users').getFirstListItem(pb.filter('email={:email}', { email })); await pb.collection('users').update(user.id, { password, passwordConfirm: password, name, verified: true }); }
  catch (e) { if (e.status !== 404) throw e; user = await pb.collection('users').create({ email, password, passwordConfirm: password, name, verified: true }); }
  try { await pb.collection('profiles').getFirstListItem(pb.filter('user={:id}', { id: user.id })); }
  catch (e) { if (e.status !== 404) throw e; await pb.collection('profiles').create({ user: user.id, name, color }); }
  console.log(`account ready: ${email}`);
}
