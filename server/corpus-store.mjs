import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import path from 'node:path';
import {countryCode} from './insights-countries.mjs';
import {speechSummary} from './odp.mjs';
import {speechSpeakerDetails} from './speech-speakers.mjs';

// Full-text corpus of speeches, questions and answers. It lives beside the
// activity index but outside its refresh generations, so a refresh never copies
// stored text. `documents.source_id` is the exact API identifier and joins to
// the attached index's `items.source_id`.
const KINDS=['speech','question','answer'];
const parse=value=>value==null?null:JSON.parse(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
export const CORPUS_LIMITS=Object.freeze({searchLimit:50,searchOffset:1000,queryLength:200,queryTerms:12,sourceIds:1000,requestBytes:128*1024,highlightBytes:512*1024,highlightRanges:10000});

function matchRanges(marked,limit) {
  const ranges=[];let cursor=0,position=0,truncated=false;
  for(;;) {
    const start=marked.indexOf('\u0002',cursor);if(start<0)break;
    const end=marked.indexOf('\u0003',start+1);if(end<0)break;
    position+=start-cursor;
    if(ranges.length<limit)ranges.push({start:position,end:position+end-start-1});else truncated=true;
    position+=end-start-1;cursor=end+1;
  }
  return {highlightRanges:ranges,highlightsTruncated:truncated};
}

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
  constructor(directory,{indexFile=null,clock=Date.now,readOnly=false}={}) {
    if(!readOnly)mkdirSync(directory,{recursive:true});
    this.clock=clock;this.owner=randomUUID();this.readOnly=readOnly;
    this.filename=path.join(directory,'corpus-v1.sqlite');
    this.db=new DatabaseSync(this.filename,{readOnly});
    if(readOnly)this.db.exec('PRAGMA busy_timeout=250; PRAGMA query_only=ON;');
    else this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('speech','question','answer')),
        parent_id TEXT, date TEXT, term INTEGER, original_languages TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS speech_metadata (source_id TEXT PRIMARY KEY, body BLOB NOT NULL, source_url TEXT NOT NULL, fetched_at TEXT NOT NULL);
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
      CREATE INDEX IF NOT EXISTS text_status_metadata ON texts(document_id,language,chars);
      CREATE VIRTUAL TABLE IF NOT EXISTS texts_fts USING fts5(body, content='texts', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS texts_ai AFTER INSERT ON texts BEGIN INSERT INTO texts_fts(rowid,body) VALUES (NEW.id,NEW.body); END;
      CREATE TRIGGER IF NOT EXISTS texts_ad AFTER DELETE ON texts BEGIN INSERT INTO texts_fts(texts_fts,rowid,body) VALUES ('delete',OLD.id,OLD.body); END;
      CREATE TRIGGER IF NOT EXISTS texts_au AFTER UPDATE OF body ON texts BEGIN
        INSERT INTO texts_fts(texts_fts,rowid,body) VALUES ('delete',OLD.id,OLD.body); INSERT INTO texts_fts(rowid,body) VALUES (NEW.id,NEW.body); END;
      CREATE TABLE IF NOT EXISTS tasks (key TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, priority INTEGER NOT NULL,
        done INTEGER NOT NULL DEFAULT 0, done_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE INDEX IF NOT EXISTS task_next ON tasks(done,priority DESC,retry_at);
      CREATE INDEX IF NOT EXISTS task_status_counts ON tasks(kind,done,error);
      CREATE INDEX IF NOT EXISTS task_status_error ON tasks(done,retry_at DESC,key,error,attempts) WHERE done=0 AND error IS NOT NULL;
      INSERT OR IGNORE INTO meta VALUES ('schema','1');`);
    if(this.get('schema')!==1)throw new Error('Unsupported corpus schema.');
    if(!readOnly&&this.get('speechMetadataVersion')!==1) {
      this.set('speechMetadataBackfill',Boolean(this.db.prepare("SELECT 1 FROM documents WHERE kind='speech' LIMIT 1").get()));
      this.set('speechMetadataVersion',1);
    }
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
  snapshot(fn) {
    // Hold one WAL read snapshot across count, page and provenance queries.
    // A background writer can keep collecting without changing a result midway.
    this.db.exec('BEGIN');
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

  // Serving generation of the attached activity index, or null before its first
  // load. `published` is false while only an initial partial generation exists.
  indexState() {
    if(!this.attachIndex())return {generation:null,published:false};
    const value=key=>parse(this.db.prepare('SELECT value FROM idx.meta WHERE key=?').get(key)?.value);
    const active=value('active');
    return {generation:active || value('working')?.generation || null,published:Boolean(active)};
  }
  indexGeneration(){return this.indexState().generation;}
  enqueue(key,kind,body,priority) {
    this.assertWriter();
    return this.db.prepare('INSERT OR IGNORE INTO tasks(key,kind,body,priority) VALUES (?,?,?,?)').run(key,kind,JSON.stringify(body),priority).changes===1;
  }
  reopen(key,body,priority) {
    this.assertWriter();
    this.db.prepare('UPDATE tasks SET done=0,attempts=0,error=NULL,retry_at=0,body=?,priority=? WHERE key=? AND done=1').run(JSON.stringify(body),priority,key);
  }
  resetTask(key,body,priority) {
    this.assertWriter();
    this.db.prepare('UPDATE tasks SET done=0,done_at=NULL,attempts=0,error=NULL,retry_at=0,body=?,priority=? WHERE key=?').run(JSON.stringify(body),priority,key);
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
      // Same text from a replacement file: keep the body and its FTS entry, update the link.
      const confirm=this.db.prepare('UPDATE texts SET checked_at=?,translation_type=?,language=?,source_format=?,source_url=? WHERE id=?');
      for(const text of texts) {
        const hash=sha((text.raw ?? text.body)), old=existing.get(id,text.sourceKey);
        const raw=text.raw==null?null:zstdCompressSync(Buffer.from(text.raw));
        if(old?.sha256===hash){confirm.run(text.fetchedAt,text.translationType,text.language,text.sourceFormat,text.sourceUrl,old.id);continue;}
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

  putSpeechMetadata(activity,sourceUrl,fetchedAt) {
    this.assertWriter();
    if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(activity?.activity_id||'')||activity.activity_date!==activity.activity_id.slice(7,17))
      throw new Error('Invalid speech metadata identity.');
    const documents=(activity.recorded_in_a_realization_of||[]).map(doc=>{
      if(!doc||typeof doc!=='object')return doc;
      const {'api:xmlFragment':fragments,...metadata}=doc;return metadata;
    });
    const metadata={...activity,recorded_in_a_realization_of:documents};
    const retained=this.db.prepare(`SELECT t.source_key,t.raw,t.source_url,t.fetched_at,t.sha256 FROM texts t JOIN documents d ON d.id=t.document_id
      WHERE d.source_id=? AND t.source_format='xml-fragment' AND t.raw IS NOT NULL ORDER BY t.source_key`).all(activity.activity_id);
    const headerSources=[...new Map(retained.map(row=>[row.source_url+'|'+row.fetched_at,{url:row.source_url,fetchedAt:row.fetched_at}])).values()];
    const fragments={};let bytes=0;
    for(const row of retained) {
      const xml=zstdDecompressSync(row.raw,{maxOutputLength:2*1024*1024}).toString('utf8');bytes+=Buffer.byteLength(xml);
      if(bytes>12*1024*1024||sha(xml)!==row.sha256)throw new Error('Retained speech fragments failed projection validation.');
      fragments[row.source_key]=xml;
    }
    const docs=structuredClone(documents),first=docs.find(doc=>doc&&typeof doc==='object');
    if(first)first['api:xmlFragment']=fragments;
    const observed={...activity,recorded_in_a_realization_of:docs};
    const body=JSON.stringify({version:1,activity:metadata,summary:speechSummary(observed),speakers:speechSpeakerDetails(observed),headerSources});
    if(Buffer.byteLength(body)>2*1024*1024)throw new Error('Speech metadata exceeded the allowed size.');
    this.db.prepare(`INSERT INTO speech_metadata VALUES (?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET
      body=excluded.body,source_url=excluded.source_url,fetched_at=excluded.fetched_at WHERE excluded.fetched_at>=speech_metadata.fetched_at`)
      .run(activity.activity_id,zstdCompressSync(Buffer.from(body)),sourceUrl,new Date(fetchedAt).toISOString());
  }

  speechTranscript({sourceId,language}) {
    return this.snapshot(()=>{
      const rows=this.db.prepare(`SELECT t.id,t.language,t.source_key,t.translation_type,t.source_url,t.fetched_at,t.checked_at,t.sha256
        FROM documents d JOIN texts t ON t.document_id=d.id
        WHERE d.source_id=? AND d.kind='speech' AND t.source_format='xml-fragment' AND t.raw IS NOT NULL
        ORDER BY t.source_key`).all(sourceId);
      // Exact language only: the authoritative detail reader owns language fallback.
      const row=rows.filter(t=>t.language===language).sort((a,b)=>
        Number(b.translation_type==='original')-Number(a.translation_type==='original') ||
        Number(b.source_key===language)-Number(a.source_key===language))[0];
      if(!row)return {id:sourceId,available:false};
      const raw=this.db.prepare('SELECT raw FROM texts WHERE id=?').get(row.id).raw;
      const xml=zstdDecompressSync(raw,{maxOutputLength:2*1024*1024}).toString('utf8');
      if(sha(xml)!==row.sha256)throw new Error('The retained speech transcript failed its checksum.');
      let metadataRecord=null,metadataUnavailable=false;
      // Old corpora remain readable before the existing writer adds/backfills metadata.
      if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='speech_metadata'").get()) {
        const metadata=this.db.prepare('SELECT * FROM speech_metadata WHERE source_id=?').get(sourceId);
        if(metadata) {
          try {
            const saved=JSON.parse(zstdDecompressSync(metadata.body,{maxOutputLength:2*1024*1024}).toString('utf8'));
            if(saved.version!==1||saved.activity?.activity_id!==sourceId||saved.summary?.id!==sourceId||!Array.isArray(saved.speakers))throw new Error('Retained speech metadata identity mismatch.');
            metadataRecord={...saved,sourceUrl:metadata.source_url,fetchedAt:metadata.fetched_at};
          }catch {metadataUnavailable=true;}
        }
      }
      return {id:sourceId,available:true,xml,textLanguage:row.language,sourceFragmentKey:row.source_key,metadataRecord,metadataUnavailable,
        translationType:row.translation_type,availableTextLanguages:[...new Set(rows.map(t=>t.language))],
        sourceUrl:row.source_url,fetchedAt:row.fetched_at,checkedAt:row.checked_at};
    });
  }

  // Read exactly the variant that produced the excerpt. No upstream request or
  // language fallback is made, even when another variant exists for this ID.
  text(params){return this.snapshot(()=>this.textSnapshot(params));}
  textSnapshot({sourceId,sourceKey,query=null,highlightBytes=CORPUS_LIMITS.highlightBytes,highlightRangeLimit=CORPUS_LIMITS.highlightRanges}) {
    const row=this.db.prepare(`SELECT d.source_id,d.kind,d.parent_id,d.date,d.original_languages,
      t.source_key,t.language,t.translation_type,t.source_format,t.source_url,t.fetched_at,t.checked_at,t.sha256,t.body
      FROM documents d JOIN texts t ON t.document_id=d.id WHERE d.source_id=? AND t.source_key=?`).get(sourceId,sourceKey);
    if(!row)return null;
    const match=query===null?null:corpusQuery(query);
    const marked=match?this.db.prepare(`SELECT highlight(texts_fts,0,'\u0002','\u0003') AS body FROM texts_fts
      JOIN texts t ON t.id=texts_fts.rowid JOIN documents d ON d.id=t.document_id WHERE d.source_id=? AND t.source_key=? AND texts_fts MATCH ?`).get(sourceId,sourceKey,match):null;
    const highlighted=marked?.body??row.body;
    // Large texts keep one body plus exact UTF-16 match ranges. Duplicating a
    // multilingual body can otherwise exceed the API response budget.
    const highlights=query===null?{}:Buffer.byteLength(JSON.stringify(highlighted))<=highlightBytes?{highlightedBody:highlighted}:matchRanges(highlighted,highlightRangeLimit);
    return {...this.variant(row),originalLanguages:parse(row.original_languages),checkedAt:row.checked_at,body:row.body,...highlights};
  }

  variant(row) {
    return {sourceId:row.source_id,kind:row.kind,parentId:row.parent_id,date:row.date,sourceKey:row.source_key,
      language:row.language,translationType:row.translation_type,sourceFormat:row.source_format,sourceUrl:row.source_url,
      fetchedAt:row.fetched_at,sha256:row.sha256,...(row.snippet===undefined?{}:{snippet:row.snippet})};
  }

  // Cheap coverage for every search response; full counts stay in status().
  coverage() {
    const backfilledAt=this.get('backfilledAt');
    return {complete:Boolean(backfilledAt),backfillComplete:Boolean(backfilledAt),authoritativeComplete:false,backfilledAt,phase:this.get('phase')||'waiting',
      note:backfilledAt?'Initial backfill finished. Results cover stored texts, not an authoritative complete parliamentary corpus.':'Backfilling: counts and search results cover only texts stored so far.',
      countryBasis:'Current saved roster country of representation; missing countries are not inferred.'};
  }
  async diskBytes() {
    return (await Promise.all(['','-wal','-shm'].map(suffix=>stat(this.filename+suffix).then(s=>s.size).catch(()=>0)))).reduce((a,b)=>a+b,0);
  }
  status(params={}){return this.snapshot(()=>this.statusSnapshot(params));}
  statusSnapshot({diskBytes=null,diskLimit=null}={}) {
    const documents=Object.fromEntries(this.db.prepare('SELECT kind,COUNT(*) AS n FROM documents GROUP BY kind').all().map(row=>[row.kind,row.n]));
    // Probe once per document; language variants must not multiply this count.
    const withText=Object.fromEntries(this.db.prepare('SELECT d.kind,COUNT(*) AS n FROM documents d WHERE EXISTS (SELECT 1 FROM texts t WHERE t.document_id=d.id) GROUP BY d.kind').all().map(row=>[row.kind,row.n]));
    const texts=this.db.prepare('SELECT d.kind,t.language,COUNT(*) AS n,SUM(t.chars) AS chars FROM texts t JOIN documents d ON d.id=t.document_id GROUP BY d.kind,t.language ORDER BY d.kind,t.language').all();
    const tasks=this.db.prepare('SELECT kind,COUNT(*) AS total,SUM(done=1) AS done,SUM(done=0 AND error IS NOT NULL) AS retrying FROM tasks GROUP BY kind').all();
    const lastError=this.db.prepare('SELECT key,error,attempts,retry_at FROM tasks WHERE done=0 AND error IS NOT NULL ORDER BY retry_at DESC LIMIT 1').get();
    const lease=this.db.prepare('SELECT expires FROM lease WHERE id=1').get();
    const backfilledAt=this.get('backfilledAt');
    const metadataRetained=this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='speech_metadata'").get()?this.db.prepare('SELECT COUNT(*) n FROM speech_metadata').get().n:0;
    return {schemaVersion:1,term:10,phase:this.get('phase')||'waiting',complete:Boolean(backfilledAt),backfillComplete:Boolean(backfilledAt),authoritativeComplete:false,backfilledAt,
      coverage:this.coverage().note,capabilities:{search:true,storedText:true,kinds:KINDS,groups:['document','question'],sorts:['relevance','newest'],sourceIdsLimit:CORPUS_LIMITS.sourceIds},
      documents:Object.fromEntries(KINDS.map(kind=>[kind,{discovered:documents[kind]||0,withText:withText[kind]||0}])),
      speechMetadata:{retained:metadataRetained,backfillPending:Boolean(this.get('speechMetadataBackfill'))},
      texts:texts.map(row=>({kind:row.kind,language:row.language,count:row.n,characters:row.chars})),
      tasks:Object.fromEntries(tasks.map(row=>[row.kind,{total:row.total,done:row.done,retrying:row.retrying}])),
      lastError:lastError?{key:lastError.key,error:lastError.error,attempts:lastError.attempts,nextRetryAt:new Date(lastError.retry_at).toISOString()}:null,
      discoveredAt:this.get('discoveredAt'),lastRunAt:this.get('lastRunAt'),languages:{speeches:this.get('speechLanguages')||null,documents:this.get('documentLanguages')||null},
      diskBytes,diskLimitBytes:diskLimit,indexAttached:this.indexAttached,exclusiveWriterActive:Boolean(lease && lease.expires>this.clock()),
      dataSource:'European Parliament Open Data API v2 (speech XML fragments; official question and answer DOCX distributions)',attribution:'European Parliament, CC BY 4.0'};
  }

  // Full-text search with optional joins to the attached activity index.
  search(params){return this.snapshot(()=>this.searchSnapshot(params));}
  searchSnapshot({query,kind=null,kinds=null,language=null,uiLanguage='en',member=null,country=null,countryMemberIds=null,countryMetadataIds=null,from=null,to=null,limit=20,offset=0,group='document',dateBasis=group==='question'?'question':'document',sort='relevance',sourceIds=null}) {
    const match=corpusQuery(query);
    if(!match)return null;
    const where=['texts_fts MATCH ?'],params=[match];
    const selectedKinds=kinds??(kind?[kind]:null);
    if(selectedKinds){where.push('d.kind IN (SELECT value FROM json_each(?))');params.push(JSON.stringify(selectedKinds));}
    // SQLite 3.51 can start with every language row and restart MATCH for each.
    // Disqualify that index term so FTS supplies candidates first. Validated
    // language strings need no TEXT-affinity coercion removed by unary +.
    if(language){where.push('+t.language=?');params.push(language);}
    const generation=this.indexGeneration();
    const questionId="CASE WHEN d.kind='answer' THEN d.parent_id WHEN d.kind='question' THEN d.source_id END";
    const groupId=group==='question'?"CASE WHEN d.kind='answer' THEN COALESCE(d.parent_id,d.source_id) ELSE d.source_id END":'d.source_id';
    const savedQuestionDate=generation==null?'NULL':`(SELECT json_extract(s.body,'$.document_date') FROM idx.sources s WHERE s.generation=${Number(generation)} AND s.key='/parliamentary-questions/' || ${questionId} AND s.kind='document')`;
    const questionDate=`CASE WHEN d.kind='question' THEN d.date WHEN d.kind='answer' THEN COALESCE(q.date,${savedQuestionDate}) END`;
    const filterDate=dateBasis==='question'?`CASE WHEN d.kind='speech' THEN d.date ELSE ${questionDate} END`:'d.date';
    if(from){where.push(`${filterDate}>=?`);params.push(from);}
    if(to){where.push(`${filterDate}<=?`);params.push(to);}
    if(sourceIds!==null){where.push('d.source_id IN (SELECT value FROM json_each(?))');params.push(JSON.stringify(sourceIds));}
    if(member || country) {
      if(generation==null)return {unavailable:'The activity index is not loaded, so member filters are unavailable.'};
      if(country){
        const known=new Set(countryMetadataIds||[]),roster=this.db.prepare('SELECT id,body FROM idx.members').all();
        // Validate coverage independently of the requested country's matches.
        // The real roster writer stores IDs/names, so missing cached countries
        // must not turn into successful zeroes. Existing saved countries remain
        // a fallback only for members without valid cached country metadata.
        if(!roster.length||roster.some(row=>{const person=parse(row.body);return !known.has(row.id)&&!countryCode(person?.countryCode||person?.['api:country-of-representation']);}))
          return {unavailableCode:'corpus_country_metadata_unavailable',unavailable:'Saved current-country metadata is incomplete. Retry after the roster metadata becomes available.'};
      }
      // Exact identifier joins only: speeches by speaker, questions and answers by author.
      const authorWhere=['i.generation=?','i.source_id=d.source_id'],authorParams=[generation];
      if(member){authorWhere.push('i.mep=?');authorParams.push(String(member));}
      if(country){authorWhere.push(`(i.mep IN (SELECT value FROM json_each(?)) OR (i.mep NOT IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM idx.members m WHERE m.id=i.mep AND CASE COALESCE(json_extract(m.body,'$.countryCode'),json_extract(m.body,'$."api:country-of-representation"')) WHEN 'GR' THEN 'EL' ELSE COALESCE(json_extract(m.body,'$.countryCode'),json_extract(m.body,'$."api:country-of-representation"')) END=?)))`);authorParams.push(JSON.stringify(countryMemberIds||[]),JSON.stringify(countryMetadataIds||[]),country);}
      where.push(`EXISTS (SELECT 1 FROM idx.items i WHERE ${authorWhere.join(' AND ')})`);params.push(...authorParams);
    }
    // Resolve the language from its covering index before matching rowids to
    // wide text records. Keep FTS ahead of this materialized lookup: reversing
    // those loops would restart MATCH for every text in the chosen language.
    const textScope=language?'filtered_text AS MATERIALIZED (SELECT id,document_id,language FROM texts WHERE language=?),':'';
    const sql=`FROM texts_fts ${language?'CROSS JOIN filtered_text':'JOIN texts'} t ON t.id=texts_fts.rowid JOIN documents d ON d.id=t.document_id LEFT JOIN documents q ON d.kind='answer' AND q.source_id=d.parent_id AND q.kind='question' WHERE ${where.join(' AND ')}`;
    const order=sort==='newest'?'date DESC,score,group_id':'score,date DESC,group_id';
    const pageOrder=sort==='newest'?'page.date DESC,page.score,page.group_id':'page.score,page.date DESC,page.group_id';
    // Count and select groups from one FTS traversal instead of repeating the
    // same full match for COUNT. The singleton LEFT JOIN retains the true total
    // for empty and out-of-range pages without a second count query.
    const page=this.db.prepare(`WITH ${textScope}matched AS MATERIALIZED (SELECT ${groupId} AS group_id,${filterDate} AS date,texts_fts.rank AS score,t.id AS text_id ${sql}),
      grouped AS MATERIALIZED (SELECT group_id,MIN(score) AS score,MAX(date) AS date FROM matched GROUP BY group_id),
      page AS MATERIALIZED (SELECT * FROM grouped ORDER BY ${order} LIMIT ? OFFSET ?)
      SELECT (SELECT COUNT(*) FROM grouped) AS total,page.*,matched.text_id,DENSE_RANK() OVER (ORDER BY matched.score) AS hit_rank
      FROM (SELECT 1) LEFT JOIN page ON 1 LEFT JOIN matched ON matched.group_id=page.group_id ORDER BY ${pageOrder}`).all(...(language?[language]:[]),...params,limit,offset);
    const total=page[0].total,selected=[...new Map(page.filter(row=>row.group_id!==null).map(row=>[row.group_id,row])).values()];
    // Keep exact matching variants from the same snapshot. Integer score ranks
    // preserve ties without serializing floating-point scores into JSON.
    const selectedHits=page.filter(row=>row.text_id!==null).map(row=>[row.text_id,row.hit_rank]);
    const members=generation==null?null:this.db.prepare('SELECT DISTINCT mep FROM idx.items WHERE generation=? AND source_id=? ORDER BY mep');
    const memberIds=id=>members?members.all(generation,id).map(item=>Number(item.mep)):null;
    const person=generation==null?null:this.db.prepare('SELECT body FROM idx.members WHERE id=?');
    const people=(ids,kind)=>(ids||[]).map(id=>({id,name:parse(person?.get(String(id))?.body)?.name||null,role:kind==='speech'?'SPEAKER':kind==='answer'?'QUESTION_AUTHOR':'AUTHOR'}));
    const rows=selected.length?this.db.prepare(`SELECT ${groupId} AS group_id,d.source_id,d.kind,d.parent_id,d.date,${questionDate} AS question_date,
      t.source_key,t.sha256,t.language,t.translation_type,t.source_format,t.source_url,t.fetched_at,
      snippet(texts_fts,0,'\u0002','\u0003','…',24) AS snippet
      FROM json_each(?) AS selected_hit CROSS JOIN texts_fts ON texts_fts.rowid=json_extract(selected_hit.value,'$[0]')
      JOIN texts t ON t.id=texts_fts.rowid JOIN documents d ON d.id=t.document_id
      LEFT JOIN documents q ON d.kind='answer' AND q.source_id=d.parent_id AND q.kind='question'
      WHERE texts_fts MATCH ? ORDER BY json_extract(selected_hit.value,'$[1]'),d.source_id,t.language,t.source_key`).all(JSON.stringify(selectedHits),match):[];
    const byGroup=new Map(selected.map(row=>[row.group_id,[]]));
    for(const row of rows)byGroup.get(row.group_id).push(row);
    const metadata=generation==null?null:this.db.prepare('SELECT body FROM idx.items WHERE generation=? AND source_id=? ORDER BY mep,category LIMIT 1');
    const savedQuestion=generation==null?null:this.db.prepare("SELECT body FROM idx.sources WHERE generation=? AND key=? AND kind='document'");
    const localTitle=titles=>typeof titles==='string'?titles:titles?.[uiLanguage]||titles?.en||Object.values(titles||{}).find(value=>typeof value==='string')||null;
    const results=selected.map(selectedRow=>{
      const matched=byGroup.get(selectedRow.group_id),first=matched[0],sourceId=selectedRow.group_id;
      const questionGroup=group==='question' && (first.kind==='question'||first.kind==='answer'&&first.parent_id);
      const item=parse(metadata?.get(generation,sourceId)?.body);
      const questionSourceId=questionGroup||first.kind==='question'?sourceId:first.kind==='answer'?first.parent_id:null;
      const saved=questionSourceId?parse(savedQuestion?.get(generation,'/parliamentary-questions/'+questionSourceId)?.body):null;
      const savedAnswer=!questionGroup&&first.kind==='answer'?(saved?.inverse_answers_to||[]).find(answer=>answer&&typeof answer==='object'&&(answer.identifier||String(answer.id||'').split('/').at(-1))===sourceId):null;
      const questionDate=matched.find(row=>row.question_date)?.question_date||null;
      const answerDate=matched.filter(row=>row.kind==='answer'&&row.date).map(row=>row.date).sort().at(-1)||null;
      const hits=matched.map(row=>{const ids=memberIds(row.source_id);return {...this.variant(row),memberIds:ids,people:people(ids,row.kind)};});
      const ids=members?[...new Set([...(memberIds(sourceId)||[]),...hits.flatMap(hit=>hit.memberIds||[])])].sort((a,b)=>a-b):null;
      const titles=item?.titles||saved?.title_dcterms||Object.assign({},...(Array.isArray(saved?.is_realized_by)?saved.is_realized_by:[]).map(realization=>realization.title||{}));
      return {sourceId,kind:questionGroup?'question':first.kind,parentId:questionGroup?null:first.parent_id,date:selectedRow.date,
        questionDate,answerDate,title:localTitle(titles)||sourceId,reference:item?.reference||(first.kind==='answer'&&!questionGroup?savedAnswer?.label:saved?.label)||sourceId,memberIds:ids,people:people(ids,questionGroup?'question':first.kind),hits};
    });
    const next=offset+results.length,more=next<total;
    return {total,limit,offset,nextOffset:more&&next<=CORPUS_LIMITS.searchOffset?next:null,truncated:more&&next>CORPUS_LIMITS.searchOffset,query:match,group,dateBasis,sort,
      results,hits:results.flatMap(result=>result.hits)};
  }
  close(){if(!this.readOnly)this.release();this.db.close();}
}
