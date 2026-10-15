import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { stat } from 'node:fs/promises';
import { ODP_BASE, boundedUpstream, backoffUpstream } from './odp.mjs';
import { ActivityStore } from './activity-index-store.mjs';
import { array, tail, projectDocument, projectProcedure, documentRows, procedureIds, speechRows, CATEGORIES } from './activity-index-model.mjs';
import { HttpError } from './http-utils.mjs';

const DAY = 24*60*60_000;
const day = t => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const hour = t => Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',hour:'2-digit',hourCycle:'h23'}).format(new Date(t)));
const safeId = id => /^[A-Z0-9-]{1,100}$/.test(id);
export function speechWindows(until) {
  const windows=[];
  for(let year=2024,month=6;year*12+month<=Number(until.slice(0,4))*12+Number(until.slice(5,7))-1;month++) {
    if(month===12){year++;month=0;}
    const start=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
    if(start>until)break;
    const end=new Date(Date.UTC(year,month+1,0)).toISOString().slice(0,10);
    windows.push({start,end:end>until?until:end});
  }
  return windows;
}
const collections = year => [
  ...Array.from({length:year-2024+1},(_,i)=>year-i).flatMap(y => [
    ...['REPORT_PLENARY','RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT'].map(type=>({endpoint:'/plenary-documents',params:{year:y,'work-type':type}})),
    ...['QUESTION_WRITTEN','QUESTION_WRITTEN_PRIORITY','QUESTION_ORAL'].map(type=>({endpoint:'/parliamentary-questions',params:{year:y,'work-type':type}})),
  ]),
  ...['OPINION_PARLIAMENTARY_COMMITTEE','OPINION_LETTER_PARLIAMENTARY_COMMITTEE'].map(type=>({endpoint:'/committee-documents',params:{'parliamentary-term':10,'work-type':type}})),
];
export function feedDocuments(xml,endpoint) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true) throw new Error('Invalid document update feed XML.');
  const root=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,processEntities:false}).parse(xml);
  if (!root.feed) throw new Error('Expected an Atom update feed.');
  const entries=array(root.feed.entry);
  const result=entries.flatMap(e=> {
    const url=String(e.id || '');
    const match=endpoint==='/procedures' ? url.match(/^https:\/\/data\.europarl\.europa\.eu\/eli\/dl\/proc\/(\d{4}-\d{4}[A-Z]?)$/) : url.match(/^https:\/\/data\.europarl\.europa\.eu\/eli\/dl\/doc\/([A-Z0-9-]{1,100})$/);
    return match ? [{id:match[1],updated:e.updated || null}] : [];
  });
  if(entries.length && !result.length)throw new Error('Update feed entries contain no recognised API identifiers.');
  return result;
}
export async function apiFetch(endpoint,params={}, {xml=false,signal}={}) {
  const url=new URL(ODP_BASE+endpoint);
  for (const [key,value] of Object.entries({...params,...(!xml?{format:'application/ld+json'}:{})})) url.searchParams.set(key,String(value));
  return boundedUpstream(async()=> {
    const response=await fetch(url,{headers:{Accept:xml?'application/atom+xml':'application/ld+json','User-Agent':'MEP-Wall-dev-1.0 (joined activity index)'},redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(45_000),...(signal?[signal]:[])])});
    if (response.status===204) return xml ? {xml:'<feed/>',fetchedAt:new Date().toISOString()} : {payload:{data:[]},fetchedAt:new Date().toISOString()};
    if (!response.ok) { await response.body?.cancel();const e=new Error(`EP API returned ${response.status} at ${endpoint}.`);e.retryAfter=Math.min(30*60,Math.max(0,Number(response.headers.get('retry-after')) || 0));if(response.status===429||response.status===503){e.retryAfter=Math.max(30,e.retryAfter);backoffUpstream(e.retryAfter);}throw e; }
    const contentType=response.headers.get('content-type') || '';
    if (!(xml?/xml/.test(contentType):/json/.test(contentType))) {await response.body?.cancel();throw new Error(`EP API returned unexpected ${contentType || 'missing content type'} at ${endpoint}.`);}
    const chunks=[];let bytes=0;
    for await (const chunk of response.body) {bytes+=chunk.length;if(bytes>12*1024*1024){await response.body.cancel().catch(()=>{});throw new Error('EP API response exceeded 12 MiB.');}chunks.push(chunk);}
    const text=Buffer.concat(chunks).toString('utf8');
    if (xml) return {xml:text,fetchedAt:new Date().toISOString()};
    const payload=JSON.parse(text);if(!Array.isArray(payload.data))throw new Error('EP API returned an invalid data array.');
    return {payload,fetchedAt:new Date().toISOString()};
  },{priority:'background'});
}
export class ActivityWorker {
  constructor(store,{fetchRecord=apiFetch,clock=Date.now,budget=1000,maxDuration=90*60_000,diskLimit=1024*1024*1024}={}) {
    this.store=store;this.fetchRecord=fetchRecord;this.clock=clock;this.budget=budget;this.maxDuration=maxDuration;this.diskLimit=diskLimit;
    this.running=false;this.stopped=false;this.controller=new AbortController();this.requests=0;
  }
  due() { const s=this.store.status();return Boolean(this.store.get('working') || !s.complete || day(Date.parse(s.lastSuccessfulRefresh))!==day(this.clock()) && hour(this.clock())>=3); }
  async request(endpoint,params={},opts={}) {
    this.store.assertWriter();this.requests++;
    const cycle=this.store.get('working');if(cycle)this.store.updateCycle({requests:(cycle.requests||0)+1});
    return this.fetchRecord(endpoint,params,{...opts,signal:this.controller.signal});
  }
  async initialize(cycle) {
    const {generation}=cycle;
    // A catalog task carries its own durable page cursor. No MEP-specific document loop.
    for (const collection of collections(new Date(this.clock()).getUTCFullYear())) this.store.enqueue(generation,'catalog:'+collection.endpoint+':'+JSON.stringify(collection.params),'catalog',{...collection,offset:0},100);
    const last=this.store.get('lastSuccess'), age=last?this.clock()-Date.parse(last):Infinity;
    const allSpeeches=cycle.initial || age>6*DAY || new Date(this.clock()).getUTCDay()===0;
    const base={'parliamentary-term':10,'activity-type':'PLENARY_DEBATE_SPEECH,PLENARY_DEBATE_WRITTEN_STATEMENT','sort-by':'sitting-date:desc,numbering:desc'};
    const windows=allSpeeches?speechWindows(day(this.clock())):[{start:day(this.clock()-7*DAY),end:day(this.clock())}];
    for(const range of windows)this.store.enqueue(generation,'catalog:/speeches:'+range.start+':'+range.end,'speeches',{endpoint:'/speeches',params:{...base,'sitting-date':range.start,'sitting-date-end':range.end},offset:0},100);
    this.store.enqueue(generation,'roster','roster',{offset:0,nodes:[]},110);
    if(!cycle.initial && age<=6*DAY) for(const endpoint of ['/plenary-documents','/committee-documents','/parliamentary-questions','/procedures']) this.store.enqueue(generation,'feed:'+endpoint,'feed',{endpoint},105);
    this.store.updateCycle({initialized:true,fullRefresh:cycle.initial || age>6*DAY});
  }
  async task(task) {
    const {generation,body}=task;
    if(task.kind==='roster') {
      const r=await this.request('/meps/show-current',{limit:1000,offset:body.offset});
      const nodes=r.payload.data.flatMap(p=>{const id=String(p.identifier || tail(p.id));return /^[1-9]\d*$/.test(id)?[{id,name:p.label || [p.givenName,p.familyName].filter(Boolean).join(' ')}]:[];});
      if(nodes.length) {
        const prior=new Set(body.nodes.map(n=>n.id));if(nodes.some(n=>prior.has(n.id)))throw new Error('EP roster pagination repeated a member.');
        this.store.taskProgress(task,{nodes:[...body.nodes,...nodes],offset:body.offset+r.payload.data.length});
      } else {if(!body.nodes.length)throw new Error('Current MEP roster was empty.');this.store.setMembers(body.nodes);this.store.finishTask(task);}
    } else if(task.kind==='catalog') {
      const r=await this.request(body.endpoint,{...body.params,limit:250,offset:body.offset});
      const nodes=r.payload.data;
      if(!nodes.length){this.store.finishTask(task);return;}
      const signatures=nodes.map(w=>w.identifier || tail(w.id)).join('|');
      if(signatures===body.lastPage)throw new Error('EP document pagination repeated a page.');
      for(const w of nodes){const id=w.identifier || tail(w.id);if(!safeId(id))throw new Error('EP document identifier was invalid.');
        if(body.endpoint!='/committee-documents' && !/^[A-Z]+-10-/.test(id))continue;
        const endpoint=body.endpoint+'/'+id, old=this.store.source(generation,endpoint);
        this.store.markSeen(generation,endpoint);
        if(!old || this.store.get('working').fullRefresh && !body.deltaOnly)this.store.enqueue(generation,endpoint,'document',{endpoint},101);
      }
      this.store.taskProgress(task,{...body,offset:body.offset+nodes.length,lastPage:signatures});
    } else if(task.kind==='speeches' && body.recoveryId) {
      if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(body.recoveryId))throw new Error('Invalid speech recovery identifier.');
      const r=await this.request('/speeches/'+body.recoveryId);
      const activity=r.payload.data.find(node=>node.activity_id===body.recoveryId);
      if(!activity)throw new Error(`Published speech ${body.recoveryId} has no matching detail record.`);
      this.store.putSource(generation,'/speeches/'+body.recoveryId,'speech',{id:body.recoveryId},r.fetchedAt,speechRows(activity,r.fetchedAt));
      this.store.finishTask(task);
    } else if(task.kind==='speeches') {
      const r=await this.request('/speeches',{...body.params,limit:250,offset:body.offset});
      // The search total saturates at 10,000. Partition the date window before
      // paging so a full term cannot be mistaken for a truncated search result.
      if(body.offset===0 && Number(r.payload.meta?.total)>=10000) {
        const start=Date.parse(body.params['sitting-date']),end=Date.parse(body.params['sitting-date-end']);
        if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw new Error('Speech search exceeds its result window in a single sitting day.');
        const middle=start+Math.floor((end-start)/DAY/2)*DAY;
        for(const [a,b] of [[start,middle],[middle+DAY,end]]) {
          const params={...body.params,'sitting-date':new Date(a).toISOString().slice(0,10),'sitting-date-end':new Date(b).toISOString().slice(0,10)};
          this.store.enqueue(generation,'catalog:/speeches:'+params['sitting-date']+':'+params['sitting-date-end'],'speeches',{endpoint:'/speeches',params,offset:0},100);
        }
        this.store.finishTask(task);return;
      }
      const hits=r.payload.searchResults?.hits;
      const graph=new Map(r.payload.data.map(node=>[node.id,node]));
      const matched=hits ? hits.map(hit=>({hit,node:graph.get(hit.id)})) : r.payload.data.filter(node=>node.activity_id).map(node=>({hit:{id:node.id},node}));
      const missing=matched.filter(({node})=>!node?.activity_id);
      // EP can return 250 search references but only 249 graph nodes. Preserve
      // every missing reference as a durable detail retry; never drop it or
      // block the 249 available records behind the same failing list page.
      for(const {hit} of missing) {
        const id=tail(hit.id);
        if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(id))throw new Error('Speech search hit has an invalid recovery identifier.');
        const sitting=id.slice(7,17);
        this.store.enqueue(generation,'recovery:/speeches/'+id,'speeches',{
          recoveryId:id,detectedAt:r.fetchedAt,searchHit:hit.id,searchWindow:{start:body.params['sitting-date'],end:body.params['sitting-date-end'],offset:body.offset},
          // Keep the existing task kind and a valid day window for safe old-image
          // rollback: old code continues strict list validation, never marks an
          // unavailable reference as a completed document.
          params:{...body.params,'sitting-date':sitting,'sitting-date-end':sitting},offset:0,
        },103);
      }
      const nodes=matched.filter(({node})=>node?.activity_id).map(({node})=>node);
      const hitCount=hits?.length ?? nodes.length;
      if(!hitCount){this.store.finishTask(task);return;}
      const signatures=(hits ? hits.map(hit=>hit.id) : nodes.map(a=>a.activity_id)).sort().join('|');
      if(signatures===body.lastPage)throw new Error('EP speech pagination repeated a page.');
      for(const activity of nodes){if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(activity.activity_id))throw new Error('EP speech identifier was invalid.');
        const rows=speechRows(activity,r.fetchedAt);this.store.putSource(generation,'/speeches/'+activity.activity_id,'speech',{id:activity.activity_id},r.fetchedAt,rows);}
      this.store.taskProgress(task,{...body,offset:body.offset+hitCount,lastPage:signatures});
    } else if(task.kind==='feed') {
      const r=await this.request(body.endpoint+'/feed',body.endpoint==='/procedures'?{timeframe:'one-week'}:{},{xml:true});
      const entries=feedDocuments(r.xml,body.endpoint);
      for(const e of entries){
        const endpoint=body.endpoint+'/'+e.id;
        if(body.endpoint==='/procedures') {
          if(this.store.source(generation,endpoint))this.store.enqueue(generation,endpoint,'procedure',{endpoint},103,true);
        } else if (body.endpoint==='/committee-documents' || /^[A-Z]+-10-/.test(e.id)) {
          // Answer feed IDs resolve through their parent question, never a guessed standalone answer endpoint.
          const resolved=endpoint.replace(/-ASW$/,'');
          // New records will be discovered by the selected-type catalogs. Feeds
          // refresh known records without importing unrelated amendments/drafts.
          if(this.store.source(generation,resolved))this.store.enqueue(generation,resolved,'document',{endpoint:resolved},85,true);
        }
      }
      this.store.finishTask(task);
    } else if(task.kind==='document') {
      const r=await this.request(body.endpoint);const work=r.payload.data.find(w=>w.type==='Work') || r.payload.data[0];
      if(!work)throw new Error('EP document detail was empty.');
      const projected=projectDocument(work), proc=new Map();
      for(const id of procedureIds(work)) {
        const endpoint='/procedures/'+id, existing=this.store.source(generation,endpoint);
        if(existing)proc.set(id,existing);
        if(tail(work.work_type)==='REPORT_PLENARY')this.store.enqueue(generation,endpoint,'procedure',{endpoint},103,true);
      }
      const {rows}=documentRows(projected,body.endpoint,r.fetchedAt,proc);
      this.store.putSource(generation,body.endpoint,'document',projected,r.fetchedAt,rows);this.store.finishTask(task);
    } else if(task.kind==='procedure') {
      const r=await this.request(body.endpoint), work=r.payload.data[0];if(!work)throw new Error('EP procedure detail was empty.');
      this.store.putSource(generation,body.endpoint,'procedure',projectProcedure(work),r.fetchedAt);
      // Make verified report roles usable during the initial partial load; an
      // unrelated missing speech must not postpone an already supported join.
      this.refreshReportJoins(generation,tail(body.endpoint));
      this.store.finishTask(task);
    }
  }
  refreshReportJoins(generation,procedureId) {
    for(const report of this.store.reportsForProcedure(generation,procedureId)) {
      const procedures=new Map(procedureIds(report.work).flatMap(id=>{const record=this.store.source(generation,'/procedures/'+id);return record?[[id,record]]:[];}));
      const {rows}=documentRows(report.work,report.key,report.fetchedAt,procedures);
      this.store.transaction(()=>{this.store.assertWriter();this.store.replaceRows(generation,report.key,rows);});
    }
  }
  catchUp(cycle) {
    const today=day(this.clock());
    if(day(Date.parse(cycle.startedAt))===today || cycle.catchupDay===today)return false;
    for(const collection of collections(new Date(this.clock()).getUTCFullYear())) this.store.enqueue(cycle.generation,'catchup:'+today+':'+collection.endpoint+':'+JSON.stringify(collection.params),'catalog',{...collection,offset:0,deltaOnly:true},100);
    for(const endpoint of ['/plenary-documents','/committee-documents','/parliamentary-questions','/procedures'])this.store.enqueue(cycle.generation,'catchup:'+today+':feed:'+endpoint,'feed',{endpoint},105);
    this.store.enqueue(cycle.generation,'catchup:'+today+':roster','roster',{offset:0,nodes:[]},110);
    const start=day(Math.max(Date.parse(cycle.startedAt)-DAY,this.clock()-30*DAY));
    this.store.enqueue(cycle.generation,'catchup:'+today+':speeches','speeches',{endpoint:'/speeches',params:{'parliamentary-term':10,'activity-type':'PLENARY_DEBATE_SPEECH,PLENARY_DEBATE_WRITTEN_STATEMENT','sort-by':'sitting-date:desc,numbering:desc','sitting-date':start,'sitting-date-end':today},offset:0},100);
    this.store.updateCycle({catchupDay:today});return true;
  }
  finalize(generation) {
    this.store.pruneUnseenDocuments(generation);
    const procedures=new Map(this.store.sources(generation,'procedure').map(s=>[tail(s.key),s]));
    const unresolved=[];
    for(const source of this.store.iterateSources(generation,'document')) {
      const result=documentRows(source.work,source.key,source.fetchedAt,procedures);
      this.store.transaction(()=>{this.store.assertWriter();this.store.replaceRows(generation,source.key,result.rows);});unresolved.push(...result.unresolved);
    }
    this.store.publish(generation,unresolved);
  }
  async run() {
    if(this.stopped || this.running || !this.due() || !this.store.acquire())return;
    this.running=true;this.requests=0;const started=this.clock();
    const heartbeat=setInterval(()=>{if(!this.store.renew()){this.stopped=true;this.controller.abort();}},20_000);heartbeat.unref();
    try {
      const cycle=this.store.beginCycle();if(!cycle.initialized)await this.initialize(cycle);
      // An unavailable historical detail must not stop next-day catalogue/feed
      // catch-up while its durable retry keeps the generation incomplete.
      this.catchUp(this.store.get('working'));
      if(!this.store.get('working').reportJoinsReady) {
        // Upgrade an existing partial generation from its retained real records,
        // without refetching sources or resetting any durable page cursor.
        for(const procedure of this.store.iterateSources(cycle.generation,'procedure'))this.refreshReportJoins(cycle.generation,tail(procedure.key));
        this.store.updateCycle({reportJoinsReady:true});
      }
      this.store.updateCycle({phase:cycle.initial?'backfilling':'refreshing'});
      while(!this.stopped && this.requests<this.budget && this.clock()-started<this.maxDuration) {
        const size=(await Promise.all(['','-wal','-shm'].map(suffix=>stat(this.store.filename+suffix).then(s=>s.size).catch(()=>0)))).reduce((a,b)=>a+b,0);
        if(size>this.diskLimit){this.store.updateCycle({phase:'paused',error:'Activity index reached its configured disk limit.'});break;}
        const task=this.store.nextTask(cycle.generation);
        if(!task){const counts=this.store.taskCounts(cycle.generation);if(counts.total===counts.completed){if(this.catchUp(this.store.get('working')))continue;this.finalize(cycle.generation);}break;}
        try {await this.task(task);}catch(error){if(this.stopped)break;this.store.failTask(task,error);if(error.retryAfter)this.store.db.prepare('UPDATE tasks SET retry_at=MAX(retry_at,?) WHERE generation=? AND key=?').run(this.clock()+error.retryAfter*1000,task.generation,task.key);}
      }
    } finally {clearInterval(heartbeat);this.store.release();this.running=false;}
  }
  stop(){this.stopped=true;this.controller.abort();if(!this.running)this.store.release();}
}
let service;
export function activityIndex() {
  if(service)return service;
  if(process.env.ACTIVITY_INDEX_ENABLED!=='true')throw new HttpError(503,'activity_index_disabled','The joined activity index is not enabled.');
  const directory=process.env.ACTIVITY_INDEX_DIR;
  if(!directory)throw new HttpError(503,'activity_index_configuration','A dedicated index directory is required.');
  const bounded=(name,fallback,min,max)=>{const value=Number(process.env[name] || fallback);if(!Number.isInteger(value)||value<min||value>max)throw new Error(`Invalid ${name}.`);return value;};
  const store=new ActivityStore(directory), worker=new ActivityWorker(store,{
    budget:bounded('ACTIVITY_INDEX_JOB_REQUEST_BUDGET',1000,1,2000),
    maxDuration:bounded('ACTIVITY_INDEX_JOB_MAX_MINUTES',90,1,120)*60_000,
    diskLimit:bounded('ACTIVITY_INDEX_MAX_DISK_MIB',2048,64,4096)*1024*1024,
  });service={store,worker};return service;
}
export function activityIndexStatus(){return activityIndex().store.status();}
export function latestActivities(id,params) {
  const store=activityIndex().store;
  if(!store.status().currentMeps)throw new HttpError(503,'activity_index_loading','The current MEP roster is being loaded.');
  const result=store.page(id,params);if(!result)throw new HttpError(404,'mep_not_current','This ID is not in the current MEP roster.');return result;
}
export function startActivityIndex() {
  if(process.env.ACTIVITY_INDEX_ENABLED!=='true')return ()=>{};
  const {worker}=activityIndex();
  const run=()=>worker.run().catch(e=>console.error('[activity-index]',e.message));
  const timer=setInterval(run,30_000);timer.unref();void run();
  return ()=>{clearInterval(timer);worker.stop();};
}
