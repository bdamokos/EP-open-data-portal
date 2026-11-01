import {availabilityHistoryVersion} from './availability-history.mjs';
import {SITTING_SNAPSHOT_SCHEMA} from './sitting-snapshot-store.mjs';
import {corpusTextVersion} from './corpus-text-schema.mjs';
import {followMarksVersion} from './follow-marks.mjs';
import {activityReadVersion} from './activity-read-projections.mjs';
import {activityAvailabilityIndexVersion} from './availability-evidence.mjs';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,statSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ActivityStore} from './activity-index-store.mjs';
import {committeeAmendmentIndexVersion,amendmentReadVersion,amendmentLinkIndexVersion} from './amendments-store.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {absolutePathFromEnvironment,booleanFromEnvironment,integerFromEnvironment} from './config.mjs';

const bytes=filename=>['','-wal','-shm'].reduce((sum,suffix)=>sum+(existsSync(filename+suffix)?statSync(filename+suffix).size:0),0);
const prepared=(store,kind)=>store.get('resourceIndexes')===1&&store.get('availabilityHistoryVersion')===availabilityHistoryVersion&&(kind==='activity'?store.get('fastReadSchemaVersion')===1&&store.get('recoveryScheduleVersion')===1&&store.get('committeeAmendmentIndexVersion')===committeeAmendmentIndexVersion&&store.get('amendmentReadVersion')===amendmentReadVersion&&store.get('amendmentLinkIndexVersion')===amendmentLinkIndexVersion&&store.get('motionLinksIndexVersion')===1&&store.get('activityReadVersion')===activityReadVersion&&store.get('refreshPolicyVersion')===1&&store.get('followMarksVersion')===followMarksVersion&&store.get('activityAvailabilityIndexVersion')===activityAvailabilityIndexVersion&&store.get('sittingSnapshotSchema')===SITTING_SNAPSHOT_SCHEMA:store.get('questionDiscoveryVersion')===1&&store.get('corpusTextVersion')===corpusTextVersion);

// Run before opening the HTTP listener or starting either source writer.
export function prepareStartupIndexes() {
  const activity=booleanFromEnvironment('ACTIVITY_INDEX_ENABLED'),corpus=booleanFromEnvironment('CORPUS_ENABLED');
  const activityDirectory=activity?absolutePathFromEnvironment('ACTIVITY_INDEX_DIR'):undefined;
  const corpusDirectory=corpus?absolutePathFromEnvironment('CORPUS_DIR'):undefined;
  if(activity&&!activityDirectory)throw new Error('ACTIVITY_INDEX_DIR is required when the activity index is enabled.');
  if(corpus&&!corpusDirectory)throw new Error('CORPUS_DIR is required when the corpus is enabled.');
  if(!activity&&!corpus)return [];
  return prepareIndexes({activityDirectory,corpusDirectory,
    activityLimitMiB:integerFromEnvironment('ACTIVITY_INDEX_MAX_DISK_MIB',8192,64,131072),
    corpusLimitMiB:integerFromEnvironment('CORPUS_MAX_DISK_MIB',2048,64,131072),
  });
}

// No HTTP server, upstream calls, background jobs or generation changes. The
// normal leases still fence another writer; never override an unexpired lease.
export function prepareIndexes({activityDirectory,corpusDirectory,activityLimitMiB=8192,corpusLimitMiB=2048,clock=Date.now,log=console.log}={}) {
  const entries=[
    {kind:'activity',directory:activityDirectory,file:'activities-v1.sqlite',Store:ActivityStore,limit:activityLimitMiB},
    {kind:'corpus',directory:corpusDirectory,file:'corpus-v1.sqlite',Store:CorpusStore,limit:corpusLimitMiB},
  ].filter(entry=>entry.directory);
  if(!entries.length)throw new Error('Set ACTIVITY_INDEX_DIR and/or CORPUS_DIR to the mounted data directories.');
  // Check both before changing either database. A racing writer is fenced a
  // second time by acquire() under its SQLite writer reservation.
  for(const entry of entries) {
    const filename=path.join(entry.directory,entry.file);
    if(!existsSync(filename))continue;
    const db=new DatabaseSync(filename,{readOnly:true});
    try {
      db.exec('PRAGMA busy_timeout=250; PRAGMA cache_size=-512; PRAGMA mmap_size=0;');
      if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lease'").get()) {
        const lease=db.prepare('SELECT expires FROM lease WHERE id=1').get();
        if(lease&&lease.expires>clock())throw new Error(entry.kind+': writer lease is active. Stop the app and wait for release/expiry before preparing indexes.');
      }
    } finally {db.close();}
  }
  const results=[];
  for(const entry of entries) {
    const filename=path.join(entry.directory,entry.file),before=existsSync(filename)?bytes(filename):0,started=performance.now();
    log('[index-prepare]',entry.kind+': opening schema');
    const store=new entry.Store(entry.directory,{clock,initializeIndexes:true,prepareLog:message=>log('[index-prepare]',message)});
    try {
      const noop=prepared(store,entry.kind);
      if(!noop) {
        const exec=store.db.exec.bind(store.db);
        store.db.exec=sql=>{
          const label=sql.trim().replace(/\s+/g,' ').slice(0,110),at=performance.now();
          log('[index-prepare]',entry.kind+': '+label+' started');
          const result=exec(sql);
          log('[index-prepare]',entry.kind+': completed in '+Math.round(performance.now()-at)+' ms');
          return result;
        };
        if(!store.acquire())throw new Error(entry.kind+': writer lease is active; preparation stopped.');
        store.release();
        const checkpoint=store.db.prepare('PRAGMA main.wal_checkpoint(TRUNCATE)').get();
        if(checkpoint.busy)throw new Error(entry.kind+': WAL checkpoint is busy. Stop database readers and rerun preparation.');
      }
      const after=bytes(filename),result={kind:entry.kind,noop,durationMs:Math.round(performance.now()-started),beforeBytes:before,afterBytes:after,addedBytes:after-before,limitBytes:entry.limit*1024*1024};
      log('[index-prepare]',JSON.stringify(result));results.push(result);
      if(after>=result.limitBytes)throw new Error(entry.kind+': prepared database exceeds its disk cap. Raise '+(entry.kind==='activity'?'ACTIVITY_INDEX_MAX_DISK_MIB':'CORPUS_MAX_DISK_MIB')+' before starting the app.');
    } finally {store.close();}
  }
  return results;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {prepareIndexes({
    activityDirectory:absolutePathFromEnvironment('ACTIVITY_INDEX_DIR'),corpusDirectory:absolutePathFromEnvironment('CORPUS_DIR'),
    activityLimitMiB:integerFromEnvironment('ACTIVITY_INDEX_MAX_DISK_MIB',8192,64,131072),
    corpusLimitMiB:integerFromEnvironment('CORPUS_MAX_DISK_MIB',2048,64,131072),
  });} catch(error){console.error('[index-prepare]',error.message);process.exitCode=1;}
}
