import {createHash} from 'node:crypto';
import {readFile,readdir,rmdir,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {statSync} from 'node:fs';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {writeCacheFile} from './cache-publication.mjs';
import {integerFromEnvironment} from './config.mjs';
import {normalizedDocxDescriptor,sameDocxDescriptor} from './amendments.mjs';

// Downloaded amendment-list DOCX bytes, retained outside index generations.
// Raw files are content-addressed by SHA-256. The leased index writer records
// each published distribution descriptor (URL, language, declared size and
// issue time) with the hash and original retrieval time of the bytes it served.
// A later parser version can re-read those bytes while the descriptor is still
// current, independently of age. Only superseded or unreferenced versions are
// evicted, and only to keep the directory inside its disk budget.
export const AMENDMENT_SOURCE_LIMITS=Object.freeze({maxFileBytes:8*1024*1024,defaultMaxMiB:512});
const HASH=/^[0-9a-f]{64}$/,BLOB=/^([0-9a-f]{64})\.docx$/,TEMPORARY=/^[0-9a-f]{64}\.docx\.[0-9a-f-]{36}\.tmp$/,LEGACY=/^[0-9a-f]{64}\.json$/;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const stores=new WeakMap();

export function amendmentSourceStore(store,{maxBytes}={}) {
  let instance=stores.get(store);
  if(!instance){instance=new AmendmentSourceStore(store,{maxBytes});stores.set(store,instance);}
  return instance;
}

const key=descriptor=>{
  const file=normalizedDocxDescriptor(descriptor);
  return file&&{url:file.url,language:file.language ?? '',byteSize:file.byteSize ?? -1,issued:file.issued ?? ''};
};
const descriptorOf=row=>normalizedDocxDescriptor({url:row.url,language:row.language||null,byteSize:row.byte_size<0?null:row.byte_size,issued:row.issued||null});

class AmendmentSourceStore {
  constructor(store,{maxBytes}={}) {
    this.store=store;this.directory=path.join(path.dirname(store.filename),'amendment-docx-v2');
    this.legacyDirectory=path.join(path.dirname(store.filename),'amendment-docx-v1');
    this.maxBytes=maxBytes ?? integerFromEnvironment('AMENDMENT_SOURCE_MAX_DISK_MIB',AMENDMENT_SOURCE_LIMITS.defaultMaxMiB,64,8192)*1024*1024;
    this.ready=null;this.full=false;
  }
  schema() {
    if(this.schemaReady)return;
    this.store.assertWriter();
    // Empty strings and -1 stand for unpublished language, issue time and size,
    // so the primary key also covers descriptors without them.
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS amendment_sources(url TEXT NOT NULL,language TEXT NOT NULL,byte_size INTEGER NOT NULL,issued TEXT NOT NULL,
      sha256 TEXT NOT NULL,size INTEGER NOT NULL,retrieved_at TEXT NOT NULL,list_id TEXT,PRIMARY KEY(url,language,byte_size,issued)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS amendment_sources_hash ON amendment_sources(sha256);
      CREATE TABLE IF NOT EXISTS amendment_source_bindings(url TEXT NOT NULL,language TEXT NOT NULL,byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,issued TEXT NOT NULL,PRIMARY KEY(url,language,byte_size,sha256)) WITHOUT ROWID;
      INSERT OR IGNORE INTO amendment_source_bindings SELECT url,language,byte_size,sha256,issued FROM amendment_sources
        WHERE issued<>'' ORDER BY retrieved_at DESC,issued DESC;`);
    this.schemaReady=true;
  }
  // Import once per process; revisit recent interrupted publications on later
  // writer accesses after their publication grace period has elapsed.
  async initialize({signal}={}) {
    try {
      if(!this.schemaReady&&this.store.clock()<(this.retryAt ?? 0))return false;
      this.store.assertWriter();this.schema();
      if(this.store.clock()>=(this.retryAt ?? 0)) {
        this.ready??=this.migrateLegacy({signal});
        if(!await this.ready){this.ready=null;this.retryAt=this.store.clock()+60_000;}
        if(this.store.clock()>=(this.sweepAfter ?? 0)) {
          await this.sweepOrphans();this.sweepAfter=this.store.clock()+10*60_000;
        }
      }
      return true;
    }catch(error){
      this.ready=null;this.retryAt=this.store.clock()+60_000;
      return this.storageFailure(error,{signal});
    }
  }
  storageFailure(error,{signal}={}) {
    signal?.throwIfAborted();
    if(error?.name==='AbortError'||error?.code==='ABORT_ERR'||error?.message==='Activity-index writer lease was lost.')throw error;
    if(!this.warned){console.warn(`[amendment-sources] byte retention unavailable (${error?.code || 'storage error'}); extraction continues without retention`);this.warned=true;}
    return false;
  }
  async sweepOrphans() {
    this.store.assertWriter();
    let names=[];
    try {names=await readdir(this.directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    const known=new Set(this.store.db.prepare('SELECT DISTINCT sha256 FROM amendment_sources').all().map(row=>row.sha256));
    for(const name of names) {
      const hash=name.match(BLOB)?.[1];
      if(hash&&known.has(hash))continue;
      if(!hash&&!TEMPORARY.test(name))continue;
      // Writers in this process publish before indexing; skip recent files.
      const info=await stat(path.join(this.directory,name)).catch(()=>null);
      if(info?.isFile()&&this.store.clock()-info.mtimeMs>10*60_000)await unlink(path.join(this.directory,name)).catch(()=>{});
    }
  }
  async migrateLegacy({signal}={}) {
    let names;
    try {names=(await readdir(this.legacyDirectory)).filter(name=>LEGACY.test(name));}catch(error){if(error.code==='ENOENT')return true;throw error;}
    let imported=0,complete=true;
    for(const name of names) {
      signal?.throwIfAborted();
      const file=path.join(this.legacyDirectory,name);
      const contents=await readFile(file,'utf8');
      let record;
      try {record=JSON.parse(contents);}catch(error){if(!(error instanceof SyntaxError))throw error;}
      let remove=true;
      if(record&&typeof record==='object') {
        const buffer=typeof record.bytes==='string'?Buffer.from(record.bytes,'base64'):null;
        if(record.version===1&&buffer&&buffer.length<=AMENDMENT_SOURCE_LIMITS.maxFileBytes&&sha256(buffer)===record.sha256&&Number.isFinite(Date.parse(record.fetchedAt))&&normalizedDocxDescriptor(record.descriptor)) {
          remove=await this.save(record.descriptor,buffer,record.fetchedAt,{signal,legacy:true});
          if(remove)imported++;
          else complete=false;
        }
      }
      signal?.throwIfAborted();this.store.assertWriter();
      if(remove)await unlink(file);
      await yieldTurn();
    }
    await rmdir(this.legacyDirectory).catch(()=>{});
    if(imported)console.info(`[amendment-sources] imported ${imported} of ${names.length} legacy DOCX cache records`);
    return complete;
  }
  match(descriptor) {
    const wanted=key(descriptor);if(!wanted)return null;
    const dated=this.store.db.prepare('SELECT 1 FROM amendment_source_bindings WHERE url=? AND language=? AND byte_size=? LIMIT 1').get(wanted.url,wanted.language,wanted.byteSize);
    const rows=this.store.db.prepare('SELECT * FROM amendment_sources WHERE url=? AND language=? AND byte_size=?').all(wanted.url,wanted.language,wanted.byteSize)
      .filter(row=>sameDocxDescriptor(descriptorOf(row),descriptor)&&!(wanted.issued&&!row.issued&&(dated||Date.parse(row.retrieved_at)<Date.parse(wanted.issued))));
    // Prefer a row with the same published issue time over one without it.
    return rows.sort((a,b)=>Number(Boolean(b.issued&&wanted.issued))-Number(Boolean(a.issued&&wanted.issued))||b.retrieved_at.localeCompare(a.retrieved_at))[0] || null;
  }
  // Check only during target preparation. read() verifies the hash before use.
  has(descriptor) {
    try {
      if(!this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='amendment_sources'").get())return false;
      const row=this.match(descriptor);if(!row)return false;
      const info=statSync(path.join(this.directory,row.sha256+'.docx'));return info.isFile()&&info.size===row.size;
    }catch(error){if(error.code!=='ENOENT')this.storageFailure(error);return false;}
  }
  // Publication knowledge is independent of the blob budget. Undated writes
  // recover the binding for these exact bytes; they never replace it.
  boundDescriptor(descriptor,hash) {
    const file=normalizedDocxDescriptor(descriptor),wanted=key(file);
    if(!wanted||file.issued||!this.schemaReady)return file;
    try {
      const binding=this.store.db.prepare('SELECT issued FROM amendment_source_bindings WHERE url=? AND language=? AND byte_size=? AND sha256=?')
        .get(wanted.url,wanted.language,wanted.byteSize,hash);
      return binding?{...file,issued:binding.issued}:file;
    }catch(error){this.storageFailure(error);return file;}
  }
  // Returns the exact retained bytes and their original retrieval time. A
  // missing or damaged file removes its row so the caller can download again.
  async read(descriptor,options={}) {
    try {return await this.readBytes(descriptor,options);}
    catch(error){this.storageFailure(error,options);return null;}
  }
  async readBytes(descriptor,{listId=null,signal}={}) {
    if(!await this.initialize({signal}))return null;
    const row=this.match(descriptor);if(!row)return null;
    const file=path.join(this.directory,row.sha256+'.docx');
    let buffer=null;
    try {buffer=await readFile(file);}catch(error){signal?.throwIfAborted();if(error.code!=='ENOENT')throw error;}
    signal?.throwIfAborted();
    if(!buffer||buffer.length!==row.size||sha256(buffer)!==row.sha256) {
      this.store.assertWriter();
      this.store.db.prepare('DELETE FROM amendment_sources WHERE sha256=?').run(row.sha256);
      await unlink(file).catch(()=>{});
      return null;
    }
    if(listId&&row.list_id!==listId){this.store.assertWriter();this.store.db.prepare('UPDATE amendment_sources SET list_id=? WHERE url=? AND language=? AND byte_size=? AND issued=?').run(listId,row.url,row.language,row.byte_size,row.issued);}
    return {buffer,fetchedAt:row.retrieved_at,sha256:row.sha256};
  }
  // Records bytes served for a current descriptor. Returns false when they
  // cannot be retained; extraction can still use the in-memory bytes.
  async save(descriptor,buffer,retrievedAt,options={}) {
    try {return await this.saveBytes(descriptor,buffer,retrievedAt,options);}
    catch(error){return this.storageFailure(error,options);}
  }
  async saveBytes(descriptor,buffer,retrievedAt,{listId=null,signal,legacy=false,downloaded=!legacy,onPublicationChange}={}) {
    if(!legacy&&!await this.initialize({signal}))return false;
    let wanted=key(descriptor);const db=this.store.db;
    if(!wanted||!Buffer.isBuffer(buffer)||buffer.length>AMENDMENT_SOURCE_LIMITS.maxFileBytes||!Number.isFinite(Date.parse(retrievedAt)))return false;
    // The same or a less specific descriptor is replaced; other versions of the
    // URL remain as superseded evidence until the budget needs their space.
    const hash=sha256(buffer);
    this.store.assertWriter();
    signal?.throwIfAborted();
    if(wanted.issued) {
      const bindings=db.prepare('SELECT sha256,issued FROM amendment_source_bindings WHERE url=? AND language=? AND byte_size=?').all(wanted.url,wanted.language,wanted.byteSize);
      const prior=bindings.find(row=>row.sha256===hash);
      const proved=bindings.some(row=>row.sha256===hash&&Date.parse(row.issued)===Date.parse(wanted.issued))||
        db.prepare('SELECT issued FROM amendment_sources WHERE url=? AND language=? AND byte_size=? AND sha256=? AND issued<>?').all(wanted.url,wanted.language,wanted.byteSize,hash,'')
          .some(row=>Date.parse(row.issued)===Date.parse(wanted.issued));
      if(!downloaded&&!proved&&(bindings.length||Date.parse(retrievedAt)<Date.parse(wanted.issued))) {
        onPublicationChange?.();return false;
      }
      // First-use legacy compatibility establishes the first binding. Only a
      // dated download can replace an existing binding, even for identical bytes.
      if(downloaded||!prior)db.prepare('INSERT INTO amendment_source_bindings VALUES (?,?,?,?,?) ON CONFLICT(url,language,byte_size,sha256) DO UPDATE SET issued=excluded.issued')
        .run(wanted.url,wanted.language,wanted.byteSize,hash,wanted.issued);
    }
    wanted=key(this.boundDescriptor(descriptor,hash));
    const matching=()=>db.prepare('SELECT * FROM amendment_sources WHERE url=? AND language=? AND byte_size=?').all(wanted.url,wanted.language,wanted.byteSize)
      .filter(row=>row.issued===wanted.issued||Boolean(wanted.issued)&&(!row.issued||Date.parse(row.issued)===Date.parse(wanted.issued)));
    // A restart may encounter a record imported before its legacy file was
    // removed. Delete that input only after verifying equivalent retained bytes.
    if(legacy&&matching().length) {
      if(!matching().some(row=>row.sha256===hash&&row.size===buffer.length))return false;
      try {return sha256(await readFile(path.join(this.directory,hash+'.docx')))===hash;}
      catch(error){if(error.code==='ENOENT')return false;throw error;}
    }
    if(!db.prepare('SELECT 1 FROM amendment_sources WHERE sha256=? LIMIT 1').get(hash)) {
      if(!await this.reserve(buffer.length,{signal}))return false;
      await writeCacheFile(path.join(this.directory,hash+'.docx'),buffer,{signal});
    }
    signal?.throwIfAborted();
    const replaced=this.store.transaction(()=>{
      this.store.assertWriter();
      const rows=matching(),same=rows.find(row=>row.sha256===hash);
      for(const row of rows)db.prepare('DELETE FROM amendment_sources WHERE url=? AND language=? AND byte_size=? AND issued=?').run(row.url,row.language,row.byte_size,row.issued);
      // Repeated retrievals of identical bytes keep the latest retrieval time.
      const at=same&&Date.parse(same.retrieved_at)>Date.parse(retrievedAt)?same.retrieved_at:retrievedAt;
      db.prepare('INSERT INTO amendment_sources VALUES (?,?,?,?,?,?,?,?)').run(wanted.url,wanted.language,wanted.byteSize,wanted.issued,hash,buffer.length,at,listId ?? same?.list_id ?? null);
      return rows.map(row=>row.sha256).filter(other=>other!==hash);
    });
    await this.release(replaced);
    return true;
  }
  async release(hashes) {
    for(const hash of new Set(hashes)) {
      if(!HASH.test(hash)||this.store.db.prepare('SELECT 1 FROM amendment_sources WHERE sha256=? LIMIT 1').get(hash))continue;
      await unlink(path.join(this.directory,hash+'.docx')).catch(()=>{});
    }
  }
  usedBytes() {
    return this.store.db.prepare('SELECT COALESCE(SUM(size),0) AS n FROM (SELECT MAX(size) AS size FROM amendment_sources GROUP BY sha256)').get().n;
  }
  // A version is superseded when a later retrieval exists for the same URL and
  // language under a different descriptor. A version is unreferenced when no
  // retained generation still publishes it for its list.
  referenced(row) {
    if(!row.list_id)return false;
    const descriptor=descriptorOf(row),generations=[...new Set([this.store.get('active'),this.store.get('previous'),this.store.get('working')?.generation].filter(Number.isInteger))];
    const statement=this.store.db.prepare("SELECT d.value FROM sources AS s,json_each(s.body,'$.distributionEvidence.descriptors') AS d WHERE s.generation=? AND s.key=? AND s.kind='amendment-list'");
    return generations.some(generation=>statement.all(generation,'amendment:list:'+row.list_id).some(({value})=>sameDocxDescriptor(JSON.parse(value),descriptor)));
  }
  *evictable() {
    const db=this.store.db,id=row=>[row.url,row.language,row.byte_size,row.issued].join('\n');
    const superseded=db.prepare(`SELECT a.* FROM amendment_sources a WHERE EXISTS(SELECT 1 FROM amendment_sources b WHERE b.url=a.url AND b.language=a.language
      AND (b.byte_size<>a.byte_size OR b.issued<>a.issued) AND b.retrieved_at>a.retrieved_at) ORDER BY a.retrieved_at`).all(),seen=new Set(superseded.map(id));
    for(const row of superseded)if(!this.referenced(row))yield row;
    for(const row of db.prepare('SELECT * FROM amendment_sources ORDER BY retrieved_at').all())if(!seen.has(id(row))&&!this.referenced(row))yield row;
  }
  async reserve(bytes,{signal}={}) {
    if(this.usedBytes()+bytes<=this.maxBytes){this.full=false;return true;}
    // Index rows are small; reference checks run lazily, only while space is short.
    for(const row of this.evictable()) {
      signal?.throwIfAborted();this.store.assertWriter();
      this.store.db.prepare('DELETE FROM amendment_sources WHERE url=? AND language=? AND byte_size=? AND issued=?').run(row.url,row.language,row.byte_size,row.issued);
      await this.release([row.sha256]);
      if(this.usedBytes()+bytes<=this.maxBytes){this.full=false;return true;}
    }
    if(!this.full)console.warn(`[amendment-sources] disk budget of ${Math.round(this.maxBytes/1048576)} MiB is held by current sources; new bytes are not retained`);
    this.full=true;
    return false;
  }
}
