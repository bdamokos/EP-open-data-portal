import {rootSourceValues,sourceByteChunks} from './topic-source-stream.mjs';
import {TopicDiskMap,topicBatches} from './topic-disk-map.mjs';
import {storyTables,stageStoryInput,storyInput,queueStoryRead} from './story-facts-storage.mjs';
import {array,tail,unique,titles,storyReference,wholeTextOutcome,debateAgenda,debateFormat,debatePlaces,speakerEligible,proceduralAgenda} from './story-facts-model.mjs';
import {speechParentDocumentId} from './speech-agenda.mjs';
import {countryLabels} from './topic-roles.mjs';
import {quarter} from './topics-store.mjs';

const tables=['story_facts','story_links','story_places','story_topics','story_parents'];
export async function buildStoryFacts(store,generation,options={}){
 const previous=store.db.prepare('PRAGMA cache_size').get().cache_size;
 store.db.exec('PRAGMA cache_size=-1024;PRAGMA temp_store=FILE;PRAGMA temp.cache_size=-1024');
 try{return await projectStoryFacts(store,generation,options);}finally{store.db.exec('PRAGMA cache_size='+Number(previous));}
}
async function projectStoryFacts(store,generation,{concepts,onProgress=()=>{}}={}){
 storyTables(store.db);store.assertWriter();store.set('storyProjection',null);
 // Existing whole-motion projections and the full sitting fallback share exact
 // result/decision identities. Stream each row, never the complete vote graph.
 for(const source of store.db.prepare("SELECT rowid,key,fetched_at FROM sources WHERE generation=? AND kind='motion-outcomes'").iterate(generation)){
  const metadata=Object.fromEntries([...rootSourceValues(sourceByteChunks(store.db,source.rowid),{scalars:['resultsUrl','decisionsUrl','resultsFetchedAt','decisionsFetchedAt']})].map(x=>[x.field,x.value]));
  let n=0;
  for(const {field,value} of rootSourceValues(sourceByteChunks(store.db,source.rowid),{arrays:['results','decisions']})){
   stageStoryInput(store,value,{url:metadata[field+'Url']||'https://data.europarl.europa.eu/api/v2'+source.key,fetchedAt:metadata[field+'FetchedAt']||source.fetched_at},{rank:2});
   if(++n%50===0){store.renew();await new Promise(setImmediate);}
  }
 }
 onProgress('story-inputs');
 for(const table of tables){let changes;do{store.transaction(()=>{store.assertWriter();changes=store.db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE generation=? LIMIT 500)`).run(generation).changes;});store.renew();await new Promise(setImmediate);}while(changes);}
 const put=store.db.prepare('INSERT INTO story_facts VALUES (?,?,?,?,?) ON CONFLICT(generation,kind,id) DO UPDATE SET date=excluded.date,body=excluded.body'),link=store.db.prepare('INSERT OR IGNORE INTO story_links VALUES (?,?,?,?)'),place=store.db.prepare('INSERT OR IGNORE INTO story_places VALUES (?,?,?,?,?,?)'),topic=store.db.prepare('INSERT OR IGNORE INTO story_topics VALUES (?,?,?,?,?)');
 const factGet=store.db.prepare('SELECT body FROM story_facts WHERE generation=? AND kind=? AND id=?');
 const fact=(kind,id)=>{const r=factGet.get(generation,kind,id);return r?JSON.parse(r.body):null;};
 const inputs=kind=>store.db.prepare('SELECT id,body,source FROM story_inputs WHERE kind=? ORDER BY id').iterate(kind);
 const addLinks=(rel,from,ids)=>{for(const to of ids)link.run(generation,rel,from,to);};
 const toGet=store.db.prepare('SELECT to_id FROM story_links WHERE generation=? AND relation=? AND from_id=?'),fromGet=store.db.prepare('SELECT from_id FROM story_links WHERE generation=? AND relation=? AND to_id=?');
 const toIds=(rel,from)=>toGet.all(generation,rel,from).map(r=>r.to_id);
 const fromIds=(rel,to)=>fromGet.all(generation,rel,to).map(r=>r.from_id);
 const end=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(store.clock?.()??Date.now());
 const inTerm=date=>date>='2024-07-16'&&date<=end;
 await topicBatches(store,(function*(){
  for(const row of inputs('document')){yield;const d={...JSON.parse(row.body),source:JSON.parse(row.source)};if(!inTerm(d.date))continue;
   if(d.conflicted){d.events=[];d.groups=[];d.groupsAvailable=false;d.places=[];d.keywords=[];}
   put.run(generation,'document',d.id,d.date,JSON.stringify(d));addLinks('document-event',d.id,d.events);addLinks('document-original',d.id,d.derivedFrom);
  }
  for(const row of inputs('result')){yield;const r=JSON.parse(row.body);if(r.conflicted)continue;addLinks('result-decision',r.id,r.decisions);addLinks('result-executed',r.id,r.executed);for(const doc of r.basedOn)addLinks('document-event',doc,[r.id]);}
  for(const row of inputs('decision')){yield;const d=JSON.parse(row.body);if(!d.conflicted)for(const result of d.results)addLinks('result-decision',result,[d.id]);}
 })());
 const docsFor=event=>fromIds('document-event',event).map(id=>fact('document',id)).filter(Boolean);
 // Match outcomes only inside explicitly linked vote results, including a joint
 // motion's originals. Originals never donate their tabling groups.
 await topicBatches(store,(function*(){for(const row of store.db.prepare("SELECT id,body FROM story_facts WHERE generation=? AND kind='document' ORDER BY id").iterate(generation)){
  yield;const d=JSON.parse(row.body),events=unique([...d.events,...d.derivedFrom.flatMap(id=>fact('document',id)?.events||[])]),votes=new Set(events.filter(id=>id.includes('VOT-ITM-')));
  for(const oj of events.filter(id=>id.includes('OJ-ITM-V-')))for(const vote of fromIds('result-executed',oj))votes.add(vote);
  const candidates=unique([...votes].flatMap(id=>toIds('result-decision',id))).map(id=>storyInput(store,'decision',id)).filter(Boolean);
  Object.assign(d,wholeTextOutcome(d,candidates));d.supersededBy=fromIds('document-original',d.id);
  if(d.outcomeStatus==='unknown')for(const event of events.filter(id=>id.includes('VOT-ITM-')||id.includes('OJ-ITM-V-')))queueStoryRead(store,'decisions','MTG-PL-'+event.slice(7,17));
  put.run(generation,'document',d.id,d.date,JSON.stringify(d));for(const id of d.places)place.run(generation,id,'document',d.id,d.date,'official');
 }} )());
 onProgress('story-documents');
 const seeds=new TopicDiskMap(store.db,'story_debate_seeds');
 store.db.exec('DROP TABLE IF EXISTS temp.story_speakers;CREATE TEMP TABLE story_speakers(debate TEXT,person TEXT,speech TEXT,capacity TEXT,eligible INTEGER,PRIMARY KEY(debate,person,speech));CREATE INDEX temp.story_speaker_debate ON story_speakers(debate,eligible,person,speech)');
 const speaker=store.db.prepare('INSERT OR REPLACE INTO story_speakers VALUES (?,?,?,?,?)'),parent=store.db.prepare('INSERT OR REPLACE INTO story_parents VALUES (?,?,?)'),items=store.db.prepare("SELECT mep,body FROM items WHERE generation=? AND source_id=? AND category='plenary-contributions'");
 const speakerCounts=store.db.prepare('SELECT COUNT(DISTINCT person) meps,COUNT(DISTINCT speech) speeches FROM story_speakers WHERE debate=? AND eligible=1');
 const speakerRoles=store.db.prepare('SELECT SUM(eligible=1 AND capacity IS NULL) unknownCapacity,SUM(eligible=0 AND capacity IS NOT NULL) institutionalExcluded,SUM(eligible=0 AND capacity IS NULL) chairExcluded FROM story_speakers WHERE debate=?');
 const roleCoverage={unknownCapacity:0,institutionalExcluded:0,chairExcluded:0,unresolvedParents:0};
 await topicBatches(store,(function*(){
  for(const row of store.db.prepare("SELECT id,json_object('parentIds',json_extract(body,'$.parentIds'),'status',json_extract(body,'$.status'),'date',date) body FROM record_topic_records WHERE generation=? AND kind='speech' ORDER BY id").iterate(generation)){
   yield;const p=JSON.parse(row.body);if(p.status==='ambiguous'||p.parentIds?.length!==1){roleCoverage.unresolvedParents++;continue;}const id=p.parentIds[0];if(!/PVCRE-ITM-/.test(id)||!inTerm(p.date))continue;
   parent.run(generation,id,row.id);const o=storyInput(store,'speech',row.id);if(!o)continue;
   let seed=seeds.get(id);if(!seed)seed={id,date:p.date,titles:o.titles||{},creIds:[],source:o.source};seed.creIds=unique([...seed.creIds,...(o.creIds||[]),...(o.creId?[o.creId]:[])]);seeds.set(id,seed);
   for(const member of items.iterate(generation,row.id)){
    const item=JSON.parse(member.body);if(item.speechKind!=='PLENARY_DEBATE_SPEECH')continue;
    const header=o.headers.find(h=>String(h.personId)===String(member.mep)),eligible=speakerEligible(item,header);
    if(header?.capacity&&header.capacity!=='member')roleCoverage.institutionalExcluded++;else if(!eligible)roleCoverage.chairExcluded++;else if(!header?.capacity)roleCoverage.unknownCapacity++;
    speaker.run(id,String(member.mep),row.id,header?.capacity||null,eligible?1:0);
   }
  }
 })());
 onProgress('story-speakers');
 await topicBatches(store,(function*(){for(const d of seeds.values()){
  yield;const counts=speakerCounts.get(d.id);if(!counts.speeches)continue;
  const event=storyInput(store,'event',d.id);let documents=docsFor(d.id);const agendaLink=debateAgenda(event,documents),agenda=agendaLink.agendaId?storyInput(store,'agenda',agendaLink.agendaId):null;
  if(agendaLink.agendaId)documents=[...new Map([...documents,...docsFor(agendaLink.agendaId)].map(x=>[x.id,x])).values()];
  const title=d.titles.en||Object.values(d.titles)[0]||'',format=debateFormat(agenda?.conflicted?null:agenda,documents),geography=debatePlaces(title,documents.flatMap(doc=>doc.places),format);
  const joint=/^Joint debate [–—-] /.test(agenda?.headings?.en||'');
  const roleCounts=speakerRoles.get(d.id);
  const procedural=proceduralAgenda(agenda),body={...d,...counts,procedural,agendaClassified:Boolean(agenda&&!agenda.conflicted&&(agenda.type||Object.keys(agenda.formats||{}).length)),speakerRoles:roleCounts,...agendaLink,format,joint:joint?agenda.headings.en.replace(/^Joint debate [–—-] /,''):null,jointHeadings:joint?agenda.headings:{},procedures:agenda?.conflicted?[]:agenda?.procedures||[],docs:documents.map(doc=>doc.id),creId:d.creIds.every(id=>id.startsWith('CRE-10-'+d.date+'-ITM-'))?speechParentDocumentId(d.creIds):null,...geography};
  put.run(generation,'debate',d.id,d.date,JSON.stringify(body));addLinks('debate-document',d.id,body.docs);addLinks('debate-procedure',d.id,body.procedures);
  for(const p of procedural?[]:body.places)place.run(generation,p.id,'debate',d.id,d.date,p.basis);
  if(!event||!event.executedKnown)queueStoryRead(store,'event',d.id);
  if(!agenda||!Object.keys(agenda.formats||{}).length)queueStoryRead(store,'agenda','MTG-PL-'+d.date,{unavailable:d.date<'2024-12-16'});
 }} )());
 const topicKeys=store.db.prepare("SELECT DISTINCT m.key FROM json_each(?) j CROSS JOIN record_topic_memberships m INDEXED BY record_topic_record CROSS JOIN record_topic_concepts c WHERE m.generation=? AND m.record_id=j.value AND c.generation=m.generation AND c.key=m.key AND c.role IN ('topic','keyword')");
 // Policy/keyword selections reuse the serving projection's exact memberships.
 await topicBatches(store,(function*(){for(const row of store.db.prepare('SELECT kind,id,date,body FROM story_facts WHERE generation=? ORDER BY kind,id').iterate(generation)){
  yield;const body=JSON.parse(row.body),ids=row.kind==='document'?[row.id]:unique([row.id,body.agendaId,...body.docs].filter(Boolean));
  for(const key of topicKeys.all(JSON.stringify(ids),generation))topic.run(generation,key.key,row.kind,row.id,row.date);
 }} )());
 onProgress('story-facts');
 await applyStrongPlaces(store,generation,{concepts,fact,docsFor});onProgress('story-places');
 const jobs={};for(const row of store.db.prepare('SELECT kind,state,COUNT(*) n FROM story_jobs GROUP BY kind,state').iterate())(jobs[row.kind]??={})[row.state]=row.n;
 store.set('storyCoverage',{generation,jobs,speakers:{...roleCoverage,nullCapacityChairLimit:true}});

}

async function applyStrongPlaces(store,generation,{concepts,fact,docsFor}){
 const remove=store.db.prepare('DELETE FROM record_topic_memberships WHERE generation=? AND record_id=? AND key LIKE \'place:%\''),member=store.db.prepare('INSERT OR IGNORE INTO record_topic_memberships VALUES (?,?,?,?,?,?)'),update=store.db.prepare('UPDATE record_topic_records SET body=? WHERE generation=? AND id=?'),parentGet=store.db.prepare('SELECT parent FROM story_parents WHERE generation=? AND speech=?');
 const conceptHas=store.db.prepare('SELECT 1 FROM record_topic_concepts WHERE generation=? AND key=?');
 const conceptPut=store.db.prepare('INSERT OR REPLACE INTO record_topic_concepts VALUES (?,?,?,?)');
 const save=(row,r,geography,edge)=>{
  const old=r.assignments.filter(a=>a.role==='place'),next=r.assignments.filter(a=>a.role!=='place');
  for(const p of geography.places){let a=old.find(a=>a.key==='place:'+p.id);if(!a||p.basis==='title')a={key:'place:'+p.id,role:'place',paths:[{basis:p.basis==='title'?'title':edge?'debate':p.basis,steps:edge?[{from:r.id,field:'inverse_consists_of',to:edge}]:[],sources:r.source?[r.source]:[]}]};next.push(a);
   const c={key:a.key,role:'place',uri:'http://publications.europa.eu/resource/authority/country/'+p.id,labels:{en:countryLabels.get(p.id)||p.id}};if(concepts&&!concepts.has(c.key))concepts.set(c.key,c);if(!conceptHas.get(generation,c.key))conceptPut.run(generation,c.key,'place',JSON.stringify(c));
  }
  if(JSON.stringify(r.assignments)===JSON.stringify(next))return;r.placeKeywords=unique(old.map(a=>a.key));r.assignments=next;remove.run(generation,r.id);for(const a of next.filter(a=>a.role==='place'))member.run(generation,a.key,r.id,row.kind,row.date,row.group_key);update.run(JSON.stringify(r),generation,r.id);
 };
 await topicBatches(store,(function*(){for(const row of store.db.prepare("SELECT id,kind,date,group_key,body FROM record_topic_records WHERE generation=? AND kind='debate' ORDER BY id").iterate(generation)){
  yield;const r=JSON.parse(row.body),known=fact('debate',row.id);if(known){save(row,r,known.procedural?{places:[]}:known);continue;}
  const agenda=storyInput(store,'agenda',row.id),docs=docsFor(row.id),title=r.titles?.en||Object.values(r.titles||{})[0]||'';save(row,r,proceduralAgenda(agenda)?{places:[]}:debatePlaces(title,docs.flatMap(d=>d.places),debateFormat(agenda,docs)));
 }} )());
 await topicBatches(store,(function*(){for(const row of store.db.prepare("SELECT id,kind,date,group_key,body FROM record_topic_records WHERE generation=? AND kind='speech' ORDER BY id").iterate(generation)){
  yield;const r=JSON.parse(row.body),parent=parentGet.get(generation,row.id)?.parent,known=parent?fact('debate',parent):null;if(known)save(row,r,known.procedural?{places:[]}:known,parent);
 }} )());
}
