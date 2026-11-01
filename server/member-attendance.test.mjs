import test from 'node:test';
import assert from 'node:assert/strict';
import {MemberAttendance,memberAttendanceQuery,extractAttendance,attendanceRegister,MEMBER_ATTENDANCE_VERSION} from './member-attendance.mjs';
import {runWithRequestSignal,cancelledRequest} from './request-budget.mjs';

const SITTING='MTG-PL-2026-10-22',DOC='PV-10-2026-10-22-ATT',NOW=Date.parse('2026-10-23T12:00:00Z');
const meeting=(patch={})=>({id:'eli/dl/event/'+SITTING,activity_id:SITTING,activity_date:'2026-10-22',had_activity_type:'def/ep-activities/PLENARY_SITTING',had_participant_person:['person/42','person/43'],had_excused_person:['person/44'],recorded_in_a_realization_of:['eli/dl/doc/'+DOC],...patch});
const payload=node=>({data:[node]});
const extract=node=>extractAttendance(payload(node),SITTING);
const pdf=(language,patch={})=>({id:'eli/dl/doc/'+DOC+'/'+language,type:'Expression',is_embodied_by:[{id:'eli/dl/doc/'+DOC+'/'+language+'/pdf',format:'http://publications.europa.eu/resource/authority/file-type/PDF',is_exemplified_by:'distribution/doc/'+DOC+'_'+language+'.pdf',issued:'2026-10-23T11:45:00+02:00',...patch}]});
const metadata=(patch={})=>({id:'eli/dl/doc/'+DOC,identifier:DOC,document_date:'2026-10-22',work_type:'def/ep-document-types/LIST_ATTEND_PLENARY',inverse_recorded_in_a_realization_of:['eli/dl/event/'+SITTING],is_realized_by:[pdf('en'),pdf('fr')],...patch});
const record=(node,endpoint='/meetings/'+SITTING,patch={})=>({url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:NOW,stale:false,refreshInProgress:false,refreshError:null,payload:payload(node),...patch});
const query=(sittings=[SITTING],language='en')=>({sittings,language});

test('attendance query accepts one to five unique held current-term exact sittings and sorts them',()=>{
  assert.equal(MEMBER_ATTENDANCE_VERSION,1);
  const earlier='MTG-PL-2024-07-16';
  assert.deepEqual(memberAttendanceQuery(new URLSearchParams({sittings:SITTING+','+earlier,lang:'fr'}),{now:NOW}),{sittings:[earlier,SITTING],language:'fr'});
  for(const input of ['', 'sittings=', 'sittings='+SITTING+','+SITTING,'sittings=MTG-PL-2026-02-30','sittings=MTG-PL-2024-07-15','sittings=MTG-PL-2026-10-24','sittings=2026-10-22','sittings='+SITTING+'&lang=bad','sittings='+SITTING+'&lang=en&lang=fr','sittings='+SITTING+'&sittings='+earlier,'sittings='+SITTING+'&url=bad','sittings='+Array.from({length:6},(_,i)=>'MTG-PL-2026-10-'+(10+i)).join(',')])assert.throws(()=>memberAttendanceQuery(new URLSearchParams(input),{now:NOW}),error=>error.status===400,input);
});

test('exact meeting identity, date, activity type and single-node identity are mandatory',()=>{
  for(const patch of [{id:'eli/dl/event/other'},{activity_id:'MTG-PL-2026-10-21'},{activity_date:'2026-10-21'},{had_activity_type:'def/ep-activities/OTHER'},{id:'https://example.invalid/eli/dl/event/'+SITTING}])assert.equal(extract(meeting(patch)).status,'unavailable');
  assert.equal(extractAttendance({data:[meeting(),meeting()]},SITTING).status,'unavailable');
  assert.equal(extractAttendance({data:null},SITTING).status,'unavailable');
  assert.equal(extract(meeting({id:'https://data.europarl.europa.eu/eli/dl/event/'+SITTING})).status,'observed');
});

test('observed lists deduplicate within each list and expose cross-list conflicts',()=>{
  const result=extract(meeting({had_participant_person:['person/42','person/42',{id:'https://data.europarl.europa.eu/person/43'}],had_excused_person:['person/42','person/44','person/44']}));
  assert.equal(result.status,'observed');assert.deepEqual(result.presentIds,['42','43']);assert.deepEqual(result.excusedIds,['42','44']);assert.deepEqual(result.conflictingIds,['42']);
  assert.deepEqual(result.counts,{present:2,excused:2,duplicatePresent:1,duplicateExcused:1,malformedReferences:0});
  const absentExcused=meeting();delete absentExcused.had_excused_person;
  assert.equal(extract(absentExcused).status,'observed');assert.equal(extract(absentExcused).excusedSupplied,false);assert.equal(extract(absentExcused).counts.excused,null);
  assert.equal(extract(meeting({had_excused_person:[]})).counts.excused,0);
});

test('partial, not-published and unavailable observations remain separate from empty verified lists',()=>{
  const partial=extract(meeting({had_participant_person:['person/42','person/0','person/abc',null,'https://example.invalid/person/43']}));
  assert.equal(partial.status,'partial');assert.deepEqual(partial.presentIds,['42']);assert.equal(partial.counts.malformedReferences,4);
  assert.equal(extract(meeting({had_excused_person:null})).status,'partial');
  assert.equal(extract(meeting({had_participant_person:'person/42'})).status,'partial');
  assert.equal(extract(meeting({had_participant_person:[]})).status,'unavailable');
  const unpublished=meeting({recorded_in_a_realization_of:[]});delete unpublished.had_participant_person;
  assert.equal(extract(unpublished).status,'not-published');assert.equal(extract(unpublished).counts.present,null);
  unpublished.recorded_in_a_realization_of=['eli/dl/doc/'+DOC];assert.equal(extract(unpublished).status,'unavailable');
});

test('metadata validates exact document, type, inverse sitting and date before offering a PDF',()=>{
  const valid=attendanceRegister(payload(metadata()),SITTING,'fr');
  assert.deepEqual(valid,{documentId:DOC,pdf:{url:'https://data.europarl.europa.eu/distribution/doc/'+DOC+'_fr.pdf',language:'fr'},issued:'2026-10-23T11:45:00+02:00',status:'available'});
  assert.equal(attendanceRegister(payload(metadata()),SITTING,'hu').pdf.language,'en');
  assert.equal(attendanceRegister(payload(metadata({is_realized_by:[pdf('fr')]})),SITTING,'hu').pdf,null);
  for(const patch of [{id:'eli/dl/doc/wrong'},{identifier:'wrong'},{document_date:'2026-10-21'},{work_type:'def/ep-document-types/OTHER'},{inverse_recorded_in_a_realization_of:['eli/dl/event/OTHER']},{inverse_recorded_in_a_realization_of:['eli/dl/event/'+SITTING,'eli/dl/event/OTHER']}])assert.equal(attendanceRegister(payload(metadata(patch)),SITTING),null);
  assert.equal(attendanceRegister({data:[metadata(),metadata()]},SITTING),null);
  for(const url of ['https://example.invalid/distribution/file.pdf','http://data.europarl.europa.eu/distribution/file.pdf','https://data.europarl.europa.eu/other/file.pdf','https://data.europarl.europa.eu/distribution/file.pdf?key=value','https://user@data.europarl.europa.eu/distribution/file.pdf'])assert.equal(attendanceRegister(payload(metadata({is_realized_by:[pdf('en',{is_exemplified_by:url})]})),SITTING).pdf,null,url);
  assert.equal(attendanceRegister(payload(metadata({is_realized_by:[pdf('en',{issued:'invalid'})]})),SITTING).issued,null);
});

test('member projection is separate, neutral, source-labelled and never concludes from partial lists',async()=>{
  let node=meeting(),calls=[];
  const service=new MemberAttendance({request:async(endpoint,params,options)=>{calls.push({endpoint,params,options});return record(endpoint.startsWith('/meetings/')?node:metadata(),endpoint);}});
  for(const [id,status] of [['42','listed-present'],['44','listed-excused'],['99','not-listed']]){
    const result=await service.query(id,query());assert.equal(result.member.mandateStatus,'not-assessed');assert.equal(result.sittings[0].memberStatus,status);assert.equal(result.sittings[0].register.pdf.language,'en');assert.match(result.sittings[0].source.contentHash,/^[a-f0-9]{64}$/);assert.equal(result.sittings[0].source.fetchedAt,new Date(NOW).toISOString());assert(!('actualPosition' in result.sittings[0]));
  }
  assert(calls.every(call=>call.options.priority==='interactive'&&call.options.staleWhileRevalidate&&call.options.ttl===15*60_000));assert.deepEqual(calls[0].params,{});
  node=meeting({had_excused_person:['person/42']});assert.equal((await service.query('42',query())).sittings[0].memberStatus,'conflicting');
  node=meeting({had_participant_person:['person/42','invalid']});assert.equal((await service.query('42',query())).sittings[0].memberStatus,null);assert.equal((await service.query('99',query())).sittings[0].memberStatus,null);
  for(const id of ['0','-1','1e2','9007199254740992'])await assert.rejects(service.query(id,query()),error=>error.status===400);
});

test('extractions are shared by source content and invalidated by changed hashes with bounded memory',async()=>{
  let node=meeting(),fetchedAt=NOW;
  const service=new MemberAttendance({limits:{cacheEntries:1,cacheBytes:2000},request:async(endpoint)=>record(endpoint.startsWith('/meetings/')?node:metadata(),endpoint,{fetchedAt,stale:true,refreshInProgress:true,refreshError:'temporarily unavailable'})});
  const first=await service.query('42',query()),extraction=[...service.extractions.values()][0].value;
  fetchedAt+=1000;await service.query('44',query());assert.strictEqual([...service.extractions.values()][0].value,extraction);
  node=meeting({had_participant_person:['person/99']});const changed=await service.query('42',query());
  assert.equal(changed.sittings[0].memberStatus,'not-listed');assert.notEqual(changed.sittings[0].source.contentHash,first.sittings[0].source.contentHash);assert.notStrictEqual([...service.extractions.values()][0].value,extraction);assert.equal(service.extractions.size,1);assert(service.cacheBytes<=2000);assert.equal(changed.sittings[0].source.stale,true);assert.equal(changed.sittings[0].source.refreshInProgress,true);assert.equal(changed.sittings[0].source.refreshError,'temporarily unavailable');
  const tiny=new MemberAttendance({limits:{cacheBytes:1}});tiny.extraction(payload(node),SITTING,'a');assert.equal(tiny.extractions.size,0);
});

test('metadata failures remove only enrichment, while meeting failures never become not-published',async()=>{
  const failed=new MemberAttendance({request:async(endpoint)=>{if(endpoint.startsWith('/plenary-session-documents/'))throw new Error('metadata failed');return record(meeting(),endpoint);}});
  const day=(await failed.query('42',query())).sittings[0];assert.equal(day.status,'observed');assert.equal(day.memberStatus,'listed-present');assert.equal(day.register.status,'unavailable');assert.equal(day.register.source,null);assert.equal(day.register.pdf,null);assert.equal(day.register.issued,null);
  const unreadable=new MemberAttendance({request:async()=>{throw new Error('404');}});assert.equal((await unreadable.query('42',query())).sittings[0].status,'unavailable');
  const tooLarge=new MemberAttendance({limits:{sourceBytes:10},request:async(endpoint)=>record(meeting(),endpoint)});assert.equal((await tooLarge.query('42',query())).sittings[0].status,'unavailable');
});

test('up to five sitting reads are sequential and each reader owns only its wait',async()=>{
  let active=0,maximum=0,started=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const ids=Array.from({length:5},(_,i)=>'MTG-PL-2026-10-'+(19+i));
  const service=new MemberAttendance({request:async endpoint=>{
    active++;maximum=Math.max(maximum,active);started++;if(started===1)await gate;
    const id=endpoint.split('/').at(-1),node=meeting({id:'eli/dl/event/'+id,activity_id:id,activity_date:id.slice(7),recorded_in_a_realization_of:[]});
    await new Promise(resolve=>setImmediate(resolve));active--;return record(node,endpoint);
  }});
  const controller=new AbortController(),first=runWithRequestSignal(controller.signal,()=>service.query('42',query(ids)));
  const second=service.query('43',query([ids[0]]));controller.abort(cancelledRequest());await assert.rejects(first,error=>error.code==='request_cancelled');release();
  assert.equal((await second).sittings[0].memberStatus,'listed-present');assert.equal(started,1,'cancelling the first reader must not start its later sittings');
  await service.query('42',query(ids));assert.equal(maximum,1);assert.equal(started,6);
});


test('malformed unrelated register expressions do not change requested-language selection',async()=>{
  const node=metadata();node.is_realized_by.unshift(null);
  const service=new MemberAttendance({request:async endpoint=>record(endpoint.startsWith('/meetings/')?meeting():node,endpoint)});
  const result=await service.query('42',query([SITTING],'fr'));
  assert.equal(result.sittings[0].register.pdf.language,'fr');
});
