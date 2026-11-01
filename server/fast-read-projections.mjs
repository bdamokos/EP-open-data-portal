import {languageCode} from './ep-links.mjs';
import {array,tail} from './activity-index-model.mjs';
import {motionDocuments} from './activity-read-projections.mjs';
export function registerFastReads(db) {
  db.function('compact_source_read',{deterministic:true},(body,mode)=>{
    const work=JSON.parse(body,(key,value)=>['extraction','amendmentEvidence','xml_fragment'].includes(key)?undefined:value);
    if(mode==='subtype')return typeof work.work_type==='string'&&work.work_type.includes('/')?tail(work.work_type):'';
    if(mode==='procedure-id')return tail(work.id)||'';
    if(mode==='events')return JSON.stringify(array(work.consists_of).filter(event=>{
      const type=tail(event.had_activity_type);
      return (['PLENARY_DEBATE','PLENARY_VOTE'].includes(type)||type.startsWith('COMMITTEE_'))&&/^eli\/dl\/event\/[A-Z0-9-]{1,150}$/.test(String(event.id).replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''))&&/^\d{4}-\d{2}-\d{2}$/.test(event.activity_date||'');
    }).map(event=>({activity_date:event.activity_date,had_activity_type:tail(event.had_activity_type)})));
    if(mode==='outside')return JSON.stringify(Object.fromEntries(['id','personId','date','term','start','parentIds','reportedParentIds','parentDocumentIds','parentDocumentsComplete','header'].filter(key=>Object.hasOwn(work,key)).map(key=>[key,work[key]])));
    if(mode==='target')return JSON.stringify(Object.fromEntries(['id','scope','targetDocumentId','procedureIds','committees','gaps','listProjectionVersion','committeeProjectionVersion','complete','wordingComplete','proposerComplete','lastUpdated','emptyObservation','linkedListObservationCount','unresolvedListObservationCount'].filter(key=>Object.hasOwn(work,key)).map(key=>[key,work[key]])));
    if(mode==='search')return [work.identifier,...Object.values(work.title_dcterms||{}),...array(work.is_realized_by).flatMap(expression=>Object.values(expression.title||{}))].filter(value=>typeof value==='string').join('\n').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase();
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
  const events=ref=>`SELECT ${ref}.generation,${ref}.key,json_extract(event.value,'$.activity_date'),json_extract(event.value,'$.had_activity_type'),${ref}.fetched_at FROM json_each(compact_source_read(${ref}.body,'events')) event WHERE ${validEvents(ref)}`;
  db.exec(`CREATE TABLE IF NOT EXISTS procedure_event_reads(generation INTEGER,source_key TEXT,date TEXT,type TEXT,fetched_at TEXT);
    CREATE INDEX IF NOT EXISTS procedure_event_window ON procedure_event_reads(generation,date DESC,source_key);
    CREATE INDEX IF NOT EXISTS procedure_event_frontiers ON procedure_event_reads(generation,type,date,fetched_at);
    CREATE INDEX IF NOT EXISTS procedure_event_source ON procedure_event_reads(generation,source_key);
    CREATE INDEX IF NOT EXISTS parser_upgrade_due ON sources(generation,COALESCE(json_extract(body,'$.extraction.parserVersion'),''),key) WHERE kind='amendment-list' AND json_type(body,'$.extraction')='object';
    CREATE INDEX IF NOT EXISTS motion_classification_due ON sources(generation,COALESCE(json_extract(body,'$.motionClassificationVersion'),0),key) WHERE ${motionDocuments};
    CREATE INDEX IF NOT EXISTS read_motion_documents ON source_reads(generation,key) WHERE ${motionDocuments};
    CREATE INDEX IF NOT EXISTS amendment_all_page ON amendments(generation,date DESC,target,CAST(json_extract(body,'$.number') AS INTEGER),id);
    CREATE INDEX IF NOT EXISTS amendment_plenary_page ON amendments(generation,date DESC,target,CAST(json_extract(body,'$.number') AS INTEGER),id) WHERE target NOT GLOB 'committee:*';
    CREATE INDEX IF NOT EXISTS amendment_target_metadata ON amendments(generation,target,id,date,outcome);
    CREATE INDEX IF NOT EXISTS amendment_target_page ON amendments(generation,target,date DESC,CAST(json_extract(body,'$.number') AS INTEGER),id);
    CREATE INDEX IF NOT EXISTS outside_unresolved_dates ON outside_contributions(generation,date,speech) WHERE json_extract(body,'$.header.name') IS NULL OR json_array_length(body,'$.parentIds')=0;`);
  db.exec(`CREATE TABLE IF NOT EXISTS outside_directory_reads(generation INTEGER,speech TEXT,person TEXT,date TEXT,term INTEGER,body TEXT,PRIMARY KEY(generation,speech,person));
    CREATE INDEX IF NOT EXISTS outside_read_term ON outside_directory_reads(generation,term,date DESC,speech);
    CREATE INDEX IF NOT EXISTS outside_read_date ON outside_directory_reads(generation,date DESC,speech);
    CREATE TABLE IF NOT EXISTS amendment_target_reads(generation INTEGER,id TEXT,body TEXT,PRIMARY KEY(generation,id));`);
  for(const [table,projection,columns,selection] of [
    ['outside_contributions','outside_directory_reads','generation,speech,person,date,term,body',ref=>`${ref}.generation,${ref}.speech,${ref}.person,${ref}.date,json_extract(${ref}.body,'$.term'),compact_source_read(${ref}.body,'outside')`],
    ['amendment_targets','amendment_target_reads','generation,id,body',ref=>`${ref}.generation,${ref}.id,compact_source_read(${ref}.body,'target')`],
  ]) {
    const identity=table==='outside_contributions'?'speech=OLD.speech AND person=OLD.person':'id=OLD.id';
    for(const [label,event,ref] of [['insert','INSERT','NEW'],['update','UPDATE','NEW'],['delete','DELETE',null]])db.exec(`CREATE TRIGGER IF NOT EXISTS fast_${table}_${label} AFTER ${event} ON ${table} BEGIN
      ${label!=='insert'?`DELETE FROM ${projection} WHERE generation=OLD.generation AND ${identity};`:''}
      ${ref?`INSERT OR REPLACE INTO ${projection}(${columns}) SELECT ${selection(ref)};`:''} END;`);
    db.exec(`DELETE FROM ${projection}; INSERT INTO ${projection}(${columns}) SELECT ${selection('source')} FROM ${table} source;`);
  }
  for(const [name,event,ref] of [['insert','INSERT','NEW'],['update','UPDATE OF body,kind,fetched_at','NEW'],['delete','DELETE',null]])db.exec(`CREATE TRIGGER IF NOT EXISTS fast_reads_${name} AFTER ${event} ON sources BEGIN
    DELETE FROM source_reads WHERE generation=${ref||'OLD'}.generation AND key=${ref||'OLD'}.key;
    DELETE FROM question_reads WHERE generation=${ref||'OLD'}.generation AND key=${ref||'OLD'}.key;
    DELETE FROM procedure_event_reads WHERE generation=${ref||'OLD'}.generation AND source_key=${ref||'OLD'}.key;
    ${ref?`INSERT INTO source_reads SELECT ${ref}.generation,${ref}.key,${ref}.kind,${body(ref)},${ref}.fetched_at WHERE ${ref}.kind IN ('document','procedure','motion-outcomes','amendment-list');
    INSERT INTO question_reads SELECT ${ref}.generation,${ref}.key,${ref}.kind,compact_source_read(${ref}.body,'question'),${ref}.fetched_at,compact_source_read(${ref}.body,'search') WHERE ${ref}.kind='document' AND (${ref}.key LIKE '/parliamentary-questions/%' OR json_extract(${ref}.body,'$.work_type') LIKE '%/QUESTION_%');
    INSERT INTO procedure_event_reads ${events(ref)};`:''} END;`);
  db.exec(`DELETE FROM source_reads; INSERT INTO source_reads SELECT source.generation,source.key,source.kind,${body('source')},source.fetched_at FROM sources source WHERE source.kind IN ('document','procedure','motion-outcomes','amendment-list');
    DELETE FROM question_reads; INSERT INTO question_reads SELECT generation,key,kind,compact_source_read(body,'question'),fetched_at,compact_source_read(body,'search') FROM sources WHERE kind='document' AND (key LIKE '/parliamentary-questions/%' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_%');
    DELETE FROM procedure_event_reads; INSERT INTO procedure_event_reads SELECT source.generation,source.key,json_extract(event.value,'$.activity_date'),json_extract(event.value,'$.had_activity_type'),source.fetched_at FROM sources source,json_each(compact_source_read(source.body,'events')) event WHERE ${validEvents('source')};`);
}
