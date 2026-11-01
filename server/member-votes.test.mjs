import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemberVotes, MEMBER_VOTES_LIMITS, memberVotesQuery} from './member-votes.mjs';
import {cancelledRequest,requestSignal,runWithRequestSignal} from './request-budget.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/insights-live-20261014.json',import.meta.url)));
const NOW=Date.parse('2026-10-17T19:10:00Z');
const SITTING='MTG-PL-2026-10-07';
const MEMBER='197591';
const clone=value=>structuredClone(value);
const sourceMeeting=fixture.meetings.payload.data.find(row=>row.activity_id===SITTING);
// The older retained fixture omits JSON-LD types; annotate this projected
// collector input so the conducted-ballot evidence is explicit.
const finalDecision={...fixture.decisions.payload.data.find(row=>row.activity_id===SITTING+'-DEC-197457'),type:'Vote'};
const finalResult=fixture.results.payload.data.find(row=>row.consists_of?.includes(finalDecision.id));
// Successful collector fixtures deliberately narrow the meeting graph too.
// Keeping the source's other declared results would describe incomplete data.
const meeting={...sourceMeeting,consists_of:[finalResult.id]};
const query=value=>memberVotesQuery(new URLSearchParams(value),{now:NOW});

function source(endpoint,params,data,extra={}) {
  const url=new URL('https://data.europarl.europa.eu/api/v2'+endpoint);
  for(const [key,value] of Object.entries(params||{}))url.searchParams.set(key,String(value));
  return {url:url.href,fetchedAt:NOW,payload:{data:clone(data)},...extra};
}

function setup({decisions=[finalDecision],results,agenda=fixture.foreseen.payload.data,meetings=[meeting],override,limits={},clock=()=>NOW}={}) {
  const calls=[];
  const rawResults=results??[{...clone(finalResult),consists_of:decisions.map(row=>row.id)}];
  const request=async(endpoint,params={})=>{
    const call={endpoint,params:{...params}};calls.push(call);
    let kind,rows;
    if(endpoint==='/meetings'){kind='catalogue';rows=meetings;}
    else if(endpoint===`/meetings/${SITTING}`){kind='meeting';rows=meetings.filter(row=>row.activity_id===SITTING);}
    else if(endpoint.endsWith('/decisions')){
      kind=params['vote-method']==='ROLL_CALL_EV'?'named':'decisions';
      rows=kind==='named'?decisions:decisions.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('had_voter'))));
    }else if(endpoint.endsWith('/vote-results')){kind='results';rows=rawResults;}
    else if(endpoint.endsWith('/foreseen-activities')){kind='agenda';rows=agenda;}
    else throw new Error('Unexpected source read: '+endpoint);
    const offset=Number(params.offset||0),limit=Number(params.limit||Number.MAX_SAFE_INTEGER);
    const supplied=source(endpoint,params,kind==='meeting'?rows:rows.slice(offset,offset+limit));
    if(override){const replacement=await override({...call,kind,rows,supplied});if(replacement!==undefined)return replacement;}
    return supplied;
  };
  return {service:new MemberVotes({readChairs:async()=>null,request,clock,limits}),calls};
}

test('single-sitting collection exposes its bounded period and reuses source reads across members',async()=>{
  const {service,calls}=setup();
  const first=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(first.version,10);
  assert.equal(first.period.sittingId,SITTING);
  assert.equal(first.period.from,'2026-10-07');
  assert.equal(first.period.to,'2026-10-07');
  assert.match(first.snapshotId,/^[a-f0-9]{64}$/);
  assert.equal(first.coverage.status,'complete');
  assert.equal(first.coverage.collectionComplete,true);
  assert.equal(first.coverage.termWide,false);
  assert.deepEqual(first.coverage.expectedSittingIds,[SITTING]);
  assert.deepEqual(first.coverage.scannedSittingIds,[SITTING]);
  assert.deepEqual(first.coverage.failedSittingIds,[]);
  assert.deepEqual(first.coverage.incompleteSittingIds,[]);
  assert.equal(first.pagination.observedTotal,1);
  assert.equal(first.pagination.returned,1);
  assert.equal(first.pagination.nextOffset,null);
  assert.equal(first.items.length,1);
  assert.deepEqual(first.items[0].actualPosition,{status:'recorded',position:'for'});
  assert.deepEqual(first.items[0].intention,{status:'reported',positions:['abstaining']});
  assert.deepEqual(first.items[0].totals,{for:454,against:86,abstaining:110});
  assert.equal(first.items[0].historicalGroup,null);
  const before=calls.length;
  const other=await service.query('197481',query('sitting='+SITTING));
  assert.equal(calls.length,before,'member projection must reuse the collected sitting snapshot');
  assert.equal(other.snapshotId,first.snapshotId);
  assert(!calls.some(call=>call.endpoint==='/meetings'),'an explicit sitting does not require the year catalogue');
  assert(!calls.some(call=>/speeches|plenary-documents|procedures/.test(call.endpoint)),'member projections do not load document or speech details');
  const named=calls.find(call=>call.kind==='named'||call.params['vote-method']==='ROLL_CALL_EV');
  assert(named,'a named-voter source is collected separately');
  assert.notEqual(named.params['filter-output'],'voters','the named source must retain actual voters');
  assert(calls.some(call=>call.endpoint.endsWith('/decisions')&&call.params['filter-output']==='voters'),'all decisions supply completeness and lapsed-decision evidence');
});

test('pagination slices one deterministic collected snapshot rather than refetching source pages',async()=>{
  const decisions=Array.from({length:5},(_,index)=>({...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-${197450+index}`,activity_id:`${SITTING}-DEC-${197450+index}`,activity_order:String(5-index)}));
  const {service,calls}=setup({decisions});
  const first=await service.query(MEMBER,query(`sitting=${SITTING}&limit=2&offset=0`));
  const count=calls.length;
  const second=await service.query(MEMBER,query(`sitting=${SITTING}&limit=2&offset=2&snapshot=${first.snapshotId}`));
  const last=await service.query(MEMBER,query(`sitting=${SITTING}&limit=2&offset=4&snapshot=${first.snapshotId}`));
  assert.deepEqual([first.pagination.returned,second.pagination.returned,last.pagination.returned],[2,2,1]);
  assert.deepEqual([first.pagination.nextOffset,second.pagination.nextOffset,last.pagination.nextOffset],[2,4,null]);
  assert.equal(first.pagination.observedTotal,5);
  assert.equal(second.pagination.observedTotal,5);
  assert.equal(calls.length,count);
  const ids=[...first.items,...second.items,...last.items].map(row=>row.id);
  assert.equal(new Set(ids).size,5);
  const full=await service.query(MEMBER,query(`sitting=${SITTING}&limit=10`));
  assert.deepEqual(ids,full.items.map(row=>row.id));
  assert.equal(full.snapshotId,first.snapshotId);
  await assert.rejects(service.query(MEMBER,query(`sitting=${SITTING}&snapshot=${'0'.repeat(64)}`)),error=>error.status===409);
});

test('declared result children missing from both decision streams prevent complete coverage',async()=>{
  const missing=`eli/dl/event/${SITTING}-DEC-199999`;
  const {service}=setup({results:[{...clone(finalResult),consists_of:[finalDecision.id,missing]}]});
  const result=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(result.items.length,1,'known observations survive incomplete result children');
  assert.equal(result.coverage.status,'partial');
  assert.equal(result.coverage.collectionComplete,false);
  assert.deepEqual(result.coverage.incompleteSittingIds,[SITTING]);
  assert(JSON.stringify(result.coverage).includes('199999'),'the unresolved exact child identifier remains reviewable');
});

test('official undated TF scheduling containers do not invalidate voting or agenda coverage',async()=>{
  const retained=JSON.parse(readFileSync(new URL('./fixtures/member-votes-timeframe.json',import.meta.url)));
  const timeframe=JSON.parse(JSON.stringify(retained.node).replaceAll('2026-10-19','2026-10-07'));
  const {service}=setup({agenda:[...fixture.foreseen.payload.data,timeframe]});
  const result=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(result.coverage.status,'complete');
  assert.equal(result.coverage.sittings[0].completeness.complete,true);
  assert.deepEqual(result.coverage.sittings[0].completeness.invalidSourceIds,[]);
  const conflicting=await setup({agenda:[...fixture.foreseen.payload.data,{...timeframe,activity_date:'2026-10-06'}]}).service.query(MEMBER,query('sitting='+SITTING));
  assert.deepEqual(conflicting.coverage.sittings[0].completeness.invalidSourceIds,[timeframe.id]);
  assert.equal(conflicting.coverage.sittings[0].completeness.complete,false);
  assert.equal(conflicting.coverage.sittings[0].completeness.votingRecordsComplete,true);
  for(const field of ['id','activity_id','activity_date']){
    const bad={...clone(finalDecision),[field]:field==='activity_date'?'2026-10-06':'wrong'};
    const response=await setup({decisions:[bad]}).service.query(MEMBER,query('sitting='+SITTING));
    assert.equal(response.coverage.status,'partial',field+' validation remains strict');
  }
});

test('a limit-sized repeated first page cannot hide undeclared decisions beyond it',async()=>{
  const decisions=Array.from({length:4},(_,i)=>({...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-${285000+i}`,activity_id:`${SITTING}-DEC-${285000+i}`}));
  const {service}=setup({decisions,results:[{...clone(finalResult),consists_of:decisions.slice(0,2).map(row=>row.id)}],limits:{decisionPageSize:2},override:({kind,endpoint,params,rows})=>{
    if(kind==='decisions'||kind==='named')return source(endpoint,params,rows.slice(0,2));
  }});
  const result=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(result.coverage.status,'partial');
  assert.equal(result.coverage.sittings[0].decisions.stopReason,'repeated-page');
  assert.equal(result.pagination.observedTotal,2);
  const duplicated=setup({decisions:decisions.slice(0,2),limits:{decisionPageSize:2},override:({kind,endpoint,params,rows})=>{
    if(kind==='decisions'||kind==='named')return source(endpoint,params,[...rows,...rows]);
  }});
  assert.equal((await duplicated.service.query(MEMBER,query('sitting='+SITTING))).coverage.status,'partial','duplicate rows do not establish an oversized census');
});

test('repeated oversized named streams require conducted Vote roll calls but may omit unheld decisions',async()=>{
  const decisions=Array.from({length:5},(_,i)=>({...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-${286000+i}`,activity_id:`${SITTING}-DEC-${286000+i}`}));
  decisions[3].decision_outcome='def/ep-statuses/LAPSED';
  decisions[4].type='Decision';
  for(const includeOptional of [false,true]){
    const {service}=setup({decisions,limits:{decisionPageSize:2},override:({kind,endpoint,params,rows})=>{
      if(kind==='decisions'||kind==='named')return source(endpoint,params,kind==='named'&&!includeOptional?rows.slice(0,3):rows);
    }});
    const result=await service.query(MEMBER,query('sitting='+SITTING));
    assert.equal(result.coverage.status,'complete');
    assert.equal(result.coverage.sittings[0].namedDecisions.stopReason,'declared-children');
    assert.deepEqual(result.coverage.sittings[0].completeness.missingNamedDecisionIds,[]);
  }
});

test('agenda-only failures retain exact context gaps without marking vote counts incomplete',async()=>{
  const {service}=setup({override:({kind})=>{if(kind==='agenda')throw new Error('Temporary agenda failure');}});
  const result=await service.query(MEMBER,query('sitting='+SITTING));
  const day=result.coverage.sittings[0];
  assert.equal(result.coverage.status,'complete');
  assert.equal(result.coverage.collectionComplete,true);
  assert.equal(day.completeness.votingRecordsComplete,true);
  assert.equal(day.completeness.complete,false);
  assert.equal(day.agenda.stopReason,'error');
  assert(day.completeness.unresolvedAgendaItemIds.length>0);
  assert(result.items[0].context.missingAgendaItemIds.length>0);
  assert.equal(result.pagination.recordedTotal,1);
});

test('repeated full decision responses require exact declared identities and a complete result graph',async()=>{
  const decisions=Array.from({length:4},(_,i)=>({...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-${280000+i}`,activity_id:`${SITTING}-DEC-${280000+i}`}));
  for(const scenario of ['exact','same-count-wrong-id','results-error','named-missing','changed-decision']){
    const children=decisions.map(row=>row.id);
    if(scenario==='same-count-wrong-id')children[3]=`eli/dl/event/${SITTING}-DEC-299999`;
    const {service}=setup({decisions,results:[{...clone(finalResult),consists_of:children}],limits:{decisionPageSize:2},override:({kind,endpoint,params,rows})=>{
      if(kind==='results'&&scenario==='results-error')throw new Error('Result source unavailable');
      if(kind==='decisions'||kind==='named'){
        const supplied=clone(rows);
        if(kind==='named'&&scenario==='named-missing')supplied.pop();
        if(scenario==='changed-decision'&&params.offset)supplied[0].decision_outcome='def/ep-statuses/REJECTED';
        return source(endpoint,params,supplied);
      }
    }});
    const result=await service.query(MEMBER,query('sitting='+SITTING));
    assert.equal(result.coverage.status,scenario==='exact'?'complete':'partial',scenario);
    if(scenario==='exact'){
      assert.equal(result.coverage.sittings[0].decisions.stopReason,'declared-children');
      assert.equal(result.coverage.sittings[0].namedDecisions.stopReason,'declared-children');
      assert.equal(result.pagination.observedTotal,4);
    }
  }
});

test('retained 400-decision ODP census ignores offsets but reconciles every exact result child',async()=>{
  const retained=JSON.parse(readFileSync(new URL('./fixtures/member-votes-repeated-census.json',import.meta.url)));
  const sittingId='MTG-PL-2026-10-21',date='2026-10-21',calls=[];
  const service=new MemberVotes({readChairs:async()=>null,clock:()=>Date.parse('2026-10-25T12:00:00Z'),request:async(endpoint,params)=>{
    calls.push({endpoint,params});
    const rows=endpoint.endsWith('/decisions')?retained.decisionRows.filter(n=>!params['vote-method']||n.decision_method.endsWith('/VOTE_ELECTRONIC_ROLLCALL')):endpoint.endsWith('/vote-results')?retained.results:[];
    return source(endpoint,params,rows);
  }});
  const day=await service.sitting({activity_id:sittingId,activity_date:date,consists_of:retained.results.map(n=>n.id)},{bytes:0});
  assert.equal(day.coverage.state,'complete');
  assert.equal(day.coverage.decisions.stopReason,'declared-children');
  assert.equal(day.coverage.observedDecisionCount,400);
  assert.equal(day.coverage.completeness.declaredDecisionCount,400);
  assert.deepEqual(day.coverage.completeness.missingDecisionIds,[]);
  assert.equal(calls.filter(call=>call.endpoint.endsWith('/decisions')&&!call.params['vote-method']).length,2);
});

test('failed selected-sitting metadata is unavailable rather than a complete empty period',async()=>{
  const {service}=setup({override:({kind})=>{if(kind==='meeting')throw new Error('Selected sitting unavailable');}});
  const result=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(result.period.sittingId,SITTING);
  assert.equal(result.items.length,0);
  assert.equal(result.coverage.status,'unavailable');
  assert.equal(result.coverage.collectionComplete,false);
  assert.deepEqual(result.coverage.failedSittingIds,[SITTING]);
});

test('a valid empty source period is distinct from unavailable decision content',async()=>{
  const complete=setup({decisions:[],results:[],agenda:[],meetings:[{...meeting,consists_of:[]}]});
  const empty=await complete.service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(empty.coverage.status,'complete');
  assert.equal(empty.coverage.collectionComplete,true);
  assert.equal(empty.pagination.observedTotal,0);
  assert.deepEqual(empty.items,[]);
  const missing=setup({decisions:[],results:[],agenda:[],override:({kind})=>{if(kind==='decisions'||kind==='named')throw Object.assign(new Error('No content'),{status:502,code:'odp_no_content'});}});
  const unavailable=await missing.service.query(MEMBER,query('sitting='+SITTING));
  assert.notEqual(unavailable.coverage.status,'complete');
  assert.equal(unavailable.coverage.collectionComplete,false);
  assert.deepEqual(unavailable.items,[]);
});

test('meeting-declared result identities prevent empty or omitted result streams from becoming complete',async()=>{
  const expected=sourceMeeting.consists_of.filter(id=>new RegExp('^eli/dl/event/'+SITTING+'-VOT-ITM-\\d+$').test(id));
  const {service}=setup({decisions:[],results:[],agenda:[],meetings:[sourceMeeting]});
  const empty=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(empty.pagination.observedTotal,0);
  assert.equal(empty.coverage.status,'partial');
  assert.equal(empty.coverage.collectionComplete,false);
  assert.deepEqual(empty.coverage.sittings[0].completeness.missingResultIds,[...expected]);
  assert.equal(empty.coverage.sittings[0].completeness.declaredResultCount,7);
  const missing=`eli/dl/event/${SITTING}-VOT-ITM-999999`;
  const otherHost='https://example.invalid/eli/dl/event/'+SITTING+'-VOT-ITM-000002';
  const otherDay='eli/dl/event/MTG-PL-2026-10-08-VOT-ITM-000003';
  const incomplete=setup({meetings:[{...meeting,consists_of:[finalResult.id,missing,otherHost,otherDay,finalResult.id+'-SPLIT-1']}]});
  const retained=await incomplete.service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(retained.items.length,1);
  assert.deepEqual(retained.coverage.sittings[0].completeness.missingResultIds,[missing]);
  assert.equal(retained.coverage.sittings[0].completeness.declaredResultCount,2);
  assert.equal(retained.coverage.collectionComplete,false);
});

test('decision endpoints that ignore offset terminate on repeats and keep coverage uncertain',async()=>{
  const count=MEMBER_VOTES_LIMITS.pageSize;
  const decisions=Array.from({length:count},(_,index)=>({...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-${200000+index}`,activity_id:`${SITTING}-DEC-${200000+index}`}));
  const {service,calls}=setup({decisions,limits:{decisionPageSize:count},override:({kind,endpoint,params,rows})=>{
    if(kind==='decisions'||kind==='named')return source(endpoint,params,rows);
  }});
  const result=await service.query(MEMBER,query(`sitting=${SITTING}&limit=100`));
  assert.equal(result.coverage.status,'partial');
  assert.equal(result.coverage.collectionComplete,false);
  assert.equal(new Set(result.items.map(row=>row.id)).size,result.items.length);
  assert.equal(result.pagination.observedTotal,count);
  assert(calls.filter(call=>call.endpoint.endsWith('/decisions')).length<=4,'each repeated stream stops after its second identical page');
  assert(JSON.stringify(result.coverage).match(/repeat/i));
});

test('later source-page failure retains observed decisions and reports partial collection',async()=>{
  const count=MEMBER_VOTES_LIMITS.pageSize;
  const decisions=Array.from({length:count},(_,index)=>({...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-${210000+index}`,activity_id:`${SITTING}-DEC-${210000+index}`}));
  const {service}=setup({decisions,limits:{decisionPageSize:count},override:({kind,params})=>{
    if((kind==='decisions'||kind==='named')&&Number(params.offset)>0)throw new Error('Second page temporarily unavailable');
  }});
  const result=await service.query(MEMBER,query(`sitting=${SITTING}&limit=100`));
  assert.equal(result.coverage.status,'partial');
  assert.equal(result.coverage.collectionComplete,false);
  assert.equal(result.pagination.observedTotal,count);
  assert(result.items.length>0);
  assert.match(JSON.stringify(result.coverage),/Second page temporarily unavailable/);
});

test('204 after a full source page terminates that stream without losing observed rows',async()=>{
  const count=MEMBER_VOTES_LIMITS.pageSize;
  const decisions=Array.from({length:count},(_,index)=>({...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-${220000+index}`,activity_id:`${SITTING}-DEC-${220000+index}`}));
  const {service}=setup({decisions,limits:{decisionPageSize:count},override:({kind,params})=>{
    if((kind==='decisions'||kind==='named')&&Number(params.offset)>0)throw Object.assign(new Error('No further content'),{status:502,code:'odp_no_content'});
  }});
  const result=await service.query(MEMBER,query(`sitting=${SITTING}&limit=100`));
  assert.equal(result.coverage.status,'complete');
  assert.equal(result.coverage.collectionComplete,true);
  assert.equal(result.pagination.observedTotal,count);
});

test('records returned for another sitting are rejected instead of contaminating the period',async()=>{
  const foreign=JSON.parse(JSON.stringify(finalDecision).replaceAll('2026-10-07','2026-10-06'));
  const {service}=setup({decisions:[foreign],results:[]});
  const result=await service.query(MEMBER,query('sitting='+SITTING));
  assert.deepEqual(result.items,[]);
  assert.notEqual(result.coverage.status,'complete');
  assert.equal(result.coverage.collectionComplete,false);
});

test('source stale and refresh-error observations survive in response provenance',async()=>{
  const {service}=setup({override:({kind,supplied})=>kind==='named'?{...supplied,stale:true,refreshError:'Public source refresh delayed'}:undefined});
  const result=await service.query(MEMBER,query('sitting='+SITTING));
  const serial=JSON.stringify(result);
  assert(serial.includes('Public source refresh delayed'));
  assert(serial.includes('"stale":true'));
  assert(serial.includes(new Date(NOW).toISOString()),'retrieval timestamp is explicit');
});

test('selected decisions are resolved from the full snapshot independently of the visible page',async()=>{
  const decisions=Array.from({length:3},(_,index)=>({...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-${230000+index}`,activity_id:`${SITTING}-DEC-${230000+index}`}));
  const {service}=setup({decisions});
  const whole=await service.query(MEMBER,query(`sitting=${SITTING}&limit=10`));
  const selectedId=whole.items.at(-1).id;
  const page=await service.query(MEMBER,query(`sitting=${SITTING}&limit=1&decision=${selectedId}&snapshot=${whole.snapshotId}`));
  assert.equal(page.items.length,1);
  assert.notEqual(page.items[0].id,selectedId);
  assert.equal(page.selected.status,'found');
  assert.equal(page.selected.item.id,selectedId);
});

test('a reader abort stops only that wait and leaves the shared period load available to another reader',async()=>{
  let entered,release;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const held=new Promise(resolve=>{release=resolve;});
  const {service,calls}=setup({override:async({kind,supplied})=>{
    if(kind==='meeting'){entered();await held;return supplied;}
  }});
  const controller=new AbortController();
  const abandoned=runWithRequestSignal(controller.signal,()=>service.query(MEMBER,query('sitting='+SITTING)));
  await waiting;
  const continuing=service.query('197481',query('sitting='+SITTING));
  controller.abort(cancelledRequest());
  await assert.rejects(abandoned,error=>error.code==='request_cancelled');
  release();
  const result=await continuing;
  assert.equal(result.coverage.status,'complete');
  const count=calls.length;
  await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(calls.length,count,'the completed shared load is reusable');
});

for(const code of ['request_cancelled','request_timeout','upstream_busy'])test(`local ${code} is propagated and never cached as a source coverage gap`,async()=>{
  let fail=true;
  const {service,calls}=setup({override:({kind})=>{
    if(kind==='named'&&fail)throw Object.assign(new Error('Local request was interrupted'),{status:503,code});
  }});
  await assert.rejects(service.query(MEMBER,query('sitting='+SITTING)),error=>error.code===code);
  const count=calls.length;fail=false;
  const retry=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(retry.coverage.status,'complete');
  assert.equal(retry.coverage.collectionComplete,true);
  assert(calls.length>count,'a failed local load was not published in the snapshot cache');
});

test('a failed stream aborts sibling ownership and prevents further paging after the loader ends',async()=>{
  let fail=true,release;
  const held=new Promise(resolve=>{release=resolve;}),signals=[];
  const {service,calls}=setup({limits:{decisionPageSize:1},override:async({kind,supplied})=>{
    if(!fail||kind==='meeting')return;
    if(kind==='named')throw Object.assign(new Error('Shared source admission is busy'),{status:503,code:'upstream_busy'});
    signals.push(requestSignal());
    await held;
    return supplied;
  }});
  await assert.rejects(service.query(MEMBER,query('sitting='+SITTING)),error=>error.code==='upstream_busy');
  assert.equal(signals.length,3);
  assert(signals.every(signal=>signal.aborted&&signal.reason.code==='upstream_busy'));
  assert.equal(service.pending.size,0);
  assert.equal(service.snapshots.size,0);
  const before=calls.length;
  release();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,before,'late sibling responses cannot start another page without an owner');
  fail=false;
  const retry=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(retry.coverage.status,'complete');
});

test('an already-aborted reader cannot start source collection',async()=>{
  const {service,calls}=setup();
  const controller=new AbortController();controller.abort(cancelledRequest());
  await assert.rejects(runWithRequestSignal(controller.signal,()=>service.query(MEMBER,query('sitting='+SITTING))),error=>error.code==='request_cancelled');
  assert.equal(calls.length,0);
});

test('a retained latest snapshot pins its resolved week before consulting a changed catalogue',async()=>{
  let now=NOW;
  const meetings=[clone(meeting)];
  const {service,calls}=setup({meetings,clock:()=>now});
  const first=await service.query(MEMBER,query('week=latest'));
  assert.equal(first.period.week,'2026-10-05');
  const count=calls.length;
  meetings.push(JSON.parse(JSON.stringify(meeting).replaceAll('2026-10-07','2026-10-14')));
  now+=MEMBER_VOTES_LIMITS.cacheMs+1;
  const pinned=await service.query(MEMBER,query('week=latest&snapshot='+first.snapshotId));
  assert.equal(pinned.period.week,'2026-10-05');
  assert.equal(pinned.snapshotId,first.snapshotId);
  assert.equal(calls.length,count,'the latest catalogue is irrelevant to an explicitly retained snapshot');
});

test('week collection reads only that held period and never loads other weeks or full-term details',async()=>{
  const meetings=[meeting,...['2026-10-14','2026-10-19'].map(date=>JSON.parse(JSON.stringify(meeting).replaceAll('2026-10-07',date)))];
  const {service,calls}=setup({meetings});
  const result=await service.query(MEMBER,query('week=2026-10-05'));
  assert.equal(result.period.kind,'week');
  assert.equal(result.period.week,'2026-10-05');
  assert.equal(result.period.from,'2026-10-05');
  assert.equal(result.period.to,'2026-10-11');
  assert.deepEqual(result.coverage.expectedSittingIds,[SITTING]);
  assert.equal(result.coverage.termWide,false);
  assert.equal(result.coverage.status,'complete');
  assert.deepEqual(calls.filter(call=>call.endpoint==='/meetings').map(call=>call.params.year),[2026]);
  assert(calls.every(call=>call.endpoint==='/meetings'||call.endpoint.startsWith('/meetings/'+SITTING+'/')));
});

test('the first term week is accepted while weeks wholly before the term remain invalid',()=>{
  assert.equal(query('week=2024-07-15').week,'2024-07-15');
  assert.throws(()=>query('week=2024-07-08'),error=>error.status===400);
  assert.throws(()=>query('sitting=MTG-PL-2024-07-15'),error=>error.status===400);
});

test('the snapshot identity changes with unprojected raw data, exact context, source content and coverage',async()=>{
  const base=await setup().service.query(MEMBER,query('sitting='+SITTING));
  const variants=[
    setup({decisions:[{...clone(finalDecision),sourceRevisionMarker:'new raw source field'}]}),
    setup({results:[{...clone(finalResult),consists_of:[finalDecision.id],based_on_a_realization_of:['eli/dl/doc/A-10-2026-9999']}]}),
    setup({agenda:fixture.foreseen.payload.data.map(row=>({...clone(row),sourceRevisionMarker:'new agenda source field'}))}),
    setup({results:[{...clone(finalResult),consists_of:[finalDecision.id,`eli/dl/event/${SITTING}-DEC-999999`]}]})
  ];
  const ids=[];
  for(const {service} of variants)ids.push((await service.query(MEMBER,query('sitting='+SITTING))).snapshotId);
  assert(ids.every(id=>id!==base.snapshotId));
  assert.equal(new Set(ids).size,ids.length);
});

test('a collector owner timeout is propagated and cannot publish the late source response',async()=>{
  let delay=true;
  const {service,calls}=setup({limits:{timeoutMs:5},override:async({kind,supplied})=>{
    if(kind==='named'&&delay){await new Promise(resolve=>setTimeout(resolve,20));return supplied;}
  }});
  await assert.rejects(service.query(MEMBER,query('sitting='+SITTING)),error=>error.code==='request_timeout');
  await new Promise(resolve=>setTimeout(resolve,25));
  const count=calls.length;delay=false;
  const retry=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(retry.coverage.status,'complete');
  assert(calls.length>count,'the response that arrived after the owner deadline was not cached');
});

test('decision page caps stop bounded retrieval without claiming complete collection',async()=>{
  const decisions=Array.from({length:3},(_,index)=>({...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-${240000+index}`,activity_id:`${SITTING}-DEC-${240000+index}`}));
  const {service,calls}=setup({decisions,limits:{decisionPageSize:2,decisionPages:1}});
  const result=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(result.coverage.status,'partial');
  assert.equal(result.coverage.collectionComplete,false);
  assert.equal(result.pagination.observedTotal,2);
  assert.equal(result.coverage.sittings[0].decisions.stopReason,'page-budget');
  assert.equal(result.coverage.sittings[0].namedDecisions.stopReason,'page-budget');
  assert.equal(calls.filter(call=>call.endpoint.endsWith('/decisions')).length,2);
});

test('named decision collection continues beyond the old first-250 boundary',async()=>{
  const small={...clone(finalDecision),had_voter_favor:['person/'+MEMBER],had_voter_against:[],had_voter_abstention:[],number_of_votes_favor:1,number_of_votes_against:0,number_of_votes_abstention:0};
  const decisions=Array.from({length:260},(_,index)=>({...clone(small),id:`eli/dl/event/${SITTING}-DEC-${250000+index}`,activity_id:`${SITTING}-DEC-${250000+index}`}));
  const {service,calls}=setup({decisions});
  const selectedId=decisions.at(-1).activity_id;
  const result=await service.query(MEMBER,query(`sitting=${SITTING}&offset=250&limit=25&decision=${selectedId}`));
  assert.equal(result.coverage.status,'complete');
  assert.equal(result.pagination.observedTotal,260);
  assert.equal(result.pagination.returned,10);
  assert.equal(result.pagination.nextOffset,null);
  assert.equal(result.selected.item.id,selectedId);
  assert.deepEqual(result.selected.item.actualPosition,{status:'recorded',position:'for'});
  assert.deepEqual(calls.filter(call=>call.params['vote-method']==='ROLL_CALL_EV').map(call=>call.params.offset),[0,250]);
});

test('result collection follows later pages and checks all declared decision children',async()=>{
  const first={...clone(finalResult),consists_of:[finalDecision.id]};
  const secondDecision={...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-250300`,activity_id:`${SITTING}-DEC-250300`,inverse_consists_of:[`eli/dl/event/${SITTING}-VOT-ITM-999999`]};
  const second={...clone(finalResult),id:`eli/dl/event/${SITTING}-VOT-ITM-999999`,activity_id:`${SITTING}-VOT-ITM-999999`,consists_of:[secondDecision.id]};
  const agenda=fixture.foreseen.payload.data.filter(row=>row.id==='eli/dl/event/'+SITTING+'-OJ-ITM-V-48');
  const {service,calls}=setup({decisions:[finalDecision,secondDecision],results:[first,second],agenda,limits:{pageSize:1}});
  const result=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(result.coverage.status,'complete');
  assert.equal(result.coverage.sittings[0].results.rows,2);
  assert.equal(result.coverage.sittings[0].completeness.complete,true);
  assert.deepEqual(calls.filter(call=>call.endpoint.endsWith('/vote-results')).map(call=>call.params.offset),[0,1,2]);
});

test('official undated roll-call and split request metadata does not invalidate dated result coverage',async()=>{
  const result={...clone(finalResult),consists_of:[finalDecision.id]};
  const requests=[['SPLIT','REQUEST_VOTE_SPLIT'],['RCV','REQUEST_VOTE_ROLLCALL'],['SEPARATE','REQUEST_VOTE_SEPARATE']].map(([suffix,type])=>({
    id:`${result.id}-${suffix}-1`,activity_id:`${result.activity_id}-${suffix}-1`,had_activity_type:'def/ep-activities/'+type,type:'Activity'
  }));
  const auxiliary={id:`eli/dl/event/${SITTING}-TF-1000`,activity_id:`${SITTING}-TF-1000`,had_activity_type:'def/ep-activities/PROCEEDING_ACTIVITY'};
  const {service}=setup({results:[result,...requests,auxiliary]});
  const response=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(response.coverage.status,'complete');
  assert.deepEqual(response.coverage.sittings[0].completeness.invalidSourceIds,[]);
  assert.equal(response.coverage.sittings[0].results.rows,5);
  assert.equal(response.items[0].date,'2026-10-07');
});

test('one week does not burst two sittings into the shared admission queue together',async()=>{
  let active=0,maximum=0;
  const nextMeeting=JSON.parse(JSON.stringify(meeting).replaceAll('2026-10-07','2026-10-08'));
  const {service}=setup({meetings:[meeting,nextMeeting],override:async({kind,endpoint,supplied})=>{
    if(kind==='catalogue')return supplied;
    active++;maximum=Math.max(maximum,active);
    await new Promise(resolve=>setImmediate(resolve));active--;
    return endpoint.includes('2026-10-08')?JSON.parse(JSON.stringify(supplied).replaceAll('2026-10-07','2026-10-08')):supplied;
  }});
  const response=await service.query(MEMBER,query('week=2026-10-05'));
  assert.deepEqual(response.coverage.scannedSittingIds,[SITTING,'MTG-PL-2026-10-08']);
  assert.equal(maximum,4,'daily streams may share slots, but the next sitting waits for the current one');
});

test('overlapping source tallies and component references retain both conflicting observations',async()=>{
  const censusAmendment='eli/dl/doc/A-10-2026-0237-AM-12',namedAmendment='eli/dl/doc/A-10-2026-0237-AM-60';
  const {service}=setup({override:({kind,supplied})=>{
    if(kind==='decisions')return {...supplied,payload:{data:supplied.payload.data.map(row=>({...row,number_of_votes_favor:1,decided_on_a_realization_of:[censusAmendment]}))}};
    if(kind==='named')return {...supplied,payload:{data:supplied.payload.data.map(row=>({...row,decided_on_a_realization_of:[namedAmendment]}))}};
  }});
  const response=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(response.coverage.collectionComplete,false);
  assert.deepEqual(response.coverage.sittings[0].completeness.conflictingDecisionIds,[finalDecision.id]);
  const conflict=response.items[0].sourceConflicts;
  assert(conflict.fields.includes('number_of_votes_favor'));
  assert(conflict.fields.includes('decided_on_a_realization_of'));
  assert.equal(conflict.census.number_of_votes_favor,1);
  assert.equal(conflict.named.number_of_votes_favor,454);
  assert.deepEqual(conflict.census.decided_on_a_realization_of,[censusAmendment]);
  assert.deepEqual(conflict.named.decided_on_a_realization_of,[namedAmendment]);
});

test('opposite outcomes duplicated within one page cannot publish a complete observation',async()=>{
  const {service}=setup({override:({kind,supplied})=>{
    if(kind==='decisions'||kind==='named')return {...supplied,payload:{data:[supplied.payload.data[0],{...supplied.payload.data[0],decision_outcome:'def/ep-statuses/REJECTED'}]}};
  }});
  const response=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(response.coverage.collectionComplete,false);
  assert.equal(response.coverage.sittings[0].decisions.error.code,'vote_source_changed');
  assert.equal(response.coverage.sittings[0].namedDecisions.error.code,'vote_source_changed');
  assert.equal(response.pagination.observedTotal,0);
});

test('a short nonempty duplicate-only page remains incomplete rather than an end marker',async()=>{
  const second={...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-250999`,activity_id:`${SITTING}-DEC-250999`};
  const {service}=setup({decisions:[finalDecision,second],limits:{decisionPageSize:2},override:({kind,params,supplied})=>{
    if((kind==='decisions'||kind==='named')&&params.offset===2)return {...supplied,payload:{data:[kind==='named'?clone(finalDecision):Object.fromEntries(Object.entries(finalDecision).filter(([key])=>!key.startsWith('had_voter')))]}};
  }});
  const response=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(response.coverage.collectionComplete,false);
  assert.equal(response.coverage.sittings[0].decisions.stopReason,'repeated-page');
  assert.equal(response.coverage.sittings[0].namedDecisions.stopReason,'repeated-page');
  assert.equal(response.pagination.observedTotal,2);
});

test('recorded-only pages retain full observed counts, subject counts and off-filter selected decisions',async()=>{
  const decisions=Array.from({length:5},(_,index)=>({...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-${270000+index}`,activity_id:`${SITTING}-DEC-${270000+index}`}));
  for(const index of [1,3]){decisions[index].decision_method='def/ep-decision-methods/VOTE_HAND';delete decisions[index].had_voter_favor;}
  const {service,calls}=setup({decisions});
  const all=await service.query(MEMBER,query(`sitting=${SITTING}&limit=10`));
  const reads=calls.length;
  const first=await service.query(MEMBER,query(`sitting=${SITTING}&positions=recorded&limit=2&decision=${decisions[3].activity_id}&snapshot=${all.snapshotId}`));
  const next=await service.query(MEMBER,query(`sitting=${SITTING}&positions=recorded&limit=2&offset=2&snapshot=${all.snapshotId}`));
  assert.equal(first.positions,'recorded');
  assert.deepEqual(first.pagination,{offset:0,limit:2,returned:2,observedTotal:5,recordedTotal:3,filteredTotal:3,nextOffset:2});
  assert.deepEqual(next.pagination,{offset:2,limit:2,returned:1,observedTotal:5,recordedTotal:3,filteredTotal:3,nextOffset:null});
  assert([...first.items,...next.items].every(item=>item.actualPosition.status==='recorded'));
  assert.equal(new Set([...first.items,...next.items].map(item=>item.id)).size,3);
  assert.equal(first.selected.status,'found');assert.equal(first.selected.item.id,decisions[3].activity_id);
  assert.equal(first.selected.item.actualPosition.status,'unavailable');
  assert.deepEqual(first.subjects[0].counts,{observed:5,filtered:3,page:2});
  assert.deepEqual(next.subjects[0].counts,{observed:5,filtered:3,page:1});
  assert.equal(first.subjects[0].wholeTextDecisions.length,5,'whole-text evidence is independent of member filter/page');
  const other=await service.query('999999',query(`sitting=${SITTING}&positions=recorded&snapshot=${all.snapshotId}`));
  assert.equal(other.pagination.observedTotal,5);assert.equal(other.pagination.filteredTotal,0);assert.deepEqual(other.items,[]);
  assert.equal(other.snapshotId,all.snapshotId);assert.equal(calls.length,reads);
});

test('invalid recorded filters are rejected and default compatibility is all',()=>{
  assert.equal(query('sitting='+SITTING).positions,'all');
  assert.equal(query('positions=recorded').positions,'recorded');
  for(const value of ['positions=','positions=REcorded','positions=for','positions=all&positions=recorded'])assert.throws(()=>query(value),error=>error.status===400);
});

test('conflicting decision streams withhold all derived position, totals, outcome and subject evidence',async()=>{
  const {service}=setup({override:({kind,supplied})=>kind==='named'?{...supplied,payload:{data:supplied.payload.data.map(row=>({...row,decision_outcome:'def/ep-statuses/REJECTED'}))}}:undefined});
  const all=await service.query(MEMBER,query('sitting='+SITTING));
  const item=all.items[0];
  assert.equal(item.actualPosition.status,'conflicting');assert.equal(item.ballotStatus,'unknown');
  assert.equal(item.method,null);assert.equal(item.outcome,null);assert.equal(item.subjectId,null);
  assert.deepEqual(item.totals,{for:null,against:null,abstaining:null});
  assert.deepEqual(item.parts,[]);assert.deepEqual(item.rollCallRequesters,[]);
  assert.equal(all.subjects[0].wholeTextDecisions.length,0);
  const recorded=await service.query(MEMBER,query(`sitting=${SITTING}&positions=recorded&snapshot=${all.snapshotId}&decision=${item.id}`));
  assert.equal(recorded.pagination.filteredTotal,0);assert.equal(recorded.selected.item.actualPosition.status,'conflicting');
});

test('auxiliary request wording is retained with exact source JSON pointers and bound into snapshot identity',async()=>{
  const evidence=JSON.parse(readFileSync(new URL('./fixtures/member-votes-evidence.json',import.meta.url)));
  const results=evidence.resultSources.flatMap(source=>source.payload.data).filter(node=>node.activity_id.startsWith(SITTING));
  const decisions=evidence.decisionSources.flatMap(source=>source.payload.data).filter(node=>node.activity_id.startsWith(SITTING));
  let changed=false;
  const {service}=setup({results,decisions,limits:{cacheMs:0},override:({kind,supplied})=>{
    if(kind==='results'&&changed){const replacement=clone(supplied);for(const node of replacement.payload.data.flatMap(node=>[node,...(node.was_motivated_by||[])]))if(node.activity_id?.endsWith('993151-SPLIT-1'))node.created_a_realization_of.find(component=>component.identifier.endsWith('-1-2')).expressionContent.en='<partValue>changed public wording</partValue>';return replacement;}
  }});
  const first=await service.query(MEMBER,query(`sitting=${SITTING}&decision=${SITTING}-DEC-197847`));
  const part=first.selected.item.parts[0];
  assert.equal(part.contentByLanguage.en.text,'‘and completing the European defence union’');
  assert(part.evidencePaths.some(path=>/^\/data\/\d+\/created_a_realization_of\/\d+$/.test(path.jsonPointer)));
  changed=true;
  const second=await service.query(MEMBER,query(`sitting=${SITTING}&decision=${SITTING}-DEC-197847`));
  assert.notEqual(first.snapshotId,second.snapshotId);
  assert.equal(second.selected.item.parts[0].contentByLanguage.en.text,'changed public wording');
  const pinned=await service.query(MEMBER,query(`sitting=${SITTING}&decision=${SITTING}-DEC-197847&snapshot=${first.snapshotId}`));
  assert.equal(pinned.selected.item.parts[0].contentByLanguage.en.text,part.contentByLanguage.en.text);
});

test('reordered repeated result pages keep every nested pointer tied to the exact retained source node',async()=>{
  const evidence=JSON.parse(readFileSync(new URL('./fixtures/member-votes-evidence.json',import.meta.url)));
  const result=evidence.resultSources.flatMap(source=>source.payload.data).find(node=>node.activity_id.endsWith('993151'));
  const decisions=evidence.decisionSources.flatMap(source=>source.payload.data).filter(node=>node.activity_id.startsWith(SITTING));
  // Add an exact RCV edge to this synthetic projection to exercise both paths.
  const rcv={id:result.id+'-RCV-99',activity_id:result.activity_id+'-RCV-99',had_activity_type:'def/ep-activities/REQUEST_VOTE_ROLLCALL',responsible_organization_label:{en:'Exact request organization'}};
  result.was_motivated_by.push(rcv);
  decisions.find(node=>node.activity_id.endsWith('197847')).was_motivated_by.push(rcv.id);
  const payloads=new Map();
  const {service}=setup({decisions,results:[result],limits:{pageSize:1},override:({kind,endpoint,params,supplied})=>{
    if(kind!=='results')return;
    const node=clone(result);
    if(params.offset){node.was_motivated_by.reverse();for(const request of node.was_motivated_by)request.created_a_realization_of?.reverse();}
    const response=source(endpoint,params,[node]);payloads.set(response.url,response.payload);return response;
  }});
  const response=await service.query(MEMBER,query(`sitting=${SITTING}&decision=${SITTING}-DEC-197847`));
  assert.equal(response.coverage.sittings[0].results.stopReason,'repeated-page');
  const item=response.selected.item;assert.equal(item.parts.length,1);assert.equal(item.rollCallRequesters.length,1);
  const resolve=path=>path.jsonPointer.slice(1).split('/').reduce((value,key)=>value[key.replaceAll('~1','/').replaceAll('~0','~')],payloads.get(path.sourceUrl));
  for(const part of [item.parts[0],...item.parts[0].contextComponents])for(const path of part.evidencePaths){assert(path.jsonPointer);assert.equal(resolve(path).id.split('/').at(-1),part.componentId);}
  for(const requester of item.rollCallRequesters)for(const path of requester.evidencePaths){assert(path.jsonPointer);assert.equal(resolve(path).id,rcv.id);}
});

test('conflicting component source observations expose alternatives only in sourceConflicts',async()=>{
  const one='eli/dl/doc/A-10-2026-0237-AM-12',two='eli/dl/doc/A-10-2026-0237-AM-60';
  const {service}=setup({override:({kind,supplied})=>['decisions','named'].includes(kind)?{...supplied,payload:{data:supplied.payload.data.map(node=>({...node,decided_on_a_realization_of:[kind==='decisions'?one:two]}))}}:undefined});
  const response=await service.query(MEMBER,query(`sitting=${SITTING}`)),item=response.items[0];
  assert.deepEqual(item.context.documentIds,[]);assert.deepEqual(item.context.amendmentIds,[]);assert.deepEqual(item.context.componentIds,[]);assert.deepEqual(item.context.resultIds,[]);assert.deepEqual(item.context.relationships,[]);
  assert.deepEqual(item.sourceConflicts.census.decided_on_a_realization_of,[one]);
  assert.deepEqual(item.sourceConflicts.named.decided_on_a_realization_of,[two]);
});

test('late conflicting decision pages cannot mutate the cached public source records',async()=>{
  const first=clone(finalDecision),before=JSON.stringify(first);
  const {service}=setup({limits:{decisionPageSize:1},override:({kind,endpoint,params})=>{
    if(kind==='named')return source(endpoint,params,[]);
    if(kind==='decisions')return {url:'https://data.europarl.europa.eu/api/v2'+endpoint+'?offset='+params.offset,fetchedAt:NOW,payload:{data:params.offset?[{...clone(first),decision_outcome:'def/ep-statuses/REJECTED'}]:[first]}};
  }});
  await service.query(MEMBER,query(`sitting=${SITTING}`));
  assert.equal(JSON.stringify(first),before);
  assert.equal('_conflictingSourceObservations' in first,false);
});

test('multiple contradictions retain all values and fields under their actual census/named stream',async()=>{
  const census=clone(finalDecision),later={...clone(finalDecision),number_of_votes_favor:455},named={...clone(finalDecision),decision_outcome:'def/ep-statuses/REJECTED'};
  const payloads=new Map();
  const {service}=setup({limits:{decisionPageSize:1},override:({kind,endpoint,params})=>{
    if(!['decisions','named'].includes(kind))return;
    const response=source(endpoint,params,kind==='decisions'?[params.offset?later:census]:params.offset?[]:[named]);
    payloads.set(response.url,response.payload);return response;
  }});
  const response=await service.query(MEMBER,query('sitting='+SITTING)),item=response.items[0],conflict=item.sourceConflicts;
  assert(conflict.fields.includes('decision_outcome'));assert(conflict.fields.includes('number_of_votes_favor'));
  assert.equal(conflict.census.decision_outcome,'def/ep-statuses/ADOPTED');
  assert.equal(conflict.named.decision_outcome,'def/ep-statuses/REJECTED');
  assert.equal(conflict.observations.length,3);
  assert.deepEqual(conflict.observations.filter(observation=>observation.stream==='census').map(observation=>observation.values.number_of_votes_favor).sort(),[454,455]);
  assert.deepEqual(conflict.observations.filter(observation=>observation.stream==='named').map(observation=>observation.values.decision_outcome),['def/ep-statuses/REJECTED']);
  for(const observation of conflict.observations)for(const path of observation.evidencePaths){const raw=path.jsonPointer.slice(1).split('/').reduce((value,key)=>value[key],payloads.get(path.sourceUrl));for(const [field,value] of Object.entries(observation.values))assert.deepEqual(raw[field],value);assert.equal(new URL(path.sourceUrl).searchParams.has('vote-method'),observation.stream==='named');}
  assert.equal(item.actualPosition.status,'conflicting');assert.equal(item.subjectId,null);assert.deepEqual(item.context.documentIds,[]);
});

test('a census-only pagination conflict never fabricates named evidence',async()=>{
  const {service}=setup({limits:{decisionPageSize:1},override:({kind,endpoint,params})=>{
    if(kind==='named')throw new Error('Named source unavailable');
    if(kind==='decisions')return source(endpoint,params,[{...clone(finalDecision),decision_outcome:params.offset?'def/ep-statuses/LAPSED':finalDecision.decision_outcome}]);
  }});
  const response=await service.query(MEMBER,query('sitting='+SITTING)),conflict=response.items[0].sourceConflicts;
  assert.deepEqual(conflict.named,{});
  assert.equal(conflict.observations.length,2);assert(conflict.observations.every(observation=>observation.stream==='census'));
  assert.deepEqual(new Set(conflict.observations.map(observation=>observation.values.decision_outcome)),new Set(['def/ep-statuses/ADOPTED','def/ep-statuses/LAPSED']));
});

test('every changed identity on a later page is withheld, including rows after the first conflict',async()=>{
  const decisions=[clone(finalDecision),{...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-280001`,activity_id:`${SITTING}-DEC-280001`}];
  const {service}=setup({decisions,limits:{decisionPageSize:2},override:({kind,endpoint,params})=>{
    if(kind==='named')return source(endpoint,params,[]);
    if(kind==='decisions')return source(endpoint,params,params.offset?decisions.map(node=>({...node,decision_outcome:'def/ep-statuses/REJECTED'})):decisions);
  }});
  const response=await service.query(MEMBER,query('sitting='+SITTING));
  assert.equal(response.items.length,2);
  assert.equal(response.coverage.sittings[0].completeness.conflictingDecisionIds.length,2);
  assert(response.items.every(item=>item.actualPosition.status==='conflicting'&&item.outcome===null&&item.sourceConflicts.observations.length===2));
});

test('alignment filters the pinned period before pagination while counts and selected remain independent',async()=>{
  const cases=[['for','ADOPTED'],['for','REJECTED'],['against','ADOPTED'],['against','REJECTED'],['abstaining','ADOPTED'],['for','LAPSED'],[null,'ADOPTED']];
  const decisions=cases.map(([position,outcome],index)=>{
    const row={...clone(finalDecision),id:`eli/dl/event/${SITTING}-DEC-${280000+index}`,activity_id:`${SITTING}-DEC-${280000+index}`,decision_outcome:'def/ep-statuses/'+outcome};
    for(const field of ['had_voter_favor','had_voter_against','had_voter_abstention'])row[field]=[];
    if(position)row[{for:'had_voter_favor',against:'had_voter_against',abstaining:'had_voter_abstention'}[position]]=['person/'+MEMBER];
    else row.decision_method='def/ep-decision-methods/VOTE_HAND';
    return row;
  });
  const {service,calls}=setup({decisions});
  const all=await service.query(MEMBER,query(`sitting=${SITTING}&limit=100`)),reads=calls.length;
  assert.equal(all.alignment,'all');assert.deepEqual(all.alignmentCounts,{with:2,against:2,abstained:1,unclassified:2});
  const ids=all.items.filter(item=>item.alignment==='against').map(item=>item.id);
  const suffix=`sitting=${SITTING}&alignment=against&snapshot=${all.snapshotId}&decision=${decisions[6].activity_id}`;
  const first=await service.query(MEMBER,query(suffix+'&positions=all&limit=1'));
  const next=await service.query(MEMBER,query(suffix+'&positions=recorded&limit=1&offset=1'));
  assert.deepEqual([...first.items,...next.items].map(item=>item.id),ids);
  assert.equal(first.pagination.filteredTotal,2);assert.equal(first.pagination.nextOffset,1);assert.equal(next.pagination.nextOffset,null);
  assert.equal(first.selected.item.id,decisions[6].activity_id);assert.equal(first.selected.item.alignment,'unclassified');
  for(const positions of ['all','recorded'])for(const alignment of ['all','with','against','abstained']){
    const result=await service.query(MEMBER,query(`sitting=${SITTING}&snapshot=${all.snapshotId}&positions=${positions}&alignment=${alignment}&limit=100`));
    assert.deepEqual(result.alignmentCounts,all.alignmentCounts);assert.equal(result.snapshotId,all.snapshotId);
    if(alignment!=='all')assert(result.items.every(item=>item.alignment===alignment&&item.actualPosition.status==='recorded'));
    assert.deepEqual(result.subjects[0].counts,{observed:7,filtered:result.items.length,page:result.items.length});
  }
  assert.deepEqual(first.alignmentCounts,all.alignmentCounts);assert.equal(calls.length,reads);
});

test('alignment validation defaults compatibly and unavailable coverage has no count claim',async()=>{
  assert.equal(query('').alignment,'all');
  for(const value of ['all','with','against','abstained'])assert.equal(query('alignment='+value).alignment,value);
  for(const value of ['','WITH','unclassified','against&alignment=with'])assert.throws(()=>query('alignment='+value),error=>error.status===400);
  const {service}=setup({override:({kind})=>{if(kind==='meeting')throw new Error('Unavailable synthetic source');}});
  const unavailable=await service.query(MEMBER,query(`sitting=${SITTING}&alignment=against`));
  assert.equal(unavailable.coverage.status,'unavailable');assert.equal(unavailable.alignmentCounts,null);
  const complete=await setup({decisions:[],results:[],agenda:[],meetings:[{...meeting,consists_of:[]}]}).service.query(MEMBER,query(`sitting=${SITTING}&alignment=with`));
  assert.equal(complete.coverage.status,'complete');assert.deepEqual(complete.alignmentCounts,{with:0,against:0,abstained:0,unclassified:0});
});

test('recordedTotal covers all observed decisions before position and alignment filters and remains null when unavailable',async()=>{
  const {service}=setup();
  const all=await service.query(MEMBER,query(`sitting=${SITTING}`));
  const recorded=await service.query(MEMBER,query(`sitting=${SITTING}&snapshot=${all.snapshotId}&positions=recorded&alignment=against`));
  assert.equal(all.pagination.recordedTotal,all.items.filter(item=>item.actualPosition.status==='recorded').length);
  assert.equal(recorded.pagination.recordedTotal,all.pagination.recordedTotal);
  const unavailable=setup({failure:true});
  // Collection failure is tested separately; the projection must withhold the count.
  unavailable.service.snapshot=async()=>({id:'a'.repeat(64),period:all.period,days:[],coverage:{status:'unavailable'}});
  assert.equal((await unavailable.service.query(MEMBER,query(`sitting=${SITTING}`))).pagination.recordedTotal,null);
});

test('held weeks crossing New Year read only years through Brussels today',async()=>{
  for(const today of ['2025-12-30T12:00:00Z','2026-01-02T12:00:00Z']){
    const now=Date.parse(today),{service,calls}=setup({clock:()=>now,meetings:[]});
    const selected=memberVotesQuery(new URLSearchParams('week=2025-12-29'),{now});
    const result=await service.query(MEMBER,selected);
    assert.equal(result.period.from,'2025-12-29');assert.equal(result.period.to,'2026-01-04');
    assert.equal(result.coverage.status,'complete');
    assert.deepEqual(calls.filter(call=>call.endpoint==='/meetings').map(call=>call.params.year),today.startsWith('2025')?[2025]:[2025,2026]);
  }
});


test('period view returns every filtered decision despite a legacy offset and small limit',async()=>{
  const decisions=Array.from({length:65},(_,index)=>({...clone(finalDecision),id:'eli/dl/event/'+SITTING+'-DEC-'+(index+1),activity_id:SITTING+'-DEC-'+(index+1)}));
  const {service,calls}=setup({decisions});
  const page=await service.query(MEMBER,query('sitting='+SITTING+'&limit=1'));
  const reads=calls.length;
  const full=await service.query(MEMBER,query('sitting='+SITTING+'&limit=1&offset=50&view=period&snapshot='+page.snapshotId));
  assert.equal(full.pagination.mode,'period');
  assert.equal(full.pagination.offset,0);
  assert.equal(full.pagination.returned,full.pagination.filteredTotal);
  assert.equal(full.pagination.nextOffset,null);
  assert(full.items.length>1);
  assert(full.subjects.every(subject=>subject.counts.page===subject.counts.filtered));
  assert.equal(calls.length,reads);
  const recorded=await service.query(MEMBER,query('sitting='+SITTING+'&view=period&positions=recorded&snapshot='+page.snapshotId));
  assert(recorded.items.every(item=>item.actualPosition.status==='recorded'));
  assert.throws(()=>query('sitting='+SITTING+'&view=other'));
});

test('chairing omissions apply before counts, filters, pagination and direct selections and remain member-specific',async()=>{
  const {service}=setup({results:[{...clone(finalResult),consists_of:[finalDecision.id],recorded_in_a_realization_of:['eli/dl/doc/PV-10-2026-10-07-VOT-ITM-007']}]});let reads=0;
  service.readChairs=async(_request,sittingId)=>{reads++;assert.equal(sittingId,SITTING);return {status:'observed',byResultDocument:{'PV-10-2026-10-07-VOT-ITM-007':'999999'},sources:[],bytes:0};};
  const q=query('sitting='+SITTING+'&decision='+finalDecision.activity_id);
  const hidden=await service.query('999999',q);
  assert.deepEqual(hidden.items,[]);assert.equal(hidden.pagination.observedTotal,0);assert.equal(hidden.pagination.filteredTotal,0);assert.equal(hidden.pagination.omittedWhileChairingTotal,1);assert.equal(hidden.pagination.recordedTotal,0);assert.equal(hidden.pagination.nextOffset,null);
  assert.deepEqual(hidden.selected,{status:'chairing',item:null});assert.equal(hidden.subjects.flatMap(s=>s.wholeTextDecisions).length,0);
  const other=await service.query(MEMBER,q);assert.equal(other.items.length,1);assert.equal(other.selected.status,'found');assert.equal(other.pagination.omittedWhileChairingTotal,undefined);assert.equal(reads,1,'chair sources are shared across members in the immutable period snapshot');
});


test('an evicted weekly snapshot opens a sitting decision and survives retrieval-time changes',async()=>{
  let refreshed=false,changed=false;
  const {service}=setup({override:({supplied})=>({...supplied,fetchedAt:NOW+(refreshed?1000:0),payload:changed?{...supplied.payload,changed:true}:supplied.payload})});
  const week=await service.snapshot(query('week=latest'));
  service.snapshotInputs.clear();
  service.snapshots.clear();service.periods.clear();service.cacheBytes=0;refreshed=true;
  const opened=await service.snapshot(query(`sitting=${SITTING}&decision=${finalDecision.activity_id}&snapshot=${week.id}`));
  assert.equal(opened.id,week.id);assert.equal(opened.period.kind,'week');
  service.snapshots.clear();service.periods.clear();service.cacheBytes=0;changed=true;
  await assert.rejects(service.snapshot(query(`sitting=${SITTING}&snapshot=${week.id}`)),error=>error.status===409);
});
