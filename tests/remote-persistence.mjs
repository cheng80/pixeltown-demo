// Runs ON the Mac mini (stdin to node, cwd pixeltown-colyseus/app, --env-file=../.env) with the outbox superuser:
//   ssh … 'cd /Users/cheng80/Servers/pixeltown-colyseus/app && MATCH_ID=<id> ../runtime/bin/node --env-file=../.env --input-type=module -' < tests/remote-persistence.mjs
// Replays a settled match (must be a no-op), sends a conflicting replay (must be refused) and a batch with an
// unknown second participant (must roll back entirely). Prints JSON evidence without credentials.
import { randomUUID } from 'node:crypto';
const { adminClient } = await import(process.cwd() + '/colyseus/config.js');
const pb = await adminClient(), id = process.env.MATCH_ID;
const rows = async (c, f) => (await pb.collection(c).getFullList({ filter: pb.filter(f, { id }) }));
const results = await rows('results', 'match_id={:id}');
if (!results.length) throw new Error('match not found');
const match = { match_id: id, zone: results[0].zone, ended_at: results[0].ended_at, scores: Object.fromEntries(results.map(r => [r.user, r.score])) };
const send = body => pb.send('/api/pixeltown/commit-match', { method: 'POST', body }).then(() => 200, e => e.status);
const replay = await send(match);
const conflicting = await send({ ...match, scores: Object.fromEntries(results.map(r => [r.user, r.score + 1])) });
const rollbackId = randomUUID(), user = results[0].user;
const partial = await send({ match_id: rollbackId, zone: 'lobby', ended_at: new Date().toISOString(), scores: { [user]: 2, missinguser0000: 1 } });
const after = { results: (await rows('results', 'match_id={:id}')).length, inventory: (await rows('inventory', 'match_id={:id}')).length };
const leaked = (await pb.collection('results').getFullList({ filter: pb.filter('match_id={:r}', { r: rollbackId }) })).length
  + (await pb.collection('inventory').getFullList({ filter: pb.filter('match_id={:r}', { r: rollbackId }) })).length;
console.log(JSON.stringify({ replayStatus: replay, rowsAfterReplay: after, conflictingStatus: conflicting, partialBatchStatus: partial, partialRowsWritten: leaked }));
