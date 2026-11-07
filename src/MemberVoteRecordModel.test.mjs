import test from 'node:test';
import assert from 'node:assert/strict';
import {MEMBER_VOTE_RECORD_LIMIT,recordComparison,recordView,memberVoteRecordRoute,recordAlignment,recordShare,validateMemberVoteRecordResponse} from './MemberVoteRecordModel.mjs';

const MEMBER=197591,A='MTG-PL-2026-09-16',B='MTG-PL-2026-10-07';
const counts=(withGroup,against,abstained=0,notComparable=0)=>({with:withGroup,against,abstained,notComparable});
function response(patch={}) {
  return {
    version:5,
    member:{id:String(MEMBER),uri:'https://data.europarl.europa.eu/person/'+MEMBER},
    period:{from:'2024-07-16',to:'2026-10-07'},
    coverage:{sittings:2,included:2,missing:0,unprojectedDecisions:0,status:'complete'},
    group:{code:'S&D',status:'attached'},
    alignment:{all:counts(3,1,1,0),wholeText:counts(2,0,0,0)},
    ballots:{chaired:0},
    breakdown:null,
    departures:{scope:'all',tag:null,offset:0,limit:5,total:1,items:[{decisionId:B+'-DEC-4',sittingId:B,date:'2026-10-07',scope:'all',wholeText:false,position:'against',line:'for',text:'Amendment 4',language:'en'}],nextOffset:null},
    comparison:{all:{group:{median:0.625,members:2}},final:{group:{median:1,members:2}}},
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
    ['an earlier version',response({version:3})],
    ['missing unprojected count',response({coverage:{sittings:2,included:2,missing:0,status:'complete'}})],
    ['negative unprojected count',response({coverage:{sittings:2,included:2,missing:0,unprojectedDecisions:-1,status:'complete'}})],
    ['coverage total',response({coverage:{sittings:3,included:2,missing:0,unprojectedDecisions:0,status:'complete'}})],
    ['coverage status',response({coverage:{sittings:2,included:2,missing:0,unprojectedDecisions:0,status:'unknown'}})],
    ['alignment',response({alignment:{all:{with:3,against:1,abstained:1},wholeText:counts(2,0,0,0)}})],
    ['ballots',response({ballots:{chaired:-1}})],
    ['departure identity',response({departures:{...response().departures,items:[{...response().departures.items[0],decisionId:'other'}]}})],
    ['departure offset',response({departures:{...response().departures,offset:1}})],
    ['comparison range',response({comparison:{all:{group:{median:1.2,members:2}},final:null}})],
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

test('medians follow the chosen scope and may be absent',()=>{
  assert.equal(recordComparison(response(),'final').group.median,1);
  assert.equal(recordComparison(response({comparison:null}),'all'),null);
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

test('the route carries a tag only when it is a topic or country key',()=>{
  assert.equal(new URL(memberVoteRecordRoute(MEMBER,{tag:'topic:100195'}),'http://localhost').searchParams.get('tag'),'topic:100195');
  assert.equal(new URL(memberVoteRecordRoute(MEMBER,{tag:'country:RUS'}),'http://localhost').searchParams.get('tag'),'country:RUS');
  assert.equal(new URL(memberVoteRecordRoute(MEMBER),'http://localhost').searchParams.has('tag'),false);
  for(const tag of ['oeil:6.40','topic:','country:rus','x'])assert.throws(()=>memberVoteRecordRoute(MEMBER,{tag}),RangeError,tag);
});

test('the response validator checks the breakdown rows and the tag echoed on the departures',()=>{
  const row={key:'topic:100195',label:'consumption',language:'en',comparable:25,withGroup:10,share:0.4};
  const breakdown={overall:0.8,topics:{eligible:1,rows:[row]},countries:{eligible:0,rows:[]}};
  assert.equal(validateMemberVoteRecordResponse(response({breakdown}),{memberId:MEMBER}),true);
  for(const [label,value] of [['key',{...row,key:'oeil:6'}],['empty label',{...row,label:''}],['share',{...row,share:1.2}],['counts',{...row,withGroup:30}],['language',{...row,language:'xx'}]])
    assert.equal(validateMemberVoteRecordResponse(response({breakdown:{...breakdown,topics:{eligible:1,rows:[value]}}}),{memberId:MEMBER}),false,label);
  assert.equal(validateMemberVoteRecordResponse(response({breakdown:{...breakdown,topics:{eligible:0,rows:[row]}}}),{memberId:MEMBER}),false,'more rows than eligible');
  assert.equal(validateMemberVoteRecordResponse(response({departures:{...response().departures,tag:{key:'country:FRA',label:'France',language:'en'}}}),{memberId:MEMBER}),true);
  assert.equal(validateMemberVoteRecordResponse(response({departures:{...response().departures,tag:{key:'bad',label:null,language:null}}}),{memberId:MEMBER}),false);
});

test('a former member keeps historical figures and the group state is accepted',()=>{
  const former=response({group:{code:null,status:'not-serving'},comparison:null});
  assert.equal(validateMemberVoteRecordResponse(former,{memberId:MEMBER}),true);
  const view=recordView(former);
  assert.equal(view.known,true);assert.equal(view.figures.against,1);assert.equal(view.medians,null);assert.equal(view.note,null);
});

test('the panel view follows the group state and never shows figures it cannot compare',()=>{
  assert.equal(recordView(response({coverage:{sittings:3,included:0,missing:3,unprojectedDecisions:0,status:'pending'}})).state,'pending');
  const attached=recordView(response());
  assert.deepEqual([attached.known,attached.list,attached.note,attached.figures.against],[true,true,null,1]);
  // A current non-attached member has no alignment, but keeps the departures of an earlier group.
  const nonAttached=recordView(response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null,departures:{...response().departures,total:3}}));
  assert.deepEqual([nonAttached.known,nonAttached.figures,nonAttached.list,nonAttached.note],[false,null,true,'nonAttached']);
  assert.equal(recordView(response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null,departures:{...response().departures,total:0,items:[]}})).list,false);
  const unknown=recordView(response({group:{code:null,status:'unavailable'},alignment:null,comparison:null,departures:{...response().departures,total:0,items:[]}}));
  assert.deepEqual([unknown.known,unknown.list,unknown.note],[false,false,'groupUnavailable']);
  const none=recordView(response({alignment:{all:counts(0,0),wholeText:counts(0,0)},comparison:null,departures:{...response().departures,total:0,items:[]}}));
  assert.deepEqual([none.known,none.list,none.note],[false,false,'noComparable']);
  // Final votes with no comparable whole-text vote still show the member's figures, with the share unknown.
  const final=recordView(response({alignment:{all:counts(3,1,1,0),wholeText:counts(0,0,2,0)}}),'final');
  assert.equal(final.known,true);assert.equal(final.figures.withShare,null);
});
