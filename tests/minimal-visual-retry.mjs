// Whole-UI resource failures and bounded module retries, through the production build and real connections.
process.env.OTA_CLIENTS ||= '2';
process.env.OTA_BASELINE_MS ||= '1500';
process.env.OTA_SWAP_MS ||= '2000';
process.env.OTA_FAULTS = '1';
await import('./minimal-frontend-ota.mjs');
