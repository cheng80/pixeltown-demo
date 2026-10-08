// Same production worker, intentionally slow initialization to force live catch-up.
await new Promise(resolve => setTimeout(resolve, 250));
await import('../../simulation-worker.js');
