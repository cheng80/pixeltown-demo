import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

// Single writer owned by the stable room host. Game logic never talks directly to PocketBase.
export class MinimalOutbox extends EventEmitter {
  constructor(dir, getClient) {
    super(); this.dir = dir; this.getClient = getClient; this.running = null; this.failed = new Set();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  files() { return readdirSync(this.dir).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)); }
  syncDirectory() { const fd = openSync(this.dir, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
  enqueue(match) {
    if (!/^[a-f0-9-]{36}$/.test(match.match_id)) throw new Error('Invalid settlement identity');
    const file = join(this.dir, `${match.match_id}.json`), body = JSON.stringify(match);
    const existing = this.files().includes(`${match.match_id}.json`);
    if (existing && readFileSync(file, 'utf8') !== body) throw new Error('Conflicting settlement');
    if (!existing) {
      writeFileSync(`${file}.tmp`, body, { mode: 0o600, flush: true });
      renameSync(`${file}.tmp`, file); this.syncDirectory();
    }
    this.emit('change');
  }
  status() { return { pending: this.files().length, failed: this.failed.size }; }
  flush() {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }
  async run() {
    const files = this.files();
    if (!files.length) return;
    let pb;
    try { pb = await this.getClient(); } catch { this.emit('change'); return; }
    for (const file of files) {
      try {
        const match = JSON.parse(readFileSync(join(this.dir, file), 'utf8'));
        await pb.send('/api/minimal/commit-match', { method: 'POST', body: match });
        unlinkSync(join(this.dir, file)); this.syncDirectory(); this.failed.delete(file);
      } catch { this.failed.add(file); } // Preserve evidence and continue unrelated settlements.
    }
    this.emit('change');
  }
}
