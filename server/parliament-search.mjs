import {sittingSnapshots} from './sitting-snapshot-store.mjs';
import {fastReadsReady} from './fast-read-projections.mjs';
import {questionCoverageRecords} from './insights-store.mjs';
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
import {searchReference} from './search-reference.mjs';

export const PARLIAMENT_SEARCH_VERSION=9;
const types=['mep','topic','question'];
const fold=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase();
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function parliamentSearchQuery(params) {
  for(const key of params.keys())if(!['q','type','lang','offset','from','to'].includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated search parameter.');
  const query=params.get('q')?.trim(),type=params.get('type')||'all',raw=params.get('offset')||'0',offset=Number(raw),from=params.get('from'),to=params.get('to');
  if(!query||query.length>200||/[\u0000-\u001f\u007f]/u.test(query))throw new HttpError(400,'invalid_query','Enter up to 200 characters.');
  if(!['all',...types,'reference'].includes(type)||!/^\d+$/.test(raw)||!Number.isSafeInteger(offset)||offset>1000)throw new HttpError(400,'invalid_query','Choose a result type and page.');
  if(from&&!date(from)||to&&!date(to)||from&&to&&from>to)throw new HttpError(400,'invalid_date','Choose a valid date range.');
  const terms=[...query.matchAll(/"([^"]+)"|“([^”]+)”|(\S+)/gu)].map(m=>fold(m[1]||m[2]||m[3]));
  if(!terms.length)throw new HttpError(400,'invalid_query','Enter a search term.');
  return {query,terms,type,offset,from,to,language:odpLanguage(params.get('lang')||'en')};
}
export const cachedAgendaRequest=(endpoint,params,options)=>{
  const id=endpoint.match(/^\/meetings\/(MTG-PL-\d{4}-\d{2}-\d{2})\/foreseen-activities$/)?.[1];
  const page=id&&sittingSnapshots.read('agenda',1,id)?.pages.find(page=>Number(new URL(page.url).searchParams.get('offset'))===Number(params.offset||0));
  return page?Promise.resolve({...page,fetchedAt:Date.parse(page.fetchedAt)}):odp(endpoint,params,{...options,cachedOnly:true});
};

// Search existing public observations. This reader neither starts collection nor
// writes another index; missing retained calendars/agendas remain coverage gaps.
export class ParliamentSearch {
  constructor(store,{request=cachedAgendaRequest,clock=Date.now}={}){this.store=store;this.request=request;this.clock=clock;this.meetings=new MeetingsReader({request,clock,snapshots:request===cachedAgendaRequest?sittingSnapshots:null});}
  // A pasted reference is looked up by its exact keys; nothing is scanned.
  reference(query,generation) {
    const parsed=searchReference(query.query);
    if(!parsed)return null;
    const db=this.store.db,body=key=>{const row=db.prepare('SELECT body,fetched_at FROM sources WHERE generation=? AND key=?').get(generation,key);return row?{...JSON.parse(row.body),fetchedAt:row.fetched_at}:null;};
    const pick=titles=>{const language=languagePreference(Object.keys(titles||{}).filter(key=>typeof titles[key]==='string'&&titles[key].trim()),query.language)[0];return language?{title:titles[language],titleLanguage:language}:{title:null,titleLanguage:null};};
    const dossier=process=>{const row=body('/procedures/'+process);return row?.label?{reference:row.label,...pick(row.process_title)}:null;};
    const rows=(sql,...args)=>{try{return db.prepare(sql).all(...args);}catch(error){if(/no such table/.test(error.message))return [];throw error;}};
    const section=(results,extra={})=>({type:'reference',total:results.length,results,nextOffset:null,truncated:false,coverage:{complete:true,available:true,limited:false},input:parsed.kind,...extra});
    const missing=extra=>section([],{held:false,...extra});
    if(parsed.kind==='dossier') {
      const found=dossier(parsed.process);
      return found&&(!parsed.type||found.reference.endsWith('('+parsed.type+')'))?section([{id:found.reference,type:'reference',kind:'dossier',reference:found.reference,title:found.title,titleLanguage:found.titleLanguage,date:null,dossier:found.reference}]):missing();
    }
    if(parsed.kind==='commission')return section([],{held:null,lookup:{key:parsed.key,reference:parsed.label}});
    if(parsed.kind==='member') {
      const row=db.prepare('SELECT body FROM members WHERE id=?').get(parsed.id);
      if(!row)return parsed.explicit?missing():null;
      const member=JSON.parse(row.body);
      return section([{id:parsed.id,type:'reference',kind:'member',reference:parsed.id,title:member.name||[member.firstName,member.lastName].filter(Boolean).join(' ')||'MEP',titleLanguage:null,date:null,member:parsed.id}]);
    }
    const documents=parsed.keys.map(key=>[key,body(key)]).filter(([,row])=>row);
    if(!documents.length)return missing();
    const source=documents.find(([key])=>!key.startsWith('committee:'))?.[1];
    const processes=new Set();
    for(const [key,row] of documents) {
      if(key.startsWith('committee:'))for(const id of row.procedureIds||[])processes.add(id);
      else {
        for(const {procedure} of rows('SELECT procedure FROM dossier_documents WHERE generation=? AND source_key=?',generation,key))processes.add(procedure);
        for(const {procedure_id} of rows('SELECT procedure_id FROM committee_document_procedures WHERE generation=? AND source_key=?',generation,key))processes.add(procedure_id.replace(/^eli\/dl\/proc\//,''));
      }
    }
    const dossiers=[...processes].filter(id=>/^\d{4}-\d{4}[A-Z]?$/.test(id)).map(dossier).filter(Boolean);
    const linked=new Set(dossiers.map(found=>found.reference)).size===1?dossiers[0].reference:null;
    const titled=source?pick(source.title_dcterms):{title:null,titleLanguage:null};
    return section([{id:parsed.id,type:'reference',kind:/^A-/.test(parsed.id)?'report':'document',reference:source?.label||parsed.id,...titled,date:source?.document_date||null,dossier:linked}]);
  }
  async query(query) {
    const status=this.store.status(),generation=status.servingGeneration;
    if(!generation)throw new HttpError(503,'search_unavailable','Search unavailable.');
    const selected=types.filter(type=>query.type==='all'||query.type===type),matches=new Map(selected.map(type=>[type,[]]));
    const totals=new Map(selected.map(type=>[type,0]));
    const exactName=new Set();
    const compare=type=>(a,b)=>type==='mep'?exactName.has(b.id)-exactName.has(a.id)||a.title.localeCompare(b.title,query.language)||a.id.localeCompare(b.id):(b.date||'').localeCompare(a.date||'')||a.id.localeCompare(b.id);
    const add=result=>{const rows=matches.get(result.type);totals.set(result.type,totals.get(result.type)+1);rows.push(result);if(rows.length>2020){rows.sort(compare(result.type));rows.length=1010;}};
    const coverage=Object.fromEntries(selected.map(type=>[type,{complete:false,available:true,limited:false}]));
    const inPeriod=value=>(!query.from||value&&value>=query.from)&&(!query.to||value&&value<=query.to);
    const match=values=>values.some(value=>{const folded=fold(value);return query.terms.every(term=>folded.includes(term));});
    const title=(titles,fallback)=>{const language=languagePreference(Object.keys(titles).filter(key=>typeof titles[key]==='string'&&titles[key].trim()),query.language)[0];return {title:language?titles[language]:fallback,titleLanguage:language||null};};
    if(matches.has('mep')) {
      for(const row of this.store.db.prepare('SELECT id,body FROM members ORDER BY id').all()) {
        const member=JSON.parse(row.body),name=member.name||[member.firstName,member.lastName].filter(Boolean).join(' ');
        const names=[name,...(member.nameVariants||[]).map(variant=>variant.value)];
        if(match([row.id,...names])) {
          if(names.some(value=>value&&fold(value).split(/\s+/).join(' ')===query.terms.join(' ')))exactName.add(row.id);
          add({id:row.id,type:'mep',title:name||'MEP',titleLanguage:null,date:null,sourceUrl:'https://www.europarl.europa.eu/meps/en/'+row.id,source:{url:'https://data.europarl.europa.eu/api/v2/meps/show-current',fetchedAt:status.rosterFetchedAt||null}});
        }
      }
      coverage.mep.complete=Boolean(status.currentMeps);
    }
    if(matches.has('question')) {
      const projected=fastReadsReady(this.store,generation);
      const table=projected?'question_reads':'sources';
      const indexedTerms=(projected?query.terms:[]).filter(term=>[...term].length>=3);
      const titleMatch=indexedTerms.map(term=>'"'+term.replaceAll('"','""')+'"').join(' AND ');
      const args=[generation,...(titleMatch?[titleMatch]:[])];
      const rows=this.store.db.prepare(`SELECT key,json_extract(body,'$.identifier') id,json_extract(body,'$.document_date') date,
        json_extract(body,'$.title_dcterms') titles,(SELECT json_group_array(json_extract(expression.value,'$.title')) FROM json_each(${table}.body,'$.is_realized_by') expression) expression_titles,fetched_at
        FROM ${table} ${projected&&!titleMatch?'INDEXED BY read_question_window':''} WHERE generation=? ${titleMatch?'AND rowid IN (SELECT rowid FROM question_title_search WHERE question_title_search MATCH ?)':''} AND kind='document' AND (json_extract(body,'$.work_type') LIKE '%/QUESTION_WRITTEN' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_WRITTEN_PRIORITY' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_ORAL') ORDER BY json_extract(body,'$.document_date') DESC,key LIMIT 50001`).iterate(...args);
      const seen=new Set();let scanned=0,latestObservedDate=null;
      for(const row of rows) {
        if(scanned++===50000){coverage.question.limited=!(query.from||query.to)||Boolean(row.date&&(!query.from||row.date>=query.from));break;}
        if(scanned%250===0){await yieldTurn();requestSignal()?.throwIfAborted();}
        const id=row.id||row.key.split('/').at(-1);
        if(!/^[EOP]-10-\d{4}-\d{6}$/.test(id)||seen.has(id)||!inPeriod(row.date))continue;
        seen.add(id);
        if(row.date&&(!latestObservedDate||row.date>latestObservedDate))latestObservedDate=row.date;
        const titles=suppliedTitles({title_dcterms:JSON.parse(row.titles||'{}'),is_realized_by:JSON.parse(row.expression_titles||'[]').map(title=>({title}))});
        if(match([id,...Object.values(titles)]))add({id,type:'question',...title(titles,id),date:row.date,sourceUrl:`https://www.europarl.europa.eu/doceo/document/${id}_${query.language.toUpperCase()}.html`,source:{url:'https://data.europarl.europa.eu/api/v2'+row.key,fetchedAt:row.fetched_at}});
      }
      const frontierRecords=questionCoverageRecords(this.store,generation);
      coverage.question.availability=indexAvailability(this.store,{sourceKey:'questions',family:'questions',generation,start:query.from||'2024-07-16',end:query.to||brusselsDay(this.clock()),records:frontierRecords,limited:coverage.question.limited});
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
    const reference=['all','reference'].includes(query.type)?this.reference(query,generation):null;
    const sections=[...(reference?[reference]:[]),...selected.map(type=>{
      const rows=matches.get(type).sort(compare(type)),total=totals.get(type);
      const next=query.offset+10;
      return {type,total,results:rows.slice(query.offset,next),nextOffset:next<total&&next<=1000?next:null,truncated:total>1010,coverage:coverage[type]};
    })];
    if(this.store.status().servingGeneration!==generation)throw new HttpError(409,'generation_changed','Search changed. Try again.');
    return {version:PARLIAMENT_SEARCH_VERSION,query:query.query,offset:query.offset,sections};
  }
}
