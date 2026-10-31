import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {HttpError} from './http-utils.mjs';
import {requestSignal, waitForRequest} from './request-budget.mjs';

// Keep native work off the event loop, with one conversion at a time. The
// original JPEG and its public-source provenance remain in PortraitCache.
sharp.cache({memory: 8, files: 0, items: 16});
sharp.concurrency(1);
export async function portraitCard(body) {
  return sharp(body, {limitInputPixels: 25_000_000})
    .autoOrient().resize({width: 480, height: 640, fit: 'inside', withoutEnlargement: true})
    .webp({quality: 80, effort: 3}).timeout({seconds: 3}).toBuffer();
}

export class PortraitRenditions {
  constructor({transform = portraitCard, maxBytes = 16 * 1024 * 1024, maxEntries = 1024,
    maxPending = 32, maxPendingBytes = 32 * 1024 * 1024} = {}) {
    Object.assign(this, {transform, maxBytes, maxEntries, maxPending, maxPendingBytes});
    this.cache = new Map(); this.bytes = 0;
    this.pending = new Map(); this.pendingBytes = 0; this.tail = Promise.resolve();
  }

  async get(image) {
    requestSignal()?.throwIfAborted();
    const originalSha256 = createHash('sha256').update(image.body).digest('hex');
    // Transform version is part of the representation identity, not source provenance.
    const key = `card-v2:${originalSha256}`;
    let body = this.cache.get(key);
    if (body) {this.cache.delete(key); this.cache.set(key, body);}
    else {
      let job = this.pending.get(key);
      if (!job) {
        if (this.pending.size >= this.maxPending || this.pendingBytes + image.body.length > this.maxPendingBytes)
          throw Object.assign(new HttpError(503, 'upstream_busy', 'Portrait unavailable.'), {retryAfter: 1});
        this.pendingBytes += image.body.length;
        // The queue owns its work independently of any single HTTP reader.
        // Never release the next native operation before this one has settled.
        job = this.tail.then(async () => {
          let converted;
          try {converted = await this.transform(image.body);}
          catch {throw new HttpError(502, 'portrait_unavailable', 'Portrait unavailable.');}
          if (!converted.length || converted.length > 512 * 1024)
            throw new HttpError(502, 'portrait_size', 'Portrait too large.');
          if (converted.length <= this.maxBytes && this.maxEntries > 0) {
            this.cache.set(key, converted); this.bytes += converted.length;
            while (this.bytes > this.maxBytes || this.cache.size > this.maxEntries) {
              const oldest = this.cache.keys().next().value;
              this.bytes -= this.cache.get(oldest).length; this.cache.delete(oldest);
            }
          }
          return converted;
        }).finally(() => {this.pending.delete(key); this.pendingBytes -= image.body.length;});
        this.pending.set(key, job); this.tail = job.catch(() => {});
      }
      body = await waitForRequest(job);
    }
    // Revalidation of unchanged source bytes must still advance HTTP freshness.
    return {...image, body, contentType: 'image/webp', originalSha256, rendition: 'card-v2'};
  }
}

export const portraitRenditions = new PortraitRenditions();
