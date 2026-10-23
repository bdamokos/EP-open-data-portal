import {createHash} from 'node:crypto';
import {array,tail,procedureIds} from './activity-index-model.mjs';
import {sourceTitles} from './source-titles.mjs';
import {isMotion,motionOutcome,motionSourceKey} from './motion-outcomes.mjs';
import {procedureReference} from './official-context.mjs';
import {HttpError} from './http-utils.mjs';

export const FOLLOWING_DOSSIERS_VERSION=1;
const key=(kind,id)=>createHash('sha256').update(JSON.stringify([kind,id])).digest('hex');
const stages={REFERRAL:'Referred to committee',COMMITTEE_ADOPTING_REPORT:'Committee report adopted',TABLING_PLENARY:'Document tabled',PLENARY_ADOPT_POSITION:'Parliament position adopted',SIGNATURE:'Act signed',PUBLICATION_OFFICIAL_JOURNAL:'Published in the Official Journal'};
const documentId=value=>String(value?.id||value||'').match(/(?:^|\/)eli\/dl\/doc\/([A-Z0-9-]{1,100})$/)?.[1];

// Prepared and populated only by the existing leased index writer. The inverse
// relationship avoids parsing the question corpus at every publication/read.
export function prepareDossierMarks(store) {
  const db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS dossier_documents(generation INTEGER,procedure TEXT,source_key TEXT,PRIMARY KEY(generation,procedure,source_key)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS dossier_document_source ON dossier_documents(generation,source_key);
    CREATE TABLE IF NOT EXISTS procedure_marks(procedure TEXT,kind TEXT,source_id TEXT,mark INTEGER,PRIMARY KEY(procedure,kind,source_id)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS dossier_events(generation INTEGER,procedure TEXT,kind TEXT,source_id TEXT,body TEXT,PRIMARY KEY(generation,procedure,kind,source_id)) WITHOUT ROWID;`);
  const links=source=>`SELECT ${source}.generation,substr(replace(CASE WHEN ref.type='object' THEN json_extract(ref.value,'$.id') ELSE ref.value END,'https://data.europarl.europa.eu/',''),13),${source}.key FROM json_each(${source}.body,'$.inverse_created_a_realization_of') ref WHERE ${source}.kind='document'`;
  // Reference validation is performed by procedureIds when the frozen view is built.
  for(const [event,source] of [['INSERT','NEW'],['UPDATE OF body,kind','NEW'],['DELETE',null]])db.exec(`CREATE TRIGGER IF NOT EXISTS dossier_documents_${event.split(' ')[0].toLowerCase()} AFTER ${event} ON sources BEGIN
    DELETE FROM dossier_documents WHERE generation=${source||'OLD'}.generation AND source_key=${source||'OLD'}.key;
    ${source?'INSERT OR IGNORE INTO dossier_documents '+links(source)+';':''} END`);
  db.exec('INSERT OR IGNORE INTO dossier_documents '+links('source').replace('FROM json_each','FROM sources source,json_each'));
}

export function publishDossierMarks(store,generation) {
  const db=store.db;
  db.prepare('DELETE FROM dossier_events WHERE generation=?').run(generation);
  const put=db.prepare('INSERT OR IGNORE INTO dossier_events VALUES (?,?,?,?,?)');
  const add=(procedure,kind,id,entry)=>{
    if(!/^\d{4}-\d{4}[A-Z]?$/.test(procedure)||!id)return;
    put.run(generation,procedure,kind,id,JSON.stringify({id:key(kind,id),kind:'activity',eventKind:kind,sourceId:id,...entry}));
  };
  for(const source of store.iterateSources(generation,'procedure')) {
    const procedure=tail(source.work.id);
    for(const event of array(source.work.consists_of)) {
      if(!event.id||!/^\d{4}-\d{2}-\d{2}$/.test(event.activity_date||'')||event.activity_date<'2024-07-16')continue;
      const type=tail(event.had_activity_type);
      const documents=['based_on_a_realization_of','created_a_realization_of','involved_work','decided_on_a_realization_of'].flatMap(field=>array(event[field]).map(documentId).filter(Boolean));
      add(procedure,'stage',String(event.id),{title:stages[type]||'Procedure stage: '+type.replaceAll('_',' ').toLowerCase(),titleLanguage:'en',date:event.activity_date,documentId:documents[0]||null,source:{url:'https://data.europarl.europa.eu/api/v2/procedures/'+procedure,fetchedAt:source.fetchedAt}});
    }
  }
  for(const source of db.prepare(`SELECT DISTINCT source.key,source.body,source.fetched_at FROM dossier_documents link JOIN sources source ON source.generation=link.generation AND source.key=link.source_key WHERE link.generation=?`).iterate(generation)) {
    const work=JSON.parse(source.body);
    if(!array(work.parliamentary_term).some(term=>tail(term)==='ep-10'))continue;
    const id=work.identifier||tail(work.id),titles=sourceTitles(work.title_dcterms),language=titles.en?'en':Object.keys(titles)[0],kind=tail(work.work_type)==='AMENDMENT_LIST'?'amendment-list':'document';
    const provenance={url:'https://data.europarl.europa.eu/api/v2'+source.key,fetchedAt:source.fetched_at};
    const outcome=isMotion(work)?motionOutcome(work,source.fetched_at,sitting=>store.source(generation,motionSourceKey(sitting))):null;
    for(const procedure of procedureIds(work)) {
      add(procedure,kind,id,{title:titles[language]||id,titleLanguage:language||null,date:work.document_date||'',documentId:id,source:provenance});
      if(outcome?.decisionId&&outcome.status!=='unavailable')add(procedure,'vote',outcome.decisionId,{title:'Motion '+outcome.status.toLowerCase(),titleLanguage:'en',date:outcome.date,documentId:id,source:outcome.sources?.at(-1)||provenance});
    }
  }
  db.prepare(`INSERT OR IGNORE INTO procedure_marks SELECT procedure,kind,source_id,? FROM dossier_events WHERE generation=?`).run(generation,generation);
}

export function dossierQuery(search) {
  for(const name of search.keys())if(!['epoch','generation','procedures'].includes(name)||search.getAll(name).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated dossier query.');
  const epoch=search.get('epoch'),generation=Number(search.get('generation')),references=(search.get('procedures')||'').split(',');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(epoch||'')||! /^[1-9]\d*$/.test(search.get('generation')||'')||!Number.isSafeInteger(generation)||generation<1)throw new HttpError(400,'invalid_generation','Choose an index epoch and generation.');
  if(references.length>50||new Set(references).size!==references.length)throw new HttpError(400,'invalid_selection','Choose up to 50 dossiers.');
  references.forEach(procedureReference);return {epoch,generation,references};
}
export function followingDossiers(store,search) {
  const {epoch,generation,references}=dossierQuery(search);
  if(epoch!==store.get('marksEpoch')||![store.get('active'),store.get('previous')].includes(generation))throw new HttpError(409,'generation_changed','The index generation has changed. Try again.');
  if(store.get('followMarksVersion')!==3)throw new HttpError(503,'marks_unavailable','Dossier updates are not available yet.');
  const entries=store.db.prepare(`SELECT event.body,mark.mark FROM dossier_events event JOIN procedure_marks mark USING(procedure,kind,source_id) WHERE generation=? AND procedure=? ORDER BY mark.mark DESC,event.kind,event.source_id LIMIT 1001`);
  const items=references.map(reference=>{
    const procedure=reference.replace(/\([A-Z]+\)$/,'').replace('/','-'),source=store.source(generation,'/procedures/'+procedure),type=tail(array(source?.work.process_type)[0]);
    if(type&&type!==reference.match(/\(([A-Z]+)\)$/)[1])return {reference,status:'unavailable',entries:[]};
    const rows=entries.all(generation,procedure),titles=sourceTitles(source?.work.process_title);
    return {reference,status:source||rows.length?'available':'unavailable',title:titles.en||null,titleLanguage:titles.en?'en':null,limited:rows.length>1000,entries:rows.slice(0,1000).map(row=>({...JSON.parse(row.body),mark:row.mark}))};
  });
  return {version:FOLLOWING_DOSSIERS_VERSION,epoch,generation,indexComplete:Boolean(store.db.prepare('SELECT index_complete FROM follow_generations WHERE generation=?').get(generation)?.index_complete),items};
}
