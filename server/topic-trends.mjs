import {HttpError} from './http-utils.mjs';
import {languagePreference} from './language-order.mjs';
import {requestSignal,sharedRequest,waitForRequest} from './request-budget.mjs';
import {insightQuery} from './insights-store.mjs';
import {array,tail} from './activity-index-model.mjs';

export function topicTrendsQuery(search,{now=Date.now()}={}) {
  for(const key of search.keys())if(!['lang','days','end','page','concept'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated timeline query.');
  const page=search.get('page')||'0';if(!/^(0|[1-9]\d?)$/.test(page)||Number(page)>11)throw new HttpError(400,'invalid_page','Invalid timeline page.');
  const concept=search.get('concept');if(concept&&!/^[1-9]\d{0,7}$/.test(concept))throw new HttpError(400,'invalid_topic','Choose an official EuroVoc topic.');
  const query=insightQuery(new URLSearchParams([...search].filter(([key])=>!['page','concept'].includes(key))),{now});return {language:query.language,start:query.start,end:query.end,days:query.days,page:Number(page),concept:concept?'http://eurovoc.europa.eu/'+concept:null};
}
const eventKind=type=>type==='PLENARY_DEBATE'?'debates':type==='PLENARY_VOTE'?'votes':String(type).startsWith('COMMITTEE_')?'committee':null;
// Milestones are read only from exact activity types in the saved record; no
// type means no adoption is recorded there, not that the dossier is still open.
const milestones=[['PUBLICATION_OFFICIAL_JOURNAL','published'],['SIGNATURE','signed'],['PLENARY_ADOPT_POSITION','parliament-position']];
export function procedureStatus(work,asOf) {
  const events=array(work.consists_of);
  for(const [type,state] of milestones){const dates=events.filter(event=>tail(event.had_activity_type)===type).map(event=>event.activity_date).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')&&(!asOf||date<=asOf)).sort();if(dates.length)return {state,date:dates.at(-1)};}
  return {state:'none',date:null};
}
export function procedureTitle(work,language) {
  const titles=work.process_title&&typeof work.process_title==='object'?work.process_title:{},code=languagePreference(Object.keys(titles).filter(code=>typeof titles[code]==='string'&&titles[code].trim()),language)[0];
  return {title:code!==undefined?titles[code].trim():null,titleLanguage:code||null};
}
export function savedProcedureEvents(store,{start,end,language='en'}) {
  const generation=store.status().servingGeneration;
  const rows=store.db.prepare("SELECT key,body,fetched_at FROM sources WHERE generation=? AND kind='procedure' ORDER BY key").all(generation);
  const procedures=[];
  for(const row of rows) {
    const id=row.key.match(/^\/procedures\/(\d{4}-\d{4}[A-Z]?)$/)?.[1];if(!id)continue;
    const work=JSON.parse(row.body);if(tail(work.id)!==id)continue;
    const timestamp=/^\d+(\.\d+)?$/.test(row.fetched_at||'')?Number(row.fetched_at):Date.parse(row.fetched_at);
    const fetchedAt=Number.isFinite(timestamp)?new Date(timestamp).toISOString():null;
    const events=array(work.consists_of).flatMap(event=>{
      const kind=eventKind(tail(event.had_activity_type)),eventId=tail(event.id),date=event.activity_date;
      if(!kind||!/^eli\/dl\/event\/[A-Z0-9-]{1,150}$/.test(String(event.id).replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''))||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||date<start||date>end)return [];
      return [{id:eventId,date,kind,procedureId:id}];
    });
    if(events.length)procedures.push({id,events,fetchedAt,...procedureTitle(work,language),status:procedureStatus(work,fetchedAt?.slice(0,10))});
  }
  return {procedures:procedures.slice(0,600),truncated:procedures.length>600};
}
const monday=date=>{const value=new Date(date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()-(value.getUTCDay()+6)%7);return value.toISOString().slice(0,10);};
export function topicTimeline(procedures,mappings,{start,end,concept}) {
  const weeks=[];for(let date=monday(start);date<=end;date=new Date(Date.parse(date+'T12:00Z')+7*86400_000).toISOString().slice(0,10))weeks.push(date);
  const topics=new Map();
  for(const procedure of procedures) {
    const mapping=mappings.get(procedure.id);if(mapping?.state!=='mapped')continue;
    for(const concept of mapping.concepts) {
      let topic=topics.get(concept.id);if(!topic){topic={...concept,events:new Map(),dossiers:new Set()};topics.set(concept.id,topic);}topic.dossiers.add(procedure.id);
      for(const event of procedure.events){let existing=topic.events.get(event.id);if(!existing){existing={...event,procedures:[]};topic.events.set(event.id,existing);}if(!existing.procedures.some(p=>p.id===procedure.id))existing.procedures.push({id:procedure.id,reference:mapping.reference});}
    }
  }
  const ranked=[...topics.values()].sort((a,b)=>b.events.size-a.events.size||a.label.localeCompare(b.label));
  const displayed=ranked.slice(0,120),requested=topics.get(concept);if(requested&&!displayed.includes(requested))displayed[119]=requested;
  const dateWeeks=new Map(),weekOf=date=>{if(!dateWeeks.has(date))dateWeeks.set(date,monday(date));return dateWeeks.get(date);};
  const shown=displayed.map(topic=>{
    const events=[...topic.events.values()],series=new Map(weeks.map(week=>[week,{week,debates:0,votes:0,committee:0}]));
    for(const event of events){const bin=series.get(weekOf(event.date));if(bin)bin[event.kind]++;}
    const latest=events.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)).slice(0,50).map(event=>({...event,procedures:event.procedures.slice(0,5),additionalProcedures:Math.max(0,event.procedures.length-5)}));
    return {id:topic.id,label:topic.label,language:topic.language,dossiers:topic.dossiers.size,eventCount:topic.events.size,eventsTruncated:topic.events.size>50,series:[...series.values()],events:latest};
  });
  const listed=new Set(shown.flatMap(topic=>topic.events.flatMap(event=>event.procedures.map(p=>p.id))));
  const dossiers=Object.fromEntries(procedures.filter(p=>listed.has(p.id)).map(p=>[p.id,{reference:mappings.get(p.id).reference,title:p.title??null,titleLanguage:p.titleLanguage??null,status:p.status||{state:'none',date:null},fetchedAt:p.fetchedAt??null}]));
  return {weeks,topicLimitReached:ranked.length>120,topics:shown,dossiers};
}
export class TopicTrends {
  constructor(store,catalog,{clock=Date.now}={}){Object.assign(this,{store,catalog,clock});this.states=new Map();}
  async query(query) {
    requestSignal()?.throwIfAborted();
    const {page,...selection}=query,key=JSON.stringify([this.store.status().servingGeneration,selection]);let state=this.states.get(key);
    if(state&&this.clock()-state.at>30*60_000){this.states.delete(key);state=null;}
    if(!state){state={at:this.clock(),...savedProcedureEvents(this.store,selection),page:-1,result:null,pending:null};this.states.set(key,state);while(this.states.size>4)this.states.delete(this.states.keys().next().value);}
    if(state.pending)await waitForRequest(state.pending);if(state.result&&!state.result.coverage.sourceError&&(state.page>=page||state.result.nextPage===null))return state.result;
    const job=sharedRequest(async()=>{
      const ids=state.procedures.map(p=>p.id),known=await this.catalog.known(ids,query.language),missing=ids.filter(id=>!known.has(id)||known.get(id).stale);let sourceError=false;
      if(missing.length)try{for(const [id,mapping] of await this.catalog.load(missing.slice(0,50),query.language))known.set(id,mapping);}catch{sourceError=true;}
      requestSignal()?.throwIfAborted();
      if(!sourceError)state.page++;
      const remaining=ids.filter(id=>!known.has(id)||known.get(id).stale).length,mapped=[...known.values()].filter(value=>value.state==='mapped').length;
      const timeline=topicTimeline(state.procedures,known,query);
      state.result={view:'topic-trends',language:query.language,window:{start:query.start,end:query.end,days:query.days},...timeline,coverage:{procedures:ids.length,mapped,unmapped:[...known.values()].filter(v=>v.state!=='mapped').length,pending:remaining,sourceError,truncated:state.truncated,indexComplete:this.store.status().complete},savedSources:state.procedures.map(p=>({id:p.id,fetchedAt:p.fetchedAt})),nextPage:remaining&&!sourceError&&state.page<11?state.page+1:null,sources:[...new Map([...known.values()].filter(v=>v.source).map(v=>[v.source.url,v.source])).values()],computedAt:new Date(this.clock()).toISOString()};return state.result;
    }).finally(()=>state.pending=null);state.pending=job;return waitForRequest(job);
  }
}
