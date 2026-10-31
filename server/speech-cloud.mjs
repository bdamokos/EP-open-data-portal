import {sourceAvailability} from './source-availability.mjs';
import {missingSitting,calendarNeedsRefresh} from './meetings-reader.mjs';
import {languagePreference} from './language-order.mjs';
import {HttpError} from './http-utils.mjs';
import {odp,odpLanguage,chooseTranscript} from './odp.mjs';
import {array,tail} from './activity-index-model.mjs';
import {personId} from './insights-model.mjs';
import {insightQuery,brusselsDay} from './insights-store.mjs';
import {countryCode,memberCountry} from './insights-countries.mjs';
import {speechParagraphText,speechWordTokens,speechWordStopwords,speechWordLanguages} from './insights-speech-words.mjs';
import {speechSpeakers,speechSpeakerDetails,speakerNameIsSpecific} from './speech-speakers.mjs';
import {transcriptLanguage} from './transcript-language.mjs';
import {phraseModel} from './insights-phrases.mjs';
import {requestSignal,sharedRequest,waitForRequest} from './request-budget.mjs';
import {retainedSpeechPage} from './corpus-speeches.mjs';

const calendarEvidence=scope=>scope.catalogue?{catalogueComplete:scope.catalogueComplete,catalogue:scope.catalogue}:{};
export const SPEECH_CLOUD_VERSION=2;
const alternativeLanguages=state=>[...state.missingLanguageAlternatives].sort(([a],[b])=>a.localeCompare(b)).map(([language,count])=>({language,count}));
function missingLanguage(state,languages,requested) {
  state.missingLanguage++;
  for(const language of new Set(languages))if(language!==requested&&speechWordLanguages.includes(language))
    state.missingLanguageAlternatives.set(language,(state.missingLanguageAlternatives.get(language)||0)+1);
}
function displayTitle(titles,language,fallback=null) {
  const code=languagePreference(Object.keys(titles||{}).filter(code=>typeof titles[code]==='string'&&titles[code].trim()),language)[0];
  return {title:code!==undefined?titles[code]:fallback,titleLanguage:code!==undefined?code||null:fallback?'en':null};
}

// A week scales the total page and XML budgets by its number of held sittings (at most five).
export const CLOUD_LIMITS=Object.freeze({pageSize:50,pages:20,xmlBytes:4*1024*1024,weekSittings:5,queries:6,cacheMs:30*60_000});
export const CLOUD_SORT='sitting-date:asc,video-start-time:asc,numbering:asc';
export function speechCloudQuery(search,{now=Date.now()}={}) {
  const allowed=new Set(['lang','member','sitting','week','topic','days','end','page','country']);
  if([...search.keys()].some(key=>!allowed.has(key)||search.getAll(key).length!==1))throw new HttpError(400,'invalid_query','Unsupported or repeated cloud query.');
  const member=search.get('member'),sitting=search.get('sitting'),week=search.get('week'),topic=search.get('topic'),page=search.get('page')||'0';
  if([member,sitting,week].filter(Boolean).length!==1)throw new HttpError(400,'invalid_scope','Choose a MEP, a plenary sitting or a plenary week.');
  if(week&&(!/^\d{4}-\d{2}-\d{2}$/.test(week)||!Number.isFinite(Date.parse(week))||new Date(week).toISOString().slice(0,10)!==week||new Date(week).getUTCDay()!==1))throw new HttpError(400,'invalid_week','Choose a Monday from the listed plenary weeks.');
  if(member&&!/^[1-9]\d{0,8}$/.test(member)||sitting&&!/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(sitting)||topic&&(!sitting||!topic.startsWith(sitting+'-OJ-ITM-')||!/^MTG-PL-\d{4}-\d{2}-\d{2}-OJ-ITM-[DV]-\d+$/.test(topic)))throw new HttpError(400,'invalid_scope','Invalid speech selection.');
  if(!/^(0|[1-9]\d{0,2})$/.test(page)||Number(page)>=CLOUD_LIMITS.pages*(week?CLOUD_LIMITS.weekSittings:1))throw new HttpError(400,'invalid_page','Invalid cloud page.');
  if((sitting||week)&&(search.has('days')||search.has('end')))throw new HttpError(400,'invalid_window','Choose a sitting or a date window.');
  const language=odpLanguage(search.get('lang')||'en');
  if(!speechWordLanguages.includes(language))throw new HttpError(400,'unsupported_analysis_language','Word filtering is not available for this language.');
  const country=search.get('country');if(country&&!countryCode(country))throw new HttpError(400,'invalid_country','Choose a country of representation.');
  const window=member?insightQuery(new URLSearchParams({lang:language,...Object.fromEntries(['days','end'].filter(key=>search.has(key)).map(key=>[key,search.get(key)]))}),{now}):null;
  return {member,sitting,week,topic,language,page:Number(page),country:country?countryCode(country):null,start:window?.start||null,end:window?.end||null,days:window?.days||null};
}
export const meaningfulSpeakerName=speakerNameIsSpecific;
const participants=activity=>[...new Set(array(activity.had_participation).flatMap(p=>array(p.had_participant_person)).map(personId).filter(Boolean))];
const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export function analyzeSpeechCloud(records,language) {
  const stopwords=speechWordStopwords(language);
  const phrases=language==='en'?phraseModel(records.map(s=>({id:s.id,titles:{en:s.analysisTitle??s.title}})),{bodies:new Map(records.map(s=>[s.id,{paragraphs:[s.text]}])),stopwords,minCount:2,maxShare:.8}):null;
  const words=new Map();
  for(const speech of records) {
    const extracted=phrases?.extract(speech.text),counts=new Map();
    for(const word of speechWordTokens(extracted?.text||speech.text,language)){const old=counts.get(word)||{word,label:null,occurrences:0};old.occurrences++;counts.set(word,old);}
    for(const p of extracted?.phrases||[])if(!/^(?:mr|mrs|ms|madam|mister)\b/i.test(p.label)&&!p.label.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).every(word=>stopwords.has(word)))counts.set(p.key,{word:p.key,label:p.label,occurrences:[...speech.text.matchAll(new RegExp('(?<![\\p{L}])'+escaped(p.label)+'(?![\\p{L}])','giu'))].length||1});
    for(const term of counts.values()) {
      const word=words.get(term.word)||{word:term.word,label:term.label,speechCount:0,occurrences:0,speechIds:[]};word.speechCount++;word.occurrences+=term.occurrences;if(word.speechIds.length<8)word.speechIds.push(speech.id);words.set(term.word,word);
    }
  }
  return [...words.values()].sort((a,b)=>b.speechCount-a.speechCount||b.occurrences-a.occurrences||a.word.localeCompare(b.word,language)).slice(0,60);
}

// Selected-view retrieval only: normal ODP cache/queue, no index or worker writes.
export class SpeechCloudInsights {
  constructor(store,{request=odp,legislation,clock=Date.now,loadMetadata=async()=>new Map(),readCorpusPage=request===odp?retainedSpeechPage:null}={}) {Object.assign(this,{store,request,legislation,clock,loadMetadata,readCorpusPage});this.states=new Map();}
  async scope(query) {
    if(query.member) {
      if(!this.store.db.prepare('SELECT id FROM members WHERE id=?').get(query.member))throw new HttpError(404,'member_not_found','This MEP is not in the current roster.');
      return {kind:'member',dates:[{start:query.start,end:query.end}],ids:null,phase:'past',title:null,titleLanguage:null};
    }
    const catalogue=await this.legislation.catalogue(),today=brusselsDay(this.clock()),calendar={catalogueComplete:catalogue.complete,catalogue:catalogue.coverage};
    if(query.week) {
      const end=new Date(Date.parse(query.week+'T12:00:00Z')+6*86400_000).toISOString().slice(0,10),sittings=catalogue.sittings.filter(s=>s.activity_date>=query.week&&s.activity_date<=end).sort((a,b)=>a.activity_date.localeCompare(b.activity_date));
      if(!sittings.length)missingSitting(catalogue);
      if(sittings.length>CLOUD_LIMITS.weekSittings)throw new HttpError(502,'sitting_calendar_invalid','Too many sitting days in this week.');
      const held=sittings.filter(s=>s.activity_date<=today);
      return {...calendar,kind:'week',dates:held.map(s=>({start:s.activity_date,end:s.activity_date})),ids:null,phase:held.length?'past':'upcoming',title:null,titleLanguage:null};
    }
    const sitting=catalogue.sittings.find(s=>s.activity_id===query.sitting);
    if(!sitting)missingSitting(catalogue);
    const upcoming=sitting.activity_date>today;
    if(!query.topic)return {...calendar,kind:'sitting',dates:upcoming?[]:[{start:sitting.activity_date,end:sitting.activity_date}],ids:null,phase:upcoming?'upcoming':'past',...displayTitle(sitting.activity_label,query.language)};
    const response=await this.legislation.query({language:query.language,sitting:query.sitting,topic:query.topic,vote:null},catalogue);
    const sources=response.detail.coverage.speechAssociations.sources;
    return {...calendar,kind:'topic',dates:[...new Set(sources.map(s=>s.eventDate))].sort().map(date=>({start:date,end:date})),ids:new Set(sources.flatMap(s=>s.contributionIds)),people:new Map(response.detail.people.map(person=>[person.id,person])),phase:upcoming?'upcoming':'past',title:response.detail.title,titleLanguage:response.detail.titleLanguage??null};
  }
  async query(query,restarts=0) {
    requestSignal()?.throwIfAborted();
    const status=this.store.status(),{page,...selection}=query,key=JSON.stringify([status.servingGeneration,this.store.get?.('demographicRevision')||0,selection]);let state=this.states.get(key);
    // A fresh visit refreshes coverage, while an ongoing walk keeps its cursor.
    if(state&&page===0&&state.availabilityRevision!==status.availabilityRevision){this.states.delete(key);state=null;}
    if(state?.scope?.catalogue&&calendarNeedsRefresh(state.scope.catalogue)&&this.clock()-state.at>=60_000){this.states.delete(key);return {...await this.query({...query,page:0},restarts),restarted:true};}
    if(state&&this.clock()-state.at>CLOUD_LIMITS.cacheMs){this.states.delete(key);state=null;}
    if(!state) {state={at:this.clock(),availabilityRevision:status.availabilityRevision,scope:null,cursor:{date:0,offset:0},page:-1,records:new Map(),seen:new Set(),scans:new Map(),sourceIssues:new Set(),duplicates:0,sources:[],rawRecords:0,missingLanguage:0,missingLanguageAlternatives:new Map(),invalidText:0,xmlBytes:0,truncated:false,pending:null,result:null};this.states.set(key,state);while(this.states.size>CLOUD_LIMITS.queries)this.states.delete(this.states.keys().next().value);}
    try {
      if(state.pending)await waitForRequest(state.pending);
      if(state.result&&(state.page>=page||state.cursor===null))return state.result;
      const job=sharedRequest(()=>this.build(state,query,page)).finally(()=>{if(state.pending===job)state.pending=null;});state.pending=job;
      return await waitForRequest(job);
    }catch(error) {
      if(error.code!=='corpus_changed'||restarts>=2)throw error;
      if(this.states.get(key)===state)this.states.delete(key);
      return {...await this.query({...query,page:0},restarts+1),restarted:true};
    }
  }
  async build(state,query,page) {
    if(!state.scope){const scope=await this.scope(query);requestSignal()?.throwIfAborted();state.scope=scope;}
    const days=['sitting','week'].includes(state.scope.kind)?Math.max(1,state.scope.dates.length):1,limits={pages:CLOUD_LIMITS.pages*days,xmlBytes:CLOUD_LIMITS.xmlBytes*days};
    if(state.corpusMode===undefined&&state.scope.dates.length&&this.readCorpusPage) {
      state.corpusFirst=await this.readCorpusPage(this.corpusSelection(state,query,0));
      requestSignal()?.throwIfAborted();state.corpusMode=Boolean(state.corpusFirst?.total>0&&!state.corpusFirst.missingRetainedLanguage);
    }
    if(state.corpusMode)return this.buildCorpus(state,query,page,limits);
    const members=new Map(this.store.db.prepare('SELECT id,body FROM members').all().map(row=>[row.id,JSON.parse(row.body)]));
    const metadata=query.country?await this.loadMetadata({members,store:this.store}):new Map();
    requestSignal()?.throwIfAborted();
    if(!state.scope.dates.length)state.cursor=null;
    while(state.cursor&&state.page<page) {
      const {date,offset}=state.cursor,window=state.scope.dates[date];
      const params={...(query.member?{'person-id':query.member}:{}),'parliamentary-term':10,'activity-type':'PLENARY_DEBATE_SPEECH','sitting-date':window.start,'sitting-date-end':window.end,'include-output':'xml_fragment',language:query.language,'sort-by':CLOUD_SORT,limit:CLOUD_LIMITS.pageSize,offset};
      const record=await this.request('/speeches',params,{priority:'interactive',staleWhileRevalidate:true});
      requestSignal()?.throwIfAborted();
      if(!Array.isArray(record.payload?.data))throw new HttpError(502,'speech_source_shape','Parliament returned unreadable speech text.');
      if(Buffer.byteLength(JSON.stringify(record.payload))>12*1024*1024)throw new HttpError(502,'speech_source_size','Parliament’s speech response is too large.');
      state.sources.push({url:record.url,fetchedAt:new Date(record.fetchedAt).toISOString(),stale:Boolean(record.stale)});
      let scan=state.scans.get(date);
      if(!scan){scan={ids:new Set(),totals:new Set(),ended:false};state.scans.set(date,scan);}
      const declaredTotal=record.payload.meta?.total;
      const knownTotal=Number.isSafeInteger(declaredTotal)&&declaredTotal>=0;
      if(knownTotal){scan.totals.add(declaredTotal);if(scan.totals.size>1)state.sourceIssues.add('total-changed');}
      else state.sourceIssues.add('total-unavailable');
      const activities=[],before=scan.ids.size;
      for(const activity of record.payload.data) {
        if(!activity||typeof activity!=='object'){state.sourceIssues.add('invalid-source-row');continue;}
        const id=activity.activity_id,people=participants(activity);
        if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]+$/.test(id||'')||tail(activity.had_activity_type)!=='PLENARY_DEBATE_SPEECH'||!/^\d{4}-\d{2}-\d{2}$/.test(activity.activity_date||'')||!id.startsWith('MTG-PL-'+activity.activity_date+'-')||activity.activity_date<window.start||activity.activity_date>window.end||query.member&&!people.includes(query.member)) {state.sourceIssues.add('invalid-source-row');continue;}
        if(scan.ids.has(id)){state.duplicates++;state.sourceIssues.add('overlapping-pages');continue;}
        scan.ids.add(id);activities.push(activity);
      }
      const hits=record.payload.searchResults?.hits;
      if(Array.isArray(hits)) {
        const hitIds=hits.map(hit=>tail(hit?.id)),graphIds=new Set(record.payload.data.map(activity=>activity?.activity_id));
        if(hitIds.length!==record.payload.data.length||hitIds.some(id=>!graphIds.has(id))||graphIds.size!==new Set(hitIds).size)state.sourceIssues.add('search-hit-mismatch');
      }
      const shortPage=knownTotal&&offset+record.payload.data.length<declaredTotal&&record.payload.data.length<CLOUD_LIMITS.pageSize;
      const noProgress=record.payload.data.length>0&&scan.ids.size===before;
      if(shortPage)state.sourceIssues.add('short-page');
      if(noProgress)state.sourceIssues.add('no-progress');
      for(const activity of activities) {
        const id=activity.activity_id,people=participants(activity);
        if(state.scope.ids&&!state.scope.ids.has(id)||state.seen.has(id))continue;
        state.seen.add(id);state.rawRecords++;
        if(query.country&&!people.some(person=>memberCountry(person,members,metadata)===query.country))continue;
        const selected=array(activity.recorded_in_a_realization_of).map(doc=>chooseTranscript([doc],query.language));
        const parts=selected.filter(part=>part.textLanguage===query.language&&part.xml);
        if(!parts.length){missingLanguage(state,selected.flatMap(part=>part.availableTextLanguages),query.language);continue;}
        const bytes=parts.reduce((sum,part)=>sum+Buffer.byteLength(part.xml),0);
        if(state.xmlBytes+bytes>limits.xmlBytes){state.sourceIssues.add('xml-byte-limit');state.cursor=null;break;}
        const paragraphs=parts.map(part=>speechParagraphText(part.xml)),text=paragraphs.filter(Boolean).join(' ');
        if(paragraphs.some(part=>!part))state.invalidText++;if(!text)continue;state.xmlBytes+=bytes;
        const headers=parts.flatMap(part=>speechSpeakers(activity,part.xml)),details=speechSpeakerDetails(activity);
        state.records.set(id,{id,date:activity.activity_date,...displayTitle(activity.activity_label,query.language,'Speech'),analysisTitle:activity.activity_label?.[query.language]||activity.activity_label?.en||'Speech',text,machineTranslation:parts.some(part=>transcriptLanguage(part.xml).machine),people:people.map(id=>{const known=members.get(id)||state.scope.people?.get(id),header=headers.find(p=>p.id===id);return {id,name:known?.name||[known?.firstName,known?.lastName].filter(Boolean).join(' ')||(meaningfulSpeakerName(header?.name)?header.name:null),currentMep:members.has(id),roleLabels:details.find(p=>p.id===id)?.roleLabels||{},roleLanguage:header?.roleLanguage||null,roleSource:{speechId:activity.activity_id,date:activity.activity_date,url:record.url,fetchedAt:new Date(record.fetchedAt).toISOString()},role:header?.role||(header&&!meaningfulSpeakerName(header.name)?(/president|chair/i.test(header.name)?'Chairing the sitting':null):null)};})});
      }
      state.page++;
      if(shortPage||noProgress)state.cursor=null;
      if(state.cursor) {
        const more=record.payload.data.length>=CLOUD_LIMITS.pageSize&&(!knownTotal||offset+CLOUD_LIMITS.pageSize<declaredTotal);
        if(!more)scan.ended=true;
        state.cursor=more?{date,offset:offset+CLOUD_LIMITS.pageSize}:date+1<state.scope.dates.length?{date:date+1,offset:0}:null;
      }
      if((scan.ended||shortPage||noProgress)&&knownTotal&&scan.ids.size!==declaredTotal)state.sourceIssues.add('source-total-mismatch');
      if(state.page>=limits.pages-1&&state.cursor){state.sourceIssues.add('page-limit');state.cursor=null;}
    }
    const records=[...state.records.values()];
    const scans=[...state.scans.values()],sourceRecords={unique:scans.reduce((sum,scan)=>sum+scan.ids.size,0),declared:scans.every(scan=>scan.totals.size===1)?scans.reduce((sum,scan)=>sum+[...scan.totals][0],0):null,duplicates:state.duplicates,issues:[...state.sourceIssues]};
    state.truncated=state.sourceIssues.size>0;
    state.result={view:'speech-cloud',availability:state.availability||sourceAvailability({sourceKey:'speech-text',family:'speeches',stage:'text',language:query.language,start:state.scope.dates[0]?.start,end:state.scope.dates.at(-1)?.end,limited:true,route:'public-api',observedRecords:records.length,checkedAt:state.sources.map(source=>source.fetchedAt).filter(Boolean).sort().at(-1),retention:state.corpusFirst?.missingRetainedLanguage?{reason:'language-not-retained',policy:state.corpusFirst.coverage?.availability?.text?.retention||null}:null}),scope:{kind:state.scope.kind,member:query.member,sitting:query.sitting,week:query.week,topic:query.topic,title:state.scope.title,titleLanguage:state.scope.titleLanguage,phase:state.scope.phase},language:query.language,availableAnalysisLanguages:speechWordLanguages,window:{start:state.scope.dates[0]?.start||null,end:state.scope.dates.at(-1)?.end||null,days:query.days},country:query.country,words:analyzeSpeechCloud(records,query.language),speeches:records.map(({text,analysisTitle,...speech})=>speech),coverage:{...calendarEvidence(state.scope),transcripts:records.length,matchedSpeechRecords:state.rawRecords,missingLanguage:state.missingLanguage,missingLanguageAlternatives:alternativeLanguages(state),unreadableText:state.invalidText,complete:state.cursor===null&&!state.truncated&&state.scope.catalogueComplete!==false,truncated:state.truncated,sourceRecords,associationUnavailable:state.scope.kind==='topic'&&!state.scope.dates.length,xmlBytes:state.xmlBytes},nextPage:state.cursor?state.page+1:null,sources:state.sources,computedAt:new Date(this.clock()).toISOString()};
    return state.result;
  }
  corpusSelection(state,query,offset) {
    return {member:query.member,from:state.scope.dates[0].start,to:state.scope.dates.at(-1).end,
      dates:query.member?null:state.scope.dates.map(window=>window.start),sourceIds:state.scope.ids?[...state.scope.ids]:null,
      language:query.language,offset,limit:CLOUD_LIMITS.pageSize,expectedRevision:state.corpusRevision};
  }
  async buildCorpus(state,query,page,limits) {
    const members=new Map(this.store.db.prepare('SELECT id,body FROM members').all().map(row=>[row.id,JSON.parse(row.body)]));
    const metadata=query.country?await this.loadMetadata({members,store:this.store}):new Map();
    requestSignal()?.throwIfAborted();
    while(state.cursor&&state.page<page) {
      const result=state.corpusFirst||await this.readCorpusPage(this.corpusSelection(state,query,state.cursor.offset));
      requestSignal()?.throwIfAborted();
      if(!result)throw new HttpError(503,'corpus_unavailable','Saved speeches are temporarily unavailable. Please retry.');
      if(result.changed)throw new HttpError(409,'corpus_changed','Saved speeches changed during loading. Please retry.');
      state.corpusRevision=result.revision;state.availability=result.coverage?.availability?.text||state.availability||null;state.corpusFirst=null;state.storedTotal=result.total;
      for(const record of result.records) {
        if(state.seen.has(record.id)){state.duplicates++;state.sourceIssues.add('overlapping-pages');continue;}
        state.seen.add(record.id);state.rawRecords++;
        const saved=record.metadata;if(!saved){state.invalidText++;continue;}
        const people=participants(saved.activity);
        if(query.country&&!people.some(id=>memberCountry(id,members,metadata)===query.country))continue;
        for(const source of [{url:saved.sourceUrl,fetchedAt:saved.fetchedAt},...(saved.headerSources||[]),...(record.text?[{url:record.text.sourceUrl,fetchedAt:record.text.fetchedAt,checkedAt:record.text.checkedAt}]:[])])
          state.sources.push({...source,retained:true});
        if(!record.text){missingLanguage(state,record.availableLanguages||[],query.language);continue;}
        const size=Buffer.byteLength(record.text.body);
        if(state.xmlBytes+size>limits.xmlBytes){state.sourceIssues.add('text-byte-limit');state.cursor=null;break;}
        state.xmlBytes+=size;
        if(!record.text.body.trim()){state.invalidText++;continue;}
        const titles=saved.summary.titles||{};
        state.records.set(record.id,{id:record.id,date:saved.summary.date,...displayTitle(titles,query.language,'Speech'),analysisTitle:titles[query.language]||titles.en||'Speech',
          text:record.text.body,machineTranslation:record.text.translationType==='machine',people:people.map(id=>{
            const known=members.get(id)||state.scope.people?.get(id),header=saved.speakers.find(person=>person.id===id);
            return {id,name:known?.name||[known?.firstName,known?.lastName].filter(Boolean).join(' ')||(meaningfulSpeakerName(header?.name)?header.name:null),currentMep:members.has(id),role:header?.role||null,roleLanguage:header?.roleLanguage||null,roleLabels:header?.roleLabels||{},roleSource:header?.roleSource||{speechId:record.id,date:saved.summary.date,url:saved.sourceUrl,fetchedAt:saved.fetchedAt}};
          })});
      }
      state.page++;
      if(result.truncated){state.sourceIssues.add('text-byte-limit');state.cursor=null;}
      if(state.cursor)state.cursor=result.nextOffset===null?null:{date:0,offset:result.nextOffset};
      if(state.page>=limits.pages-1&&state.cursor){state.sourceIssues.add('page-limit');state.cursor=null;}
    }
    const records=[...state.records.values()];state.truncated=state.sourceIssues.size>0;
    state.result={view:'speech-cloud',availability:state.availability||sourceAvailability({sourceKey:'speech-text',family:'speeches',stage:'text',language:query.language,start:state.scope.dates[0]?.start,end:state.scope.dates.at(-1)?.end,limited:true,route:'public-api',observedRecords:records.length,checkedAt:state.sources.map(source=>source.fetchedAt).filter(Boolean).sort().at(-1),retention:state.corpusFirst?.missingRetainedLanguage?{reason:'language-not-retained',policy:state.corpusFirst.coverage?.availability?.text?.retention||null}:null}),scope:{kind:state.scope.kind,member:query.member,sitting:query.sitting,week:query.week,topic:query.topic,title:state.scope.title,titleLanguage:state.scope.titleLanguage,phase:state.scope.phase},
      language:query.language,availableAnalysisLanguages:speechWordLanguages,window:{start:state.scope.dates[0].start,end:state.scope.dates.at(-1).end,days:query.days},country:query.country,
      words:analyzeSpeechCloud(records,query.language),speeches:records.map(({text,analysisTitle,...speech})=>speech),
      coverage:{...calendarEvidence(state.scope),basis:'retained-corpus',transcripts:records.length,matchedSpeechRecords:state.rawRecords,missingLanguage:state.missingLanguage,missingLanguageAlternatives:alternativeLanguages(state),unreadableText:state.invalidText,complete:false,truncated:state.truncated,
        sourceRecords:{unique:state.rawRecords,declared:null,retained:state.storedTotal,duplicates:state.duplicates,issues:[...state.sourceIssues]},associationUnavailable:false,xmlBytes:state.xmlBytes},
      nextPage:state.cursor?state.page+1:null,sources:[...new Map(state.sources.map(source=>[JSON.stringify(source),source])).values()],computedAt:new Date(this.clock()).toISOString()};
    return state.result;
  }
}
