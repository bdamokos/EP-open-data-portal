import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {languagePreference} from './language-order.mjs';
import {countryLabels} from './topic-roles.mjs';
import {countryIdentity} from './topic-country-identity.mjs';
import {validTopicKey,RECORD_TOPICS_VERSION} from './record-topics.mjs';
import {STORY_FACTS_VERSION} from './story-facts-model.mjs';
import {emptyStoryCounts} from './story-facts-aggregate.mjs';
import europe from './story-europe-countries.json' with {type:'json'};
import {HttpError} from './http-utils.mjs';
import {topicPeriods,quarter} from './topics-store.mjs';

/* Frontend contract (all counts are exact over the generation's retained evidence):
 * mode=q/d is a presentation selector; counts retain every kind.
 * scope=map uses zoom world/eu; place uses one canonical authority ID; topic uses
 * an OEIL/EuroVoc key. askers=elsewhere filters only questions, per named place.
 * counts covers period, or the whole term when absent. periodCounts covers every
 * calendar quarter. series is the sparse complete place×selected-quarter counter
 * grid (map/place); omitted cells are zero among qualifying retained records.
 * questions counts distinct questions; questionMentions counts question×place;
 * questionHome/Elsewhere/Unknown split mentions (only place scope sums to questions).
 * documents counts canonical motions/reports by publication quarter: a qualifying
 * joint replaces its qualifying originals in the same scope.
 * documentsWithKnownOutcome/documentsWithUnknownOutcome partition documents.
 * adoptedTexts counts known ADOPTED whole-text decisions;
 * quarters require their decision date. Whole-term counts also include known
 * undated adoptions, tracked by adoptedTextsUndated. adoptedTextsWithTallies requires both
 * for/against. Unknown-date adoptions never enter a quarter.
 * debates counts resolved oral-MEP items with no observed procedural type;
 * debatesWithUnknownAgenda tracks those still lacking agenda classification;
 * debates3Plus is its >=3 distinct MEP subset. urgencyDebates counts urgency items;
 * urgencyDebates3Plus is the urgency subset with >=3 distinct MEP speakers.
 * debateSpeakerAppearances sums distinct debate×MEP pairs (not unique term MEPs);
 * debateSpeakerAppearances3Plus sums pairs only in >=3-MEP debates. groups uses exactly
 * the topic detail grouping over all indexed kinds, independently of this subset.
 * Map counts also report placesWithQuestions/Debates/AdoptedTexts, distinct places.
 * winners and periodWinners contain all ties on their primary+secondary scores:
 * busiestDebates => max MEPs; busiestNonUrgencyDebates excludes urgencies;
 * busiestPrimaryNonUrgencyDebates also requires this place to be primary.
 * closestAdoptedTexts
 * => minimum absolute for-against among adopted texts with tallies; headlineAdopted
 * => max linked debate MEPs, then votes for (headlineAdoptedTexts3Plus uses only
 * linked debates with >=3 MEPs). leadingPlaceDebates3Plus returns the best two
 * >=3-MEP debates, primary-place first then MEPs, including every boundary tie.
 * Map most*Places return every
 * place equal to the maximum; topAdoptedPlaces includes all ties at rank four.
 * rising*Places use full quarters from the third, excluding the first partial:
 * current/max(1,mean(previous full quarters)), >=1.5, questions>=8/documents>=3;
 * rank by ratio then current count, all ties. First/second, partial and whole-term
 * risers are absent; whole-term requests expose quarter risers in periodWinners.
 * sets.urgencyDebates is complete by quarter. Place sets.adoptedTexts is complete;
 * whole-term place sets also include adoptedUndated. Other scopes return
 * complete adopted sets only for quarters with <=2, under
 * adoptedTextsWhenAtMostTwo. An omitted larger adopted set uses its exact count,
 * winners and browse page. Counts/winners cover all records regardless of sets.
 * debates/docs/questions are hydrated EVIDENCE for winners, sets and the page,
 * never a source of totals. blocks contains the same evidence IDs per quarter.
 * Browse: list=debates|documents|adoptedTexts|adoptedUndated|questions, optional
 * cursor. page={list,pageSize:20,total,items:[{id,kind,date}],nextCursor}. It is a
 * complete date-desc/id-desc keyset traversal (adopted lists sort by outcome
 * date), pinned to generation, projection publication and qualification selectors; language/mode may change;
 * stale/cross-selection cursors return 409. Topic member groups use topics/detail.
 * No list is silently truncated; unknown outcomes remain null, never 'none'.
 */
const allowed=['scope','key','period','mode','askers','zoom','lang','list','cursor'];
const listKinds={debates:'debate',documents:'document',adoptedTexts:'adopted',adoptedUndated:'adopted',questions:'question'};
export function storyQuery(params){
 for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported story parameter.');
 const scope=params.get('scope')||'map',mode=params.get('mode')||'q',askers=params.get('askers')||'all',zoom=params.get('zoom')||'world',period=params.get('period')||null,language=params.get('lang')||'en',list=params.get('list')||null,cursor=params.get('cursor')||null;let key=params.get('key')||null;
 if(!['map','place','topic'].includes(scope)||!['q','d'].includes(mode)||!['all','elsewhere'].includes(askers)||!['world','eu'].includes(zoom)||period&&!topicPeriods().includes(period)||language.length>32||list&&!Object.hasOwn(listKinds,list)||cursor&&(!list||cursor.length>1000||!/^[A-Za-z0-9_-]+$/.test(cursor)))throw new HttpError(400,'invalid_query','Choose a story scope.');
 if(scope==='place'){const id=countryIdentity(key?.replace(/^place:/,''))?.id;if(!id||!countryLabels.has(id))throw new HttpError(400,'invalid_query','Choose a place.');key='place:'+id;}
 if(scope==='topic'&&(!validTopicKey(key)||!/^oeil:|^eurovoc:/.test(key)))throw new HttpError(400,'invalid_query','Choose a topic.');
 if(scope==='map'&&key)throw new HttpError(400,'invalid_query','Choose a story scope.');
 return {scope,mode,askers,zoom,period,language,key,list,cursor};
}
const cleanTitle=title=>String(title||'').replace(/^\d+(?:\.\d+)*\.\s*/,'').replace(/\s*\((?:debate|topical debate|joint debate|continuation of debate)\)\s*$/i,'');
export function storyFacts(store,params,{pressFilename}={}){
 const q=storyQuery(params),state=store.get('storyProjection'),base=store.get('recordTopicProjection'),generation=store.get('active');
 if(!state||state.version!==STORY_FACTS_VERSION||state.generation!==generation||base?.generation!==generation||base.version!==RECORD_TOPICS_VERSION)return {ready:false};
 const db=store.db,periods=topicPeriods(),selectedPeriods=q.period?[q.period]:periods,key=q.scope==='map'?q.zoom:q.scope==='place'?q.key.slice(6):q.key,dimension=[generation,q.scope,key,q.askers];
 const choose=(values,fallback='')=>{const lang=languagePreference(Object.keys(values||{}),q.language)[0];return {value:values?.[lang]||fallback,language:lang||null};};
 const zeroCounts=()=>({...emptyStoryCounts(),...(q.scope==='map'?{placesWithQuestions:0,placesWithDebates:0,placesWithAdoptedTexts:0}:{})});
 const rows=db.prepare('SELECT period,body FROM story_scope_counts INDEXED BY story_count_scope WHERE generation=? AND scope=? AND key=? AND askers=?').all(...dimension),cells=new Map(rows.map(r=>[r.period,{...zeroCounts(),...JSON.parse(r.body)}]));
 const counts=cells.get(q.period||'')||zeroCounts(),periodCounts=periods.map(period=>({period,...(cells.get(period)||zeroCounts())}));
 const top=db.prepare('SELECT score,secondary FROM story_rank WHERE generation=? AND scope=? AND key=? AND askers=? AND period=? AND metric=? ORDER BY score DESC,secondary DESC,date DESC,id LIMIT 1');
 const ties=db.prepare('SELECT id,score,secondary,body FROM story_rank WHERE generation=? AND scope=? AND key=? AND askers=? AND period=? AND metric=? AND score=? AND secondary=? ORDER BY date DESC,id');
 const placeTop=db.prepare('SELECT score,secondary FROM story_place_rank WHERE generation=? AND zoom=? AND askers=? AND period=? AND metric=? ORDER BY score DESC,secondary DESC,id LIMIT 1');
 const placeTies=db.prepare('SELECT id,score,secondary,body FROM story_place_rank WHERE generation=? AND zoom=? AND askers=? AND period=? AND metric=? AND score=? AND secondary=? ORDER BY id');
 const debateIds=new Set(),docIds=new Set();
 const winnerFor=period=>{
  const out={};for(const metric of ['busiestDebates','busiestNonUrgencyDebates','busiestPrimaryNonUrgencyDebates','closestAdoptedTexts','headlineAdoptedTexts','headlineAdoptedTexts3Plus']){
   const args=[...dimension,period,metric],best=top.get(...args);out[metric]=best?ties.all(...args,best.score,best.secondary).map(r=>{(metric.includes('Debates')?debateIds:docIds).add(r.id);return {id:r.id,...(metric.includes('Debates')?{meps:r.score}:metric==='closestAdoptedTexts'?{margin:-r.score}:{debateMeps:r.score,votesFor:r.secondary<0?null:r.secondary})};}):[];
  }
  if(q.scope==='place'){
   const args=[...dimension,period,'leadingPlaceDebates3Plus'],boundary=db.prepare('SELECT score,secondary FROM story_rank WHERE generation=? AND scope=? AND key=? AND askers=? AND period=? AND metric=? ORDER BY score DESC,secondary DESC,date DESC,id LIMIT 1 OFFSET 1').get(...args);
   const leaders=db.prepare('SELECT id,score,secondary FROM story_rank WHERE generation=? AND scope=? AND key=? AND askers=? AND period=? AND metric=?'+(boundary?' AND (score,secondary)>=(?,?)':'')+' ORDER BY score DESC,secondary DESC,date DESC,id').all(...args,...(boundary?[boundary.score,boundary.secondary]:[]));out.leadingPlaceDebates3Plus=leaders.map(r=>{debateIds.add(r.id);return {id:r.id,meps:r.secondary,primaryPlace:Boolean(r.score)};});
  }
  if(q.scope==='map'){
   for(const metric of ['mostQuestionedPlaces','mostDebatedPlaces','mostDebatedPlaces3Plus','mostAdoptedPlaces','risingQuestionPlaces','risingDocumentPlaces']){
    const args=[generation,q.zoom,q.askers,period,metric],best=placeTop.get(...args);out[metric]=best?placeTies.all(...args,best.score,best.secondary).map(r=>({id:r.id,...JSON.parse(r.body)})):[];
   }
   const args=[generation,q.zoom,q.askers,period,'mostAdoptedPlaces'],fourth=db.prepare('SELECT score FROM story_place_rank WHERE generation=? AND zoom=? AND askers=? AND period=? AND metric=? ORDER BY score DESC,id LIMIT 1 OFFSET 3').get(...args);
   out.topAdoptedPlaces=db.prepare('SELECT id,body FROM story_place_rank WHERE generation=? AND zoom=? AND askers=? AND period=? AND metric=?'+(fourth?' AND score>=?':'')+' ORDER BY score DESC,id').all(...args,...(fourth?[fourth.score]:[])).map(r=>({id:r.id,...JSON.parse(r.body)}));
  }
  return out;
 };
 const winners=winnerFor(q.period||''),periodWinners=Object.fromEntries(selectedPeriods.map(p=>[p,winnerFor(p)]));
 const sets={urgencyDebates:{},...(q.scope==='place'?{adoptedTexts:{}}:{adoptedTextsWhenAtMostTwo:{}})};
 const urgency=db.prepare("SELECT id FROM story_scope_records WHERE generation=? AND scope=? AND key=? AND askers=? AND kind='debate' AND urgency=1 AND period=? ORDER BY date DESC,id DESC"),adopted=db.prepare("SELECT id FROM story_scope_records WHERE generation=? AND scope=? AND key=? AND askers=? AND kind='adopted' AND canonical=1 AND period=? ORDER BY date DESC,id DESC");
 for(const period of selectedPeriods){sets.urgencyDebates[period]=urgency.all(...dimension,period).map(r=>r.id);for(const id of sets.urgencyDebates[period])debateIds.add(id);
  if(q.scope==='place'||(cells.get(period)?.adoptedTexts||0)<=2){const ids=adopted.all(...dimension,period).map(r=>r.id);(sets.adoptedTexts||sets.adoptedTextsWhenAtMostTwo)[period]=ids;for(const id of ids)docIds.add(id);}
 }
 if(q.scope==='place'&&!q.period){sets.adoptedUndated=db.prepare("SELECT id FROM story_scope_records WHERE generation=? AND scope=? AND key=? AND askers=? AND kind='adopted' AND canonical=1 AND date='' ORDER BY id DESC").all(...dimension).map(r=>r.id);for(const id of sets.adoptedUndated)docIds.add(id);}
 const signature=[generation,state.builtAt||null,q.scope,key,q.askers,q.period,q.list];let after=null;
 if(q.cursor){try{after=JSON.parse(Buffer.from(q.cursor,'base64url').toString('utf8'));if(JSON.stringify(after.slice(0,7))!==JSON.stringify(signature)||after.length!==9||typeof after[7]!=='string'||typeof after[8]!=='string'||!/^[-A-Za-z0-9_]{1,150}$/.test(after[8])||!(['adoptedTexts','adoptedUndated'].includes(q.list)&&after[7]===''||/^\d{4}-\d{2}-\d{2}$/.test(after[7])))throw Error();}catch{throw new HttpError(409,'story_cursor','Reload this list.');}}
 let page=null;const questionIds=[];
 if(q.list){
  const kind=listKinds[q.list],conditions=['generation=?','scope=?','key=?','askers=?','kind=?','canonical=1'],args=[...dimension,kind];
  if(q.period){conditions.push('period=?');args.push(q.period);}if(q.list==='adoptedUndated')conditions.push("date=''");if(after){conditions.push('(date,id)<(?,?)');args.push(after[7],after[8]);}
  const found=db.prepare('SELECT id,kind,date FROM story_scope_records WHERE '+conditions.join(' AND ')+' ORDER BY date DESC,id DESC LIMIT 21').all(...args),more=found.length>20,items=found.slice(0,20),last=items.at(-1);
  for(const r of items)if(r.kind==='debate')debateIds.add(r.id);else if(r.kind==='question')questionIds.push(r.id);else docIds.add(r.id);
  const totalField={adoptedUndated:'adoptedTextsUndated'}[q.list]||q.list;
  page={list:q.list,pageSize:20,total:counts[totalField],items:items.map(r=>({...r,date:r.date||null,kind:r.kind==='debate'?'debate':r.kind==='question'?'question':'document'})),nextCursor:more?Buffer.from(JSON.stringify([...signature,last.date||'',last.id])).toString('base64url'):null};
 }
 const fact=db.prepare('SELECT body FROM story_facts WHERE generation=? AND kind=? AND id=?'),debates=[],documents=new Map();
 const docOutput=d=>{const title=choose(d.titles,d.reference||d.id),o=d.outcome;return {id:d.id,reference:d.reference,ref:d.reference,type:d.type,date:d.date,q:quarter(d.date),title:title.value,titleLanguage:title.language,rule:d.rule,rules:d.rule.map(n=>'Rule '+n),groups:d.groups,groupsAvailable:d.groupsAvailable,places:d.places,keywords:d.keywords,keywordKeys:d.keywords.map(id=>'eurovoc:'+id),procedures:d.procedures,derivedFrom:d.derivedFrom,supersededBy:d.supersededBy||[],outcome:o?{decisionId:o.decisionId,id:o.decisionId,outcome:o.outcome,date:o.date,for:o.for,against:o.against,abstentions:o.abstentions,abst:o.abstentions,label:choose(o.labels).value,referenceText:choose(o.references).value,decisionMethod:o.decisionMethod,method:o.method,source:o.source}:null,outcomeStatus:d.outcomeStatus,source:d.source};};
 for(const id of debateIds){const raw=fact.get(generation,'debate',id);if(!raw)continue;const f=JSON.parse(raw.body),title=choose(f.titles);debates.push({id:f.id,date:f.date,q:quarter(f.date),title:cleanTitle(title.value),rawTitle:f.titles.en||title.value,titleLanguage:title.language,creId:f.creId,cre:f.creId,meps:f.meps,speeches:f.speeches,format:f.format,joint:f.joint,jointHeading:choose(f.jointHeadings).value||null,agendaId:f.agendaId,agendaVia:f.agendaVia,procedures:f.procedures,primaryPlace:f.primaryPlace,places:f.places.map(p=>({id:p.id,basis:p.basis,bases:p.bases})),placeBases:Object.fromEntries(f.places.map(p=>[p.id,p.bases])),docs:f.docs,source:f.source});for(const doc of f.docs)docIds.add(doc);}
 for(const id of docIds){const raw=fact.get(generation,'document',id);if(raw)documents.set(id,docOutput(JSON.parse(raw.body)));}
 const questions=[],getQuestion=db.prepare("SELECT date,json_extract(body,'$.titles') titles,json_extract(body,'$.members') members FROM record_topic_records WHERE generation=? AND id=?"),getPlaces=db.prepare('SELECT substr(key,7) id,askers FROM record_topic_question_places WHERE generation=? AND record_id=?');
 for(const id of questionIds){const r=getQuestion.get(generation,id);if(!r)continue;const title=choose(JSON.parse(r.titles||'{}'),id),places=getPlaces.all(generation,id).filter(p=>(q.askers==='all'||p.askers==='elsewhere')&&(q.scope!=='place'||p.id===key)&&(q.scope!=='map'||q.zoom==='world'||europe.ids.includes(p.id)));questions.push({id,date:r.date,d:r.date,q:quarter(r.date),title:title.value,t:title.value,titleLanguage:title.language,oral:id.startsWith('O-'),authors:JSON.parse(r.members||'[]'),places:places.map(p=>p.id),home:places.filter(p=>p.askers==='home').map(p=>p.id),askers:Object.fromEntries(places.map(p=>[p.id,p.askers]))});}
 const series={};if(q.scope!=='topic')for(const r of db.prepare("SELECT key,period,body FROM story_scope_counts INDEXED BY "+(q.scope==='place'?'story_count_scope':'story_count_grid')+" WHERE generation=? AND scope='place' AND askers=? AND period<>''"+(q.period?' AND period=?':'')+(q.scope==='place'?' AND key=?':q.zoom==='eu'?' AND key IN (SELECT value FROM json_each(?))':'')+' ORDER BY key,period').iterate(generation,q.askers,...(q.period?[q.period]:[]),...(q.scope==='place'?[key]:q.zoom==='eu'?[JSON.stringify(europe.ids)]:[])))(series[r.key]??={})[r.period]=JSON.parse(r.body);
 const press={},procedureIds=new Set(debates.flatMap(d=>d.procedures));let pressReady=false;
 if(pressFilename&&existsSync(pressFilename)){const pdb=new DatabaseSync(pressFilename,{readOnly:true});try{pdb.exec('PRAGMA query_only=ON;PRAGMA cache_size=-1024;BEGIN');if(pdb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='links'").get()){
  pressReady=true;const read=pdb.prepare("SELECT l.value,r.id,r.url,json_extract(r.body,'$.title') title,COALESCE(json_extract(r.body,'$.publishedLocal'),json_extract(r.body,'$.publishedAt')) date FROM links l JOIN releases r ON r.id=l.release WHERE l.kind='procedure' AND l.value>=? AND l.value<? AND COALESCE(json_extract(r.body,'$.listed'),1)<>0 ORDER BY date DESC,r.id");
  for(const id of procedureIds)if(/^\d{4}-\d{4}[A-Z]?$/.test(id))for(const row of read.iterate(id.replace('-','/')+'(',id.replace('-','/')+')')){const m=row.value.match(/^(\d{4})\/(\d{4}[A-Z]?)\([A-Z]+\)$/);if(m&&m[1]+'-'+m[2]===id)(press[id]??=[]).push({id:row.id,url:row.url,title:row.title,date:row.date?.slice(0,10)||null,reference:row.value,ref:row.value});}
 }}catch{pressReady=false;}finally{pdb.close();}}
 let topic=null;if(q.scope==='topic'){const c=db.prepare('SELECT body FROM record_topic_concepts WHERE generation=? AND key=?').get(generation,q.key);topic={key:q.key,label:choose(c?JSON.parse(c.body).labels:{},q.key).value,groups:Object.fromEntries(periodCounts.map(p=>[p.period,p.groups]))};}
 const docs=[...documents.values()],blocks=selectedPeriods.map(period=>({period,counts:cells.get(period)||zeroCounts(),debates:debates.filter(d=>d.q===period).map(d=>d.id),docs:docs.filter(d=>d.q===period||d.outcome?.date&&quarter(d.outcome.date)===period).map(d=>d.id),questions:questions.filter(d=>d.q===period).map(d=>d.id)}));
 return {ready:true,scope:q.scope,key:q.key,period:q.period,mode:q.mode,askers:q.askers,zoom:q.zoom,periods,partial:store.get('recordTopicCalendar')?.partial,counts,periodCounts,winners,periodWinners,sets,page,debatesTotal:counts.debates,debates,docs,questions,press,topic,topics:topic?{[topic.key]:topic}:{},blocks,series,summary:{debates:counts.debates,documents:counts.documents,questions:counts.questions},coverage:{...store.get('storyCoverage'),press:{ready:pressReady}}};
}
