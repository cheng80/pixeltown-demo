import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {adminClient,PB_URL} from '../colyseus/minimal/config.js';
import PocketBase from 'pocketbase';
const action=process.argv[2],source='colyseus/minimal/simulation.js',saved='.test-work/operational-source.js';
const accountsFile='.test-work/operational-accounts.json';
const admin=await adminClient();
if(action==='provision'){
 if(existsSync(accountsFile))throw Error('Operational accounts already provisioned; no duplicate creation');
 execFileSync('python3',['-c',"import sqlite3,os; s=sqlite3.connect('.local/minimal/pb_data/data.db'); d=sqlite3.connect('.test-work/pre-operational.db'); s.backup(d); d.close();s.close();os.chmod('.test-work/pre-operational.db',0o600)"]);
 writeFileSync(saved,readFileSync(source),{mode:0o600});
 const accounts=[],password=randomBytes(32).toString('hex'),run=Date.now();
 for(let i=0;i<100;i++){const u=await admin.collection('users').create({email:`ops-${run}-${i}@minimal.test`,password,passwordConfirm:password,name:`검증${i}`});await admin.collection('profiles').create({user:u.id,name:`검증${i}`});const pb=new PocketBase(PB_URL);const auth=await pb.collection('users').authWithPassword(u.email,password);accounts.push({id:u.id,token:auth.token});}
 writeFileSync(accountsFile,JSON.stringify(accounts),{mode:0o600});console.log(JSON.stringify(accounts));
}else if(action.startsWith('swap-')||action==='restore'){
 const original=readFileSync(saved,'utf8'),n=Number(action.slice(5));
 let next=original;
 if(action!=='restore'){if(n%2)next=next.replace('return Object.values(this.game.scores).reduce((n, s) => n + s, 0);','let total = 0; for (const score of Object.values(this.game.scores)) total += score; return total;');next+=`\n// Operational verification release ${n}\n`;}
 writeFileSync(source,next);
 console.log(execFileSync(process.execPath,['--env-file=../.env','scripts/deploy-minimal-worker.mjs'],{encoding:'utf8'}));
}else if(action==='verify'){
 const users=JSON.parse(readFileSync(accountsFile)),inventory=await admin.collection('inventory').getFullList(),results=await admin.collection('results').getFullList();
 for(const u of users){const rows=inventory.filter(r=>r.user===u.id),wallet=await(await fetch(PB_URL+'/api/minimal/wallet',{headers:{Authorization:u.token}})).json();if(wallet.balance!==rows.reduce((n,r)=>n+r.quantity,0)||new Set(rows.map(r=>r.match_id)).size!==rows.length)throw Error('Ledger mismatch');}
 console.log(JSON.stringify({verifiedUsers:users.length,inventory:inventory.length,results:results.length}));
}else throw Error('Unknown action');
