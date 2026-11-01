import {suppliedTitles} from './insights-model.mjs';
import {sourceAvailability} from './source-availability.mjs';
import {languageCode} from './ep-links.mjs';
import {array,tail} from './activity-index-model.mjs';
import {motionDocuments} from './activity-read-projections.mjs';
export function registerFastReads(db) {
  db.function('projection_event_date',{deterministic:true},(date,at)=>{
    const timestamp=/^\d+(\.\d+)?$/.test(at||'')?Number(at):Date.parse(at);
    const fetchedAt=Number.isFinite(timestamp)?new Date(timestamp).toISOString():null;
    return sourceAvailability({records:[{date,fetchedAt}],today:date}).latestObservedDate;
  });
  db.function('compact_source_read',{deterministic:true,varargs:true},(body,mode,key)=>{
    const work=JSON.parse(body,(key,value)=>['extraction','amendmentEvidence','xml_fragment'].includes(key)?undefined:value);
    if(mode==='subtype')return typeof work.work_type==='string'&&work.work_type.includes('/')?tail(work.work_type):'';
    if(mode==='procedure-id')return tail(work.id)||'';
    if(mode==='events')return JSON.stringify(array(work.consists_of).filter(event=>{
      const type=tail(event.had_activity_type);
      return (['PLENARY_DEBATE','PLENARY_VOTE'].includes(type)||type.startsWith('COMMITTEE_'))&&/^eli\/dl\/event\/[A-Z0-9-]{1,150}$/.test(String(event.id).replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''))&&/^\d{4}-\d{2}-\d{2}$/.test(event.activity_date||'');
    }).map(event=>({activity_date:event.activity_date,had_activity_type:tail(event.had_activity_type)==='PLENARY_DEBATE'?'debates':tail(event.had_activity_type)==='PLENARY_VOTE'?'votes':'committee'})));
    if(mode==='outside')return JSON.stringify(Object.fromEntries(['id','personId','date','term','start','parentIds','reportedParentIds','parentDocumentIds','parentDocumentsComplete','header'].filter(key=>Object.hasOwn(work,key)).map(key=>[key,work[key]])));
    if(mode==='target')return JSON.stringify(Object.fromEntries(['id','scope','targetDocumentId','procedureIds','committees','gaps','listProjectionVersion','committeeProjectionVersion','complete','wordingComplete','proposerComplete','lastUpdated','emptyObservation','linkedListObservationCount','unresolvedListObservationCount'].filter(key=>Object.hasOwn(work,key)).map(key=>[key,work[key]])));
    if(mode==='search')return [work.identifier||key.split('/').at(-1),...Object.values(suppliedTitles(work))].join('\n').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase();
    if(mode==='question') {
      const result=Object.fromEntries(['id','identifier','work_type','document_date','title_dcterms','creator','workHadParticipation','answersObserved'].filter(key=>Object.hasOwn(work,key)).map(key=>[key,work[key]]));
      if(Object.hasOwn(work,'inverse_answers_to'))result.inverse_answers_to=work.inverse_answers_to==null?work.inverse_answers_to:array(work.inverse_answers_to).filter(answer=>answer&&typeof answer==='object').map(answer=>typeof answer==='object'?Object.fromEntries(['id','identifier','document_date','creator'].filter(key=>Object.hasOwn(answer,key)).map(key=>[key,answer[key]])):answer);
      result.is_realized_by=array(work.is_realized_by).map(expression=>({language:expression.language,title:expression.title,is_embodied_by:languageCode(expression.language)==='en'?array(expression.is_embodied_by).filter(file=>tail(file.format)==='DOCX'):[]}));
      return JSON.stringify(result);
    }
    return JSON.stringify(work);
  });
}
// Disk projections owned by the source writer. Large extracted bodies stay in sources.
export function prepareFastReads(db) {
  registerFastReads(db);
  const types="(json_extract(body,'$.work_type') LIKE '%/QUESTION_WRITTEN' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_WRITTEN_PRIORITY' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_ORAL')";
  db.exec(`CREATE TABLE IF NOT EXISTS source_reads(generation INTEGER,key TEXT,kind TEXT,body TEXT,fetched_at TEXT,PRIMARY KEY(generation,key));
    CREATE TABLE IF NOT EXISTS question_reads(generation INTEGER,key TEXT,kind TEXT,body TEXT,fetched_at TEXT,search_text TEXT,PRIMARY KEY(generation,key));
    CREATE INDEX IF NOT EXISTS read_kind ON source_reads(generation,kind,key);
    CREATE INDEX IF NOT EXISTS read_question_window ON question_reads(generation,json_extract(body,'$.document_date') DESC,key) WHERE kind='document' AND ${types};`);
  db.exec(`CREATE TABLE IF NOT EXISTS question_frontiers(generation INTEGER,key TEXT,subtype TEXT,date TEXT,fetched_at TEXT,PRIMARY KEY(generation,key));
    CREATE INDEX IF NOT EXISTS question_frontier_date ON question_frontiers(generation,subtype,date DESC,key,fetched_at);
    CREATE TRIGGER IF NOT EXISTS question_frontier_insert AFTER INSERT ON question_reads BEGIN
      INSERT OR REPLACE INTO question_frontiers VALUES (NEW.generation,NEW.key,compact_source_read(NEW.body,'subtype'),json_extract(NEW.body,'$.document_date'),NEW.fetched_at); END;
    CREATE TRIGGER IF NOT EXISTS question_frontier_delete AFTER DELETE ON question_reads BEGIN DELETE FROM question_frontiers WHERE generation=OLD.generation AND key=OLD.key; END;`);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS question_title_search USING fts5(search_text,content='question_reads',content_rowid='rowid',tokenize='trigram');
    CREATE TRIGGER IF NOT EXISTS question_search_insert AFTER INSERT ON question_reads BEGIN INSERT INTO question_title_search(rowid,search_text) VALUES (NEW.rowid,NEW.search_text); END;
    CREATE TRIGGER IF NOT EXISTS question_search_delete AFTER DELETE ON question_reads BEGIN INSERT INTO question_title_search(question_title_search,rowid,search_text) VALUES ('delete',OLD.rowid,OLD.search_text); END;`);
  const body=ref=>`compact_source_read(${ref}.body,'metadata')`;
  const validEvents=ref=>`${ref}.kind='procedure' AND ${ref}.key GLOB '/procedures/[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]*' AND (length(${ref}.key)=21 OR (length(${ref}.key)=22 AND substr(${ref}.key,22) GLOB '[A-Z]')) AND compact_source_read(${ref}.body,'procedure-id')=substr(${ref}.key,13)`;
  const events=ref=>`SELECT ${ref}.generation,${ref}.key,json_extract(event.value,'$.activity_date'),json_extract(event.value,'$.had_activity_type'),${ref}.fetched_at,projection_event_date(json_extract(event.value,'$.activity_date'),${ref}.fetched_at) FROM json_each(compact_source_read(${ref}.body,'events')) event WHERE ${validEvents(ref)}`;
  db.exec(`CREATE TABLE IF NOT EXISTS procedure_event_reads(generation INTEGER,source_key TEXT,date TEXT,type TEXT,fetched_at TEXT,admissible_date TEXT);
    CREATE INDEX IF NOT EXISTS procedure_event_admissible ON procedure_event_reads(generation,type,admissible_date DESC);
    CREATE INDEX IF NOT EXISTS procedure_event_window ON procedure_event_reads(generation,date DESC,source_key);
    CREATE INDEX IF NOT EXISTS procedure_event_frontiers ON procedure_event_reads(generation,type,date,fetched_at);
    CREATE INDEX IF NOT EXISTS procedure_event_source ON procedure_event_reads(generation,source_key);
    CREATE INDEX IF NOT EXISTS read_motion_documents ON source_reads(generation,key) WHERE ${motionDocuments};
    `);
  db.exec(`CREATE TABLE IF NOT EXISTS outside_directory_reads(generation INTEGER,speech TEXT,person TEXT,date TEXT,term INTEGER,body TEXT,PRIMARY KEY(generation,speech,person));
    CREATE INDEX IF NOT EXISTS outside_read_term ON outside_directory_reads(generation,term,date DESC,speech);
    CREATE INDEX IF NOT EXISTS outside_read_date ON outside_directory_reads(generation,date DESC,speech);
    CREATE TABLE IF NOT EXISTS amendment_target_reads(generation INTEGER,id TEXT,body TEXT,PRIMARY KEY(generation,id));`);
  db.exec(`CREATE TABLE IF NOT EXISTS amendment_page_reads(generation INTEGER,id TEXT,target TEXT,date TEXT,outcome TEXT,number INTEGER,PRIMARY KEY(generation,id));
    CREATE INDEX IF NOT EXISTS amendment_page_order ON amendment_page_reads(generation,date DESC,target,number,id);
    CREATE INDEX IF NOT EXISTS amendment_page_target ON amendment_page_reads(generation,target,date DESC,number,id);`);
  for(const [name,event,ref] of [['insert','INSERT','NEW'],['update','UPDATE','NEW'],['delete','DELETE',null]])db.exec(`CREATE TRIGGER IF NOT EXISTS fast_amendment_page_${name} AFTER ${event} ON amendments BEGIN
    ${name==='insert'?'':`DELETE FROM amendment_page_reads WHERE generation=OLD.generation AND id=OLD.id;`}
    ${ref?`INSERT OR REPLACE INTO amendment_page_reads VALUES (${ref}.generation,${ref}.id,${ref}.target,${ref}.date,${ref}.outcome,CAST(json_extract(${ref}.body,'$.number') AS INTEGER));`:''} END;`);
  for(const [table,projection,columns,selection] of [
    ['outside_contributions','outside_directory_reads','generation,speech,person,date,term,body',ref=>`${ref}.generation,${ref}.speech,${ref}.person,${ref}.date,json_extract(${ref}.body,'$.term'),compact_source_read(${ref}.body,'outside')`],
    ['amendment_targets','amendment_target_reads','generation,id,body',ref=>`${ref}.generation,${ref}.id,compact_source_read(${ref}.body,'target')`],
  ]) {
    const identity=table==='outside_contributions'?'speech=OLD.speech AND person=OLD.person':'id=OLD.id';
    for(const [label,event,ref] of [['insert','INSERT','NEW'],['update','UPDATE','NEW'],['delete','DELETE',null]])db.exec(`CREATE TRIGGER IF NOT EXISTS fast_${table}_${label} AFTER ${event} ON ${table} BEGIN
      ${label!=='insert'?`DELETE FROM ${projection} WHERE generation=OLD.generation AND ${identity};`:''}
      ${ref?`INSERT OR REPLACE INTO ${projection}(${columns}) SELECT ${selection(ref)};`:''} END;`);

  }
  for(const [name,event,ref] of [['insert','INSERT','NEW'],['update','UPDATE OF body,kind,fetched_at','NEW'],['delete','DELETE',null]])db.exec(`CREATE TRIGGER IF NOT EXISTS fast_reads_${name} AFTER ${event} ON sources BEGIN
    DELETE FROM source_reads WHERE generation=${ref||'OLD'}.generation AND key=${ref||'OLD'}.key;
    DELETE FROM question_reads WHERE generation=${ref||'OLD'}.generation AND key=${ref||'OLD'}.key;
    DELETE FROM procedure_event_reads WHERE generation=${ref||'OLD'}.generation AND source_key=${ref||'OLD'}.key;
    ${ref?`INSERT INTO source_reads SELECT ${ref}.generation,${ref}.key,${ref}.kind,${body(ref)},${ref}.fetched_at WHERE ${ref}.kind IN ('document','procedure','motion-outcomes','amendment-list');
    INSERT INTO question_reads SELECT ${ref}.generation,${ref}.key,${ref}.kind,compact_source_read(${ref}.body,'question'),${ref}.fetched_at,compact_source_read(${ref}.body,'search',${ref}.key) WHERE ${ref}.kind='document' AND (${ref}.key LIKE '/parliamentary-questions/%' OR json_extract(${ref}.body,'$.work_type') LIKE '%/QUESTION_%');
    INSERT INTO procedure_event_reads ${events(ref)};`:''} END;`);
  db.exec(`CREATE TABLE IF NOT EXISTS fast_read_progress(projection TEXT,generation INTEGER,cursor TEXT NOT NULL DEFAULT '',ready INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(projection,generation));`);
}
export function fastReadsReady(store,generation,projection='sources') {
  try{return Boolean(store.db.prepare('SELECT ready FROM fast_read_progress WHERE projection=? AND generation=?').get(projection,generation)?.ready);}catch{return false;}
}
// One writer reservation and commit per call. Cursor and rows advance atomically.
export function backfillFastReads(store,generation,limit=32) {
  return store.transaction(()=>{
    store.assertWriter();
    for(const [projection,table,column] of [['sources','sources','key'],['outside','outside_contributions','speech'],['targets','amendment_targets','id'],['amendments','amendments','id']]) {
      store.db.prepare('INSERT OR IGNORE INTO fast_read_progress(projection,generation) VALUES (?,?)').run(projection,generation);
      const progress=store.db.prepare('SELECT * FROM fast_read_progress WHERE projection=? AND generation=?').get(projection,generation);
      if(progress.ready)continue;
      const count=Math.max(1,Math.min(limit,32));
      const rows=projection==='outside'?store.db.prepare('SELECT speech,person FROM outside_contributions WHERE generation=? AND (speech,person)>(?,?) ORDER BY speech,person LIMIT ?').all(generation,...(progress.cursor?JSON.parse(progress.cursor):['','']),count):store.db.prepare(`SELECT ${column} cursor FROM ${table} WHERE generation=? AND ${column}>? ORDER BY ${column} LIMIT ?`).all(generation,progress.cursor,count);
      // Re-fire the normal inline maintenance, preserving every source byte and timestamp.
      const update=store.db.prepare(`UPDATE ${table} SET body=body WHERE generation=? AND ${column}=?`+(projection==='outside'?' AND person=?':''));
      for(const row of rows)projection==='outside'?update.run(generation,row.speech,row.person):update.run(generation,row.cursor);
      store.db.prepare('UPDATE fast_read_progress SET cursor=?,ready=? WHERE projection=? AND generation=?').run((projection==='outside'&&rows.length?JSON.stringify([rows.at(-1).speech,rows.at(-1).person]):rows.at(-1)?.cursor)||progress.cursor,Number(rows.length===0),projection,generation);
      return true;
    }
    return false;
  });
}
