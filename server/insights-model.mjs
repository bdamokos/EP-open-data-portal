import {sourceTitles} from './source-titles.mjs';
import { array, tail } from './activity-index-model.mjs';
import {titlePlaces,countryLabelSource} from './insights-places.mjs';
import {phraseModelSteps} from './insights-phrases.mjs';
import {finishWork,cooperativeWork} from './cooperative-work.mjs';
import {questionAddressees} from './question-addressees.mjs';

export const INSIGHTS_VERSION = 'titles-phrases-facets-v12-dated-affiliation';
export const officialApi = path => 'https://data.europarl.europa.eu/api/v2' + path;
export function personId(value) {
  let reference=typeof value==='string' ? value : value?.id;
  if(typeof reference!=='string')return null;
  if(reference.includes('://')) {
    try {
      const url=new URL(reference);
      if(!['http:','https:'].includes(url.protocol)||url.hostname!=='data.europarl.europa.eu'||url.port||url.username||url.password||url.search||url.hash)return null;
      reference=url.pathname.slice(1);
    }catch{return null;}
  }
  const match=reference.match(/^person\/([1-9]\d*)$/);
  return match&&Number.isSafeInteger(Number(match[1])) ? match[1] : null;
}
export const canonical = value => String(value?.id || value || '').replace(/^https?:\/\/data\.europarl\.europa\.eu\//, '');
export function suppliedTitles(work) {
  return sourceTitles(Object.assign({}, ...array(work.is_realized_by).map(e => e.title || {}), work.title_dcterms || {}));
}
export function authorEvidence(work, endpoint, fetchedAt) {
  const evidence = new Map();
  function add(value, role, relationship, participation = null) {
    const id = personId(value); if (!id) return;
    const old = evidence.get(id) || { id, personUri: 'https://data.europarl.europa.eu/person/' + id, role, sourceId: work.identifier || tail(work.id), date: work.document_date || null, apiUrl: officialApi(endpoint), fetchedAt, relationships: [], participationIds: [] };
    if (!old.relationships.includes(relationship)) old.relationships.push(relationship);
    if (participation?.id && !old.participationIds.includes(participation.id)) old.participationIds.push(participation.id);
    evidence.set(id, old);
  }
  for (const p of array(work.workHadParticipation).filter(p => tail(p.participation_role) === 'AUTHOR'))
    for (const v of array(p.had_participant_person)) add(v, 'AUTHOR', 'workHadParticipation.AUTHOR → had_participant_person', p);
  for (const v of array(work.creator)) add(v, 'AUTHOR', 'creator → person');
  return [...evidence.values()].sort((a,b) => a.id.localeCompare(b.id));
}
export function questionFromSource({ work, key, fetchedAt }) {
  if (!['QUESTION_WRITTEN', 'QUESTION_WRITTEN_PRIORITY', 'QUESTION_ORAL'].includes(tail(work.work_type))) return null;
  const id = work.identifier || tail(work.id);
  return { id, date: work.document_date || null, kind: tail(work.work_type), titles: suppliedTitles(work), authors: authorEvidence(work, key, fetchedAt), addressees: questionAddressees(work),
    answers: array(work.inverse_answers_to).filter(a => a && typeof a === 'object').map(a => ({ id: a.identifier || tail(a.id), date: a.document_date || null, creatorUris: array(a.creator).map(canonical), apiUrl: officialApi('/parliamentary-questions/' + (a.identifier || tail(a.id))) })),
    apiUrl: officialApi(key), fetchedAt };
}
const stopwords = new Set(('possible possibility future concerning impact impacts support supporting protection protecting compliance public national law laws funding fund funds access compatibility people sector request policy policies act acts article articles directive directives regulation regulations rule rules programme programmes request requests requested requesting ensure ensuring continued continuing continuation publish publishes published a about above across after again against all also an and another any are as at be been before being between both but by can commission concerning could council did do does during each eu european europe for from further has have how i if in into is it its may more most much must new no not of on one only or other our over parliament question regarding related regarding situation situations issue issues measures action actions including implementation application ongoing recent current developments need needs concerning should so some such than that the their them then there these they this those through to towards under union up use using very was we were what when where which while who why will with within would you your').split(' '));
export function titleTokens(title,phrases=null) {
  const extracted=phrases?.extract(title),named=titlePlaces(extracted?.text??title);
  return [...new Set([...(extracted?.phrases.map(p=>p.key)||[]),...(named.text.match(/(?:\bai\b|\p{L}[\p{L}\p{M}'’-]{2,})/gu)||[]).filter(t=>!stopwords.has(t)&&!['member','states'].includes(t)&&t.length<40),...named.places.map(p=>p.token)])].slice(0,24);
}
function sortedCounts(counts) { return [...counts].map(([label,count]) => ({label,count})).sort((a,b) => b.count-a.count || a.label.localeCompare(b.label)); }
export function ageAt(bday, referenceDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bday || '') || !Number.isFinite(Date.parse(bday)) || new Date(bday).toISOString().slice(0,10) !== bday) return null;
  const year = Number(referenceDate.slice(0,4)) - Number(bday.slice(0,4));
  const age = year - (referenceDate.slice(5) < bday.slice(5) ? 1 : 0);
  return age >= 18 && age <= 120 ? age : null;
}
export function demographicStats(ids, members, metadata = new Map(), referenceDate) {
  const unique = [...new Set(ids.map(String))], roster = members instanceof Map ? members : new Map(members.map(m => [String(m.id),m]));
  const current = unique.filter(id => roster.has(id)), outside = unique.filter(id => !roster.has(id));
  const dimensions = {country:new Map(),group:new Map(),gender:new Map(),age:new Map()};
  for (const id of current) {
    const meta = metadata.get(id) || {}, sex = tail(array(meta.hasGender)[0]);
    const age = ageAt(meta.bday,referenceDate);
    const values = {country:meta['api:country-of-representation'] || 'Unknown',group:meta['api:political-group'] || 'Unknown',gender:sex === 'FEMALE' ? 'Female' : sex === 'MALE' ? 'Male' : 'Unknown',age:age == null ? 'Unknown' : age < 35 ? '18–34' : age < 50 ? '35–49' : age < 65 ? '50–64' : '65+'};
    for (const [dimension,value] of Object.entries(values)) { const bucket=dimensions[dimension];bucket.set(value,(bucket.get(value)||0)+1); }
  }
  return {uniquePeople:unique.length,uniqueCurrentMeps:current.length,peopleOutsideCurrentRoster:outside.length,denominator:current.length,referenceDate,
    basis:'Current saved roster and explicitly supplied cached profile metadata; not membership at activity time. Age uses explicit birth date at the stated reference date. People outside the current roster are listed separately.',
    metadataSourceDates:{from:current.flatMap(id=>[metadata.get(id)?.metadataFetchedAt,metadata.get(id)?.rosterMetadataFetchedAt]).filter(Boolean).sort()[0]||null,to:current.flatMap(id=>[metadata.get(id)?.metadataFetchedAt,metadata.get(id)?.rosterMetadataFetchedAt]).filter(Boolean).sort().at(-1)||null},
    dimensions:Object.fromEntries(Object.entries(dimensions).map(([key,value]) => [key, sortedCounts(value)]))};
}
export function memberPeople(ids, members, metadata = new Map()) {
  const roster = members instanceof Map ? members : new Map(members.map(m => [String(m.id),m]));
  return [...new Set(ids.map(String))].map(id => ({id,name:roster.get(id)?.name || metadata.get(id)?.label || null,currentMep:roster.has(id),group:metadata.get(id)?.['api:political-group'] || roster.get(id)?.groupCode || null,country:metadata.get(id)?.['api:country-of-representation'] || roster.get(id)?.countryCode || null,personUri:'https://data.europarl.europa.eu/person/'+id}));
}
export function questionTrend(all,selected,{start,end,days},latestObservedDate=all.map(q=>q.date).filter(Boolean).sort().at(-1)||null) {
  const step=days<=30?1:7,bins=[];
  const first=Date.parse(start+'T12:00:00Z'),last=Date.parse(end+'T12:00:00Z'),begin=step===7?first-((new Date(first).getUTCDay()+6)%7)*86400_000:first;
  for(let time=begin;time<=last;time+=step*86400_000) {
    const from=new Date(Math.max(first,time)).toISOString().slice(0,10),to=new Date(Math.min(time+(step-1)*86400_000,last)).toISOString().slice(0,10);
    const total=all.filter(q=>q.date>=from&&q.date<=to).length,count=selected.filter(q=>q.date>=from&&q.date<=to).length;
    const availability=!latestObservedDate||from>latestObservedDate?'unavailable':to>latestObservedDate?'partial':'observed';
    bins.push({start:from,end:to,availability,count:availability==='unavailable'?null:count,total:availability==='unavailable'?null:total,share:total?Math.round(count/total*10000)/100:null});
  }
  return {interval:step===1?'day':'week',latestObservedDate,availabilityBasis:'Latest saved question document_date in the analysis window before country, topic and time-range filters; not a completeness guarantee.',bins};
}
export function analyzeQuestions(questions,options) {return finishWork(questionAnalysisSteps(questions,options));}
export function analyzeQuestionsAsync(questions,{signal,...options}={}) {return cooperativeWork(questionAnalysisSteps(questions,options),{signal});}
function* questionAnalysisSteps(questions,{bodies=new Map()}={}) {
  // Each title is one observation, regardless of its author count or repeated words.
  const unique = [...new Map(questions.map(q => [q.id,q])).values()].sort((a,b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));
  const phrases=yield* phraseModelSteps(unique,{bodies,stopwords});
  const tokens=[],places=[];
  for(const q of unique) {tokens.push(titleTokens(q.titles.en,phrases));places.push(titlePlaces(q.titles.en).places);yield;}
  const index = new Map();
  tokens.forEach((ts,i) => ts.forEach(t => { const list = index.get(t) || []; list.push(i);index.set(t,list); }));
  const parents=unique.map((_,i)=>i),componentPlaces=places.map(ps=>new Set(ps.map(p=>p.id)));
  const common=new Set([...index].filter(([,items])=>items.length>Math.max(30,unique.length*.15)).map(([word])=>word));
  function find(i) { while(parents[i]!==i) {parents[i]=parents[parents[i]];i=parents[i];}return i; }
  // Exact informative title signatures remain linear even when every term is common.
  const signatures=new Map();
  tokens.forEach((words,i)=>{if(words.length<2)return;const key=[...words].sort().join('|');const previous=signatures.get(key);if(previous===undefined)signatures.set(key,i);else {const root=find(previous);parents[i]=root;componentPlaces[root]=new Set([...componentPlaces[root],...componentPlaces[i]]);}});
  const maximumFrequency=Math.max(30,Math.floor(unique.length*.15));
  // Per-title candidates keep memory bounded, rather than retaining all corpus pairs.
  for(let a=0;a<unique.length;a++) {
    yield;
    const candidates=new Map();
    for(const t of tokens[a]) {
      const list=index.get(t);
      if(common.has(t)||list.length<2||list.length>maximumFrequency||list.length>300)continue;
      for(const b of list)if(b>a)candidates.set(b,(candidates.get(b)||0)+1);
    }
    for(const [b,shared] of candidates)if(shared>=2 && shared/(tokens[a].length+tokens[b].length-shared)>=.18) {
      const ra=find(a),rb=find(b);if(ra===rb)continue;
      const ca=componentPlaces[ra],cb=componentPlaces[rb];
      if(ca.size&&cb.size&&![...ca].some(id=>cb.has(id)))continue;
      const low=Math.min(ra,rb),high=Math.max(ra,rb);parents[high]=low;componentPlaces[low]=new Set([...ca,...cb]);
    }
  }
  const components = new Map();
  unique.forEach((q,i) => {const root=find(i),items=components.get(root)||[];items.push(q);components.set(root,items);});
  const clusters=[];const assignments=new Map();
  const tokensById=new Map(unique.map((q,i)=>[q.id,tokens[i]]));
  for(const items of components.values()) {
    yield;
    if(items.length<2)continue;
    const frequencies=new Map();items.forEach(q=>tokensById.get(q.id).forEach(t=>frequencies.set(t,(frequencies.get(t)||0)+1)));
    const keywords=[...frequencies].filter(([,n])=>n>=2).sort((a,b)=> b[1]*Math.log(1+unique.length/(index.get(b[0])?.length||1))-a[1]*Math.log(1+unique.length/(index.get(a[0])?.length||1)) || a[0].localeCompare(b[0])).slice(0,4).map(([word])=>word);
    const id='topic-'+items.map(q=>q.id).sort()[0];items.forEach(q=>assignments.set(q.id,id));
    clusters.push({id,label:keywords.map(k=>phrases.labels[k]||k).join(' · '),keywords,questionCount:items.length,uniqueAuthorCount:new Set(items.flatMap(q=>q.authors.map(a=>a.id))).size});
  }
  clusters.sort((a,b)=>b.questionCount-a.questionCount||a.id.localeCompare(b.id));
  const ranked=[...index].map(([word,items])=>({word,label:phrases.labels[word]||null,questionCount:items.length})).sort((a,b)=>b.questionCount-a.questionCount||a.word.localeCompare(b.word));
  const shown=[...new Map([...ranked.slice(0,30),...ranked.filter(w=>w.label).slice(0,30),...ranked].map(w=>[w.word,w])).values()].slice(0,60).sort((a,b)=>b.questionCount-a.questionCount||a.word.localeCompare(b.word));
  return {questions:unique.map((q,i)=>({...q,tokens:tokens[i],places:places[i],clusterId:assignments.get(q.id)||null})),clusters,
    termLabels:phrases.labels,words:shown,
    analysis:{version:INSIGHTS_VERSION,language:'en',basis:'Topics and counts use supplied English titles. Already cached English question bodies help recognise phrases; no body text is downloaded.',method:'Specific named phrases and recurring multiword expressions remain whole. Similar titles need two shared informative terms; different named places remain separate unless connected. These are derived topics, not official indexing.',phraseCoverage:phrases.coverage,countryLabelSource,missingEnglishTitles:unique.filter(q=>!q.titles.en).length,unassignedQuestions:unique.filter(q=>!assignments.has(q.id)).length}};
}
