import {createHash} from 'node:crypto';
import {odp} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {memberVotes,memberVotesQuery} from './member-votes.mjs';
import {requestSignal,sharedRequest,waitForRequest,isLocalRequestFailure} from './request-budget.mjs';
import {unique,eventUri,identifier,references,comparable} from './vote-evidence.mjs';
import {speechPeople} from './speech-interventions.mjs';
import {explanationVoteContext,matchVoteExplanation} from './member-vote-explanations-model.mjs';

export const MEMBER_VOTE_EXPLANATIONS_VERSION=3;
export const EXPLANATION_LIMITS=Object.freeze({pageSize:50,pages:4,parents:24,sourceBytes:2*1024*1024,totalBytes:8*1024*1024,timeoutMs:25_000,pending:8});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function memberVoteExplanationsQuery(search,options) {
  for(const key of search.keys())if(!['lang','week','sitting','decision','snapshot'].includes(key))throw new HttpError(400,'invalid_query','Unsupported explanation parameter.');
  const query=memberVotesQuery(search,options);
  if(!query.snapshot||!query.decision)throw new HttpError(400,'explanation_snapshot_required','Choose a vote from a saved period.');
  return query;
}

function observe(record,budget,limits) {
  const bytes=Buffer.byteLength(JSON.stringify(record.payload));
  if(bytes>limits.sourceBytes||budget.bytes+bytes>limits.totalBytes)throw new HttpError(502,'explanation_source_size','Explanation records exceed the reading limit.');
  budget.bytes+=bytes;
  const fetchedAt=typeof record.fetchedAt==='number'?new Date(record.fetchedAt).toISOString():record.fetchedAt;
  if(!Number.isFinite(Date.parse(fetchedAt))||typeof record.url!=='string'||!record.url.startsWith('https://data.europarl.europa.eu/api/v2/'))throw new HttpError(502,'explanation_provenance','Explanation source details are unavailable.');
  if(!Array.isArray(record.payload?.data))throw new HttpError(502,'explanation_source_shape','Explanation records could not be read.');
  return {url:record.url,fetchedAt,contentHash:hash(record.payload),stale:record.stale===true,refreshInProgress:record.refreshInProgress===true,refreshError:record.refreshError||null};
}

export class MemberVoteExplanations {
  constructor({request=odp,votes=memberVotes,limits={}}={}){this.request=request;this.votes=votes;this.limits={...EXPLANATION_LIMITS,...limits};this.pending=new Map();}

  async collect(memberId,day) {
    const budget={bytes:0},sources=[],gaps=[],rows=new Map(),conflicts=new Set();let ended=false,total=null;
    for(let page=0;page<this.limits.pages;page++) {
      try {
        const record=await this.request('/speeches',{'person-id':memberId,'sitting-date':day.date,'include-output':'xml_fragment',language:'en',limit:this.limits.pageSize,offset:page*this.limits.pageSize},{priority:'interactive',ttl:60_000,staleWhileRevalidate:true});
        requestSignal()?.throwIfAborted();
        const source=observe(record,budget,this.limits);sources.push(source);
        if(source.stale||source.refreshError)gaps.push({code:'speech-source-stale'});
        const declared=record.payload.meta?.total,data=record.payload.data;
        if(!Number.isSafeInteger(declared)||declared<0)gaps.push({code:'speech-total-unavailable'});
        else {if(total!==null&&total!==declared)gaps.push({code:'speech-total-changed'});total=declared;}
        const hits=record.payload.searchResults?.hits;
        if(Array.isArray(hits)&&hits.some(hit=>!data.some(row=>eventUri(row)===eventUri(hit))))gaps.push({code:'speech-hit-unavailable'});
        let added=0;
        for(const [index,activity] of data.entries()) {
          const uri=eventUri(activity),people=speechPeople(activity);
          if(!uri||activity.activity_id!==identifier(uri)||!new RegExp('^'+day.sittingId+'-[A-Z0-9-]+$').test(activity.activity_id)||activity.activity_date!==day.date||people.length!==1||people[0]!==memberId){gaps.push({code:'speech-identity-mismatch'});continue;}
          const previous=rows.get(uri);
          if(previous){gaps.push({code:'speech-overlapping-pages',id:activity.activity_id});if(JSON.stringify(comparable(previous.activity))!==JSON.stringify(comparable(activity)))conflicts.add(uri);}
          else {rows.set(uri,{activity,sources:[{...source,jsonPointer:'/data/'+index}]});added++;}
        }
        if(data.length<this.limits.pageSize||total!==null&&(page+1)*this.limits.pageSize>=total){ended=true;break;}
        if(!added){gaps.push({code:'speech-repeated-page'});break;}
      } catch(error) {
        if(isLocalRequestFailure(error))throw error;
        gaps.push({code:error.code||'speech-source-unavailable'});break;
      }
    }
    if(!ended)gaps.push({code:'speech-collection-incomplete'});
    if(total!==null&&rows.size!==total)gaps.push({code:'speech-count-mismatch'});
    const parents=new Map(),eligible=[...rows].filter(([uri])=>!conflicts.has(uri)).map(([,row])=>row);
    const parentIds=unique(eligible.flatMap(({activity})=>references(activity.inverse_consists_of).filter(uri=>new RegExp('^https://data.europarl.europa.eu/eli/dl/event/'+day.sittingId+'-PVCRE-ITM-\\d+(?:-\\d+)*$').test(uri))));
    if(parentIds.length>this.limits.parents)gaps.push({code:'parent-read-limit'});
    // Sequential optional reads share ODP admission and this aggregate budget.
    for(const uri of parentIds.slice(0,this.limits.parents)) {
      try {
        const record=await this.request('/events/'+identifier(uri),{}, {priority:'interactive',ttl:60_000,staleWhileRevalidate:true});
        requestSignal()?.throwIfAborted();const source=observe(record,budget,this.limits);
        sources.push(source);
        if(source.stale||source.refreshError)gaps.push({code:'parent-source-stale',id:identifier(uri)});
        if(record.payload.data.length!==1||eventUri(record.payload.data[0])!==uri||record.payload.data[0].activity_id!==identifier(uri)||record.payload.data[0].activity_date!==day.date)throw new HttpError(502,'parent-identity-mismatch','The explanation chapter could not be verified.');
        parents.set(uri,{activity:record.payload.data[0],source:{...source,jsonPointer:'/data/0'}});
      }catch(error){if(isLocalRequestFailure(error))throw error;gaps.push({code:error.code||'parent-source-unavailable',id:identifier(uri)});}
    }
    return {rows:eligible,parents,sources,gaps};
  }

  async query(member,query) {
    const memberId=String(member);
    if(!/^[1-9]\d*$/.test(memberId)||!Number.isSafeInteger(Number(memberId)))throw new HttpError(400,'invalid_id','Use a positive person identifier.');
    if(!query.snapshot||!query.decision)throw new HttpError(400,'explanation_snapshot_required','Choose a vote from a saved period.');
    // Validate even on coalesced source reads. Expired snapshots never collect a
    // replacement or reuse an answer whose voting evidence has disappeared.
    const snapshot=await this.votes.snapshot(query);requestSignal()?.throwIfAborted();
    const day=snapshot.days.find(day=>day.decisions.some(row=>row.activity_id===query.decision));
    if(!day)throw new HttpError(404,'explanation_decision_unavailable','This vote is not in the saved period.');
    const context=explanationVoteContext(day,memberId,query.decision,query.language);
    const base={version:MEMBER_VOTE_EXPLANATIONS_VERSION,memberId,decisionId:query.decision,sittingId:day.sittingId,snapshotId:snapshot.id,
      subjectId:context.subject?.id||null,matchScope:'subject',presentationAnchorDecisionId:context.anchor,
      written:{status:'unsupported',count:null},items:[],sources:[],voteSources:day.sources,voteGraphGaps:day.coverage?.completeness?.unresolvedAgendaItemIds||null};
    if(!context.subject||context.gaps.length)return {...base,coverage:{status:'unavailable',searchComplete:false,gaps:context.gaps.length?context.gaps:[{code:'vote-subject-unavailable'}]}};
    const key=JSON.stringify([memberId,day.sittingId]);let job=this.pending.get(key);
    if(!job){
      if(this.pending.size>=this.limits.pending)throw new HttpError(503,'explanation_busy','Explanation reads are busy. Try again.');
      job=sharedRequest(()=>this.collect(memberId,day),this.limits.timeoutMs).finally(()=>this.pending.delete(key));this.pending.set(key,job);
    }
    const collected=await waitForRequest(job);requestSignal()?.throwIfAborted();
    const items=[],gaps=[...collected.gaps];
    for(const row of collected.rows) {
      const parentUris=references(row.activity.inverse_consists_of);
      if(parentUris.length!==1){gaps.push({code:'explanation-parent-unresolved',id:row.activity.activity_id});continue;}
      const parent=collected.parents.get(parentUris[0]);if(!parent){gaps.push({code:'explanation-parent-unavailable',id:row.activity.activity_id});continue;}
      const matched=matchVoteExplanation(row.activity,parent.activity,day,context,memberId);
      if(matched.gap)gaps.push({code:matched.gap,id:row.activity.activity_id,...(matched.details?{details:matched.details}:{})});
      if(matched.item)items.push({...matched.item,sources:[...row.sources,parent.source]});
    }
    return {...base,presentationAnchorDecisionId:items.length?context.anchor:null,items,sources:collected.sources,coverage:{status:gaps.length?'partial':'searched',searchComplete:gaps.length===0,gaps}};
  }
}

export const memberVoteExplanations=new MemberVoteExplanations();
