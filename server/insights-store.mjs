import {questionGroupMetrics,contributionGroup} from './group-aggregation.mjs';
import {generationGroupOn,datedPerson} from './group-attribution.mjs';
import {subjectPlace} from './insights-places.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http-utils.mjs';
import {countryCode,countryQuestions,memberCountry} from './insights-countries.mjs';
import { odpLanguage } from './odp.mjs';
import { analyzeQuestionsAsync, questionFromSource, demographicStats, memberPeople,personId,questionTrend } from './insights-model.mjs';
import {requestSignal,sharedRequest,waitForRequest} from './request-budget.mjs';
import {cachedEnglishQuestionBodies} from './insights-phrases.mjs';
import {CURRENT_TERM_START,brusselsDay} from './analysis-period.mjs';
import {validAddresseeFilter,matchesAddressee,addresseeLabel} from './question-addressees.mjs';
export {brusselsDay} from './analysis-period.mjs';

export const INSIGHTS_LIMITS = Object.freeze({ termStart:CURRENT_TERM_START,questions:5000,page:50,offset:5000,cacheEntries:4,cacheBytes:32*1024*1024,cacheMs:60_000 });
function strictDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
}
export function insightQuery(search, {now=Date.now(),kind='questions'}={}) {
  const allowed=new Set(kind==='questions'?['lang','days','end','from','to','cluster','word','country','group','addressee','subject','limit','offset']:['lang','sitting','week','topic','vote']);
  for(const key of search.keys()) if(!allowed.has(key)||search.getAll(key).length!==1) throw new HttpError(400,'invalid_query','Unsupported or repeated insight parameter.');
  const language=odpLanguage(search.get('lang')||'en');
  if(kind!=='questions') {
    const sitting=search.get('sitting');if(sitting&&!/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(sitting))throw new HttpError(400,'invalid_sitting','Choose a catalogue-listed plenary sitting.');
    const topic=search.get('topic'),vote=search.get('vote');
    const week=search.get('week');
    if(search.has('week')&&(week!=='latest'&&(!strictDate(week)||new Date(week).getUTCDay()!==1)||sitting||topic||vote))throw new HttpError(400,'invalid_week','Choose a plenary week or a single sitting item.');
    if([topic,vote].some(v=>v && (!/^[A-Za-z0-9:/_.-]{1,180}$/.test(v))))throw new HttpError(400,'invalid_selection','Invalid topic or vote identifier.');
    return {language,sitting,week,topic,vote};
  }
  function integer(key,fallback,min,max) { const raw=search.get(key);const n=raw==null?fallback:Number(raw);if(raw!=null&&!/^\d+$/.test(raw)||!Number.isSafeInteger(n)||n<min||n>max)throw new HttpError(400,'invalid_query',`${key} must be ${min}–${max}.`);return n; }
  const end=search.get('end')||brusselsDay(now);
  if(!strictDate(end)||end>brusselsDay(now))throw new HttpError(400,'invalid_date','Choose a valid end date on or before today.');
  if(end<CURRENT_TERM_START)throw new HttpError(400,'invalid_date','The window must fall within parliamentary term 10.');
  const termDays=1+(Date.parse(end)-Date.parse(CURRENT_TERM_START))/86400_000;
  const days=search.get('days')==='term'?termDays:integer('days',90,1,termDays);
  const start=new Date(Date.parse(end+'T12:00:00Z')-(days-1)*86400_000).toISOString().slice(0,10);
  const from=search.get('from'),to=search.get('to');
  if(Boolean(from)!==Boolean(to)||from&&(!strictDate(from)||!strictDate(to)||from<start||to>end||from>to))throw new HttpError(400,'invalid_range','Choose a date range inside the analysis period.');
  const cluster=search.get('cluster'),word=search.get('word'),country=search.get('country');
  const subject=search.get('subject');
  if(search.has('subject')&&!subjectPlace(subject))throw new HttpError(400,'invalid_subject','Choose a subject from a question title.');
  const group=search.get('group');
  if(group!==null&&!['PPE','S&D','Renew','Verts/ALE','ECR','PfE','ESN','TheLeft','NI'].includes(group))throw new HttpError(400,'invalid_group','Choose a political group.');
  const addressee=search.get('addressee');
  if(addressee!==null&&!validAddresseeFilter(addressee))throw new HttpError(400,'invalid_addressee','Choose an addressee from the question filters.');
  if(country&&!countryCode(country))throw new HttpError(400,'invalid_country','Choose a country of representation.');
  if(cluster && !/^(?:unassigned|topic-[A-Z0-9-]{1,100})$/.test(cluster))throw new HttpError(400,'invalid_cluster','Invalid cluster identifier.');
  if(word && (!/^(?:ai|\p{L}[\p{L}\p{M}'’-]{2,39})$/u.test(word)))throw new HttpError(400,'invalid_word','Choose a word from the title cloud.');
  return {language,days,start,end,from,to,cluster,word,group,addressee,subject,country:country?countryCode(country):null,limit:integer('limit',25,1,50),offset:integer('offset',0,0,5000)};
}

// Read exact known cache keys. Never scan/copy the cache or trigger upstream fetches.
export async function savedMetadata({directory=process.env.ODP_CACHE_DIR,members}={}) {
  const metadata=new Map();if(!directory)return metadata;
  async function record(endpoint,params={}) {
    const url=new URL('https://data.europarl.europa.eu/api/v2'+endpoint);
    for(const [k,v] of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(k,String(v));
    try {
      const file=path.join(directory,createHash('sha256').update(url.href).digest('hex')+'.json');
      const legacy=Buffer.from(url.href).toString('base64url')+'.json';
      const data=await readFile(file,'utf8').catch(error=>legacy.length<=255?readFile(path.join(directory,legacy),'utf8'):Promise.reject(error));
      if(data.length>12*1024*1024)return null;
      const r=JSON.parse(data);return r.url===url.href&&Number.isFinite(r.fetchedAt)&&Array.isArray(r.payload?.data)?r:null;
    }catch{return null;}
  }
  const roster=await record('/meps/show-current',{limit:1000,offset:0});
  for(const p of roster?.payload.data||[]) {
    const id=personId(p.id);if(!id)continue;
    metadata.set(id,{...p,metadataFetchedAt:new Date(roster.fetchedAt).toISOString(),rosterMetadataFetchedAt:new Date(roster.fetchedAt).toISOString(),metadataApiUrl:roster.url});
  }
  // A bounded group of sequential reads avoids 719 concurrent open files.
  const ids=[...members.keys()].slice(0,750);
  for(let i=0;i<ids.length;i+=16) await Promise.all(ids.slice(i,i+16).map(async id=>{
    const profile=await record('/meps/'+id),p=profile?.payload.data.find(p=>personId(p.id)===id);if(!p)return;
    const fields=Object.fromEntries(['hasGender','bday','label'].filter(key=>p[key]!==undefined).map(key=>[key,p[key]]));
    metadata.set(id,{...metadata.get(id),...fields,metadataFetchedAt:new Date(profile.fetchedAt).toISOString(),metadataApiUrl:profile.url});
  }));
  return metadata;
}

export class QuestionInsights {
  constructor(store,{clock=Date.now,loadMetadata=savedMetadata,loadQuestionBodies=cachedEnglishQuestionBodies}={}) {this.store=store;this.clock=clock;this.loadMetadata=loadMetadata;this.loadQuestionBodies=loadQuestionBodies;this.cache=new Map();this.pending=new Map();this.cacheBytes=0;}
  async analysis(query) {
    requestSignal()?.throwIfAborted();
    const status=this.store.status();if(!status.currentMeps||!status.servingGeneration)throw new HttpError(503,'insights_loading','The saved activity index is not available yet.');
    const groupOn=generationGroupOn(this.store,status.servingGeneration);
    const key=JSON.stringify([status.servingGeneration,status.complete,status.progress?.completed,status.rosterFetchedAt,query.start,query.end]);
    const old=this.cache.get(key);if(old && this.clock()-old.at<INSIGHTS_LIMITS.cacheMs)return old.value;
    if(this.pending.has(key))return waitForRequest(this.pending.get(key));
    // Language and filter views share this analysis, but each view has its own
    // owner. Expiring one view must cancel only its wait on the shared work.
    const job=sharedRequest(async signal=>{
      // Use the existing store, not a second ActivityStore or worker. All statements are SELECTs.
      const params=[status.servingGeneration,query.start,query.end];
      const where="generation=? AND kind='document' AND json_extract(body,'$.document_date') BETWEEN ? AND ? AND (json_extract(body,'$.work_type') LIKE '%/QUESTION_WRITTEN' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_WRITTEN_PRIORITY' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_ORAL')";
      const count=this.store.db.prepare('SELECT COUNT(*) AS n FROM sources WHERE '+where).get(...params).n;
      const undatedQuestions=this.store.db.prepare('SELECT COUNT(*) AS n FROM sources WHERE '+where.replace("json_extract(body,'$.document_date') BETWEEN ? AND ?","(json_extract(body,'$.document_date') IS NULL OR json_extract(body,'$.document_date')='')")).get(status.servingGeneration).n;
      const rows=this.store.db.prepare('SELECT key,body,fetched_at FROM sources WHERE '+where+" ORDER BY json_extract(body,'$.document_date') DESC,key LIMIT ?").all(...params,INSIGHTS_LIMITS.questions);
      const members=new Map(this.store.db.prepare('SELECT id,body FROM members ORDER BY id').all().map(r=>[r.id,JSON.parse(r.body)]));
      const metadata=await this.loadMetadata({members});
      const sources=rows.map(r=>({key:r.key,work:JSON.parse(r.body),fetchedAt:r.fetched_at}));
      const bodies=await this.loadQuestionBodies(sources);
      const analysis=await analyzeQuestionsAsync(sources.map(questionFromSource).filter(Boolean),{bodies,signal});
      const geography=countryQuestions(analysis,members,metadata);
      const value={...analysis,...geography,members,metadata,status,groupOn,undatedQuestions,indexedMatchingQuestions:count,truncated:count>rows.length,computedAt:new Date(this.clock()).toISOString()};
      const bytes=Buffer.byteLength(JSON.stringify({...analysis,...geography}));
      signal.throwIfAborted();
      if(bytes<=INSIGHTS_LIMITS.cacheBytes) {
        if(this.cache.has(key)){this.cacheBytes-=this.cache.get(key).bytes;this.cache.delete(key);}
        this.cache.set(key,{at:this.clock(),value,bytes});this.cacheBytes+=bytes;
        while(this.cache.size>INSIGHTS_LIMITS.cacheEntries||this.cacheBytes>INSIGHTS_LIMITS.cacheBytes){const oldest=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(oldest).bytes;this.cache.delete(oldest);}
      }
      return value;
    }).finally(()=>{if(this.pending.get(key)===job)this.pending.delete(key);});
    this.pending.set(key,job);return waitForRequest(job);
  }
  async query(query) {
    const a=await this.analysis(query);
    const groupOn=a.groupOn;
    if(query.cluster && query.cluster!=='unassigned' && !a.clusters.some(c=>c.id===query.cluster))throw new HttpError(404,'cluster_not_found','That topic is not in this window.');
    const inTime=q=>!query.from||q.date>=query.from&&q.date<=query.to,hasTopic=q=>(!query.cluster || (query.cluster==='unassigned'?q.clusterId==null:q.clusterId===query.cluster))&&(!query.word||q.tokens.includes(query.word)),hasCountry=q=>!query.country||q.countries.includes(query.country);
    const hasGroup=q=>!query.group||q.authors.some(p=>contributionGroup(p.id,q.date,groupOn)===query.group);
    const hasAddressee=q=>matchesAddressee(q.addressees,query.addressee)&&hasGroup(q);
    const subjectBase=a.questions.filter(q=>!query.subject||q.places.some(place=>place.id===query.subject));
    const recipientBase=subjectBase.filter(hasAddressee),timeBase=recipientBase.filter(inTime),countryBase=timeBase.filter(hasCountry),selected=countryBase.filter(hasTopic);
    const geography=query.from||query.addressee||query.subject||query.group?countryQuestions({...a,questions:timeBase},a.members,a.metadata):a;
    const countryAnalysis=query.country?geography.countries.find(c=>c.code===query.country):null,countryFeatures=new Map((countryAnalysis?.features||[]).map(f=>[f.id,f]));
    const wordCounts=new Map(),clusterCounts=new Map();for(const q of countryBase){for(const token of q.tokens)wordCounts.set(token,(wordCounts.get(token)||0)+1);if(q.clusterId)clusterCounts.set(q.clusterId,(clusterCounts.get(q.clusterId)||0)+1);}
    const shownWords=a.wordCandidates.filter(w=>wordCounts.has(w.word)).map(w=>({...w,contextQuestionCount:wordCounts.get(w.word)})).sort((a,b)=>b.contextQuestionCount-a.contextQuestionCount||a.word.localeCompare(b.word)).slice(0,60);
    const topicBase=timeBase.filter(hasTopic),countryFacets=geography.countries.map(country=>{const questions=topicBase.filter(q=>q.countries.includes(country.code));return {code:country.code,count:questions.length,authors:new Set(questions.flatMap(q=>q.authors.filter(author=>memberCountry(author.id,a.members,a.metadata)===country.code).map(a=>a.id))).size};});
    const ids=questions=>questions.flatMap(q=>q.authors.map(p=>p.id));
    // Disjunctive facet: counts respect every other filter but retain alternatives.
    const addresseeCounts=new Map();
    for(const q of subjectBase.filter(q=>inTime(q)&&hasCountry(q)&&hasTopic(q)&&hasGroup(q))) {
      for(const id of q.addressees?.length?q.addressees.map(item=>item.id):['unavailable'])addresseeCounts.set(id,(addresseeCounts.get(id)||0)+1);
    }
    if(query.addressee&&!addresseeCounts.has(query.addressee))addresseeCounts.set(query.addressee,0);
    const addresseeFacets=[...addresseeCounts].map(([id,count])=>({id,label:addresseeLabel(id),count})).sort((a,b)=>a.id==='unavailable'?1:b.id==='unavailable'?-1:a.label.localeCompare(b.label));
    const stats=(questions,selectedCountry=false)=>{
      const groupStats=questionGroupMetrics(questions,groupOn,(p,q)=>(!selectedCountry||!query.country||memberCountry(p.id,a.members,a.metadata)===query.country)&&(!query.group||contributionGroup(p.id,q.date,groupOn)===query.group));
      const stats=demographicStats(ids(questions).filter(id=>!selectedCountry||!query.country||memberCountry(id,a.members,a.metadata)===query.country),a.members,a.metadata,query.end);
      return {...stats,groupContributions:groupStats};
    };
    const present=q=>({id:q.id,date:q.date,kind:q.kind,title:q.titles[query.language] || q.titles.en || Object.values(q.titles)[0] || q.id,titleLanguage:q.titles[query.language]?query.language:q.titles.en?'en':Object.keys(q.titles)[0]||null,analysisTitle:q.titles.en||null,places:q.places||[],clusterId:q.clusterId,authors:q.authors.map(p=>({...p,...datedPerson(memberPeople([p.id],a.members,a.metadata)[0],q.date,groupOn)})),addressees:q.addressees||[],answers:q.answers,apiUrl:q.apiUrl,fetchedAt:q.fetchedAt});
    return {version:1,view:'questions',window:{start:query.start,end:query.end,days:query.days,dateBasis:'document_date; both boundaries inclusive'},requestedLanguage:query.language,
      counts:{indexedMatchingQuestions:a.indexedMatchingQuestions,analyzedQuestions:a.questions.length,totalQuestions:a.status.complete&&!a.truncated?a.indexedMatchingQuestions:null,selectedQuestions:selected.length,contextUnassignedQuestions:countryBase.filter(q=>q.clusterId===null).length,countryUnassignedQuestions:query.country?countryBase.filter(q=>q.clusterId===null).length:null,clusters:a.clusters.length},
      selection:{subject:query.subject||null,subjectLabel:subjectPlace(query.subject)?.label||null,cluster:query.cluster,word:query.word,wordLabel:query.word?(a.termLabels?.[query.word]||query.word):null,country:query.country,group:query.group||null,addressee:query.addressee,from:query.from||null,to:query.to||null},facets:{countries:countryFacets,addressees:addresseeFacets,availableQuestions:countryBase.length},stats:stats(recipientBase),selectedStats:stats(selected,true),clusters:a.clusters.map(c=>({...c,contextQuestionCount:clusterCounts.get(c.id)||0,countryQuestionCount:query.country?clusterCounts.get(c.id)||0:null})),words:shownWords.map(w=>({...w,countryQuestionCount:query.country?w.contextQuestionCount:null})),analysis:a.analysis,
      geography:{countries:geography.countries.map(c=>({...c,features:[...new Map([...c.features.filter(f=>f.highlighted).slice(0,8),...c.features.filter(f=>f.id===(query.word?'word:'+query.word:'cluster:'+query.cluster))].map(f=>[f.id,f])).values()]})),selected:countryAnalysis,unknownCountryQuestions:geography.unknownCountryQuestions,method:geography.method},
      trend:questionTrend(recipientBase.filter(hasCountry),recipientBase.filter(q=>hasCountry(q)&&hasTopic(q)),query,a.questions.map(q=>q.date).filter(Boolean).sort().at(-1)||null),questions:selected.slice(query.offset,query.offset+query.limit).map(present),offset:query.offset,limit:query.limit,nextOffset:query.offset+query.limit<selected.length?query.offset+query.limit:null,
      coverage:{undatedQuestions:a.undatedQuestions,undatedQuestionsScope:'All saved questions; excluded from date-window analysis because tabling document_date is unavailable',indexComplete:a.status.complete,truncated:a.truncated,scope:'Saved term-10 question sources, with all explicitly supplied authors. Country, gender and age demographics cover only people on the current saved MEP roster. Political groups count author-question contributions at tabling.',servingGeneration:a.status.servingGeneration,sourceCounts:a.status.sourceCounts,rosterFetchedAt:a.status.rosterFetchedAt,lastSuccessfulRefresh:a.status.lastSuccessfulRefresh,pendingSpeechRecoveries:a.status.pendingSpeechRecoveries?.count||0,sourceFetchedFrom:a.questions.map(q=>q.fetchedAt).filter(Boolean).sort()[0]||null,sourceFetchedTo:a.questions.map(q=>q.fetchedAt).filter(Boolean).sort().at(-1)||null},
      cache:{computedAt:a.computedAt,ttlSeconds:60,readOnly:true},attribution:'European Parliament Open Data API v2, CC BY 4.0',limits:INSIGHTS_LIMITS};
  }
}
