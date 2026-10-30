import {HttpError} from './http-utils.mjs';
import {odp,odpLanguage} from './odp.mjs';
import {MeetingsReader} from './meetings-reader.mjs';
import {agendaTopics} from './insights-legislation-model.mjs';
import {suppliedTitles,canonical} from './insights-model.mjs';
import {languagePreference} from './language-order.mjs';
import {requestSignal} from './request-budget.mjs';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {comparable,exactReference} from './vote-evidence.mjs';
import {indexAvailability} from './availability-evidence.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {periodAvailability} from './source-availability.mjs';

export const PARLIAMENT_SEARCH_VERSION=5;
const types=['mep','topic','question'];
const fold=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase();
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function parliamentSearchQuery(params) {
  for(const key of params.keys())if(!['q','type','lang','offset','from','to'].includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated search parameter.');
  const query=params.get('q')?.trim(),type=params.get('type')||'all',raw=params.get('offset')||'0',offset=Number(raw),from=params.get('from'),to=params.get('to');
  if(!query||query.length>200||/[\u0000-\u001f\u007f]/u.test(query))throw new HttpError(400,'invalid_query','Enter up to 200 characters.');
  if(!['all',...types].includes(type)||!/^\d+$/.test(raw)||!Number.isSafeInteger(offset)||offset>1000)throw new HttpError(400,'invalid_query','Choose a result type and page.');
  if(from&&!date(from)||to&&!date(to)||from&&to&&from>to)throw new HttpError(400,'invalid_date','Choose a valid date range.');
  const terms=[...query.matchAll(/"([^"]+)"|“([^”]+)”|(\S+)/gu)].map(m=>fold(m[1]||m[2]||m[3]));
  if(!terms.length)throw new HttpError(400,'invalid_query','Enter a search term.');
  return {query,terms,type,offset,from,to,language:odpLanguage(params.get('lang')||'en')};
}
const cachedRequest=(endpoint,params,options)=>odp(endpoint,params,{...options,cachedOnly:true});

// Search existing public observations. This reader neither starts collection nor
// writes another index; missing retained calendars/agendas remain coverage gaps.
export class ParliamentSearch {
  constructor(store,{request=cachedRequest,clock=Date.now}={}){this.store=store;this.request=request;this.clock=clock;this.meetings=new MeetingsReader({request,clock});}
  async query(query) {
    const status=this.store.status(),generation=status.servingGeneration;
    if(!generation)throw new HttpError(503,'search_unavailable','Search unavailable.');
    const selected=types.filter(type=>query.type==='all'||query.type===type),matches=new Map(selected.map(type=>[type,[]]));
    const totals=new Map(selected.map(type=>[type,0]));
    const compare=type=>(a,b)=>type==='mep'?a.title.localeCompare(b.title,query.language)||a.id.localeCompare(b.id):(b.date||'').localeCompare(a.date||'')||a.id.localeCompare(b.id);
    const add=result=>{const rows=matches.get(result.type);totals.set(result.type,totals.get(result.type)+1);rows.push(result);if(rows.length>2020){rows.sort(compare(result.type));rows.length=1010;}};
    const coverage=Object.fromEntries(selected.map(type=>[type,{complete:false,available:true,limited:false}]));
    const inPeriod=value=>(!query.from||value&&value>=query.from)&&(!query.to||value&&value<=query.to);
    const match=values=>values.some(value=>{const folded=fold(value);return query.terms.every(term=>folded.includes(term));});
    const title=(titles,fallback)=>{const language=languagePreference(Object.keys(titles).filter(key=>typeof titles[key]==='string'&&titles[key].trim()),query.language)[0];return {title:language?titles[language]:fallback,titleLanguage:language||null};};
    if(matches.has('mep')) {
      for(const row of this.store.db.prepare('SELECT id,body FROM members ORDER BY id').all()) {
        const member=JSON.parse(row.body),name=member.name||[member.firstName,member.lastName].filter(Boolean).join(' ');
        if(match([row.id,name,...(member.nameVariants||[]).map(variant=>variant.value)]))add({id:row.id,type:'mep',title:name||'MEP',titleLanguage:null,date:null,sourceUrl:'https://www.europarl.europa.eu/meps/en/'+row.id,source:{url:'https://data.europarl.europa.eu/api/v2/meps/show-current',fetchedAt:status.rosterFetchedAt||null}});
      }
      coverage.mep.complete=Boolean(status.currentMeps);
    }
    if(matches.has('question')) {
      const rows=this.store.db.prepare(`SELECT key,json_extract(body,'$.identifier') id,json_extract(body,'$.document_date') date,
        json_extract(body,'$.title_dcterms') titles,(SELECT json_group_array(json_extract(expression.value,'$.title')) FROM json_each(sources.body,'$.is_realized_by') expression) expression_titles,fetched_at
        FROM sources INDEXED BY question_window WHERE generation=? AND kind='document' AND (json_extract(body,'$.work_type') LIKE '%/QUESTION_WRITTEN' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_WRITTEN_PRIORITY' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_ORAL') ORDER BY json_extract(body,'$.document_date') DESC,key LIMIT 50001`).iterate(generation);
      const seen=new Set();let scanned=0,latestObservedDate=null;
      for(const row of rows) {
        if(scanned++===50000){coverage.question.limited=true;break;}
        if(scanned%250===0){await yieldTurn();requestSignal()?.throwIfAborted();}
        const id=row.id||row.key.split('/').at(-1);
        if(!/^[EOP]-10-\d{4}-\d{6}$/.test(id)||seen.has(id)||!inPeriod(row.date))continue;
        seen.add(id);
        if(row.date&&(!latestObservedDate||row.date>latestObservedDate))latestObservedDate=row.date;
        const titles=suppliedTitles({title_dcterms:JSON.parse(row.titles||'{}'),is_realized_by:JSON.parse(row.expression_titles||'[]').map(title=>({title}))});
        if(match([id,...Object.values(titles)]))add({id,type:'question',...title(titles,id),date:row.date,sourceUrl:`https://www.europarl.europa.eu/doceo/document/${id}_${query.language.toUpperCase()}.html`,source:{url:'https://data.europarl.europa.eu/api/v2'+row.key,fetchedAt:row.fetched_at}});
      }
      coverage.question.availability=indexAvailability(this.store,{sourceKey:'questions',family:'questions',generation,start:query.from||'2024-07-16',end:query.to||brusselsDay(this.clock()),latestObservedDate,limited:coverage.question.limited});
      // Completeness must also support an empty lookup; positive matches do
      // not close another known read failure in the same requested interval.
      coverage.question.complete=periodAvailability({start:query.from||'2024-07-16',end:query.to||brusselsDay(this.clock())},coverage.question.availability,0,{today:brusselsDay(this.clock())}).state==='observed';
    }
    if(matches.has('topic')) {
      const catalogue=await this.meetings.catalogue(),sittings=catalogue.nodes.slice(0,500);
      coverage.topic.available=catalogue.coverage.status!=='unavailable';
      coverage.topic.limited=catalogue.nodes.length>sittings.length;
      coverage.topic.catalogue=catalogue.coverage;
      const years=(catalogue.coverage.years||[]).filter(row=>(!query.from||row.year>=Number(query.from.slice(0,4)))&&(!query.to||row.year<=Number(query.to.slice(0,4))));
      coverage.topic.incompleteCalendarYears=years.filter(row=>row.state!=='complete').map(row=>row.year);
      const calendarComplete=catalogue.coverage.status==='complete'||years.length>0&&!coverage.topic.incompleteCalendarYears.length;
      coverage.topic.agendasRead=0;
      coverage.topic.missingAgendas=0;
      coverage.topic.pageLimitedAgendas=0;
      coverage.topic.missingAgendaPages=[];
      coverage.topic.conflicts=[];
      const seen=new Set();
      for(const sitting of sittings) {
        requestSignal()?.throwIfAborted();
        if(!inPeriod(sitting.activity_date))continue;
        const sources=[],observations=new Map(),conflicts=new Set();
        for(let page=0;page<2;page++) {
          try {
            const record=await this.request('/meetings/'+sitting.activity_id+'/foreseen-activities',{limit:50,offset:page*50});sources.push(record);
            for(const node of record.payload.data) {
              const uri=exactReference(node);if(!uri){coverage.topic.error=true;continue;}
              const key=canonical(uri),previous=observations.get(key);
              if(!previous)observations.set(key,{node,source:record});
              else if(JSON.stringify(comparable(previous.node))!==JSON.stringify(comparable(node))) {
                conflicts.add(key);
                coverage.topic.conflicts.push({id:key,sittingId:sitting.activity_id,sources:[previous.source,record].map(source=>({url:source.url,fetchedAt:new Date(source.fetchedAt).toISOString()}))});
              }
            }
            if(record.payload.data.length<50)break;
            if(page===1){coverage.topic.pageLimitedAgendas++;coverage.topic.limited=true;}
          }
          catch(error){requestSignal()?.throwIfAborted();if(page>0)coverage.topic.missingAgendaPages.push({sittingId:sitting.activity_id,offset:page*50});if(error.code!=='odp_cache_miss')coverage.topic.error=true;break;}
        }
        if(!sources.length){coverage.topic.missingAgendas++;continue;}
        coverage.topic.agendasRead++;
        const nodes=[...observations].filter(([key])=>!conflicts.has(key)).map(([,observation])=>observation.node);
        const first=sources[0],topics=agendaTopics({payload:{data:[sitting]}},{...first,payload:{data:nodes}});
        for(const item of topics) {
          if(seen.has(item.id))continue;seen.add(item.id);
          const source=observations.get(item.uri).source;
          if(match([item.id,...Object.values(item.titles)]))add({id:item.id,type:'topic',...title(item.titles,item.id),date:item.date||sitting.activity_date,sittingId:sitting.activity_id,source:{url:source.url,fetchedAt:new Date(source.fetchedAt).toISOString(),stale:source.stale===true}});
        }
      }
      if(coverage.topic.missingAgendas&&!coverage.topic.agendasRead)coverage.topic.available=false;
      coverage.topic.complete=calendarComplete&&!coverage.topic.missingAgendas&&!coverage.topic.missingAgendaPages.length&&!coverage.topic.limited&&!coverage.topic.error&&!coverage.topic.conflicts.length;
    }
    const sections=selected.map(type=>{
      const rows=matches.get(type).sort(compare(type)),total=totals.get(type);
      const next=query.offset+10;
      return {type,total,results:rows.slice(query.offset,next),nextOffset:next<total&&next<=1000?next:null,truncated:total>1010,coverage:coverage[type]};
    });
    if(this.store.status().servingGeneration!==generation)throw new HttpError(409,'generation_changed','Search changed. Try again.');
    return {version:PARLIAMENT_SEARCH_VERSION,query:query.query,offset:query.offset,sections};
  }
}
