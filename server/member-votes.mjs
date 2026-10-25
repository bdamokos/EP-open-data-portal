import {VoteSourceReader,pageCoverage,sourceEvidence} from './vote-source-reader.mjs';
import {meetingsReader,MeetingsReader} from './meetings-reader.mjs';
import {calendarYears,identifiedPlenarySitting,currentTermSittings,isPlenarySitting} from './plenary-calendar.mjs';
import {createHash} from 'node:crypto';
import {HttpError} from './http-utils.mjs';
import {odp,odpLanguage} from './odp.mjs';
import {CURRENT_TERM_START,brusselsDay} from './analysis-period.mjs';
import {requestSignal,runWithRequestSignal,sharedRequest,waitForRequest,isLocalRequestFailure} from './request-budget.mjs';
import {projectMemberSitting,memberVoteAlignment} from './member-votes-model.mjs';
import {mergeSourceNodes,sourceNodeKey,decisionSourceConflicts} from './vote-evidence.mjs';

export const MEMBER_VOTES_VERSION=7;
export const MEMBER_VOTES_LIMITS=Object.freeze({pageSize:50,decisionPageSize:250,cataloguePages:10,decisionPages:4,resultsPages:4,agendaPages:4,maxRows:4000,maxSittings:5,sourceBytes:8*1024*1024,periodBytes:24*1024*1024,cacheBytes:32*1024*1024,cacheEntries:8,cacheMs:60_000,snapshotMs:10*60_000,sourceMs:15*60_000,timeoutMs:50_000});
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const dayOffset=(value,days)=>new Date(Date.parse(value+'T12:00:00Z')+days*86400_000).toISOString().slice(0,10);
const monday=value=>dayOffset(value,-((new Date(value+'T12:00:00Z').getUTCDay()+6)%7));
const tail=value=>String(value?.id||value||'').split('/').at(-1);
const relative=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
const refs=value=>(Array.isArray(value)?value:value==null?[]:[value]).map(relative);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const errorInfo=error=>({code:error?.code||'vote_source_unavailable',message:error?.message||'Parliament source could not be read.'});

export function memberVotesQuery(search,{now=Date.now()}={}) {
  const allowed=['lang','week','sitting','limit','offset','decision','snapshot','positions','alignment'];
  for(const key of search.keys())if(!allowed.includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated member-vote parameter.');
  const language=odpLanguage(search.get('lang')??'en'),today=brusselsDay(now);
  const sitting=search.get('sitting'),week=search.get('week');
  if(search.has('sitting')&&(!/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(sitting||'')||!validDate(sitting.slice(7))||sitting.slice(7)<CURRENT_TERM_START||sitting.slice(7)>today))throw new HttpError(400,'invalid_sitting','Choose a held plenary sitting in the current term.');
  if(search.has('week')&&(week!=='latest'&&(!validDate(week)||monday(week)!==week||dayOffset(week,6)<CURRENT_TERM_START||week>today)||search.has('sitting')))throw new HttpError(400,'invalid_week','Choose one held plenary week or sitting.');
  function integer(key,fallback,min,max){const raw=search.get(key)??String(fallback),value=Number(raw);if(!/^(0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(value)||value<min||value>max)throw new HttpError(400,'invalid_query',`Invalid ${key}.`);return value;}
  const decision=search.get('decision'),snapshot=search.get('snapshot'),positions=search.get('positions')??'all';
  const alignment=search.get('alignment')??'all';
  if(!['all','with','against','abstained'].includes(alignment))throw new HttpError(400,'invalid_alignment','Choose all, with, against or abstained alignment.');
  if(!['all','recorded'].includes(positions))throw new HttpError(400,'invalid_positions','Choose all or recorded member positions.');
  if(search.has('decision')&&(!/^MTG-PL-\d{4}-\d{2}-\d{2}-DEC-\d+$/.test(decision||'')||!validDate(decision.slice(7,17))))throw new HttpError(400,'invalid_decision','Use an exact decision identifier.');
  if(search.has('snapshot')&&!/^[a-f0-9]{64}$/.test(snapshot||''))throw new HttpError(400,'invalid_snapshot','Use the snapshot identifier returned by this endpoint.');
  return {language,positions,alignment,sitting:sitting||null,week:sitting?null:week||'latest',limit:integer('limit',25,1,100),offset:integer('offset',0,0,10000),decision:decision||null,snapshot:snapshot||null};
}

// Period snapshots are independent of the requested member, language, and page.
// No activity store or writer is opened by this reader.
export class MemberVotes extends VoteSourceReader {
  constructor({request=odp,clock=Date.now,limits={},meetings}={}){super();this.meetings=meetings||(request===odp&&clock===Date.now&&!Object.keys(limits).length?meetingsReader:new MeetingsReader({request,clock,limits}));this.request=request;this.clock=clock;this.limits={...MEMBER_VOTES_LIMITS,...limits};this.periods=new Map();this.snapshots=new Map();this.pending=new Map();this.cacheBytes=0;}

  async catalogue(query,budget) {
    if(query.sitting){
      const coverage=pageCoverage();
      try {
        const record=await this.request('/meetings/'+query.sitting,{}, {priority:'interactive',staleWhileRevalidate:true,ttl:this.limits.sourceMs});requestSignal()?.throwIfAborted();
        if(!Array.isArray(record.payload?.data))throw new HttpError(502,'vote_source_shape','Parliament returned an unreadable sitting.');
        const nodes=record.payload.data.filter(n=>relative(n.id)==='eli/dl/event/'+query.sitting&&n.activity_id===query.sitting&&n.activity_date===query.sitting.slice(7)&&tail(n.had_activity_type)==='PLENARY_SITTING');
        if(nodes.length!==1)throw new HttpError(502,'vote_sitting_identity','Parliament did not return the exact requested sitting.');
        const bytes=Buffer.byteLength(JSON.stringify(record.payload));if(bytes>this.limits.sourceBytes)throw new HttpError(502,'vote_source_size','Parliament sitting exceeds the bounded source size.');budget.bytes+=bytes;
        Object.assign(coverage,{state:'complete',pages:1,rows:1,stopReason:'end',sources:[sourceEvidence(record,record.payload)]});return {nodes,coverage};
      }catch(error){if(isLocalRequestFailure(error))throw error;coverage.error=errorInfo(error);coverage.stopReason='error';return {nodes:[],coverage};}
    }
    const today=brusselsDay(this.clock()),year=Number((query.week==='latest'?today:query.week).slice(0,4));
    const years=(query.week==='latest'?calendarYears(today).reverse():[...new Set([year,Number(dayOffset(query.week,6).slice(0,4))])]).filter(value=>value<=Number(today.slice(0,4)));
    let nodes=[],coverage=pageCoverage();
    for(const selectedYear of years){
      const result=await this.meetings.year(selectedYear);
      if(budget.bytes+result.bytes>this.limits.periodBytes)throw new HttpError(502,'vote_period_budget','The selected period exceeds the bounded source budget.');
      budget.bytes+=result.bytes;
      nodes.push(...result.nodes);coverage={...result.coverage,pages:coverage.pages+result.coverage.pages,rows:nodes.length,sources:[...coverage.sources,...result.coverage.sources]};
      if(coverage.state!=='complete')break;
      if(query.week==='latest'&&nodes.some(n=>tail(n.had_activity_type)==='PLENARY_SITTING'&&validDate(n.activity_date)&&n.activity_date>=CURRENT_TERM_START&&n.activity_date<=today))break;
    }
    if(nodes.some(n=>isPlenarySitting(n)&&!identifiedPlenarySitting(n))){coverage.state='partial';coverage.error={code:'vote_sitting_identity',message:'Some listed plenary sittings have inconsistent identifiers or dates.'};}
    const valid=currentTermSittings(nodes,today);
    return {nodes:valid,coverage};
  }

  async sitting(node,budget){
    const sittingId=node.activity_id,date=node.activity_date;
    const failure=new AbortController(),signal=AbortSignal.any([requestSignal(),failure.signal].filter(Boolean));
    // A local failure ends this collection, so sibling reads must lose their
    // ownership too, before sharedRequest disposes the collection deadline.
    const [all,named,results,agenda]=await runWithRequestSignal(signal,()=>Promise.all([
      this.pages('/meetings/'+sittingId+'/decisions',{'filter-output':'voters'},'decisions',budget,{heldSitting:date}),
      this.pages('/meetings/'+sittingId+'/decisions',{'vote-method':'ROLL_CALL_EV'},'decisions',budget,{heldSitting:date}),
      this.pages('/meetings/'+sittingId+'/vote-results',{},'results',budget,{heldSitting:date}),
      this.pages('/meetings/'+sittingId+'/foreseen-activities',{},'agenda',budget,{heldSitting:date})
    ]).catch(error=>{failure.abort(error);throw error;}));
    const errors=[];
    const eligible=(collection,suffix)=>collection.nodes.filter(n=>{
      const good=new RegExp('^eli/dl/event/'+sittingId+suffix+'$').test(relative(n.id))&&n.activity_id===tail(n.id)&&n.activity_date===date;
      if(!good)errors.push(relative(n.id));return good;
    });
    // Auxiliary requests are bounded by the same result-page/byte budgets.
    // Keep their exact edges and wording; they are never result parents.
    const resultCandidates={nodes:results.nodes.filter(n=>tail(n.had_activity_type)==='PLENARY_VOTE_RESULTS')};
    const allNodes=eligible(all,'-DEC-\\d+'),namedNodes=eligible(named,'-DEC-\\d+'),resultNodes=eligible(resultCandidates,'-VOT-ITM-\\d+');
    const requests=results.nodes.filter(n=>['REQUEST_VOTE_ROLLCALL','REQUEST_VOTE_SPLIT','REQUEST_VOTE_SEPARATE'].includes(tail(n.had_activity_type))).filter(n=>{const good=new RegExp('^eli/dl/event/'+sittingId+'-VOT-ITM-\\d+-(?:RCV|SPLIT|SEPARATE)-\\d+$').test(relative(n.id))&&n.activity_id===tail(n.id);if(!good)errors.push(relative(n.id));return good;});
    const voteErrors=[...errors];
    // MEETING_PART time slots can omit activity_date. They are scheduling
    // containers, never vote items; keep dated agenda-item validation intact.
    const agendaItems={nodes:agenda.nodes.filter(n=>!(n.type==='ForeseenActivity'&&tail(n.had_activity_type)==='MEETING_PART'&&new RegExp('^eli/dl/event/'+sittingId+'-TF-\\d{4}$').test(relative(n.id))&&n.activity_id===tail(n.id)&&refs(n.inverse_was_scheduled_in).includes('eli/dl/event/'+sittingId)))};
    const agendaNodes=eligible(agendaItems,'-[A-Z0-9-]{1,100}');
    const merged=new Map(allNodes.map(n=>[relative(n.id),n]));const conflictingDecisionIds=[];
    for(const n of namedNodes){
      const key=relative(n.id),old=merged.get(key),{node,fields}=mergeSourceNodes(old,n);
      merged.set(key,{...node,...(fields.length?old:{})});
    }
    const observations=new Map();
    for(const [stream,collection] of [['census',all],['named',named]])for(const node of [...collection.nodes,...collection.conflicts]){
      const key=relative(node.id);if(!merged.has(key))continue;
      const entries=observations.get(key)||[];
      entries.push({stream,node,evidencePaths:collection.nodeEvidence[sourceNodeKey(node)]||[]});observations.set(key,entries);
    }
    for(const [key,node] of merged){
      const conflict=decisionSourceConflicts(observations.get(key)||[]);
      if(conflict)conflictingDecisionIds.push(key);
      merged.set(key,{...node,_conflictingSourceObservations:conflict});
    }
    const decisions=[...merged.values()],parents=resultNodes.filter(n=>tail(n.had_activity_type)==='PLENARY_VOTE_RESULTS');
    const resultIds=new Set(parents.map(n=>relative(n.id))),decisionIds=new Set(decisions.map(n=>relative(n.id))),namedIds=new Set(namedNodes.map(n=>relative(n.id))),agendaIds=new Set(agendaNodes.map(n=>relative(n.id)));
    const isSittingResult=id=>new RegExp('^eli/dl/event/'+sittingId+'-VOT-ITM-\\d+$').test(id);
    const declaredResults=[...new Set([
      ...refs(node.consists_of).filter(isSittingResult),
      ...parents.flatMap(n=>(Array.isArray(n.inverse_consists_of)?n.inverse_consists_of:[]).filter(p=>relative(p.id)==='eli/dl/event/'+sittingId).flatMap(p=>refs(p.consists_of))).filter(isSittingResult)
    ])];
    const declaredDecisions=[...new Set(parents.flatMap(n=>refs(n.consists_of)))];
    const missingResultIds=[...new Set([...declaredResults.filter(id=>!resultIds.has(id)),...decisions.flatMap(n=>refs(n.inverse_consists_of)).filter(id=>!resultIds.has(id))])];
    const missingDecisionIds=declaredDecisions.filter(id=>!decisionIds.has(id));
    const missingNamedDecisionIds=allNodes.filter(n=>tail(n.decision_method)==='VOTE_ELECTRONIC_ROLLCALL'&&!['LAPSED','WITHDRAWN'].includes(tail(n.decision_outcome))&&n.type==='Vote'&&!namedIds.has(relative(n.id))).map(n=>relative(n.id));
    const unresolvedAgendaItemIds=[...new Set(parents.flatMap(n=>refs(n.executed)).filter(id=>!agendaIds.has(id)))];
    const undeclaredChildResultIds=parents.filter(n=>!Array.isArray(n.consists_of)||!n.consists_of.length).map(n=>relative(n.id));
    // Some decision responses ignore limit/offset and repeat the entire census.
    // Counts alone cannot prove exhaustion: require the exact declared ID set,
    // complete result parents and unchanged, valid source observations.
    const sameIds=(nodes,ids)=>nodes.length===ids.length&&nodes.every(n=>ids.includes(relative(n.id)));
    const resultGraphComplete=results.coverage.state==='complete'&&parents.length>0&&!missingResultIds.length&&!undeclaredChildResultIds.length&&declaredDecisions.every(id=>new RegExp('^eli/dl/event/'+sittingId+'-DEC-\\d+$').test(id));
    const confirmRepeated=(collection,validNodes,ids)=>{
      if(collection.coverage.stopReason==='repeated-page'&&!collection.coverage.error&&!collection.conflicts.length&&collection.nodes.length===validNodes.length&&sameIds(validNodes,ids))Object.assign(collection.coverage,{state:'complete',stopReason:'declared-children'});
    };
    if(resultGraphComplete&&!voteErrors.length){
      confirmRepeated(all,allNodes,declaredDecisions);
      if(all.coverage.state==='complete')confirmRepeated(named,namedNodes,allNodes.filter(n=>tail(n.decision_method)==='VOTE_ELECTRONIC_ROLLCALL').map(n=>relative(n.id)));
    }
    const votingRecordsComplete=[all,named,results].every(c=>c.coverage.state==='complete')&&![missingResultIds,missingDecisionIds,missingNamedDecisionIds,conflictingDecisionIds,undeclaredChildResultIds,voteErrors].some(a=>a.length);
    const completeness={missingResultIds,missingDecisionIds,missingNamedDecisionIds,unresolvedAgendaItemIds,conflictingDecisionIds,undeclaredChildResultIds,invalidSourceIds:[...new Set(errors)],declaredResultCount:Array.isArray(node.consists_of)?declaredResults.length:declaredResults.length||null,declaredDecisionCount:declaredDecisions.length,votingRecordsComplete,complete:false};
    completeness.complete=[all,named,results,agenda].every(c=>c.coverage.state==='complete')&&![missingResultIds,missingDecisionIds,missingNamedDecisionIds,unresolvedAgendaItemIds,conflictingDecisionIds,undeclaredChildResultIds,errors].some(a=>a.length);
    const anySource=[all,named,results].some(c=>c.coverage.pages>0);
    const coverage={sittingId,date,state:votingRecordsComplete?'complete':anySource?'partial':'unavailable',decisions:all.coverage,namedDecisions:named.coverage,results:results.coverage,agenda:agenda.coverage,completeness,observedDecisionCount:decisions.length};
    return {sittingId,date,decisions,results:resultNodes,requests,conflictingResults:results.conflicts,resultEvidence:results.evidence,decisionEvidence:Object.fromEntries([...new Set([...Object.keys(all.evidence),...Object.keys(named.evidence)])].map(key=>[key,[...(all.evidence[key]||[]),...(named.evidence[key]||[])]])),agenda:agendaNodes,sources:{decisions:[...all.coverage.sources,...named.coverage.sources],results:results.coverage.sources,agenda:agenda.coverage.sources},coverage};
  }

  async collect(query){
    const budget={bytes:0},catalogue=await this.catalogue(query,budget),today=brusselsDay(this.clock());
    const latest=catalogue.nodes.map(n=>n.activity_date).sort().at(-1);
    const week=query.sitting?null:query.week==='latest'?(latest?monday(latest):null):query.week;
    if(!query.sitting&&!week){return {period:{kind:'week',week:null,sittingId:null,from:null,to:null},days:[],coverage:{status:'unavailable',collectionComplete:false,termWide:false,expectedSittingIds:[],scannedSittingIds:[],failedSittingIds:[],incompleteSittingIds:[],catalogue:catalogue.coverage,sittings:[],basis:'No latest held week could be established from the retrieved sitting catalogue.'}};}
    const period={kind:query.sitting?'sitting':'week',week,sittingId:query.sitting||null,from:query.sitting?query.sitting.slice(7):week,to:query.sitting?query.sitting.slice(7):dayOffset(week,6)};
    const nodes=catalogue.nodes.filter(n=>n.activity_date>=period.from&&n.activity_date<=period.to&&n.activity_date<=today).sort((a,b)=>a.activity_date.localeCompare(b.activity_date)||a.activity_id.localeCompare(b.activity_id));
    if(nodes.length>this.limits.maxSittings)throw new HttpError(502,'vote_sitting_budget','The selected period contains too many sittings for this bounded view.');
    const days=[];
    // At most four cold source reads enter the shared admission queue at once.
    // Eight simultaneous reads would exceed its ten-second interactive wait.
    for(const node of nodes)days.push(await this.sitting(node,budget));
    requestSignal()?.throwIfAborted();
    const expectedSittingIds=query.sitting?[query.sitting]:nodes.map(n=>n.activity_id),scannedSittingIds=days.map(d=>d.sittingId);
    const failedSittingIds=[...expectedSittingIds.filter(id=>!scannedSittingIds.includes(id)),...days.filter(d=>d.coverage.state==='unavailable').map(d=>d.sittingId)];
    const incompleteSittingIds=days.filter(d=>d.coverage.state!=='complete').map(d=>d.sittingId);
    const collectionComplete=catalogue.coverage.state==='complete'&&!failedSittingIds.length&&!incompleteSittingIds.length;
    const coverage={status:collectionComplete?'complete':days.some(d=>d.coverage.state!=='unavailable')?'partial':'unavailable',collectionComplete,termWide:false,expectedSittingIds,scannedSittingIds,failedSittingIds,incompleteSittingIds,catalogue:catalogue.coverage,sittings:days.map(d=>d.coverage),basis:'Voting-record coverage for the resolved held period: decision, named-position and result streams plus exact declared-child checks. Agenda context is separate; completeness.complete retains the full graph check. Complete does not establish attendance, eligibility, universal publication or term-wide history. Missing positions are not absence. Source retrieval times and hashes identify this snapshot.'};
    return {period,days,coverage};
  }

  prune(){
    for(const [id,entry] of this.snapshots)if(this.clock()-entry.at>=this.limits.snapshotMs){this.snapshots.delete(id);this.cacheBytes-=entry.bytes;}
    while(this.snapshots.size>this.limits.cacheEntries||this.cacheBytes>this.limits.cacheBytes){const id=this.snapshots.keys().next().value,entry=this.snapshots.get(id);this.snapshots.delete(id);this.cacheBytes-=entry.bytes;}
    for(const [key,entry] of this.periods)if(!this.snapshots.has(entry.id))this.periods.delete(key);
  }

  async snapshot(query){
    this.prune();
    if(query.snapshot){
      const old=this.snapshots.get(query.snapshot);
      if(!old||query.sitting&&old.value.period.sittingId!==query.sitting||!query.sitting&&(old.value.period.kind!=='week'||query.week!=='latest'&&old.value.period.week!==query.week))throw new HttpError(409,'vote_snapshot_unavailable','That period snapshot is unavailable or belongs to another period. Start the period again.');
      return {...old.value,id:query.snapshot};
    }
    const key=JSON.stringify([MEMBER_VOTES_VERSION,query.sitting||query.week,query.week==='latest'?brusselsDay(this.clock()):null]);
    const old=this.periods.get(key);if(old&&this.clock()-old.at<this.limits.cacheMs&&this.snapshots.has(old.id))return {...this.snapshots.get(old.id).value,id:old.id};
    if(this.pending.has(key))return waitForRequest(this.pending.get(key));
    const job=sharedRequest(async()=>{
      const value=await this.collect(query);requestSignal()?.throwIfAborted();
      const id=digest({version:MEMBER_VOTES_VERSION,...value}),bytes=Buffer.byteLength(JSON.stringify(value));
      if(bytes>this.limits.cacheBytes)throw new HttpError(503,'vote_snapshot_size','The bounded period snapshot is too large to retain. Choose a single sitting.');
      requestSignal()?.throwIfAborted();
      if(!this.snapshots.has(id)){this.snapshots.set(id,{at:this.clock(),value,bytes});this.cacheBytes+=bytes;}
      this.periods.set(key,{at:this.clock(),id});this.prune();return {...value,id};
    },this.limits.timeoutMs).finally(()=>this.pending.delete(key));
    this.pending.set(key,job);return waitForRequest(job);
  }

  async query(memberId,query){
    const id=String(memberId);if(!/^[1-9]\d*$/.test(id)||!Number.isSafeInteger(Number(id)))throw new HttpError(400,'invalid_id','Use a positive person identifier.');
    const snapshot=await this.snapshot(query);requestSignal()?.throwIfAborted();
    const {period,coverage}=snapshot;
    if(query.decision&&period.from&&(query.decision.slice(7,17)<period.from||query.decision.slice(7,17)>period.to))throw new HttpError(400,'decision_outside_period','Choose a decision in the resolved period.');
    const projected=snapshot.days.map(day=>projectMemberSitting(day,id,query.language));
    const items=projected.flatMap(day=>day.items).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.id.localeCompare(b.id));
    const positions=query.positions||'all',alignment=query.alignment||'all';
    const alignmentCounts=coverage.status==='unavailable'?null:items.reduce((counts,item)=>{counts[memberVoteAlignment(item)]++;return counts;},{with:0,against:0,abstained:0,unclassified:0});
    const filtered=items.filter(item=>(positions!=='recorded'||item.actualPosition.status==='recorded')&&(alignment==='all'||item.alignment===alignment));
    const page=filtered.slice(query.offset,query.offset+query.limit),selected=query.decision?items.find(item=>item.id===query.decision)||null:null;
    const subjects=projected.flatMap(day=>day.subjects).map(subject=>({...subject,counts:{observed:items.filter(item=>item.subjectId===subject.id).length,filtered:filtered.filter(item=>item.subjectId===subject.id).length,page:page.filter(item=>item.subjectId===subject.id).length}}));
    return {version:MEMBER_VOTES_VERSION,member:{id,uri:'https://data.europarl.europa.eu/person/'+id,mandateStatus:'not-assessed',historicalGroupStatus:'not-collected'},period,snapshotId:snapshot.id,positions,alignment,alignmentCounts,subjects,pagination:{offset:query.offset,limit:query.limit,returned:page.length,observedTotal:items.length,recordedTotal:coverage.status==='unavailable'?null:items.filter(item=>item.actualPosition.status==='recorded').length,filteredTotal:filtered.length,nextOffset:query.offset+page.length<filtered.length?query.offset+page.length:null},items:page,selected:{status:query.decision?(selected?'found':coverage.status==='unavailable'?'unavailable':'not-found-in-scanned-data'):'not-requested',item:selected},coverage,attribution:'European Parliament Open Data API v2, CC BY 4.0'};
  }
}

export const memberVotes=new MemberVotes();
