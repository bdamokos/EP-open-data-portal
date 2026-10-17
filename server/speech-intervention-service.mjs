import {odp,speechSummary,speakerIdentities} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {interventionMetadata,buildInterventionSequence,speechId,speechPeople} from './speech-interventions.mjs';
import {requestSignal,sharedRequest,waitForRequest} from './request-budget.mjs';
import {retainedSpeechMetadata,retainedSpeechPage} from './corpus-speeches.mjs';

const source=record=>({url:record.url,fetchedAt:new Date(record.fetchedAt).toISOString(),stale:Boolean(record.stale)});
const validId=id=>/^MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]+$/.test(id||'');
export const INTERVENTION_LIMITS=Object.freeze({memberPage:50,memberPages:20,sittingPage:500,sittingPages:4,selections:8,cacheMs:30*60_000});

export class SpeechInterventions {
  constructor({request=odp,clock=Date.now,identities=request===odp?speakerIdentities:null,readSpeechMetadata=request===odp?retainedSpeechMetadata:null,readCorpusPage=request===odp?retainedSpeechPage:null}={}) {Object.assign(this,{request,clock,identities,readSpeechMetadata,readCorpusPage});this.sittings=new Map();this.members=new Map();}
  async sitting(day) {
    let state=this.sittings.get(day);
    if(state&&this.clock()-state.at<INTERVENTION_LIMITS.cacheMs)return waitForRequest(state.promise);
    state={at:this.clock(),promise:null};
    state.promise=sharedRequest(async()=>{
      const rows=new Map(),sources=[],issues=new Set();let total=null,ended=false;
      for(let page=0;page<INTERVENTION_LIMITS.sittingPages;page++) {
        const record=await this.request('/speeches',{'sitting-date':day,'include-output':'xml_fragment',language:'en','sort-by':'numbering:asc',limit:INTERVENTION_LIMITS.sittingPage,offset:page*INTERVENTION_LIMITS.sittingPage},{staleWhileRevalidate:true});
        requestSignal()?.throwIfAborted();
        sources.push(source(record));const declared=record.payload.meta?.total;
        if(!Number.isSafeInteger(declared)||declared<0)issues.add('total-unavailable');
        else {if(total!==null&&total!==declared)issues.add('total-changed');total=declared;}
        const hits=record.payload.searchResults?.hits;
        const hitIds=Array.isArray(hits)?new Set(hits.map(h=>speechId(h.id))):null;
        for(const activity of record.payload.data||[]) {
          if(!validId(activity.activity_id)||speechId(activity.id)!==activity.activity_id||activity.activity_date!==day||!activity.activity_id.startsWith('MTG-PL-'+day+'-')||hitIds&&!hitIds.has(activity.activity_id)){issues.add('source-row-mismatch');continue;}
          if(rows.has(activity.activity_id))issues.add('overlapping-pages');
          rows.set(activity.activity_id,activity);
        }
        if(hitIds&&[...hitIds].some(id=>!rows.has(id)))issues.add('missing-hit');
        if((record.payload.data?.length||0)<INTERVENTION_LIMITS.sittingPage||total!==null&&(page+1)*INTERVENTION_LIMITS.sittingPage>=total){ended=true;break;}
      }
      return {rows:[...rows.values()],sources,coverage:{complete:ended&&issues.size===0&&rows.size===total,available:rows.size,total,issues:[...issues]}};
    }).catch(error=>{if(this.sittings.get(day)===state)this.sittings.delete(day);throw error;});
    this.sittings.set(day,state);while(this.sittings.size>INTERVENTION_LIMITS.selections)this.sittings.delete(this.sittings.keys().next().value);
    return waitForRequest(state.promise);
  }
  async context(id) {
    const retained=await this.readSpeechMetadata?.(id);requestSignal()?.throwIfAborted();
    const record=retained?.summary.intervention?{url:retained.sourceUrl,fetchedAt:Date.parse(retained.fetchedAt),payload:{data:[retained.activity]}}:await this.request('/speeches/'+id,{'include-output':'xml_fragment'},{staleWhileRevalidate:true});
    const activity=record.payload.data.find(a=>a.activity_id===id);
    if(!activity)throw new HttpError(404,'speech_not_found','This speech is unavailable.');
    const meta=structuredClone(retained?.summary.intervention||interventionMetadata(activity)),parentIds=meta.parentIds.filter(p=>/-PVCRE-ITM-\d+(?:-\d+)*$/.test(p));
    const debates=[];
    // Joint agenda items can name several parents. Do not silently pick one.
    for(const parentId of parentIds.slice(0,4)) {
      try {
        const event=await this.request('/events/'+parentId,{}, {staleWhileRevalidate:true});
        const parent=event.payload.data.find(a=>a.activity_id===parentId);
        if(!parent)throw new Error('The debate record is unavailable.');
        const sitting=await this.sitting(activity.activity_date);
        const sequence=buildInterventionSequence(sitting.rows,{parentId,expectedIds:parent.consists_of||[]});
        debates.push({id:parentId,titles:parent.activity_label||{},...sequence,records:sequence.records.map(({activity,...row})=>({...speechSummary(activity),...row})),sources:[source(event),...sitting.sources],sittingCoverage:sitting.coverage});
      }catch(error){debates.push({id:parentId,titles:{},records:[],exchanges:[],coverage:{complete:false,expected:null,available:0,missingIds:[]},error:String(error.message),...(Number.isFinite(error.retryAt)?{retryAt:error.retryAt}:{})});}
    }
    if(this.identities) {
      const metadata=[meta,...debates.flatMap(debate=>debate.records.map(row=>row.intervention))];
      const people=metadata.flatMap(value=>[value.speaker,value.chair].filter(Boolean));
      const chairs=metadata.flatMap(value=>[...(value.type==='chair'&&value.speaker?[value.speaker.id]:[]),...(value.chair?[value.chair.id]:[])]);
      const resolved=await this.identities.enrich(people,activity.activity_date,{chairs});
      let index=0;
      for(const value of metadata) {
        // A person's office does not turn their separate substantive speech into chairing.
        if(value.speaker){const {sittingRole,office,...identity}=resolved[index++];value.speaker={...identity,...(value.type==='chair'?{sittingRole:'chair',office}:{} )};}
        if(value.chair)value.chair={...resolved[index++],sittingRole:'chair'};
      }
    }
    return {speechId:id,intervention:meta,debates,unavailable:parentIds.length===0,sources:[source(record)]};
  }
  async member(id,page=0) {
    requestSignal()?.throwIfAborted();
    const key=String(id);let state=this.members.get(key),restarted=false;
    if(state&&this.clock()-state.at>=INTERVENTION_LIMITS.cacheMs){this.members.delete(key);state=null;}
    if(!state){
      // A browser can outlive this bounded selection cache. Restart its walk from the public source cache.
      if(page>0){page=0;restarted=true;}
      state={at:this.clock(),page:-1,rows:new Map(),summaries:new Map(),sources:[],issues:new Set(),total:null,ended:false,pending:null};this.members.set(key,state);while(this.members.size>INTERVENTION_LIMITS.selections)this.members.delete(this.members.keys().next().value);
    }
    if(state.pending)try {await waitForRequest(state.pending);}catch(error){if(error.code==='corpus_changed')return this.restartMember(id,key,state);throw error;}
    if(page>state.page+1)throw new HttpError(400,'invalid_page','Load the preceding statistics page first.');
    if(!state.ended&&page>state.page) {
      const job=sharedRequest(async()=>{
        let saved=null;
        if(state.corpusMode!==false&&this.readCorpusPage) {
          saved=await this.readCorpusPage({member:key,kinds:['PLENARY_DEBATE_SPEECH','PLENARY_DEBATE_WRITTEN_STATEMENT'],metadataOnly:true,descending:true,limit:INTERVENTION_LIMITS.memberPage,offset:page*INTERVENTION_LIMITS.memberPage,expectedRevision:state.corpusRevision});
          requestSignal()?.throwIfAborted();
          if(state.corpusMode&&!saved)throw new HttpError(503,'corpus_unavailable','Saved speech statistics are temporarily unavailable.');
          if(saved?.changed)throw new HttpError(409,'corpus_changed','Saved speech statistics changed during loading.');
          if(state.corpusMode===undefined)state.corpusMode=Boolean(saved?.total>0);
          if(!state.corpusMode)saved=null;
        }
        let record;
        if(saved) {
          state.corpusRevision=saved.revision;
          state.issues.add('retained-corpus');
          if(saved.truncated)state.issues.add('retained-byte-limit');
          const rows=saved.records.filter(row=>row.metadata);
          if(rows.length!==saved.records.length)state.issues.add('retained-metadata-unavailable');
          for(const row of rows)state.summaries.set(row.id,row.metadata.summary);
          record={payload:{data:rows.map(row=>row.metadata.activity),meta:{total:saved.total}},sources:rows.flatMap(row=>[{url:row.metadata.sourceUrl,fetchedAt:row.metadata.fetchedAt,retained:true},...(row.metadata.headerSources||[])])};
        } else record=await this.request('/speeches',{'person-id':id,'parliamentary-term':10,'activity-type':'PLENARY_DEBATE_SPEECH,PLENARY_DEBATE_WRITTEN_STATEMENT','include-output':'xml_fragment',language:'en','sort-by':'sitting-date:desc,numbering:desc',limit:INTERVENTION_LIMITS.memberPage,offset:page*INTERVENTION_LIMITS.memberPage},{staleWhileRevalidate:true});
        requestSignal()?.throwIfAborted();
        state.sources.push(...(record.sources||[source(record)]));const total=record.payload.meta?.total;
        if(!Number.isSafeInteger(total)||total<0)state.issues.add('total-unavailable');else {if(state.total!==null&&state.total!==total)state.issues.add('total-changed');state.total=total;}
        const hitIds=Array.isArray(record.payload.searchResults?.hits)?new Set(record.payload.searchResults.hits.map(h=>speechId(h.id))):null;
        for(const activity of record.payload.data||[]) {
          if(!validId(activity.activity_id)||speechId(activity.id)!==activity.activity_id||!activity.activity_id.startsWith('MTG-PL-'+activity.activity_date+'-')||activity.activity_date<'2024-07-16'||!speechPeople(activity).includes(key)||!['PLENARY_DEBATE_SPEECH','PLENARY_DEBATE_WRITTEN_STATEMENT'].some(type=>String(activity.had_activity_type).endsWith('/'+type))||hitIds&&!hitIds.has(activity.activity_id)){state.issues.add('source-row-mismatch');continue;}
          if(state.rows.has(activity.activity_id))state.issues.add('overlapping-pages');
          state.rows.set(activity.activity_id,activity);
        }
        if(hitIds&&[...hitIds].some(id=>!state.rows.has(id)))state.issues.add('missing-hit');
        state.page=page;state.ended=saved?saved.nextOffset===null||saved.truncated:(record.payload.data?.length||0)<INTERVENTION_LIMITS.memberPage||state.total!==null&&(page+1)*INTERVENTION_LIMITS.memberPage>=state.total;
      }).finally(()=>{if(state.pending===job)state.pending=null;});state.pending=job;
      try {await waitForRequest(job);}catch(error){if(error.code==='corpus_changed')return this.restartMember(id,key,state);throw error;}
    }
    const rows=[...state.rows.values()],metadata=rows.map(row=>state.summaries.get(row.activity_id)?.intervention||interventionMetadata(row)),count=type=>metadata.filter(m=>m.type===type).length;
    const groupOrations=metadata.filter(m=>m.onBehalfOf.some(g=>g.politicalGroup));
    const sourceComplete=state.ended&&state.issues.size===0&&state.rows.size===state.total;
    const classificationsComplete=(metadata.length>0||sourceComplete)&&(!state.corpusMode||sourceComplete)&&!metadata.some(m=>['unclassified','blue-card'].includes(m.type));
    const observed=value=>(value>0||classificationsComplete)?value:null;
    return {memberId:key,restarted,items:rows.map(row=>state.summaries.get(row.activity_id)||speechSummary(row)),counts:{groupOrations:state.corpusMode?observed(groupOrations.length):groupOrations.length,blueQuestions:observed(count('blue-card-question')+count('blue-card-intervention')),blueAnswers:observed(count('blue-card-answer')),blueReactions:observed(count('blue-card-reaction')),catchTheEye:count('catch-the-eye')||null},groups:[...new Set(groupOrations.flatMap(m=>m.onBehalfOf.filter(g=>g.politicalGroup).map(g=>g.id)))].map(id=>({id,label:groupLabelsFrom(metadata,id),count:groupOrations.filter(m=>m.onBehalfOf.some(g=>g.id===id)).length})),
      coverage:{complete:sourceComplete&&classificationsComplete,available:state.rows.size,total:state.total,headers:metadata.filter(m=>m.headerAvailable).length,unclassified:count('unclassified')+count('blue-card'),issues:[...state.issues]},
      nextPage:!state.ended&&state.page+1<INTERVENTION_LIMITS.memberPages?state.page+1:null,sources:state.sources};
  }
  async restartMember(id,key,state) {
    if(this.members.get(key)===state)this.members.delete(key);
    return {...await this.member(id,0),restarted:true};
  }
}
const groupLabelsFrom=(metadata,id)=>metadata.flatMap(m=>m.onBehalfOf).find(g=>g.id===id)?.label||id;
