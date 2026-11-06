import test from 'node:test';
import assert from 'node:assert/strict';
import {MEMBER_VOTE_RECORD_LIMIT,recordComparison,memberVoteRecordRoute,recordAlignment,recordShare,recordSummary,recordTrend,validateMemberVoteRecordResponse} from './MemberVoteRecordModel.mjs';

const MEMBER=197591,A='MTG-PL-2026-09-16',B='MTG-PL-2026-10-07';
const counts=(withGroup,against,abstained=0,notComparable=0)=>({with:withGroup,against,abstained,notComparable});
function response(patch={}) {
  return {
    version:1,
    member:{id:String(MEMBER),uri:'https://data.europarl.europa.eu/person/'+MEMBER},
    period:{from:'2024-07-16',to:'2026-10-07'},
    coverage:{sittings:2,included:2,missing:0,status:'complete'},
    group:{code:'S&D',status:'attached'},
    alignment:{all:counts(3,1,1,0),wholeText:counts(2,0,0,0)},
    ballots:{recorded:5,named:4,chaired:0},
    bySitting:[
      {sittingId:B,date:'2026-10-07',withGroup:2,comparable:2,finalWithGroup:2,finalComparable:2},
      {sittingId:A,date:'2026-09-16',withGroup:1,comparable:2,finalWithGroup:null,finalComparable:null},
    ],
    departures:{scope:'all',offset:0,limit:5,total:1,items:[{decisionId:B+'-DEC-4',sittingId:B,date:'2026-10-07',scope:'all',wholeText:false,position:'against',line:'for',text:'Amendment 4',language:'en'}],nextOffset:null},
    comparison:{all:{group:{median:0.625,members:2},parliament:{median:0.5,members:3}},final:{group:{median:1,members:2},parliament:{median:0.75,members:3}}},
    attribution:'European Parliament Open Data API v2, CC BY 4.0',
    ...patch,
  };
}

test('the route carries the requested language, scope and departure page',()=>{
  assert.equal(memberVoteRecordRoute(MEMBER),'member-vote-record/'+MEMBER+'?lang=en&scope=all&limit=5&offset=0');
  assert.equal(MEMBER_VOTE_RECORD_LIMIT,5);
  const route=new URL(memberVoteRecordRoute(MEMBER,{language:'hu',scope:'final',limit:50,offset:10000}),'http://localhost');
  assert.equal(route.searchParams.get('lang'),'hu');assert.equal(route.searchParams.get('scope'),'final');
  assert.equal(route.searchParams.get('limit'),'50');assert.equal(route.searchParams.get('offset'),'10000');
  for(const options of [{language:'eng'},{language:'EN'},{scope:'other'},{limit:-1},{limit:51},{offset:10001},{limit:1.5}])
    assert.throws(()=>memberVoteRecordRoute(MEMBER,options),RangeError,JSON.stringify(options));
  for(const id of [0,-1,'1.5','x','01'])assert.throws(()=>memberVoteRecordRoute(id),RangeError,String(id));
});

test('the response validator accepts stored shapes and rejects a member or page mismatch',()=>{
  assert.equal(validateMemberVoteRecordResponse(response(),{memberId:MEMBER}),true);
  assert.equal(validateMemberVoteRecordResponse(response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null}),{memberId:MEMBER}),true);
  const invalid=[
    ['member',response({member:{id:'2',uri:'https://data.europarl.europa.eu/person/2'}})],
    ['version',response({version:2})],
    ['coverage total',response({coverage:{sittings:3,included:2,missing:0,status:'complete'}})],
    ['coverage status',response({coverage:{sittings:2,included:2,missing:0,status:'unknown'}})],
    ['alignment',response({alignment:{all:{with:3,against:1,abstained:1},wholeText:counts(2,0,0,0)}})],
    ['ballots',response({ballots:{recorded:-1,named:4,chaired:0}})],
    ['sitting date',response({bySitting:[{sittingId:B,date:'2026-10-08',withGroup:2,comparable:2,finalWithGroup:null,finalComparable:null}]})],
    ['sitting counts',response({bySitting:[{sittingId:B,date:'2026-10-07',withGroup:3,comparable:2,finalWithGroup:null,finalComparable:null}]})],
    ['departure identity',response({departures:{...response().departures,items:[{...response().departures.items[0],decisionId:'other'}]}})],
    ['departure offset',response({departures:{...response().departures,offset:1}})],
    ['comparison range',response({comparison:{all:{group:{median:1.2,members:2},parliament:{median:0.5,members:3}},final:null}})],
  ];
  for(const [label,value] of invalid)assert.equal(validateMemberVoteRecordResponse(value,{memberId:MEMBER}),false,label);
});

test('all-vote and final-vote figures share one comparable definition',()=>{
  const data=response();
  assert.deepEqual(recordAlignment(data,'all'),{...counts(3,1,1,0),total:5,comparable:4,withShare:0.75,againstShare:0.25});
  assert.deepEqual(recordAlignment(data,'final'),{...counts(2,0,0,0),total:2,comparable:2,withShare:1,againstShare:0});
  assert.equal(recordAlignment(response({alignment:null}),'all'),null);
  assert.deepEqual(recordAlignment(response({alignment:{all:counts(0,0,2),wholeText:counts(0,0,0)}})),{...counts(0,0,2),total:2,comparable:0,withShare:null,againstShare:null});
});

test('the trend sorts sittings and keeps gaps as explicit nulls',()=>{
  const data=response({bySitting:[
    {sittingId:B,date:'2026-10-07',withGroup:null,comparable:null,finalWithGroup:null,finalComparable:null},
    {sittingId:A,date:'2026-09-16',withGroup:1,comparable:2,finalWithGroup:1,finalComparable:1},
  ]});
  assert.deepEqual(recordTrend(data),[
    {sittingId:A,date:'2026-09-16',withGroup:1,comparable:2,share:0.5},
    {sittingId:B,date:'2026-10-07',withGroup:null,comparable:null,share:null},
  ]);
  assert.deepEqual(recordTrend(data,'final').map(point=>point.share),[1,null]);
});

test('the profile summary reports attached, non-attached, empty and chaired states',()=>{
  assert.deepEqual(recordSummary(response()),{attached:true,share:0.75,comparable:4,recorded:5,named:4,chaired:0});
  assert.deepEqual(recordSummary(response({group:{code:'NI',status:'non-attached'},alignment:null})),{attached:false,share:null,comparable:0,recorded:5,named:4,chaired:0});
  assert.deepEqual(recordSummary(response({alignment:null,ballots:{recorded:0,named:0,chaired:0}})),{attached:true,share:null,comparable:0,recorded:0,named:0,chaired:0});
  assert.equal(recordSummary(response({ballots:{recorded:5,named:4,chaired:3}})).chaired,3);
});

test('medians follow the chosen scope and may be absent',()=>{
  assert.equal(recordComparison(response(),'final').group.median,1);
  assert.equal(recordComparison(response({comparison:null}),'all'),null);
  assert.equal(validateMemberVoteRecordResponse(response({ballots:{recorded:5,named:null,chaired:0}}),{memberId:MEMBER}),true);
});

test('shares round to one decimal without inventing a value for a gap',()=>{
  assert.equal(recordShare(0.12356),12.4);assert.equal(recordShare(1),100);assert.equal(recordShare(0),0);
  assert.equal(recordShare(null),null);assert.equal(recordShare(undefined),null);assert.equal(recordShare(NaN),null);
});

test('a pasted offset past the last departure is a valid empty page',()=>{
  const data=response({departures:{...response().departures,offset:10,items:[],total:1,nextOffset:null}});
  assert.equal(validateMemberVoteRecordResponse(data,{memberId:MEMBER}),true);
});

test('language-neutral departure wording is a valid response',()=>{
  const base=response(),item=base.departures.items[0];
  const withLanguage=language=>response({departures:{...base.departures,items:[{...item,language}]}});
  assert.equal(validateMemberVoteRecordResponse(withLanguage('mul'),{memberId:MEMBER}),true);
  assert.equal(validateMemberVoteRecordResponse(withLanguage('xx'),{memberId:MEMBER}),false);
});
