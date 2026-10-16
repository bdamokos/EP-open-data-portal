import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import path from 'node:path';

// Full-text corpus of speeches, questions and answers. It lives beside the
// activity index but outside its refresh generations, so a refresh never copies
// stored text. `documents.source_id` is the exact API identifier and joins to
// the attached index's `items.source_id`.
const KINDS=['speech','question','answer'];
const parse=value=>value==null?null:JSON.parse(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
export const CORPUS_LIMITS=Object.freeze({searchLimit:50,searchOffset:1000,queryLength:200,queryTerms:12});

// Accept words and "quoted phrases" only. Each becomes a quoted FTS5 string, so
// user input cannot reach column filters, NEAR, prefix or boolean operators.
export function corpusQuery(input) {
  const text=String(input||'').normalize('NFC').trim();
  if(!text || text.length>CORPUS_LIMITS.queryLength)return null;
  const terms=[...text.matchAll(/"([^"]+)"|([^\s"]+)/g)].map(match=>(match[1]??match[2]).replace(/[^\p{L}\p{M}\p{N}'’\- ]/gu,' ').trim().replace(/\s+/g,' ')).filter(Boolean);
  if(!terms.length || terms.length>CORPUS_LIMITS.queryTerms)return null;
  return terms.map(term=>'"'+term.replaceAll('"','""')+'"').join(' ');
}

export class CorpusStore {
  constructor(directory,{indexFile=null,clock=Date.now}={}) {
    mkdirSync(directory,{recursive:true});
    this.clock=clock;this.owner=randomUUID();
    this.filename=path.join(directory,'corpus-v1.sqlite');
    this.db=new DatabaseSync(this.filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('speech','question','answer')),
        parent_id TEXT, date TEXT, term INTEGER, original_languages TEXT NOT NULL DEFAULT '[]');
      CREATE INDEX IF NOT EXISTS document_kind_date ON documents(kind,date DESC);
      CREATE INDEX IF NOT EXISTS document_parent ON documents(parent_id) WHERE parent_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS texts (
        id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        language TEXT NOT NULL, source_key TEXT NOT NULL, translation_type TEXT NOT NULL CHECK(translation_type IN ('original','machine','unspecified')),
        source_format TEXT NOT NULL CHECK(source_format IN ('xml-fragment','docx')), source_url TEXT NOT NULL,
        fetched_at TEXT NOT NULL, checked_at TEXT NOT NULL, sha256 TEXT NOT NULL, chars INTEGER NOT NULL,
        body TEXT NOT NULL, raw BLOB, UNIQUE(document_id,source_key));
      CREATE INDEX IF NOT EXISTS text_language ON texts(language,document_id);
      CREATE INDEX IF NOT EXISTS text_source_url ON texts(source_url);
      CREATE VIRTUAL TABLE IF NOT EXISTS texts_fts USING fts5(body, content='texts', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS texts_ai AFTER INSERT ON texts BEGIN INSERT INTO texts_fts(rowid,body) VALUES (NEW.id,NEW.body); END;
      CREATE TRIGGER IF NOT EXISTS texts_ad AFTER DELETE ON texts BEGIN INSERT INTO texts_fts(texts_fts,rowid,body) VALUES ('delete',OLD.id,OLD.body); END;
      CREATE TRIGGER IF NOT EXISTS texts_au AFTER UPDATE OF body ON texts BEGIN
        INSERT INTO texts_fts(texts_fts,rowid,body) VALUES ('delete',OLD.id,OLD.body); INSERT INTO texts_fts(rowid,body) VALUES (NEW.id,NEW.body); END;
      CREATE TABLE IF NOT EXISTS tasks (key TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, priority INTEGER NOT NULL,
        done INTEGER NOT NULL DEFAULT 0, done_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE INDEX IF NOT EXISTS task_next ON tasks(done,priority DESC,retry_at);
      INSERT OR IGNORE INTO meta VALUES ('schema','1');`);
    if(this.get('schema')!==1)throw new Error('Unsupported corpus schema.');
    this.indexFile=indexFile;this.indexAttached=false;this.attachIndex();
  }
  // Read-only: the activity worker remains the only index writer.
  attachIndex() {
    if(!this.indexAttached && this.indexFile && existsSync(this.indexFile)) {
      this.db.prepare('ATTACH DATABASE ? AS idx').run('file:'+encodeURI(this.indexFile)+'?mode=ro');
      this.indexAttached=true;
    }
    return this.indexAttached;
  }
  get(key){return parse(this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value);}
  set(key,value){this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key,JSON.stringify(value));}
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try{const out=fn();this.db.exec('COMMIT');return out;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  acquire(ttl=90_000) {
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT * FROM lease WHERE id=1').get();
      if(old && old.owner!==this.owner && old.expires>this.clock())return false;
      this.db.prepare('INSERT OR REPLACE INTO lease VALUES (1,?,?)').run(this.owner,this.clock()+ttl);return true;
    });
  }
  renew(ttl=90_000){return this.db.prepare('UPDATE lease SET expires=? WHERE id=1 AND owner=? AND expires>?').run(this.clock()+ttl,this.owner,this.clock()).changes===1;}
  assertWriter() {
    const lease=this.db.prepare('SELECT owner,expires FROM lease WHERE id=1').get();
    if(lease?.owner!==this.owner || lease.expires<=this.clock())throw new Error('Corpus writer lease was lost.');
  }
  release(){this.db.prepare('DELETE FROM lease WHERE id=1 AND owner=?').run(this.owner);}

  // Serving generation of the attached activity index, or null before its first load.
  indexGeneration() {
    if(!this.attachIndex())return null;
    const value=key=>parse(this.db.prepare('SELECT value FROM idx.meta WHERE key=?').get(key)?.value);
    return value('active') || value('working')?.generation || null;
  }
  enqueue(key,kind,body,priority) {
    this.assertWriter();
    return this.db.prepare('INSERT OR IGNORE INTO tasks(key,kind,body,priority) VALUES (?,?,?,?)').run(key,kind,JSON.stringify(body),priority).changes===1;
  }
  reopen(key,body,priority) {
    this.assertWriter();
    this.db.prepare('UPDATE tasks SET done=0,attempts=0,error=NULL,retry_at=0,body=?,priority=? WHERE key=? AND done=1').run(JSON.stringify(body),priority,key);
  }
  task(key){const row=this.db.prepare('SELECT * FROM tasks WHERE key=?').get(key);return row && {...row,body:parse(row.body)};}
  nextTask(){const row=this.db.prepare('SELECT * FROM tasks WHERE done=0 AND retry_at<=? ORDER BY priority DESC,key DESC LIMIT 1').get(this.clock());return row && {...row,body:parse(row.body)};}
  taskProgress(task,body){this.assertWriter();this.db.prepare('UPDATE tasks SET body=?,attempts=0,error=NULL,retry_at=0 WHERE key=?').run(JSON.stringify(body),task.key);}
  finishTask(task){this.assertWriter();this.db.prepare('UPDATE tasks SET done=1,done_at=?,error=NULL WHERE key=?').run(this.clock(),task.key);}
  failTask(task,error,retryAfter=0) {
    this.assertWriter();
    const delay=Math.max(retryAfter*1000,Math.min(6*60*60_000,60_000*2**Math.min(task.attempts,8)));
    this.db.prepare('UPDATE tasks SET attempts=attempts+1,retry_at=?,error=? WHERE key=?').run(this.clock()+delay,String(error.message).slice(0,350),task.key);
  }
  hasText(sourceUrl){return Boolean(this.db.prepare('SELECT 1 FROM texts WHERE source_url=? LIMIT 1').get(sourceUrl));}

  // One source record and the texts supplied with it. Unchanged texts keep their
  // row (and FTS entry); only the confirmation time moves forward.
  putDocument(document,texts) {
    if(!KINDS.includes(document.kind) || !/^[A-Z0-9-]{1,100}$/.test(document.sourceId))throw new Error('Invalid corpus document.');
    this.transaction(()=>{
      this.assertWriter();
      this.db.prepare(`INSERT INTO documents(source_id,kind,parent_id,date,term,original_languages) VALUES (?,?,?,?,?,?)
        ON CONFLICT(source_id) DO UPDATE SET kind=excluded.kind,parent_id=excluded.parent_id,date=COALESCE(excluded.date,date),term=COALESCE(excluded.term,term),original_languages=excluded.original_languages`)
        .run(document.sourceId,document.kind,document.parentId||null,document.date||null,document.term??null,JSON.stringify(document.originalLanguages||[]));
      const id=this.db.prepare('SELECT id FROM documents WHERE source_id=?').get(document.sourceId).id;
      const existing=this.db.prepare('SELECT id,sha256 FROM texts WHERE document_id=? AND source_key=?');
      const insert=this.db.prepare(`INSERT INTO texts(document_id,language,source_key,translation_type,source_format,source_url,fetched_at,checked_at,sha256,chars,body,raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      const update=this.db.prepare(`UPDATE texts SET language=?,translation_type=?,source_format=?,source_url=?,fetched_at=?,checked_at=?,sha256=?,chars=?,body=?,raw=? WHERE id=?`);
      const confirm=this.db.prepare('UPDATE texts SET checked_at=?,translation_type=? WHERE id=?');
      for(const text of texts) {
        const hash=sha((text.raw ?? text.body)), old=existing.get(id,text.sourceKey);
        const raw=text.raw==null?null:zstdCompressSync(Buffer.from(text.raw));
        if(old?.sha256===hash){confirm.run(text.fetchedAt,text.translationType,old.id);continue;}
        const values=[text.language,text.translationType,text.sourceFormat,text.sourceUrl,text.fetchedAt,text.fetchedAt,hash,text.body.length,text.body,raw];
        if(old)update.run(...values,old.id);
        else insert.run(id,text.language,text.sourceKey,text.translationType,text.sourceFormat,text.sourceUrl,text.fetchedAt,text.fetchedAt,hash,text.body.length,text.body,raw);
      }
    });
  }
  raw(sourceId,sourceKey) {
    const row=this.db.prepare('SELECT t.raw FROM texts t JOIN documents d ON d.id=t.document_id WHERE d.source_id=? AND t.source_key=?').get(sourceId,sourceKey);
    return row?.raw ? zstdDecompressSync(row.raw).toString('utf8') : null;
  }

  async diskBytes() {
    return (await Promise.all(['','-wal','-shm'].map(suffix=>stat(this.filename+suffix).then(s=>s.size).catch(()=>0)))).reduce((a,b)=>a+b,0);
  }
  status({diskBytes=null,diskLimit=null}={}) {
    const documents=Object.fromEntries(this.db.prepare('SELECT kind,COUNT(*) AS n FROM documents GROUP BY kind').all().map(row=>[row.kind,row.n]));
    const withText=Object.fromEntries(this.db.prepare('SELECT d.kind,COUNT(DISTINCT d.id) AS n FROM documents d JOIN texts t ON t.document_id=d.id GROUP BY d.kind').all().map(row=>[row.kind,row.n]));
    const texts=this.db.prepare('SELECT d.kind,t.language,COUNT(*) AS n,SUM(t.chars) AS chars FROM texts t JOIN documents d ON d.id=t.document_id GROUP BY d.kind,t.language ORDER BY d.kind,t.language').all();
    const tasks=this.db.prepare('SELECT kind,COUNT(*) AS total,SUM(done=1) AS done,SUM(done=0 AND error IS NOT NULL) AS retrying FROM tasks GROUP BY kind').all();
    const lastError=this.db.prepare('SELECT key,error,attempts,retry_at FROM tasks WHERE done=0 AND error IS NOT NULL ORDER BY retry_at DESC LIMIT 1').get();
    const lease=this.db.prepare('SELECT expires FROM lease WHERE id=1').get();
    const backfilledAt=this.get('backfilledAt');
    return {schemaVersion:1,term:10,phase:this.get('phase')||'waiting',complete:Boolean(backfilledAt),backfilledAt,
      coverage:backfilledAt?'Initial backfill finished; recent sittings and new questions are rechecked.':'Backfilling: counts and search results are incomplete.',
      documents:Object.fromEntries(KINDS.map(kind=>[kind,{discovered:documents[kind]||0,withText:withText[kind]||0}])),
      texts:texts.map(row=>({kind:row.kind,language:row.language,count:row.n,characters:row.chars})),
      tasks:Object.fromEntries(tasks.map(row=>[row.kind,{total:row.total,done:row.done,retrying:row.retrying}])),
      lastError:lastError?{key:lastError.key,error:lastError.error,attempts:lastError.attempts,nextRetryAt:new Date(lastError.retry_at).toISOString()}:null,
      discoveredAt:this.get('discoveredAt'),lastRunAt:this.get('lastRunAt'),languages:this.get('languages')||null,
      diskBytes,diskLimitBytes:diskLimit,indexAttached:this.indexAttached,exclusiveWriterActive:Boolean(lease && lease.expires>this.clock()),
      dataSource:'European Parliament Open Data API v2 (speech XML fragments; official question and answer DOCX distributions)',attribution:'European Parliament, CC BY 4.0'};
  }

  // Full-text search with optional joins to the attached activity index.
  search({query,kind=null,language=null,member=null,from=null,to=null,limit=20,offset=0}) {
    const match=corpusQuery(query);
    if(!match)return null;
    const where=['texts_fts MATCH ?'],params=[match];
    if(kind){where.push('d.kind=?');params.push(kind);}
    if(language){where.push('t.language=?');params.push(language);}
    if(from){where.push('d.date>=?');params.push(from);}
    if(to){where.push('d.date<=?');params.push(to);}
    const generation=this.indexGeneration();
    if(member) {
      if(generation==null)return {unavailable:'The activity index is not loaded, so member filters are unavailable.'};
      // Exact identifier joins only: speeches by speaker, questions and answers by author.
      where.push('EXISTS (SELECT 1 FROM idx.items i WHERE i.generation=? AND i.mep=? AND i.source_id=d.source_id)');params.push(generation,String(member));
    }
    const sql=`FROM texts_fts JOIN texts t ON t.id=texts_fts.rowid JOIN documents d ON d.id=t.document_id WHERE ${where.join(' AND ')}`;
    const total=this.db.prepare('SELECT COUNT(*) AS n '+sql).get(...params).n;
    const rows=this.db.prepare(`SELECT d.source_id,d.kind,d.parent_id,d.date,t.language,t.translation_type,t.source_format,t.source_url,t.fetched_at,
      snippet(texts_fts,0,'\u0002','\u0003','…',24) AS snippet ${sql} ORDER BY bm25(texts_fts),d.date DESC,d.source_id LIMIT ? OFFSET ?`).all(...params,limit,offset);
    const members=generation==null?null:this.db.prepare('SELECT DISTINCT mep FROM idx.items WHERE generation=? AND source_id=? ORDER BY mep');
    return {total,limit,offset,nextOffset:offset+rows.length<total?offset+rows.length:null,query:match,
      hits:rows.map(row=>({sourceId:row.source_id,kind:row.kind,parentId:row.parent_id,date:row.date,language:row.language,translationType:row.translation_type,
        sourceFormat:row.source_format,sourceUrl:row.source_url,fetchedAt:row.fetched_at,snippet:row.snippet,
        memberIds:members?members.all(generation,row.source_id).map(item=>Number(item.mep)):null}))};
  }
  close(){this.release();this.db.close();}
}
