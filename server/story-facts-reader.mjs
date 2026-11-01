import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {languagePreference} from './language-order.mjs';
import {countryLabels} from './topic-roles.mjs';
import {countryIdentity} from './topic-country-identity.mjs';
import {validTopicKey,RECORD_TOPICS_VERSION} from './record-topics.mjs';
import {STORY_FACTS_VERSION} from './story-facts-model.mjs';
import europe from './story-europe-countries.json' with {type:'json'};
import {HttpError} from './http-utils.mjs';
import {topicPeriods,quarter} from './topics-store.mjs';
const allowed=['scope','key','period','mode','askers','zoom','lang'];
export function storyQuery(params){
 for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported story parameter.');
 const scope=params.get('scope')||'map',mode=params.get('mode')||'q',askers=params.get('askers')||'all',zoom=params.get('zoom')||'world',period=params.get('period')||null,language=params.get('lang')||'en';let key=params.get('key')||null;
 if(!['map','place','topic'].includes(scope)||!['q','d'].includes(mode)||!['all','elsewhere'].includes(askers)||!['world','eu'].includes(zoom)||period&&!topicPeriods().includes(period)||language.length>32)throw new HttpError(400,'invalid_query','Choose a story scope.');
 if(scope==='place'){const id=countryIdentity(key?.replace(/^place:/,''))?.id;if(!id||!countryLabels.has(id))throw new HttpError(400,'invalid_query','Choose a place.');key='place:'+id;}
 if(scope==='topic'&&(!validTopicKey(key)||!/^oeil:|^eurovoc:/.test(key)))throw new HttpError(400,'invalid_query','Choose a topic.');
 if(scope==='map'&&key)throw new HttpError(400,'invalid_query','Choose a story scope.');
 return {scope,mode,askers,zoom,period,language,key};
}
const cleanTitle=title=>String(title||'').replace(/^\d+(?:\.\d+)*\.\s*/,'').replace(/\s*\((?:debate|topical debate|joint debate|continuation of debate)\)\s*$/i,'');
export function storyFacts(store,params,{pressFilename}={}){
 const q=storyQuery(params),state=store.get('storyProjection'),base=store.get('recordTopicProjection'),generation=store.get('active');
 if(!state||state.version!==STORY_FACTS_VERSION||state.generation!==generation||base?.generation!==generation||base.version!==RECORD_TOPICS_VERSION)return {ready:false};
 const db=store.db,periods=topicPeriods(),selectedPeriods=q.period?[q.period]:periods,calendar=store.get('recordTopicCalendar')||{},coverage=store.get('storyCoverage')||{},geo=q.scope==='place'?[q.key.slice(6)]:q.zoom==='eu'?europe.ids:null;
 const choose=(values,fallback='')=>{const lang=languagePreference(Object.keys(values||{}),q.language)[0];return {value:values?.[lang]||fallback,language:lang||null};};
 const where=['f.generation=?',"(f.kind<>'debate' OR COALESCE(json_extract(f.body,'$.procedural'),0)=0)"],args=[generation];
 if(q.period){where.push("(substr(f.date,1,4)||'-Q'||CAST((CAST(substr(f.date,6,2) AS INTEGER)+2)/3 AS INTEGER)=? OR (f.kind='document' AND substr(json_extract(f.body,'$.outcome.date'),1,4)||'-Q'||CAST((CAST(substr(json_extract(f.body,'$.outcome.date'),6,2) AS INTEGER)+2)/3 AS INTEGER)=?))");args.push(q.period,q.period);}
 if(q.scope==='topic'){where.push('EXISTS (SELECT 1 FROM story_topics t WHERE t.generation=f.generation AND t.kind=f.kind AND t.id=f.id AND t.key=?)');args.push(q.key);}
 else if(geo){where.push('EXISTS (SELECT 1 FROM story_places p WHERE p.generation=f.generation AND p.kind=f.kind AND p.id=f.id AND p.place IN (SELECT value FROM json_each(?)))');args.push(JSON.stringify(geo));}
 else if(q.scope==='map')where.push('EXISTS (SELECT 1 FROM story_places p WHERE p.generation=f.generation AND p.kind=f.kind AND p.id=f.id)');
 if(q.scope==='map'&&q.mode==='q')where.push("f.kind='debate'");
 const allDebates=[],documents=new Map(),matchedDocs=new Set();let truncated=false;
 const getDoc=db.prepare("SELECT body FROM story_facts WHERE generation=? AND kind='document' AND id=?");
 const docOutput=d=>{
  const title=choose(d.titles,d.reference||d.id),o=d.outcome;
  return {id:d.id,reference:d.reference,ref:d.reference,type:d.type,date:d.date,q:quarter(d.date),title:title.value,titleLanguage:title.language,rule:d.rule,rules:d.rule.map(n=>'Rule '+n),groups:d.groups,groupsAvailable:d.groupsAvailable,places:d.places,keywords:d.keywords,keywordKeys:d.keywords.map(id=>'eurovoc:'+id),procedures:d.procedures,derivedFrom:d.derivedFrom,supersededBy:d.supersededBy||[],outcome:o?{decisionId:o.decisionId,id:o.decisionId,outcome:o.outcome,date:o.date,for:o.for,against:o.against,abstentions:o.abstentions,abst:o.abstentions,label:choose(o.labels).value,referenceText:choose(o.references).value,decisionMethod:o.decisionMethod,method:o.method,source:o.source}:null,outcomeStatus:d.outcomeStatus,source:d.source};
 };
 for(const row of db.prepare('SELECT kind,body FROM story_facts f WHERE '+where.join(' AND ')+' ORDER BY f.date DESC,f.kind,f.id LIMIT 10001').iterate(...args)){
  if(allDebates.length+documents.size>=10000){truncated=true;break;}const f=JSON.parse(row.body);
  if(row.kind==='document'){if(q.scope!=='map'||q.mode==='d'||q.scope==='place'){documents.set(f.id,docOutput(f));matchedDocs.add(f.id);}continue;}
  const title=choose(f.titles),raw=f.titles.en||title.value,placeBases=Object.fromEntries(f.places.map(p=>[p.id,p.bases]));
  allDebates.push({id:f.id,date:f.date,q:quarter(f.date),title:cleanTitle(title.value),rawTitle:raw,titleLanguage:title.language,creId:f.creId,cre:f.creId,meps:f.meps,speeches:f.speeches,format:f.format,joint:f.joint,jointHeading:choose(f.jointHeadings).value||null,agendaId:f.agendaId,agendaVia:f.agendaVia,procedures:f.procedures,primaryPlace:f.primaryPlace,places:f.places.map(p=>({id:p.id,basis:p.basis,bases:p.bases})),placeBases,docs:f.docs,source:f.source});
  for(const id of f.docs){const row=getDoc.get(generation,id);if(row){const d=JSON.parse(row.body);documents.set(d.id,docOutput(d));}}
 }
 const debatePeriods=new Map();for(const d of allDebates)(debatePeriods.get(d.q)||debatePeriods.set(d.q,[]).get(d.q)).push(d);
 const debatePeriodCounts={},debates=[];
 for(const [period,rows] of debatePeriods){rows.sort((a,b)=>b.meps-a.meps||b.date.localeCompare(a.date)||a.id.localeCompare(b.id));const selected=rows.filter((d,i)=>i<50||d.format==='urgency');debates.push(...selected);debatePeriodCounts[period]={total:rows.length,truncated:selected.length<rows.length};}
 debates.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 const debatesTotal=allDebates.length,debatesTruncated=debates.length<debatesTotal;
 const questions=new Map();if(q.scope!=='topic'&&(q.scope!=='map'||q.mode==='q')){
  const conditions=['p.generation=?',"p.date>='2024-07-16'",'p.date<=?'],bindings=[generation,new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(Date.now())];if(q.period){conditions.push("substr(p.date,1,4)||'-Q'||CAST((CAST(substr(p.date,6,2) AS INTEGER)+2)/3 AS INTEGER)=?");bindings.push(q.period);}if(q.askers==='elsewhere')conditions.push("p.askers='elsewhere'");if(geo){conditions.push("substr(p.key,7) IN (SELECT value FROM json_each(?))");bindings.push(JSON.stringify(geo));}
  for(const row of db.prepare("SELECT p.key,p.record_id,p.date,p.askers,json_extract(r.body,'$.titles') titles,json_extract(r.body,'$.members') members FROM record_topic_question_places p JOIN record_topic_records r ON r.generation=p.generation AND r.id=p.record_id WHERE "+conditions.join(' AND ')+' ORDER BY p.record_id,p.key LIMIT 20001').iterate(...bindings)){
   if(questions.size>=20000){truncated=true;break;}let item=questions.get(row.record_id);if(!item){const title=choose(JSON.parse(row.titles||'{}'),row.record_id);item={id:row.record_id,date:row.date,d:row.date,q:quarter(row.date),title:title.value,t:title.value,titleLanguage:title.language,oral:row.record_id.startsWith('O-'),authors:JSON.parse(row.members||'[]'),places:[],home:[],askers:{}};questions.set(item.id,item);}const id=row.key.slice(6);item.places.push(id);item.askers[id]=row.askers;if(row.askers==='home')item.home.push(id);
  }
 }
 const press={},procedureIds=new Set(debates.flatMap(d=>d.procedures));let pressReady=false;
 if(pressFilename&&existsSync(pressFilename)){const pdb=new DatabaseSync(pressFilename,{readOnly:true});try{pdb.exec('PRAGMA query_only=ON;PRAGMA cache_size=-1024;BEGIN');if(pdb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='links'").get()){
  pressReady=true;
  const read=pdb.prepare("SELECT l.value,r.id,r.url,json_extract(r.body,'$.title') title,COALESCE(json_extract(r.body,'$.publishedLocal'),json_extract(r.body,'$.publishedAt')) date FROM links l JOIN releases r ON r.id=l.release WHERE l.kind='procedure' AND l.value>=? AND l.value<? AND COALESCE(json_extract(r.body,'$.listed'),1)<>0 ORDER BY date DESC,r.id");
  for(const id of procedureIds){
   if(!/^\d{4}-\d{4}[A-Z]?$/.test(id))continue;const prefix=id.replace('-','/')+'(';
   for(const row of read.iterate(prefix,id.replace('-','/')+')')){
    const m=row.value.match(/^(\d{4})\/(\d{4}[A-Z]?)\([A-Z]+\)$/);if(!m||m[1]+'-'+m[2]!==id)continue;
    (press[id]??=[]).push({id:row.id,url:row.url,title:row.title,date:row.date?.slice(0,10)||null,reference:row.value,ref:row.value});
   }
  }
 }}catch{pressReady=false;}finally{pdb.close();}}
 const docs=[...documents.values()].map(d=>({...d,contextOnly:!matchedDocs.has(d.id)})),blocks=selectedPeriods.map(period=>({period,debatesTotal:debatePeriodCounts[period]?.total||0,debatesTruncated:debatePeriodCounts[period]?.truncated||false,debates:debates.filter(d=>d.q===period).map(d=>d.id),docs:docs.filter(d=>d.q===period||d.outcome?.date&&quarter(d.outcome.date)===period).map(d=>d.id),questions:[...questions.values()].filter(d=>d.q===period).map(d=>d.id)}));
 const byPlace={};for(const question of questions.values())for(const id of question.places)((byPlace[id]??={})[question.q]??=[]).push({id:question.id,home:question.askers[id]==='home',askers:question.askers[id]});
 const series={};const cell=(id,period)=>((series[id]??={})[period]??={questions:0,questionHome:0,questionElsewhere:0,questionUnknown:0,documents:0,debates:0,resolutions:0});
 for(const x of questions.values())for(const id of x.places){const c=cell(id,x.q);c.questions++;c['question'+x.askers[id][0].toUpperCase()+x.askers[id].slice(1)]++;}
 for(const d of allDebates)for(const id of new Set(d.places.map(p=>p.id)))if(!geo||geo.includes(id))cell(id,d.q).debates++;
 for(const d of docs)if(!d.supersededBy.some(id=>documents.has(id)))for(const id of d.places)if(!geo||geo.includes(id)){if(selectedPeriods.includes(d.q)&&(!d.contextOnly||q.scope==='map'&&q.mode==='q'))cell(id,d.q).documents++;if(d.outcome?.outcome==='ADOPTED'&&d.outcome.date&&selectedPeriods.includes(quarter(d.outcome.date))&&(!d.contextOnly||q.scope==='map'&&q.mode==='q'))cell(id,quarter(d.outcome.date)).resolutions++;}
 let topic=null;if(q.scope==='topic'){const c=db.prepare('SELECT body FROM record_topic_concepts WHERE generation=? AND key=?').get(generation,q.key);const concept=c?JSON.parse(c.body):null;topic={key:q.key,label:choose(concept?.labels,q.key).value,groups:Object.fromEntries(db.prepare("SELECT period,groups FROM record_topic_group_summary WHERE generation=? AND key=?").all(generation,q.key).map(r=>[r.period,r.groups])),members:db.prepare('SELECT record_id,kind,date,group_key FROM record_topic_memberships WHERE generation=? AND key=?').all(generation,q.key).map(r=>[r.record_id,r.kind,r.date,r.group_key])};}
 return {ready:true,scope:q.scope,key:q.key,period:q.period,mode:q.mode,askers:q.askers,zoom:q.zoom,periods,partial:calendar.partial,debates,debatesTotal,debatesTruncated,docs,questions:[...questions.values()],questionsByPlace:byPlace,press,topic,topics:topic?{[topic.key]:topic}:{},blocks,series,summary:{debates:debatesTotal,documents:docs.filter(d=>(!d.contextOnly||q.scope==='map'&&q.mode==='q')&&!d.supersededBy.some(id=>documents.has(id))).length,questions:questions.size},coverage:{...coverage,press:{ready:pressReady},truncated}};
}
