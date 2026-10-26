import test from 'node:test';
import assert from 'node:assert/strict';
import {memberAttendanceRoute,validateMemberAttendanceResponse,memberAttendanceDetail,memberAttendanceLine} from './memberAttendancePresentation.mjs';
import {voteMethodLabel,knownVoteMethodLabel} from './voteMethod.mjs';
const id='MTG-PL-2026-10-22';
const source={url:'https://data.europarl.europa.eu/api/v2/meetings/'+id,fetchedAt:'2026-10-23T12:00:00Z',contentHash:'a'.repeat(64),stale:false,refreshInProgress:false,refreshError:null};
const day=()=>({sittingId:id,date:'2026-10-22',status:'observed',memberStatus:'listed-present',excusedSupplied:false,counts:{present:609,excused:null,duplicatePresent:0,duplicateExcused:0,malformedReferences:0},conflictingIds:[],source,register:{documentId:'PV-10-2026-10-22-ATT',pdf:{url:'https://data.europarl.europa.eu/distribution/doc/PV-10-2026-10-22-ATT_en.pdf',language:'en'},issued:'2026-10-23T11:45:00+02:00',status:'available',source}});
const response=()=>({version:1,member:{id:'42',mandateStatus:'not-assessed'},sittings:[day()]});
const accepts=value=>validateMemberAttendanceResponse(value,{memberId:42,sittingIds:[id]});

test('attendance route is bounded, canonical and independent from vote selections',()=>{
  assert.equal(memberAttendanceRoute(42,[id,'MTG-PL-2026-10-21'],'fr'),'member-attendance/42?sittings=MTG-PL-2026-10-21%2CMTG-PL-2026-10-22&lang=fr');
  for(const ids of [[],[id,id],['MTG-PL-2026-02-30'],['other'],Array.from({length:6},(_,i)=>'MTG-PL-2026-10-'+(10+i))])assert.throws(()=>memberAttendanceRoute(42,ids),RangeError);
  assert.throws(()=>memberAttendanceRoute(0,[id]),RangeError);assert.throws(()=>memberAttendanceRoute(42,[id],'xx'),RangeError);
});

test('attendance response guard rejects wrong members, sitting sets, status certainty and unsafe links',()=>{
  assert.equal(accepts(response()),true);
  for(const change of [value=>value.version=2,value=>value.member.id='43',value=>value.sittings=[],value=>value.sittings.push(day()),value=>value.sittings[0].sittingId='MTG-PL-2026-10-21',value=>value.sittings[0].date='2026-10-21',value=>value.sittings[0].status='partial',value=>value.sittings[0].memberStatus='absent',value=>value.sittings[0].source=null,value=>value.sittings[0].counts.present=0,value=>value.sittings[0].counts.malformedReferences=1,value=>value.sittings[0].register.documentId='other',value=>value.sittings[0].register.pdf.url='https://example.invalid/file.pdf',value=>value.sittings[0].register.pdf.url='javascript:alert(1)',value=>value.sittings[0].register.pdf.language='xx']){
    const value=response();change(value);assert.equal(accepts(value),false);
  }
  for(const status of ['partial','unavailable','not-published']){const value=response();value.sittings[0].status=status;value.sittings[0].memberStatus=null;assert.equal(accepts(value),true);}
});

test('all attendance labels preserve sitting-level semantics and unknown states',()=>{
  const observed=day();
  for(const [status,label] of [['listed-present','Listed as present'],['listed-excused','Listed as excused'],['not-listed','Not listed'],['conflicting','Listed as both present and excused']])assert.match(memberAttendanceDetail({...observed,memberStatus:status}),new RegExp(label));
  assert.match(memberAttendanceDetail(observed),/Listed as present at this sitting\./);
  assert.match(memberAttendanceDetail({...observed,status:'not-published',memberStatus:null}),/not yet published/);
  for(const value of [undefined,{...observed,status:'partial',memberStatus:null},{...observed,status:'unavailable',memberStatus:null}])assert.match(memberAttendanceDetail(value),/Attendance register unavailable/);
  assert.equal(memberAttendanceLine([observed,{...observed,date:'2026-10-23',status:'not-published',memberStatus:null}]),'Attendance register: listed present 22 Oct · not yet published 23 Oct');
});

test('shared method labels distinguish electronic non-roll-call and both secret aliases',()=>{
  for(const [method,label] of [['VOTE_HAND','Show of hands'],['VOTE_ELECTRONIC','Electronic vote (names not recorded)'],['VOTE_ELECTRONIC_ROLLCALL','Roll-call vote'],['VOTE_SECRET','Secret ballot'],['VOTE_SECRET_BALLOT','Secret ballot'],[null,''],['VOTE_UNKNOWN',''],['toString','']])assert.equal(voteMethodLabel(method),label);
});


test('a not-listed member with no supplied excused list does not acquire a negative excused observation',()=>{
  assert.equal(memberAttendanceDetail({...day(),memberStatus:'not-listed',excusedSupplied:false}), 'Not listed as present.');
  assert.equal(memberAttendanceDetail({...day(),memberStatus:'not-listed',excusedSupplied:true}), "Not listed in this sitting's attendance register.");
});

test('indexed motion fallbacks can omit unknown methods using the same recognised label map',()=>{
  for(const method of [null,undefined,'VOTE_UNKNOWN','toString'])assert.equal(knownVoteMethodLabel(method),null);
  assert.equal(knownVoteMethodLabel('VOTE_ELECTRONIC'),'Electronic vote (names not recorded)');
});
