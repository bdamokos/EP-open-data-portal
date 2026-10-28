import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {digest} from './amendment-benchmark-cache.mjs';

export function monday(date) {
  const value=new Date(date+'T00:00:00Z');value.setUTCDate(value.getUTCDate()-(value.getUTCDay()+6)%7);return value.toISOString().slice(0,10);
}
export const validDecision = decision => /^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(decision.sittingId||'') && /^\d{4}-\d{2}-\d{2}$/.test(decision.date||'') && decision.sittingId==='MTG-PL-'+decision.date;
export const allDecisions = row => (row.decisions||[]).filter(validDecision);
export function decisionsInSample(row,sample) {
  if(sample.exclusions?.amendmentIds.includes(row.id))return [];
  return allDecisions(row).filter(d=>d.date<=sample.asOf&&(sample.mode==='documents'||sample.mode==='date-window'&&d.date>=sample.from&&d.date<=sample.to||sample.mode==='plenary-weeks'&&sample.weeks.includes(monday(d.date))));
}

// A snapshot's sample is defined by its frozen catalogue, never by which rows
// happened to be extracted, placed or included in a later benchmark report.
export async function excludedSnapshot(filename) {
  const snapshot=JSON.parse(await readFile(filename,'utf8'));
  const {apiBase,sample,manifest,snapshotId}=snapshot;
  if(!sample||!Array.isArray(manifest)||digest(JSON.stringify({apiBase,sample,manifest}))!==snapshotId)throw new Error('Invalid exclusion snapshot manifest: '+filename);
  const ids=new Set();let pages=0;
  for(const meta of manifest) {
    const url=new URL(meta.url);
    if(url.origin!==apiBase||url.pathname!=='/api/amendments')continue;
    const identity=meta.request?JSON.stringify([meta.url,meta.request]):meta.url;
    const body=await readFile(path.join(path.dirname(filename),'inputs',digest(identity)+'.body'));
    if(!meta.ok||body.length!==meta.bytes||digest(body)!==meta.sha256)throw new Error('Invalid exclusion catalogue input: '+meta.url);
    const catalogue=JSON.parse(body.toString('utf8'));
    if(!Array.isArray(catalogue.items))throw new Error('Invalid exclusion catalogue: '+meta.url);
    pages++;
    for(const row of catalogue.items)if(decisionsInSample(row,sample).length) {
      if(typeof row.id!=='string'||!row.id)throw new Error('Missing exclusion amendment ID');
      ids.add(row.id);
    }
  }
  if(!pages||!ids.size)throw new Error('Exclusion snapshot has no sampled amendment IDs: '+filename);
  return {snapshotId,amendmentIds:[...ids].sort()};
}

export async function sampleExclusions(filenames) {
  const sources=[];const ids=new Set();
  for(const filename of [...new Set(filenames)].sort()) {
    const source=await excludedSnapshot(path.resolve(filename));
    sources.push(source.snapshotId);
    for(const id of source.amendmentIds)ids.add(id);
  }
  return sources.length?{snapshotIds:[...new Set(sources)].sort(),amendmentIds:[...ids].sort()}:undefined;
}
