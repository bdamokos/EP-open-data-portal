import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {HttpError} from './http-utils.mjs';
import {MEMBER_VOTE_SNAPSHOT_VERSION} from './member-votes.mjs';
import {MemberVoteRecordReader,memberVoteRecordQuery,memberVoteRecordLanguage,MEMBER_VOTE_RECORD_VERSION} from './member-vote-record.mjs';

const MEP='1',VERSION=MEMBER_VOTE_SNAPSHOT_VERSION;
const A='MTG-PL-2026-09-16',B='MTG-PL-2026-10-07',C='MTG-PL-2026-10-08';
const decision=(sitting,number)=>sitting+'-DEC-'+number;
const emptyAlignment=()=>({with:0,against:0,abstained:0,notComparable:0});
const person=code=>({coverage:'complete',mandateCoverage:'complete',mandates:[{start:'2024-07-16',end:null}],ambiguous:[],groups:[{code,org:'org/'+code,groupId:'org/'+code,start:'2024-07-16',end:null}]});
const history={members:{'1':person('S&D'),'2':person('Renew'),'3':person('S&D')},catalogue:{sources:[],bodies:[]}};
const titles=(text)=>({en:text});

function memberRow({sittingId,date,alignment=emptyAlignment(),wholeText=emptyAlignment(),recorded=0,named=0,chaired=0,withGroup=null,comparable=null,finalWithGroup=null,finalComparable=null,departures=[]}) {
  return {memberId:MEP,sittingId,date,groupCode:'S&D',alignment,wholeText,ballots:{recorded,named,chaired},departures,
    bySitting:{sittingId,date,withGroup,comparable,finalWithGroup,finalComparable}};
}

function database({includeC=true,generation=3,groupSnapshot=history,totals=[{memberId:MEP,withGroup:3,comparable:4,finalWithGroup:3,finalComparable:3},{memberId:'2',withGroup:2,comparable:4,finalWithGroup:1,finalComparable:2},{memberId:'3',withGroup:1,comparable:2,finalWithGroup:0,finalComparable:1}]}={}) {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE member_vote_record_sittings (
    sitting_id TEXT PRIMARY KEY, revision TEXT NOT NULL, date TEXT NOT NULL,
    group_generation INTEGER, snapshot_version INTEGER NOT NULL,
    named INTEGER NOT NULL, decisions TEXT NOT NULL, complete INTEGER NOT NULL);
    CREATE TABLE member_vote_record_members (member_id TEXT NOT NULL, sitting_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(member_id,sitting_id));
    CREATE TABLE member_vote_record_totals (member_id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE sitting_snapshots (kind TEXT, version INTEGER, id TEXT, complete INTEGER, error TEXT);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE group_history_snapshots (generation INTEGER PRIMARY KEY, body TEXT NOT NULL);`);
  db.prepare('INSERT INTO meta VALUES (?,?)').run('active',JSON.stringify(generation));
  if(groupSnapshot)db.prepare('INSERT INTO group_history_snapshots VALUES (?,?)').run(generation,JSON.stringify(groupSnapshot));
  const insertSitting=db.prepare('INSERT INTO member_vote_record_sittings VALUES (?,?,?,?,?,?,?,?)');
  const insertMember=db.prepare('INSERT INTO member_vote_record_members VALUES (?,?,?)');
  const snapshot=db.prepare('INSERT INTO sitting_snapshots VALUES (?,?,?,?,?)');
  const sitting=(id,{named=0,complete=1,decisions={}}={})=>{
    insertSitting.run(id,'a'.repeat(64),id.slice(7),generation,VERSION,named,JSON.stringify(decisions),complete);
    snapshot.run('votes',VERSION,id,complete,null);
  };
  const member=row=>insertMember.run(MEP,row.sittingId,JSON.stringify(row));
  for(const total of totals)db.prepare('INSERT INTO member_vote_record_totals VALUES (?,?)').run(total.memberId,JSON.stringify(total));
  if(includeC)snapshot.run('votes',VERSION,C,1,null);
  return {db,sitting,member,snapshot};
}

function fullDatabase({complete=false}={}) {
  const {db,sitting,member}=database({includeC:!complete});
  sitting(A,{named:2,decisions:{
    [decision(A,1)]:{titles:titles('First final'),referenceTexts:{},outcome:'ADOPTED',scope:'whole-text',wholeText:true,method:'VOTE_ELECTRONIC_ROLLCALL'},
    [decision(A,2)]:{titles:titles('First amendment'),referenceTexts:{},outcome:'REJECTED',scope:'amendment',wholeText:false,method:'VOTE_ELECTRONIC_ROLLCALL'},
  }});
  sitting(B,{named:2,decisions:{
    [decision(B,3)]:{titles:titles('Second final'),referenceTexts:{},outcome:'ADOPTED',scope:'whole-text',wholeText:true,method:'VOTE_ELECTRONIC_ROLLCALL'},
    [decision(B,4)]:{titles:titles('Second amendment'),referenceTexts:{},outcome:'REJECTED',scope:'amendment',wholeText:false,method:'VOTE_ELECTRONIC_ROLLCALL'},
  }});
  member(memberRow({sittingId:A,date:'2026-09-16',alignment:{with:1,against:1,abstained:0,notComparable:0},wholeText:{with:1,against:0,abstained:0,notComparable:0},
    recorded:2,named:2,withGroup:1,comparable:2,finalWithGroup:1,finalComparable:1,departures:[{decisionId:decision(A,2),date:'2026-09-16',wholeText:false,position:'against',line:'for'}]}));
  member(memberRow({sittingId:B,date:'2026-10-07',alignment:{with:2,against:0,abstained:1,notComparable:0},wholeText:{with:2,against:0,abstained:0,notComparable:0},
    recorded:3,named:2,chaired:1,withGroup:2,comparable:2,finalWithGroup:2,finalComparable:2,departures:[
      {decisionId:decision(B,3),date:'2026-10-07',wholeText:true,position:'against',line:'for'},
      {decisionId:decision(B,4),date:'2026-10-07',wholeText:false,position:'against',line:'for'},
    ]}));
  return db;
}

const query=(patch={})=>memberVoteRecordQuery(new URLSearchParams({lang:'en',limit:'5',offset:'0',...patch}));

test('the reader combines stored member rows without parsing snapshots or contacting upstream',()=>{
  const db=fullDatabase();
  const reader=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00:00Z')});
  const data=reader.query(MEP,{...query(),language:'en'});
  assert.equal(data.version,MEMBER_VOTE_RECORD_VERSION);
  assert.deepEqual(data.member,{id:MEP,uri:'https://data.europarl.europa.eu/person/'+MEP});
  assert.deepEqual(data.period,{from:'2024-07-16',to:'2026-10-07'});
  assert.deepEqual(data.coverage,{sittings:3,included:2,missing:1,status:'partial'});
  assert.deepEqual(data.group,{code:'S&D',status:'attached'});
  assert.deepEqual(data.alignment.all,{with:3,against:1,abstained:1,notComparable:0});
  assert.deepEqual(data.alignment.wholeText,{with:3,against:0,abstained:0,notComparable:0});
  assert.deepEqual(data.ballots,{recorded:5,named:4,chaired:1});
  assert.deepEqual(data.bySitting,[
    {sittingId:B,date:'2026-10-07',withGroup:2,comparable:2,finalWithGroup:2,finalComparable:2},
    {sittingId:A,date:'2026-09-16',withGroup:1,comparable:2,finalWithGroup:1,finalComparable:1},
  ]);
  // Whole texts sort first, then newest first within each scope.
  assert.deepEqual(data.departures.items.map(item=>item.decisionId),[decision(B,3),decision(B,4),decision(A,2)]);
  assert.deepEqual(data.departures.items.map(item=>item.scope),['final','all','all']);
  assert.equal(data.departures.items[0].text,'Second final');
  assert.equal(data.departures.total,3);
  assert.equal(data.departures.nextOffset,null);
  assert.equal(data.comparison,null,'medians need every stored sitting');
});

test('medians come from current members with comparable votes, for each scope, once coverage is complete',()=>{
  const db=fullDatabase({complete:true});
  const reader=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00:00Z')});
  const data=reader.query(MEP,{...query(),language:'en'});
  assert.equal(data.coverage.status,'complete');
  assert.deepEqual(data.comparison.all,{group:{median:0.625,members:2},parliament:{median:0.5,members:3}});
  assert.deepEqual(data.comparison.final,{group:{median:0.5,members:2},parliament:{median:0.5,members:3}});
  // A member who left office is not a current member.
  const left={...history,members:{...history.members,'3':{...person('S&D'),mandates:[{start:'2024-07-16',end:'2026-01-01'}],mandateCoverage:'complete',groups:[{code:'S&D',org:'org/S&D',groupId:'org/S&D',start:'2024-07-16',end:'2026-01-01'}]}}};
  db.prepare('UPDATE group_history_snapshots SET body=?').run(JSON.stringify(left));
  assert.deepEqual(reader.query(MEP,{...query(),language:'en'}).comparison.all,{group:{median:0.75,members:1},parliament:{median:0.625,members:2}});
});

test('named votes count only while in office, and an unknown mandate leaves the total unknown',()=>{
  const db=fullDatabase({complete:true});
  const reader=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00:00Z')});
  // Joined after the first sitting without a ballot there: only the second sitting's votes are due.
  db.prepare('DELETE FROM member_vote_record_members WHERE sitting_id=?').run(A);
  const joined={...history,members:{...history.members,'1':{...person('S&D'),mandates:[{start:'2026-10-01',end:null}],groups:[{code:'S&D',org:'org/S&D',groupId:'org/S&D',start:'2026-10-01',end:null}]}}};
  db.prepare('UPDATE group_history_snapshots SET body=?').run(JSON.stringify(joined));
  assert.equal(reader.query(MEP,{...query(),language:'en'}).ballots.named,2);
  db.prepare('UPDATE group_history_snapshots SET body=?').run(JSON.stringify({members:{},catalogue:{sources:[],bodies:[]}}));
  const unknown=reader.query(MEP,{...query(),language:'en'});
  assert.equal(unknown.ballots.named,null);
  assert.equal(unknown.ballots.recorded,3);
});

test('scope, limit and offset select departures without changing the stored totals',()=>{
  const db=fullDatabase();
  const reader=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00:00Z')});
  const all=reader.query(MEP,{...query({limit:'1',offset:'0'}),language:'en'});
  assert.deepEqual(all.departures.items.map(item=>item.decisionId),[decision(B,3)]);
  assert.equal(all.departures.nextOffset,1);
  assert.equal(all.alignment.all.with,3,'a page of departures never truncates the alignment counts');
  const page=reader.query(MEP,{...query({limit:'1',offset:'1'}),language:'en'});
  assert.deepEqual(page.departures.items.map(item=>item.decisionId),[decision(B,4)]);
  assert.equal(page.departures.offset,1);
  const final=reader.query(MEP,{...query({scope:'final'}),language:'en'});
  assert.deepEqual(final.departures.items.map(item=>item.decisionId),[decision(B,3)]);
  assert.equal(final.departures.scope,'final');
  assert.equal(final.departures.total,1);
  assert.equal(final.departures.nextOffset,null);
  const empty=reader.query(MEP,{...query({offset:'3'}),language:'en'});
  assert.deepEqual(empty.departures.items,[]);
  assert.equal(empty.departures.total,3);
});

test('a missing snapshot leaves explicit partial coverage and an absent projection adds no member figure',()=>{
  const {db,sitting,member}=database({includeC:false});
  sitting(A,{named:2});
  member(memberRow({sittingId:A,date:'2026-09-16',alignment:{with:1,against:1,abstained:0,notComparable:0},recorded:2,named:2,withGroup:1,comparable:2}));
  const reader=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00:00Z')});
  const data=reader.query(MEP,{...query(),language:'en'});
  assert.deepEqual(data.coverage,{sittings:1,included:1,missing:0,status:'complete'});
  // A stored expected sitting without a projection is partial, never zero.
  db.prepare('INSERT INTO sitting_snapshots VALUES (?,?,?,?,?)').run('votes',VERSION,C,1,null);
  const partial=reader.query(MEP,{...query(),language:'en'});
  assert.deepEqual(partial.coverage,{sittings:2,included:1,missing:1,status:'partial'});
  assert.equal(partial.bySitting.length,1);
});

test('non-attached and unavailable group states omit group figures while keeping recorded ballots',()=>{
  const db=fullDatabase();
  const nonAttached={...history,members:{...history.members,'1':person('NI')}};
  db.prepare('UPDATE group_history_snapshots SET body=?').run(JSON.stringify(nonAttached));
  const reader=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00:00Z')});
  const data=reader.query(MEP,{...query(),language:'en'});
  assert.deepEqual(data.group,{code:'NI',status:'non-attached'});
  assert.equal(data.alignment,null);
  assert.equal(data.comparison,null);
  assert.equal(data.ballots.recorded,5);
  db.prepare('UPDATE group_history_snapshots SET body=?').run(JSON.stringify({members:{},catalogue:{sources:[],bodies:[]}}));
  const unavailable=reader.query(MEP,{...query(),language:'en'});
  assert.deepEqual(unavailable.group,{code:null,status:'unavailable'});
  assert.equal(unavailable.alignment,null);
});

test('an unavailable index or projection table fails without pretending the record is empty',()=>{
  const empty=new DatabaseSync(':memory:');
  assert.throws(()=>new MemberVoteRecordReader({snapshots:{connection:()=>null},clock:Date.now}).query(MEP,{...query(),language:'en'}),error=>error instanceof HttpError&&error.status===503);
  assert.throws(()=>new MemberVoteRecordReader({snapshots:{connection:()=>empty},clock:Date.now}).query(MEP,{...query(),language:'en'}),error=>error instanceof HttpError&&error.status===503);
});

test('query parsing rejects unsupported, repeated, out-of-range and malformed values',()=>{
  assert.deepEqual(memberVoteRecordQuery(new URLSearchParams()),{scope:'all',limit:5,offset:0});
  assert.deepEqual(memberVoteRecordQuery(new URLSearchParams({scope:'final',limit:'50',offset:'10000'})),{scope:'final',limit:50,offset:10000});
  for(const params of ['scope=other','limit=51','limit=-1','limit=1.5','offset=10001','offset=x','limit=1&limit=2','unknown=1'])
    assert.throws(()=>memberVoteRecordQuery(new URLSearchParams(params)),error=>error instanceof HttpError&&error.status===400,params);
  assert.equal(memberVoteRecordLanguage(new URLSearchParams({lang:'hu'})),'hu');
  assert.equal(memberVoteRecordLanguage(new URLSearchParams()),'en');
  for(const lang of ['eng','EN','e',''])assert.throws(()=>memberVoteRecordLanguage(new URLSearchParams({lang})),error=>error instanceof HttpError&&error.status===400);
});

test('the period ends at the latest stored sitting, even for a member absent from it',()=>{
  const {db,sitting,member}=database({includeC:false});
  sitting(A,{named:1});sitting(C,{named:1});
  member(memberRow({sittingId:A,date:'2026-09-16',alignment:{with:1,against:0,abstained:0,notComparable:0},recorded:1,named:1,withGroup:1,comparable:1}));
  const reader=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-09T12:00:00Z')});
  assert.deepEqual(reader.query(MEP,{...query(),language:'en'}).period,{from:'2024-07-16',to:'2026-10-08'});
});
