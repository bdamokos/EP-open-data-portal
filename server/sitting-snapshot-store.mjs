import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {absolutePathFromEnvironment,integerFromEnvironment} from './config.mjs';
import {observeSqlite} from './sqlite-observability.mjs';

export const SITTING_SNAPSHOT_SCHEMA=1, SITTING_CALENDAR_VERSION=1;
export const SNAPSHOT_MAX_BYTES=32*1024*1024;
export const snapshotDiskLimit=()=>integerFromEnvironment('SITTING_SNAPSHOT_MAX_DISK_MIB',256,16,2048)*1024*1024;
const encode=value=>{
  const json=JSON.stringify(value);
  if(Buffer.byteLength(json)>SNAPSHOT_MAX_BYTES)throw new Error('Sitting snapshot exceeds its bounded size.');
  return gzipSync(json);
};
const decode=body=>JSON.parse(gunzipSync(body,{maxOutputLength:SNAPSHOT_MAX_BYTES}).toString('utf8'));

// Additive, generation-independent observations, prepared before HTTP startup.
export function prepareSittingSnapshots(store) {
  store.assertWriter();
  store.db.exec(`CREATE TABLE IF NOT EXISTS sitting_snapshots (
    kind TEXT, version INTEGER, id TEXT, complete INTEGER NOT NULL DEFAULT 0,
    checked_at INTEGER, next_check INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0, error TEXT, body BLOB,
    PRIMARY KEY(kind,version,id));
    CREATE INDEX IF NOT EXISTS sitting_snapshot_due ON sitting_snapshots(next_check,priority DESC);
    CREATE TABLE IF NOT EXISTS sitting_snapshot_staging (
    kind TEXT, version INTEGER, id TEXT, key TEXT, saved_at INTEGER, body BLOB,
    PRIMARY KEY(kind,version,id,key));`);
  store.set('sittingSnapshotSchema',SITTING_SNAPSHOT_SCHEMA);
}

// Foreground readers submit IDs only. The leased index writer drains these
// bounded hints; normal calendar discovery also recovers them after a restart.
export class SittingSnapshotHints {
  constructor(){this.ids=new Map();}
  enqueue(kind,version,id,{changedDeclarations=false}={}){
    const key=JSON.stringify([kind,version,id]);
    if(this.ids.has(key)||this.ids.size<512)this.ids.set(key,{kind,version,id,changedDeclarations:changedDeclarations||Boolean(this.ids.get(key)?.changedDeclarations)});
  }
  drain(){const hints=[...this.ids.values()];this.ids.clear();return hints;}
  get size(){return this.ids.size;}
}
export const sittingSnapshotHints=new SittingSnapshotHints();

export class SittingSnapshotReader {
  constructor({db=null,directory=()=>absolutePathFromEnvironment('ACTIVITY_INDEX_DIR'),clock=Date.now,hints=sittingSnapshotHints}={}){this.db=db;this.directory=directory;this.clock=clock;this.hints=hints;this.owned=false;}
  connection(){
    if(this.db)return this.db;
    const directory=typeof this.directory==='function'?this.directory():this.directory;
    if(!directory)return null;
    const filename=path.join(directory,'activities-v1.sqlite');
    if(!existsSync(filename))return null;
    let db;
    try {
      db=observeSqlite(new DatabaseSync(filename,{readOnly:true}),'sitting-snapshots');
      db.exec('PRAGMA busy_timeout=250;');
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='sitting_snapshots'").get()){db.close();return null;}
      this.db=db;this.owned=true;return db;
    }catch{db?.close();return null;}
  }
  read(kind,version,id){
    try {
      // Filter on metadata before reading or decompressing any payload.
      const row=this.connection()?.prepare('SELECT body FROM sitting_snapshots WHERE kind=? AND version=? AND id=? AND complete=1 AND error IS NULL AND next_check>?').get(kind,version,id,this.clock());
      if(row?.body)return decode(row.body);
    }catch{/* Unavailable/corrupt local evidence falls back to the public reader. */}
    return null;
  }
  enqueue(kind,version,id,options){this.hints.enqueue(kind,version,id,options);}
  close(){if(this.owned)this.db.close();this.db=null;}
}
export const sittingSnapshots=new SittingSnapshotReader();

export class SittingSnapshotWriter {
  constructor(store,{diskLimit=snapshotDiskLimit()}={}){this.store=store;this.db=store.db;this.diskLimit=diskLimit;}
  enqueue(kind,version,id,priority=0,{changedDeclarations=false}={}){
    this.store.assertWriter();
    // Changed declarations reopen successful observations, preserving failure backoff.
    this.db.prepare('INSERT INTO sitting_snapshots(kind,version,id,priority) VALUES (?,?,?,?) ON CONFLICT(kind,version,id) DO UPDATE SET priority=MAX(priority,excluded.priority),next_check=CASE WHEN ? AND complete=1 AND error IS NULL THEN 0 ELSE next_check END').run(kind,version,id,priority,Number(changedDeclarations));
  }
  due(now){return this.db.prepare('SELECT kind,version,id,attempts FROM sitting_snapshots WHERE next_check<=? ORDER BY priority DESC,next_check,id DESC LIMIT 1').get(now);}
  hasDue(now){return Boolean(this.db.prepare('SELECT 1 FROM sitting_snapshots WHERE next_check<=? LIMIT 1').get(now));}
  usage(){return this.db.prepare('SELECT COALESCE(SUM(length(body)),0) AS n FROM sitting_snapshots').get().n+this.db.prepare('SELECT COALESCE(SUM(length(body)),0) AS n FROM sitting_snapshot_staging').get().n;}
  retain(job,value,{complete,now,next}){
    this.store.assertWriter();
    const body=encode(value);
    this.store.transaction(()=>{
      this.store.assertWriter();
      const old=this.db.prepare('SELECT length(body) AS n FROM sitting_snapshots WHERE kind=? AND version=? AND id=?').get(job.kind,job.version,job.id)?.n||0;
      const staged=this.db.prepare('SELECT COALESCE(SUM(length(body)),0) AS n FROM sitting_snapshot_staging WHERE kind=? AND version=? AND id=?').get(job.kind,job.version,job.id).n;
      if(this.usage()-old-staged+body.length>this.diskLimit)throw new Error('Sitting snapshots reached their configured disk limit.');
      this.db.prepare('UPDATE sitting_snapshots SET body=?,complete=?,checked_at=?,next_check=?,attempts=?,priority=0,error=NULL WHERE kind=? AND version=? AND id=?').run(body,Number(complete),now,next,complete?0:job.attempts+1,job.kind,job.version,job.id);
      this.clearStage(job);
    });
  }

  fail(job,error,next){
    this.store.assertWriter();
    this.db.prepare('UPDATE sitting_snapshots SET attempts=attempts+1,next_check=?,priority=0,error=? WHERE kind=? AND version=? AND id=?').run(next,error.message,job.kind,job.version,job.id);
    this.clearStage(job);
  }
  stage(job,key,record,now){
    this.store.assertWriter();const body=encode(record);
    if(this.usage()+body.length>this.diskLimit)throw new Error('Sitting snapshots reached their configured disk limit.');
    this.db.prepare('INSERT OR REPLACE INTO sitting_snapshot_staging VALUES (?,?,?,?,?,?)').run(job.kind,job.version,job.id,key,now,body);
  }
  staged(job,key,now){
    const row=this.db.prepare('SELECT body FROM sitting_snapshot_staging WHERE kind=? AND version=? AND id=? AND key=? AND saved_at>?').get(job.kind,job.version,job.id,key,now-60*60_000);
    return row?decode(row.body):null;
  }
  clearStage(job){this.db.prepare('DELETE FROM sitting_snapshot_staging WHERE kind=? AND version=? AND id=?').run(job.kind,job.version,job.id);}
}
