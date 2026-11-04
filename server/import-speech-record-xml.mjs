// Maintainer tool: import plenary speeches the Open Data API lists but cannot
// serve, from individually published website XML files captured beforehand.
// The app never reads these files itself; this tool only reads local files.
//
//   node server/import-speech-record-xml.mjs --manifest manifest.json --evidence evidence.json \
//     --index DIR --corpus DIR [--dry-run | --rollback] [--wait-seconds N]
//
// manifest.json: {files:[{file,url,status,retrievedAt,sha256}]}. Paths are relative to the manifest.
// evidence.json: public API reads of each speech's PRE and SUIV neighbours and their debate:
//   {speeches:{<id>:{url,fetchedAt,activity}},events:{<id>:{url,fetchedAt,consists_of}}}
//
// --dry-run reads only backup copies, identified by the .sha256 file `ops.mjs backup`
// leaves beside each one. It runs the real writes on them and rolls everything back,
// with no leases to wait for and no contact with the live app. A real write holds a
// write lock for one record at a time, and its row report is read outside the lock.
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {ACTIVITY_SCHEMA_GATES,ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {CORPUS_SCHEMA_GATES,CorpusStore} from './corpus-store.mjs';
import {initializeAvailabilityHistory} from './availability-history.mjs';
import {speechTexts} from './corpus-worker.mjs';
import {languageCode} from './ep-links.mjs';
import {groupVoiceJobKey} from './group-voices-store.mjs';
import {WEBSITE_ACQUISITION,WEBSITE_RECHECK_MS,logSpeechGapChange,observeSpeechGap,speechSourceGapSchema} from './speech-source-gaps.mjs';
import {speakerIsChair} from '../src/speakerNames.mjs';

const refuse=message=>{throw Object.assign(new Error(message),{code:'import_refused'});};
const LANGUAGE_URIS=Object.fromEntries(['BUL','SPA','CES','DAN','DEU','EST','ELL','ENG','FRA','GLE','HRV','ITA','LAV','LIT','HUN','MLT','NLD','POL','POR','RON','SLK','SLV','FIN','SWE'].map(code=>[languageCode(code),'http://publications.europa.eu/resource/authority/language/'+code]));
const WEBSITE_URL=/^https:\/\/www\.europarl\.europa\.eu\/doceo\/document\/CRE-(\d+)-(\d{4}-\d{2}-\d{2})-INT-(\d{1,16})_([A-Z]{2})\.xml$/;
const TERM_START='2024-07-16';
const TAGS=new Set(['SubItem.CHAPTER','NUMERO','INTERVENTION','ORATEUR','LG','EMPHAS','PP','PARA','#text',':@']);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false,processEntities:true});
const tagOf=node=>Object.keys(node).find(key=>key!==':@');
const flatten=nodes=>nodes.map(node=>tagOf(node)==='#text'?node['#text']:flatten(node[tagOf(node)])).join('');
const walk=(nodes,visit)=>{for(const node of nodes){visit(tagOf(node));if(tagOf(node)!=='#text')walk(node[tagOf(node)],visit);}};
const only=(nodes,tag)=>{const found=nodes.filter(node=>tagOf(node)===tag);if(found.length!==1)refuse(`Expected one ${tag} element.`);return found[0];};
const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const position=value=>{const parts=String(value||'').match(/^(\d+)-(\d+)-(\d+)$/);return parts?parts.slice(1).map(Number):null;};
const numberOrder=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];
const array=value=>value==null?[]:Array.isArray(value)?value:[value];

export function parseSpeechXml(bytes,url,{today=new Date().toISOString().slice(0,10)}={}) {
  const match=String(url).match(WEBSITE_URL);
  if(!match)refuse('Source URL is not an individual verbatim-report XML file.');
  const [,term,date,speechId,version]=match;
  if(term!=='10'||!validDay(date)||date<TERM_START||date>today)refuse('Term or sitting date is outside the current term.');
  const xml=Buffer.from(bytes).toString('utf8');
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)refuse('XML is invalid.');
  const roots=parser.parse(xml);
  walk(roots,tag=>{if(!TAGS.has(tag))refuse(`Unknown XML element ${tag}.`);});
  const root=only(roots,'SubItem.CHAPTER')['SubItem.CHAPTER'],numero=only(root,'NUMERO'),intervention=only(root,'INTERVENTION').INTERVENTION,orateur=only(intervention,'ORATEUR');
  const attrs=numero[':@'],speaker=orateur[':@'];
  if(attrs['@_ACT']!==speechId)refuse(`ACT ${attrs['@_ACT']} does not match speech ${speechId}.`);
  if(attrs['@_VL']!==version)refuse('NUMERO language does not match the file language.');
  // A version in another language is a translation; only originals are imported.
  if(speaker['@_LG']!==version||flatten(only(orateur.ORATEUR,'LG').LG)!==version)refuse('Speaker language does not match the file language.');
  const mep=speaker['@_MEPID'];
  if(!/^[1-9]\d*$/.test(mep||'')||speaker['@_CODICT']!==mep)refuse('Speaker MEPID is missing or disagrees with CODICT.');
  const index=attrs['@_INDEX'],indexPosition=position(index);
  if(!indexPosition)refuse('NUMERO INDEX is malformed.');
  const start=attrs['@_VOD-START'],end=attrs['@_VOD-END'];
  if(Boolean(start)!==Boolean(end)||start&&(start.slice(0,10)!==date||end.slice(0,10)!==date))refuse('Recording times do not match the sitting date.');
  const paragraphs=intervention.filter(node=>tagOf(node)==='PARA').map(node=>node.PARA).filter(nodes=>flatten(nodes).trim());
  if(!paragraphs.length)refuse('Speech has no text.');
  const first=paragraphs[0],lead=first.find(node=>tagOf(node)!=='#text'||node['#text'].trim());
  const process=lead&&tagOf(lead)==='EMPHAS'&&lead[':@']?.['@_NAME']==='I'?flatten(lead.EMPHAS).trim():null;
  const written=!start&&indexPosition[2]!==0&&Boolean(process);
  if(!written&&!(start&&indexPosition[2]===0))refuse('Speech type is ambiguous: recording, numbering and "in writing" marker disagree.');
  const label=speaker['@_LIB']||'',name=label.split('|').map(part=>part.trim()).filter(Boolean).join(' ');
  const heading=flatten(only(orateur.ORATEUR,'EMPHAS').EMPHAS).trim();
  const group=only(orateur.ORATEUR,'EMPHAS').EMPHAS.filter(node=>tagOf(node)==='PP').map(node=>flatten(node.PP))[0]||null;
  if(!name||![',','.'].some(end=>heading===(group?`${name} (${group})`:name)+end))refuse('Speaker heading does not match the speaker label.');
  if(!written&&!speakerIsChair(name)&&!group)refuse('Oral speaker has neither a chair label nor a political group.');
  const texts=paragraphs.map((nodes,i)=>(i===0&&written?flatten(nodes.slice(nodes.indexOf(lead)+1)):flatten(nodes)).replace(/^\s*[–—-]\s*/,'').replace(/\s+/g,' ').trim()).filter(Boolean);
  if(!texts.length)refuse('Speech has no text after its header.');
  return {term:10,date,speechId,id:`MTG-PL-${date}-OTH-${speechId}`,language:version.toLowerCase(),index,pre:attrs['@_PRE']||null,suiv:attrs['@_SUIV']||null,start:start||null,end:end||null,mepId:mep,name,group,kind:written?'PLENARY_DEBATE_WRITTEN_STATEMENT':'PLENARY_DEBATE_SPEECH',process,texts};
}

// Filing follows EP's own numbering: both published neighbours must name one
// debate and bracket this speech. Topic fit is never considered.
export function parentFromEvidence(speech,evidence) {
  const neighbour=number=>{
    const id=`MTG-PL-${speech.date}-OTH-${number}`,entry=evidence.speeches?.[id],activity=entry?.activity;
    if(!number||activity?.activity_id!==id||activity.activity_date!==speech.date)refuse(`Parent is ambiguous: no evidence for neighbour ${number} of ${speech.id}.`);
    const parents=array(activity.inverse_consists_of).map(value=>String(value?.id||value).split('/').at(-1)),doc=array(activity.recorded_in_a_realization_of).find(value=>value&&typeof value==='object');
    const parts=array(doc?.is_part_of).map(value=>String(value?.id||value));
    if(parents.length!==1||parts.length!==1||!/^MTG-PL-\d{4}-\d{2}-\d{2}-PVCRE-ITM-[\d-]+$/.test(parents[0])||!position(doc.number))refuse(`Parent is ambiguous: neighbour ${number} of ${speech.id} has no single debate.`);
    return {id,parent:parents[0],part:parts[0],number:position(doc.number),titles:activity.activity_label||{},url:entry.url,fetchedAt:entry.fetchedAt};
  };
  const previous=neighbour(speech.pre),following=neighbour(speech.suiv),own=position(speech.index);
  if(previous.parent!==following.parent||previous.part!==following.part)refuse(`Parent is ambiguous: neighbours of ${speech.id} name ${previous.parent} and ${following.parent}.`);
  if(numberOrder(previous.number,own)>=0||numberOrder(own,following.number)>=0)refuse(`Parent is ambiguous: ${speech.id} is not numbered between its neighbours.`);
  if(JSON.stringify(Object.entries(previous.titles).sort())!==JSON.stringify(Object.entries(following.titles).sort())||!Object.keys(previous.titles).length)refuse(`Parent is ambiguous: neighbours of ${speech.id} carry different titles.`);
  const debate=evidence.events?.[previous.parent];
  const children=debate?array(debate.consists_of).map(value=>String(value?.id||value).split('/').at(-1)):null;
  if(children&&(!children.includes(previous.id)||!children.includes(following.id)))refuse(`Parent is ambiguous: debate ${previous.parent} does not list both neighbours of ${speech.id}.`);
  const listed=Boolean(children?.includes(speech.id));
  return {parent:previous.parent,part:previous.part,titles:previous.titles,listedByDebate:listed,basis:(listed?'debate lists this speech; ':'')+'both neighbours name this debate and bracket its number',sources:[previous,following].map(({id,url,fetchedAt})=>({id,url,fetchedAt}))};
}

const brusselsOffset=value=>{
  const name=new Intl.DateTimeFormat('en',{timeZone:'Europe/Brussels',timeZoneName:'longOffset'}).formatToParts(new Date(value+'Z')).find(part=>part.type==='timeZoneName').value;
  return name.replace('GMT','')||'+00:00';
};
export function speechFragment(speech) {
  const lang=escape(speech.language),person=`<person refersTo="epdata:person/${speech.mepId}">${escape(speech.name)}</person>`;
  const statement=speech.kind==='PLENARY_DEBATE_WRITTEN_STATEMENT';
  // The XML names the group but not its organisation ID, so none is asserted.
  const group=speech.group?` (<organization>${escape(speech.group)}</organization>)`:'';
  const from=statement?`${person}${group}, <process refersTo="">${escape(speech.process)}</process>`:`${person}${group}.`;
  const times=speech.start?`endTime="${escape(speech.end)}" startTime="${escape(speech.start)}" `:'';
  const root=statement?'writtenStatements':'oralStatements';
  return `<${root}><speech ${times}xml:lang="${lang}"><from xml:lang="${lang}" xml:space="preserve">${from}</from><blockContainer>${speech.texts.map(text=>`<p>${escape(text)}</p>`).join('')}</blockContainer></speech></${root}>`;
}
// The API-shaped record every reader expects, plus its provenance. Numbering
// stays absent: the API's own sequence has no slot for this speech.
export function speechActivity(speech,placement,{url,retrievedAt,sha256}) {
  const identifier=`CRE-10-${speech.date}-OTH-${speech.speechId}`;
  return {id:'eli/dl/event/'+speech.id,type:'Activity',activity_date:speech.date,activity_id:speech.id,activity_label:placement.titles,
    ...(speech.start?{activity_start_date:speech.start+brusselsOffset(speech.start),activity_end_date:speech.end+brusselsOffset(speech.end)}:{}),
    had_activity_type:'def/ep-activities/'+speech.kind,
    had_participation:{id:`eli/dl/participation/${speech.id}_${speech.mepId}`,type:'Participation',had_participant_person:['person/'+speech.mepId],participation_role:'def/ep-roles/SPEAKER'},
    recorded_in_a_realization_of:[{id:'eli/dl/doc/'+identifier,type:'WorkSubdivision',is_part_of:placement.part,number:speech.index,type_subdivision:'http://publications.europa.eu/resource/authority/subdivision/OTH',identifier,notation_speechId:speech.speechId,originalLanguage:[LANGUAGE_URIS[speech.language]],'api:xmlFragment':{[speech.language]:speechFragment(speech)}}],
    inverse_consists_of:['eli/dl/event/'+placement.parent],
    acquisition:WEBSITE_ACQUISITION,
    website:{url,retrievedAt,sha256,fromApi:false,neighbours:{previous:placement.sources[0].id,next:placement.sources[1].id},parentEvidence:{basis:placement.basis,listedByDebate:placement.listedByDebate,sources:placement.sources}}};
}

const generations=store=>[...new Set([store.get('active'),store.get('working')?.generation].filter(Number.isInteger))];
const indexKeys=id=>['/speeches/'+id,'recovery:/speeches/'+id,'website-recheck:/speeches/'+id,'/events/'+id,'outside:detail:'+id,'outside:english:'+id,'outside:upgrade:'+id];
export const INDEX_TABLES=[
  ['sources',id=>['key=?',['/speeches/'+id]]],['items',id=>['source_key=?',['/speeches/'+id]]],
  ['outside_contributions',id=>['speech=?',[id]]],['group_voice_observations',id=>['speech=?',[id]]],['group_voice_designations',id=>['speech=?',[id]]],
  ['tasks',id=>[`key IN (${indexKeys(id).map(()=>'?')})`,indexKeys(id)]],['amendment_jobs',id=>[`key IN (${indexKeys(id).map(()=>'?')})`,indexKeys(id)]],['group_voice_jobs',id=>['key=?',[groupVoiceJobKey('recovery',id)]]],
  ['refresh_gaps',id=>[`key IN (${indexKeys(id).map(()=>'?')})`,indexKeys(id)]],['refresh_gap_admissions',id=>[`key IN (${indexKeys(id).map(()=>'?')})`,indexKeys(id)]],
  ['speech_source_gaps',id=>['id=?',[id]]],
];
const corpusKeys=id=>['speech:'+id,'speech-metadata-detail:'+id];
export const CORPUS_TABLES=[
  ['documents',id=>['source_id=?',[id]]],['texts',id=>['document_id IN (SELECT id FROM documents WHERE source_id=?)',[id]]],
  ['speech_metadata',id=>['source_id=?',[id]]],['speech_catalog',id=>['source_id=?',[id]]],
  ['tasks',id=>[`key IN (${corpusKeys(id).map(()=>'?')})`,corpusKeys(id)]],['source_failures',id=>[`key IN (${corpusKeys(id).map(()=>'?')})`,corpusKeys(id)]],
];
const shown=value=>{
  if(value instanceof Uint8Array)return `<${value.length} bytes sha256:${createHash('sha256').update(value).digest('hex').slice(0,16)}>`;
  return typeof value==='string'&&value.length>200?`${value.slice(0,120)}… <${value.length} chars sha256:${createHash('sha256').update(value).digest('hex').slice(0,16)}>`:value;
};
// Index tables lead with generation, so naming it keeps each read on its primary key.
export function snapshotQueries(tables,id,targets=null) {
  return tables.flatMap(([table,scope])=>{
    const [where,args]=scope(id),sql=condition=>`SELECT rowid AS _rowid,* FROM ${table} WHERE ${condition}`;
    return targets&&table!=='speech_source_gaps'?targets.map(generation=>({table,sql:sql('generation=? AND '+where),args:[generation,...args]})):[{table,sql:sql(where),args}];
  });
}
function snapshot(db,tables,id,targets) {
  const rows=new Map();
  for(const {table,sql,args} of snapshotQueries(tables,id,targets))for(const row of db.prepare(sql).all(...args)) {
    const {_rowid,...values}=row;
    rows.set(table+':'+('generation' in values?values.generation+':':'')+_rowid,{table,values});
  }
  return rows;
}
function rowChanges(before,after,store) {
  const changes=[];
  for(const [key,row] of after) {
    const old=before.get(key);
    if(!old){changes.push({store,table:row.table,change:'insert',row:Object.fromEntries(Object.entries(row.values).map(([k,v])=>[k,shown(v)]))});continue;}
    const columns=Object.keys(row.values).filter(column=>JSON.stringify(shown(row.values[column]))!==JSON.stringify(shown(old.values[column])));
    if(columns.length)changes.push({store,table:row.table,change:'update',key:key.split(':').slice(1).join(':'),columns:Object.fromEntries(columns.map(column=>[column,[shown(old.values[column]),shown(row.values[column])]]))});
  }
  for(const [key,row] of before)if(!after.has(key))changes.push({store,table:row.table,change:'delete',row:Object.fromEntries(Object.entries(row.values).map(([k,v])=>[k,shown(v)]))});
  return changes;
}

// Queue owners for this exact speech end with their gaps; nothing else moves.
function clearIndexOwners(store,generation,id) {
  const keys=indexKeys(id),marks=keys.map(()=>'?').join(',');
  store.db.prepare(`DELETE FROM refresh_gaps WHERE generation=? AND key IN (${marks})`).run(generation,...keys);
  store.db.prepare(`DELETE FROM refresh_gap_admissions WHERE generation=? AND key IN (${marks})`).run(generation,...keys);
  store.db.prepare(`UPDATE tasks SET done=1,error=NULL WHERE generation=? AND key IN (${marks}) AND (done IS NULL OR done<>1)`).run(generation,...keys);
  store.db.prepare(`UPDATE amendment_jobs SET done=1,error=NULL WHERE generation=? AND key IN (${marks}) AND (done IS NULL OR done<>1)`).run(generation,...keys);
  store.db.prepare('UPDATE group_voice_jobs SET done=1,error=NULL WHERE generation=? AND key=? AND done<>1').run(generation,groupVoiceJobKey('recovery',id));
}
function clearCorpusOwners(corpus,id) {
  for(const key of corpusKeys(id)){const task=corpus.task(key);if(task&&!task.done)corpus.finishTask(task);corpus.db.prepare('DELETE FROM source_failures WHERE key=?').run(key);}
}
function assertSpeakerKnown(store,generation,speech) {
  const roster=store.source(generation,'outside:roster:'+speech.date)?.work;
  if(roster?.ids&&!roster.ids.map(String).includes(speech.mepId))refuse(`Speaker ${speech.mepId} is not on the dated roster for ${speech.date}.`);
  if(!roster&&!store.db.prepare('SELECT 1 FROM members WHERE id=?').get(speech.mepId))refuse(`Speaker ${speech.mepId} is not on a held roster.`);
}
// Evidence read earlier must still agree with whatever the index now holds.
function assertHeldNeighbours(store,generation,placement) {
  for(const {id} of placement.sources) {
    const held=store.source(generation,'/speeches/'+id)?.work;
    const parents=held?.inverse_consists_of?array(held.inverse_consists_of).map(value=>String(value?.id||value).split('/').at(-1)):held?.outside?.parentIds;
    if(parents?.length&&!parents.includes(placement.parent))refuse(`Parent is ambiguous: held neighbour ${id} names ${parents.join(', ')}.`);
  }
}

const within=(target,fn)=>target.db.isTransaction?fn():target.transaction(fn);
export function importRecord({store,corpus,worker},{speech,placement,activity,url,retrievedAt,sha256}) {
  const id=speech.id,targets=generations(store);
  if(!targets.length)refuse('The index has no generation to write to.');
  for(const generation of targets){assertSpeakerKnown(store,generation,speech);assertHeldNeighbours(store,generation,placement);}
  const heldIndex=generation=>store.source(generation,'/speeches/'+id)?.work;
  if(targets.some(generation=>{const work=heldIndex(generation);return work&&work.acquisition!==WEBSITE_ACQUISITION;}))return {id,outcome:'api-record-held',changes:[],gapChange:null};
  const apiText=corpus.db.prepare("SELECT 1 FROM documents d JOIN texts t ON t.document_id=d.id WHERE d.source_id=? AND COALESCE(json_extract(t.source_edition,'$.acquisition'),'')<>'website-xml' LIMIT 1").get(id);
  if(apiText||corpus.db.prepare('SELECT 1 FROM speech_metadata WHERE source_id=?').get(id)&&!corpus.websiteSpeechHeld(id))return {id,outcome:'api-record-held',changes:[],gapChange:null};
  const beforeIndex=snapshot(store.db,INDEX_TABLES,id,targets),beforeCorpus=snapshot(corpus.db,CORPUS_TABLES,id);
  const {document,texts}=speechTexts(activity,url,retrievedAt);
  if(!texts.length)refuse(`${id} produced no corpus text.`);
  let gapChange=null;const started=performance.now();
  // Each store commits atomically. The index commits first inside the corpus
  // transaction, so a crash between them leaves a state this tool can finish.
  within(corpus,()=>{
    corpus.assertWriter();
    const held=corpus.db.prepare("SELECT t.source_edition FROM texts t JOIN documents d ON d.id=t.document_id WHERE d.source_id=? AND t.source_key=?").get(id,speech.language);
    if(JSON.parse(held?.source_edition||'{}').sha256!==sha256) {
      corpus.putDocument(document,texts.map(text=>({...text,sourceEdition:{acquisition:WEBSITE_ACQUISITION,sha256,fromApi:false}})),{acquisition:WEBSITE_ACQUISITION});
      corpus.putSpeechMetadata(activity,url,retrievedAt,{acquisition:WEBSITE_ACQUISITION});
    }
    clearCorpusOwners(corpus,id);
    within(store,()=>{
      store.assertWriter();
      for(const generation of targets) {
        if(heldIndex(generation)?.website?.sha256!==sha256)worker.saveSpeech(generation,activity,retrievedAt,false,url,false,{acquisition:WEBSITE_ACQUISITION});
        clearIndexOwners(store,generation,id);
      }
      const alreadyHeld=store.db.prepare("SELECT 1 FROM speech_source_gaps WHERE id=? AND state='held-website'").get(id);
      gapChange=alreadyHeld?null:observeSpeechGap(store,{id,state:'held-website',nextCheck:store.clock()+WEBSITE_RECHECK_MS},{log:false});
    });
  });
  const lockMs=Math.round(performance.now()-started);
  const changes=[...rowChanges(beforeIndex,snapshot(store.db,INDEX_TABLES,id,targets),'index'),...rowChanges(beforeCorpus,snapshot(corpus.db,CORPUS_TABLES,id),'corpus')];
  return {id,outcome:changes.length?'imported':'unchanged',gapChange,changes,lockMs};
}
// Removes only rows this tool wrote. The gap reappears through normal discovery.
export function rollbackRecord({store,corpus},id) {
  const targets=generations(store),beforeIndex=snapshot(store.db,INDEX_TABLES,id,targets),beforeCorpus=snapshot(corpus.db,CORPUS_TABLES,id);
  corpus.transaction(()=>{
    corpus.assertWriter();
    // Text and metadata refresh separately, so each row answers for itself.
    corpus.db.prepare("DELETE FROM texts WHERE document_id IN (SELECT id FROM documents WHERE source_id=?) AND json_extract(source_edition,'$.acquisition')='website-xml'").run(id);
    if(corpus.speechMetadata(id)?.activity.acquisition===WEBSITE_ACQUISITION) {
      corpus.db.prepare('DELETE FROM speech_metadata WHERE source_id=?').run(id);
      corpus.db.prepare('DELETE FROM speech_catalog WHERE source_id=?').run(id);
    }
    corpus.db.prepare('DELETE FROM documents WHERE source_id=? AND NOT EXISTS(SELECT 1 FROM texts WHERE document_id=documents.id) AND NOT EXISTS(SELECT 1 FROM speech_metadata WHERE source_id=documents.source_id)').run(id);
    store.transaction(()=>{
      store.assertWriter();
      for(const generation of targets) {
        if(store.source(generation,'/speeches/'+id)?.work.acquisition!==WEBSITE_ACQUISITION)continue;
        store.replaceRows(generation,'/speeches/'+id,[]);
        store.db.prepare('DELETE FROM sources WHERE generation=? AND key=?').run(generation,'/speeches/'+id);
        store.db.prepare('DELETE FROM outside_contributions WHERE generation=? AND speech=?').run(generation,id);
        store.db.prepare('DELETE FROM group_voice_designations WHERE generation=? AND speech=?').run(generation,id);
        store.db.prepare('DELETE FROM group_voice_observations WHERE generation=? AND speech=?').run(generation,id);
      }
      store.db.prepare("DELETE FROM speech_source_gaps WHERE id=? AND state='held-website'").run(id);
    });
  });
  return {id,outcome:'rolled-back',changes:[...rowChanges(beforeIndex,snapshot(store.db,INDEX_TABLES,id,targets),'index'),...rowChanges(beforeCorpus,snapshot(corpus.db,CORPUS_TABLES,id),'corpus')]};
}

export function loadRecords(manifestFile,evidence,{today}={}) {
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8')),directory=path.dirname(manifestFile),records=[];
  for(const entry of manifest.files.filter(file=>file.status===200)) {
    const bytes=readFileSync(path.resolve(directory,entry.file)),sha256=createHash('sha256').update(bytes).digest('hex');
    if(sha256!==entry.sha256)refuse(`${entry.file} does not match its manifest hash.`);
    if(!Number.isFinite(Date.parse(entry.retrievedAt)))refuse(`${entry.file} has no valid retrieval time.`);
    const retrievedAt=new Date(entry.retrievedAt).toISOString(),speech=parseSpeechXml(bytes,entry.url,{today}),placement=parentFromEvidence(speech,evidence);
    records.push({speech,placement,url:entry.url,retrievedAt,sha256,activity:speechActivity(speech,placement,{url:entry.url,retrievedAt,sha256})});
  }
  if(new Set(records.map(record=>record.speech.id)).size!==records.length)refuse('The manifest holds more than one file for a speech.');
  return records;
}
// Holding one lease while waiting for the other would starve that store's
// writer, so an attempt either gets both or leaves neither held.
export async function acquireBothLeases(store,corpus,seconds,{pauseMs=5000}={}) {
  const deadline=Date.now()+seconds*1000;
  for(;;) {
    if(store.acquire()) {
      if(corpus.acquire())return;
      store.release();
    }
    if(Date.now()>=deadline)refuse(`The writer leases were not both free within ${seconds} seconds; nothing was written.`);
    await sleep(pauseMs);
  }
}
// Rehearses on backup copies. A lease row copied from the live store means nothing
// here. The real writes run on the real tables, and everything is rolled back.
function holdForRehearsal(target,gates,label) {
  target.db.exec('BEGIN IMMEDIATE');
  try {
    if(gates.some(gate=>gate.writerGate!==false&&target.get(gate.key)!==gate.value))refuse(`The ${label} needs preparation; run node server/migrate-indexes.mjs.`);
    target.db.prepare('INSERT OR REPLACE INTO lease VALUES (1,?,?)').run(target.owner,target.clock()+90_000);
    initializeAvailabilityHistory(target);
  } catch(error) {target.db.exec('ROLLBACK');throw error;}
}
export function rehearseImport({store,corpus,worker},records) {
  holdForRehearsal(store,ACTIVITY_SCHEMA_GATES,'activity index');
  try {holdForRehearsal(corpus,CORPUS_SCHEMA_GATES,'corpus');}
  catch(error){store.db.exec('ROLLBACK');throw error;}
  try {
    speechSourceGapSchema(store.db);
    return records.map(record=>importRecord({store,corpus,worker},record));
  } finally {store.db.exec('ROLLBACK');corpus.db.exec('ROLLBACK');}
}
export function rollbackRecipe(records,{manifest,evidence,index,corpus}) {
  return ['Rollback (removes only website-xml rows; the recovery gaps then return through normal discovery):',
    `  node server/import-speech-record-xml.mjs --rollback --manifest ${manifest} --evidence ${evidence} --index ${index} --corpus ${corpus}`,
    'Whole-store rollback: stop the app and restore the pre-write backups of activities-v1.sqlite and corpus-v1.sqlite.',
    'Speeches: '+records.map(record=>record.speech.id).join(' ')].join('\n');
}
export async function runImport({manifest,evidence,index,corpus:corpusDirectory,dryRun=false,rollback=false,waitSeconds=600,log=console.log}) {
  const records=loadRecords(manifest,JSON.parse(readFileSync(evidence,'utf8')));
  // CorpusStore creates a missing database; a mistyped path must not do that.
  for(const file of [path.join(index,'activities-v1.sqlite'),path.join(corpusDirectory,'corpus-v1.sqlite')]) {
    if(!existsSync(file))refuse(`${file} does not exist.`);
    if(dryRun&&!existsSync(file+'.sha256'))refuse(`--dry-run reads backup copies only, and ${file} has no .sha256 beside it. Point --index and --corpus at the copies from ops.mjs backup.`);
  }
  const store=new ActivityStore(index,{preparedOnly:true}),corpus=new CorpusStore(corpusDirectory),worker=new ActivityWorker(store,{fetchRecord:()=>refuse('The import tool makes no upstream requests.')});
  const renew=dryRun?null:setInterval(()=>{store.renew();corpus.renew();},20_000);renew?.unref();
  const reports=[],describe=(record,report)=>({...report,parent:record.placement.parent,basis:record.placement.basis,kind:record.speech.kind,language:record.speech.language,mepId:record.speech.mepId,sourceUrl:record.url,retrievedAt:record.retrievedAt});
  try {
    if(dryRun) {
      const rehearsed=rehearseImport({store,corpus,worker},records);
      reports.push(...rehearsed.map((report,index)=>describe(records[index],report)));
    } else {
      await acquireBothLeases(store,corpus,waitSeconds);
      for(const record of records) {
        const report=rollback?rollbackRecord({store,corpus},record.speech.id):importRecord({store,corpus,worker},record);
        reports.push(describe(record,report));
        if(report.gapChange)logSpeechGapChange(report.gapChange);
      }
    }
  } finally {if(renew)clearInterval(renew);corpus.close();store.close();}
  log(JSON.stringify({mode:rollback?'rollback':dryRun?'dry-run':'write',records:reports},null,1));
  log(rollbackRecipe(records,{manifest,evidence,index,corpus:corpusDirectory}));
  return reports;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  const {values}=parseArgs({options:{manifest:{type:'string'},evidence:{type:'string'},index:{type:'string'},corpus:{type:'string'},'dry-run':{type:'boolean'},rollback:{type:'boolean'},'wait-seconds':{type:'string'}}});
  const index=values.index||process.env.ACTIVITY_INDEX_DIR,corpus=values.corpus||process.env.CORPUS_DIR;
  if(!values.manifest||!values.evidence||!index||!corpus||values['dry-run']&&values.rollback){console.error('Use --manifest FILE --evidence FILE --index DIR --corpus DIR [--dry-run | --rollback] [--wait-seconds N].');process.exitCode=2;}
  else runImport({manifest:values.manifest,evidence:values.evidence,index,corpus,dryRun:Boolean(values['dry-run']),rollback:Boolean(values.rollback),waitSeconds:Number(values['wait-seconds']||600)}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
