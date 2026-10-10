// Whole UI supersedes the renderer-only polling harness. Short run with an isolated DB and real clients;
// `npm run test:minimal:ota` keeps the 85-client 10+10 minute defaults.
process.env.OTA_CLIENTS ||= '2';
process.env.OTA_BASELINE_MS ||= '1500';
process.env.OTA_SWAP_MS ||= '2000';
await import('./minimal-frontend-ota.mjs');
