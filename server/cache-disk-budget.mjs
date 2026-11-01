import {readdir, stat, unlink, utimes} from 'node:fs/promises';
import path from 'node:path';

const DAY = 86400_000;
const TEMPORARY = /^(.+)\.[0-9a-f-]{36}\.tmp$/;

// Bounds one cache directory written through writeCacheFile. The least recently
// read records are removed first; file modification times carry recency across
// restarts. Only names matching `pattern` and their temporary files are managed.
export class CacheDiskBudget {
  constructor(directory, {maxBytes, maxEntries, pattern, clock = Date.now, evict = true} = {}) {
    Object.assign(this, {directory, maxBytes, maxEntries, pattern, clock, evict});
    this.entries = new Map(); this.bytes = 0; this.ready = null; this.work = Promise.resolve();
  }

  initialize() {
    this.ready ??= (async () => {
      let names;
      try { names = await readdir(this.directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const name of names) {
        const file = path.join(this.directory, name);
        const info = await stat(file).catch(() => null);
        if (!info?.isFile()) continue;
        // A write may be in flight while the scan runs; only old temporary files
        // are interrupted publications.
        const temporary = name.match(TEMPORARY)?.[1];
        if (temporary) { if (this.pattern.test(temporary) && this.clock() - info.mtimeMs > 10 * 60_000) await unlink(file).catch(() => {}); continue; }
        if (!this.pattern.test(name)) continue;
        this.entries.set(name, {size: info.size, usedAt: info.mtimeMs, touchedAt: info.mtimeMs}); this.bytes += info.size;
      }
      await this.trim(null);
    })().catch(error => { this.ready = null; throw error; });
    return this.ready;
  }

  // Record a read without delaying it. The file time is refreshed at most daily.
  used(name) {
    void this.initialize().then(() => this.markUsed(name), () => {});
  }

  markUsed(name) {
    const entry = this.entries.get(name), now = this.clock();
    if (!entry) return;
    entry.usedAt = now;
    if (now - (entry.touchedAt ?? 0) < DAY) return;
    entry.touchedAt = now;
    const time = new Date(now);
    void utimes(path.join(this.directory, name), time, time).catch(() => {});
  }

  // Account for a published record, then evict older records over the budget.
  saved(name, size) {
    this.work = this.work.then(async () => {
      await this.initialize();
      if (!this.pattern.test(name)) return;
      // A record larger than the whole budget is served from memory only.
      if (size > this.maxBytes) { await this.remove(name); return; }
      this.bytes += size - (this.entries.get(name)?.size || 0);
      this.entries.set(name, {size, usedAt: this.clock(), touchedAt: this.clock()});
      await this.trim(name);
    }).catch(() => {});
    return this.work;
  }

  async canSave(name,size) {
    await this.initialize();
    return this.bytes-(this.entries.get(name)?.size||0)+size<=this.maxBytes && (this.entries.has(name)||this.entries.size<this.maxEntries);
  }

  async trim(keep) {
    if(!this.evict)return;
    const oldest = [...this.entries].sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [name] of oldest) {
      if (this.bytes <= this.maxBytes && this.entries.size <= this.maxEntries) break;
      if (name === keep) continue;
      await this.remove(name);
    }
  }

  async remove(name) {
    await unlink(path.join(this.directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const entry = this.entries.get(name);
    if (entry) { this.entries.delete(name); this.bytes -= entry.size; }
  }
}
