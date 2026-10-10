// Shared post-publication activation for manual Pages deploys and Git Pages builds.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { activatePublished } from './frontend-publication.mjs';

const remoteScript = `const [method, port, tokenFile, path, generation, revision] = process.argv.slice(2);
const { readFileSync } = require('node:fs');
(async () => {
  const headers = {};
  if (method === 'POST') {
    headers.Authorization = 'Bearer ' + readFileSync(tokenFile, 'utf8').trim();
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch('http://127.0.0.1:' + port + path, {
    method, headers, body: method === 'POST' ? JSON.stringify({ expectedGeneration: Number(generation), revision }) : undefined,
    redirect: 'manual', signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  process.stdout.write(JSON.stringify({ status: response.status, body: JSON.parse(text) }));
})().catch(() => { process.exitCode = 1; });`;

export function remoteRequest(env = process.env) {
  const host = env.MINIMAL_FRONTEND_SSH_HOST;
  const file = env.MINIMAL_FRONTEND_TOKEN_FILE;
  const port = env.MINIMAL_FRONTEND_GAME_PORT;
  const key = env.MINIMAL_FRONTEND_SSH_KEY;
  const node = env.MINIMAL_FRONTEND_NODE_PATH;
  if (!host || host.startsWith('-') || !/^[A-Za-z0-9_.@-]+$/.test(host) || !file || !/^\/[A-Za-z0-9_./-]+$/.test(file) || !node || !/^\/[A-Za-z0-9_./-]+$/.test(node) || node.split('/').includes('..') || file.split('/').includes('..') || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535 || key && (!/^\/[A-Za-z0-9_./-]+$/.test(key) || key.split('/').includes('..'))) throw new Error('Set MINIMAL_FRONTEND_SSH_HOST, MINIMAL_FRONTEND_TOKEN_FILE, MINIMAL_FRONTEND_GAME_PORT, MINIMAL_FRONTEND_NODE_PATH, and optional MINIMAL_FRONTEND_SSH_KEY');
  return async (method, path, body) => {
    const command = `${node} - ${method} ${port} ${file} ${path} ${body?.expectedGeneration ?? 0} ${body?.revision ?? 'none'}`;
    try {
      const output = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', ...(key ? ['-i', key] : []), host, command], { input: remoteScript, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
      return JSON.parse(output);
    } catch { throw new Error('Remote frontend request failed'); }
  };
}

export async function activateFrontendCli(argv = process.argv.slice(2), env = process.env) {
  const index = argv.indexOf('--revision');
  const revision = index >= 0 ? argv[index + 1] : null;
  if (!/^[a-f0-9]{64}$/.test(revision || '')) throw new Error('Use --revision with a 64-character SHA');
  const origin = env.MINIMAL_VISUAL_PUBLIC_URL || 'https://pixeltown.fastmake.net';
  const request = remoteRequest(env);
  const receiptPath = env.MINIMAL_FRONTEND_RECEIPT || resolve(import.meta.dirname, '../.local/minimal/frontend-publication-receipt.json');
  const receipt = await activatePublished({ origin, revision, request, receiptPath });
  console.log(JSON.stringify(receipt));
  if (receipt.publication !== 'confirmed' || receipt.activation !== 'confirmed' || receipt.notification !== 'queued') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) await activateFrontendCli();
