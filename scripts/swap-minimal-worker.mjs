// Local control only. This never restarts the connection host or contacts production.
const port = Number(process.env.MINIMAL_GAME_PORT || 12620);
const token = process.env.MINIMAL_SWAP_TOKEN;
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !token || token.length < 32) {
  throw new Error('Set MINIMAL_GAME_PORT and the running host’s MINIMAL_SWAP_TOKEN (at least 32 characters).');
}
const response = await fetch(`http://127.0.0.1:${port}/internal/worker/swap`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error || `Swap failed: ${response.status}`);
console.log(JSON.stringify(result, null, 2));
