import {mkdir, open, readdir, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import {HttpError} from './http-utils.mjs';

const IMAGE_LIMIT = 2 * 1024 * 1024;
const HEADER_LIMIT = 4096;
const digest = body => createHash('sha256').update(body).digest('hex');
const unavailable = () => new HttpError(502, 'portrait_unavailable', 'Portrait unavailable.');

function officialPortrait(value) {
  const url = new URL(value);
  if (url.origin !== 'https://www.europarl.europa.eu' ||
      !/^\/mepphoto\/[1-9][0-9]*\.jpg$/.test(url.pathname) || url.search || url.hash || url.username || url.password)
    throw new HttpError(404, 'portrait_unavailable', 'Portrait unavailable.');
  return url.href;
}

// One writer per cache directory, as with the other public-source caches.
export class PortraitCache {
  constructor({directory = process.env.ODP_CACHE_DIR && path.join(process.env.ODP_CACHE_DIR, 'portraits-v1'),
    clock = Date.now, fetchImpl = (...args) => fetch(...args), freshMs = 7 * 86400_000,
    retryMs = 5 * 60_000, maxDiskBytes = 128 * 1024 * 1024, maxDiskEntries = 2048,
    maxMemoryBytes = 8 * 1024 * 1024, maxMemoryEntries = 120,
    warn = message => console.warn(message)} = {}) {
    Object.assign(this, {directory, clock, fetchImpl, freshMs, retryMs, maxDiskBytes, maxDiskEntries,
      maxMemoryBytes, maxMemoryEntries, warn});
    this.memory = new Map(); this.memoryBytes = 0;
    this.pending = new Map(); this.refreshes = new Map(); this.failures = new Map();
    this.files = new Map(); this.diskBytes = 0; this.writes = Promise.resolve();
    this.initialized = null; this.warned = false;
  }

  diskError() {
    if (!this.warned) {
      this.warned = true;
      this.warn('Portrait disk cache unavailable; serving with bounded memory caching.');
    }
  }

  remember(id, image) {
    const previous = this.memory.get(id);
    if (previous) this.memoryBytes -= previous.body.length;
    this.memory.delete(id);
    if (image.body.length <= this.maxMemoryBytes && this.maxMemoryEntries > 0) {
      this.memory.set(id, image); this.memoryBytes += image.body.length;
    }
    while (this.memory.size > this.maxMemoryEntries || this.memoryBytes > this.maxMemoryBytes) {
      const oldest = this.memory.keys().next().value;
      this.memoryBytes -= this.memory.get(oldest).body.length;
      this.memory.delete(oldest);
    }
    return image;
  }

  async removeFile(id) {
    await unlink(path.join(this.directory, `${id}.portrait`)).catch(error => {if (error.code !== 'ENOENT') throw error;});
    this.diskBytes -= this.files.get(id)?.size || 0;
    this.files.delete(id);
  }

  async trim(extraBytes = 0, extraEntries = 0, preserveId = null) {
    const oldest = [...this.files].sort((a, b) => a[1].savedAt - b[1].savedAt);
    for (const [id] of oldest) {
      if (this.diskBytes + extraBytes <= this.maxDiskBytes && this.files.size + extraEntries <= this.maxDiskEntries) break;
      if (id === preserveId) continue;
      await this.removeFile(id);
    }
    return this.diskBytes + extraBytes <= this.maxDiskBytes && this.files.size + extraEntries <= this.maxDiskEntries;
  }

  async initialize() {
    if (!this.directory) return;
    this.initialized ??= (async () => {
      await mkdir(this.directory, {recursive: true});
      for (const entry of await readdir(this.directory, {withFileTypes: true})) {
        // Remove only our interrupted atomic writes, never unrelated cache data.
        if (entry.isFile() && /^\.[1-9][0-9]*\.[0-9a-f-]+\.tmp$/.test(entry.name)) {
          await unlink(path.join(this.directory, entry.name)); continue;
        }
        if (!entry.isFile() || !/^[1-9][0-9]*\.portrait$/.test(entry.name)) continue;
        const id = Number(entry.name.split('.')[0]);
        const info = await stat(path.join(this.directory, entry.name));
        this.files.set(id, {size: info.size, savedAt: info.mtimeMs}); this.diskBytes += info.size;
      }
      await this.trim();
    })();
    return this.initialized;
  }

  async read(id) {
    if (!this.directory) return null;
    let file;
    try {
      await this.initialize();
      if (!this.files.has(id)) return null;
      file = await open(path.join(this.directory, `${id}.portrait`), 'r');
      const info = await file.stat();
      if (info.size > IMAGE_LIMIT + HEADER_LIMIT + 4) return null;
      const data = await file.readFile();
      const headerLength = data.length >= 4 ? data.readUInt32BE(0) : 0;
      if (!headerLength || headerLength > HEADER_LIMIT || headerLength + 4 >= data.length) return null;
      const header = JSON.parse(data.subarray(4, 4 + headerLength).toString('utf8'));
      const body = data.subarray(4 + headerLength);
      if (header.version !== 1 || header.memberId !== id || !Number.isFinite(header.fetchedAt) ||
          header.fetchedAt <= 0 || header.fetchedAt > this.clock() || header.contentType !== 'image/jpeg' ||
          officialPortrait(header.sourceUrl) !== header.sourceUrl || body.length > IMAGE_LIMIT ||
          digest(body) !== header.sha256) return null;
      return this.remember(id, {...header, body});
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof HttpError) && error.code !== 'ENOENT') this.diskError();
      return null;
    } finally {
      await file?.close();
    }
  }

  async save(id, image) {
    if (!this.directory) return;
    // Serialize pruning and writes so parallel downloads cannot exceed the budget.
    const operation = this.writes.then(async () => {
      let temporary;
      try {
        await this.initialize();
        const {body, ...metadata} = image;
        const header = Buffer.from(JSON.stringify({...metadata, version: 1, sha256: digest(body)}));
        const prefix = Buffer.alloc(4); prefix.writeUInt32BE(header.length);
        const data = Buffer.concat([prefix, header, body]);
        if (data.length > this.maxDiskBytes || this.maxDiskEntries < 1) return;
        // Retain the old file until the replacement is complete. The temporary
        // file also fits inside the budget; a failed refresh cannot erase it.
        const previousSize = this.files.get(id)?.size || 0;
        if (!await this.trim(data.length, this.files.has(id) ? 0 : 1, id)) return;
        temporary = path.join(this.directory, `.${id}.${randomUUID()}.tmp`);
        await writeFile(temporary, data, {flag: 'wx'});
        await rename(temporary, path.join(this.directory, `${id}.portrait`));
        temporary = null;
        this.files.set(id, {size: data.length, savedAt: this.clock()}); this.diskBytes += data.length - previousSize;
      } catch { this.diskError(); }
      finally { if (temporary) await unlink(temporary).catch(() => {}); }
    });
    this.writes = operation.catch(() => {});
    await operation;
  }

  async download(id, resolveSource) {
    const sourceUrl = officialPortrait(await resolveSource(id));
    const response = await this.fetchImpl(sourceUrl, {
      headers: {'User-Agent': 'Mozilla/5.0 (compatible; Parliament-Explorer/0.1)', Accept: 'image/jpeg'},
      redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!response.ok || contentType !== 'image/jpeg' || !response.body) {
      await response.body?.cancel(); throw unavailable();
    }
    const tooLarge = () => new HttpError(502, 'portrait_size', 'Portrait too large.');
    if (Number(response.headers.get('content-length')) > IMAGE_LIMIT) {
      await response.body.cancel(); throw tooLarge();
    }
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      for (;;) {
        const {value, done} = await reader.read();
        if (done) break;
        size += value.length;
        if (size > IMAGE_LIMIT) { await reader.cancel(); throw tooLarge(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (!size) throw unavailable();
    return {memberId: id, sourceUrl, fetchedAt: this.clock(), contentType, body: Buffer.concat(chunks, size)};
  }

  refresh(id, resolveSource) {
    if (this.refreshes.has(id)) return this.refreshes.get(id);
    const failure = this.failures.get(id);
    if (failure && this.clock() < failure.retryAt) return Promise.reject(failure.error);
    const job = (async () => {
      try {
        const image = await this.download(id, resolveSource);
        this.remember(id, image); this.failures.delete(id);
        await this.save(id, image);
        return image;
      } catch (error) {
        this.failures.delete(id);
        this.failures.set(id, {error, retryAt: this.clock() + this.retryMs});
        if (this.failures.size > 120) this.failures.delete(this.failures.keys().next().value);
        throw error;
      } finally { this.refreshes.delete(id); }
    })();
    this.refreshes.set(id, job);
    return job;
  }

  get(id, resolveSource) {
    if (!Number.isSafeInteger(id) || id < 1) return Promise.reject(new HttpError(400, 'invalid_id', 'id must be a positive integer'));
    if (this.pending.has(id)) return this.pending.get(id);
    const job = (async () => {
      let image = this.memory.get(id);
      if (image) this.remember(id, image);
      else image = await this.read(id);
      if (!image) return this.refresh(id, resolveSource);
      if (this.clock() - image.fetchedAt >= this.freshMs) {
        // A retained portrait stays visible during a refresh or an upstream outage.
        void this.refresh(id, resolveSource).catch(() => {});
      }
      return image;
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, job);
    return job;
  }
}
