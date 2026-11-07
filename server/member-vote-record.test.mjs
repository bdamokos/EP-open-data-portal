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
    named INTEGER NOT NULL, decisions TEXT NOT NULL, complete INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'projected', reason TEXT, subjects TEXT NOT NULL DEFAULT '{}',unprojected INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE member_vote_record_tags (sitting_id TEXT PRIMARY KEY, topics_generation INTEGER, tags TEXT NOT NULL);
    CREATE TABLE member_vote_record_members (member_id TEXT NOT NULL, sitting_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(member_id,sitting_id));
    CREATE TABLE member_vote_record_totals (member_id TEXT NOT NULL,snapshot_version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(member_id,snapshot_version));
    CREATE TABLE sitting_snapshots (kind TEXT, version INTEGER, id TEXT, complete INTEGER, error TEXT);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE group_history_snapshots (generation INTEGER PRIMARY KEY, body TEXT NOT NULL);`);
  db.prepare('INSERT INTO meta VALUES (?,?)').run('active',JSON.stringify(generation));
  if(groupSnapshot)db.prepare('INSERT INTO group_history_snapshots VALUES (?,?)').run(generation,JSON.stringify(groupSnapshot));
  const insertSitting=db.prepare('INSERT INTO member_vote_record_sittings(sitting_id,revision,date,group_generation,snapshot_version,named,decisions,complete,status,subjects) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const insertMember=db.prepare('INSERT INTO member_vote_record_members VALUES (?,?,?)');
  const snapshot=db.prepare('INSERT INTO sitting_snapshots VALUES (?,?,?,?,?)');
  const sitting=(id,{named=0,complete=1,decisions={},status='projected',subjects={},tags=[]}={})=>{
    insertSitting.run(id,'a'.repeat(64),id.slice(7),generation,VERSION,named,JSON.stringify(decisions),complete,status,JSON.stringify(subjects));
    db.prepare('INSERT INTO member_vote_record_tags VALUES (?,?,?)').run(id,null,JSON.stringify(tags));
    snapshot.run('votes',VERSION,id,complete,null);
  };
  const member=row=>insertMember.run(MEP,row.sittingId,JSON.stringify(row));
  for(const total of totals)db.prepare('INSERT INTO member_vote_record_totals VALUES (?,?,?)').run(total.memberId,VERSION,JSON.stringify(total));
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
  assert.equal(data.breakdown,null,'a record without tags has no breakdown');
  assert.deepEqual(data.member,{id:MEP,uri:'https://data.europarl.europa.eu/person/'+MEP});
  assert.deepEqual(data.period,{from:'2024-07-16',to:'2026-10-07'});
  assert.deepEqual(data.coverage,{sittings:3,included:2,missing:1,status:'partial',unprojectedDecisions:0});
  assert.deepEqual(data.group,{code:'S&D',status:'attached'});
  assert.deepEqual(data.alignment.all,{with:3,against:1,abstained:1,notComparable:0});
  assert.deepEqual(data.alignment.wholeText,{with:3,against:0,abstained:0,notComparable:0});
  assert.deepEqual(data.ballots,{chaired:1});
  assert.equal('bySitting' in data,false,'the per-sitting series is not part of the record');
  // Whole texts sort first, then newest first within each scope.
  assert.deepEqual(data.departures.items.map(item=>item.decisionId),[decision(B,3),decision(B,4),decision(A,2)]);
  assert.deepEqual(data.departures.items.map(item=>item.scope),['final','all','all']);
  assert.equal(data.departures.items[0].text,'Second final');
  assert.equal(data.departures.total,3);
  assert.equal(data.departures.nextOffset,null);
  assert.deepEqual(data.comparison.all,{group:{median:0.5,members:1}},'every member\'s totals cover the same projected sittings, so a missing one does not switch medians off');
});

test('the group median comes from current members of the same group with comparable votes, for each scope',()=>{
  const db=fullDatabase({complete:true});
  const reader=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00:00Z')});
  const data=reader.query(MEP,{...query(),language:'en'});
  assert.equal(data.coverage.status,'complete');
  assert.deepEqual(data.comparison.all,{group:{median:0.5,members:1}});
  assert.deepEqual(data.comparison.final,{group:{median:0,members:1}});
  // A member who left office is not a current member.
  const left={...history,members:{...history.members,'3':{...person('S&D'),mandates:[{start:'2024-07-16',end:'2026-01-01'}],mandateCoverage:'complete',groups:[{code:'S&D',org:'org/S&D',groupId:'org/S&D',start:'2024-07-16',end:'2026-01-01'}]}}};
  db.prepare('UPDATE group_history_snapshots SET body=?').run(JSON.stringify(left));
  assert.deepEqual(reader.query(MEP,{...query(),language:'en'}).comparison.all,null);
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
  assert.deepEqual(data.coverage,{sittings:1,included:1,missing:0,status:'complete',unprojectedDecisions:0});
  // A stored expected sitting without a projection is partial, never zero.
  db.prepare('INSERT INTO sitting_snapshots VALUES (?,?,?,?,?)').run('votes',VERSION,C,1,null);
  const partial=reader.query(MEP,{...query(),language:'en'});
  assert.deepEqual(partial.coverage,{sittings:2,included:1,missing:1,status:'partial',unprojectedDecisions:0});
});

test('non-attached and unavailable group states omit group figures while keeping the chaired count',()=>{
  const db=fullDatabase();
  const nonAttached={...history,members:{...history.members,'1':person('NI')}};
  db.prepare('UPDATE group_history_snapshots SET body=?').run(JSON.stringify(nonAttached));
  const reader=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00:00Z')});
  const data=reader.query(MEP,{...query(),language:'en'});
  assert.deepEqual(data.group,{code:'NI',status:'non-attached'});
  assert.equal(data.alignment,null);
  assert.equal(data.comparison,null);
  assert.deepEqual(data.ballots,{chaired:1});
  db.prepare('UPDATE group_history_snapshots SET body=?').run(JSON.stringify({members:{},catalogue:{sources:[],bodies:[]}}));
  const unavailable=reader.query(MEP,{...query(),language:'en'});
  assert.deepEqual(unavailable.group,{code:null,status:'unavailable'});
  assert.equal(unavailable.alignment,null);
});

test('an unavailable index fails, and a projection that does not exist yet answers as pending rather than as an error to retry',()=>{
  const empty=new DatabaseSync(':memory:');
  assert.throws(()=>new MemberVoteRecordReader({snapshots:{connection:()=>null},clock:Date.now}).query(MEP,{...query(),language:'en'}),error=>error instanceof HttpError&&error.status===503);
  const pending=new MemberVoteRecordReader({snapshots:{connection:()=>empty},clock:Date.now}).query(MEP,{...query(),language:'en'});
  assert.deepEqual(pending.coverage,{sittings:0,included:0,missing:0,status:'pending',unprojectedDecisions:0});
  assert.equal(pending.departures.total,0);
});

test('query parsing rejects unsupported, repeated, out-of-range and malformed values',()=>{
  assert.deepEqual(memberVoteRecordQuery(new URLSearchParams()),{scope:'all',tag:null,limit:5,offset:0});
  assert.deepEqual(memberVoteRecordQuery(new URLSearchParams({scope:'final',limit:'50',offset:'10000'})),{scope:'final',tag:null,limit:50,offset:10000});
  assert.equal(memberVoteRecordQuery(new URLSearchParams({tag:'topic:100195'})).tag,'topic:100195');
  assert.equal(memberVoteRecordQuery(new URLSearchParams({tag:'country:RUS'})).tag,'country:RUS');
  for(const params of ['scope=other','limit=51','limit=-1','limit=1.5','offset=10001','offset=x','limit=1&limit=2','unknown=1','tag=oeil:6.40','tag=topic:','tag=country:rus','tag=topic:1&tag=topic:2'])
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

test('coverage counts what is stored except sittings without decisions; unexamined, incomplete or conflicting ones are missing',()=>{
  const {db,sitting,member,snapshot}=database({includeC:false});
  sitting(A,{named:1});
  member(memberRow({sittingId:A,date:'2026-09-16',alignment:{with:1,against:0,abstained:0,notComparable:0},recorded:1,named:1,withGroup:1,comparable:1}));
  snapshot.run('votes',VERSION,B,0,null);
  snapshot.run('votes',VERSION,C,1,'Exact sitting metadata unavailable.');
  const reader=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-09T12:00:00Z')});
  assert.deepEqual(reader.query(MEP,{...query(),language:'en'}).coverage,{sittings:3,included:1,missing:2,status:'partial',unprojectedDecisions:0});
  // B held no decisions: not a sitting that is missing. C was examined and excluded: still missing.
  db.prepare('DELETE FROM sitting_snapshots WHERE id IN (?,?)').run(B,C);
  sitting(B,{named:0,complete:0,status:'empty'});sitting(C,{named:0,complete:1,status:'excluded'});
  assert.deepEqual(reader.query(MEP,{...query(),language:'en'}).coverage,{sittings:2,included:1,missing:1,status:'partial',unprojectedDecisions:0});
  db.prepare("UPDATE member_vote_record_sittings SET status='projected' WHERE sitting_id=?").run(C);
  assert.deepEqual(reader.query(MEP,{...query(),language:'en'}).coverage,{sittings:2,included:2,missing:0,status:'complete',unprojectedDecisions:0});
});

test('stored sittings that are not projected yet read as pending, and departures carry the result title only through an exact link',()=>{
  const {db,snapshot,sitting,member}=database({includeC:false});
  snapshot.run('votes',VERSION,A,1,null);
  const reader=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-09T12:00:00Z')});
  assert.deepEqual(reader.query(MEP,{...query(),language:'en'}).coverage,{sittings:1,included:0,missing:1,status:'pending',unprojectedDecisions:0});
  db.prepare('DELETE FROM sitting_snapshots').run();
  sitting(A,{named:2,decisions:{
    [decision(A,1)]:{subjectId:'result-1',titles:titles('Label one'),referenceTexts:{},outcome:'ADOPTED',scope:'amendment',wholeText:false,method:'VOTE_ELECTRONIC_ROLLCALL'},
    [decision(A,2)]:{subjectId:null,titles:titles('Label two'),referenceTexts:{},outcome:'ADOPTED',scope:'amendment',wholeText:false,method:'VOTE_ELECTRONIC_ROLLCALL'},
  },subjects:{'result-1':{en:'Energy efficiency of buildings',mul:'x'}}});
  member(memberRow({sittingId:A,date:'2026-09-16',recorded:2,named:2,withGroup:0,comparable:2,alignment:{with:0,against:2,abstained:0,notComparable:0},
    departures:[1,2].map(n=>({decisionId:decision(A,n),date:'2026-09-16',wholeText:false,position:'against',line:'for'}))}));
  const items=reader.query(MEP,{...query(),language:'en'}).departures.items;
  const one=items.find(item=>item.decisionId===decision(A,1)),two=items.find(item=>item.decisionId===decision(A,2));
  assert.deepEqual(one.subject,{text:'Energy efficiency of buildings',language:'en'});assert.equal(one.text,'Label one');
  assert.equal(two.subject,null);assert.equal(two.text,'Label two');
});

test('odd and even medians are rounded alike',()=>{
  const share=(withGroup,comparable)=>({withGroup,comparable,finalWithGroup:withGroup,finalComparable:comparable});
  const db=fullDatabase({complete:true});
  db.prepare('DELETE FROM member_vote_record_totals').run();
  const put=db.prepare('INSERT INTO member_vote_record_totals VALUES (?,?,?)');
  put.run('3',VERSION,JSON.stringify(share(1,3)));
  put.run(MEP,VERSION,JSON.stringify(share(1,1)));
  const data=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00:00Z')}).query(MEP,{...query(),language:'en'});
  assert.equal(data.comparison.all.group.median,0.3333);
});

function breakdownDatabase({tagged=25,againstTagged=15,procedures=['2026-1','2026-2','2026-3'],withOthers=50,group='S&D'}={}) {
  const {db,sitting,member}=database({includeC:false});
  const names=Array.from({length:tagged},(_,index)=>decision(A,index+1));
  const decisions=Object.fromEntries(names.map(id=>[id,{subjectId:null,titles:titles('Vote '+id.split('-').pop()),referenceTexts:{},outcome:'ADOPTED',scope:'amendment',wholeText:false,method:'VOTE_ELECTRONIC_ROLLCALL'}]));
  const tags=names.map((id,index)=>[id,[procedures[index%procedures.length]],['100195'],['FRA']]);
  sitting(A,{named:tagged,decisions,tags});
  const marks=Array.from({length:tagged},(_,index)=>index<againstTagged?'a':'w').join('');
  const against=names.slice(0,againstTagged);
  member({...memberRow({sittingId:A,date:'2026-09-16',alignment:{with:tagged-againstTagged,against:againstTagged,abstained:0,notComparable:0},recorded:tagged,named:tagged,withGroup:tagged-againstTagged,comparable:tagged,
    departures:against.map(id=>({decisionId:id,date:'2026-09-16',wholeText:false,position:'against',line:'for'}))}),vector:marks});
  // Many votes with the group and no tag: they raise the overall share only.
  const others=Array.from({length:withOthers},(_,index)=>decision(B,index+1));
  sitting(B,{named:withOthers,decisions:Object.fromEntries(others.map(id=>[id,{subjectId:null,titles:titles('Other'),referenceTexts:{},outcome:'ADOPTED',scope:'amendment',wholeText:false,method:'VOTE_ELECTRONIC_ROLLCALL'}])),tags:others.map(id=>[id,[],[],[]])});
  member({...memberRow({sittingId:B,date:'2026-10-07',alignment:{with:withOthers,against:0,abstained:0,notComparable:0},recorded:withOthers,named:withOthers,withGroup:withOthers,comparable:withOthers}),vector:'w'.repeat(withOthers)});
  db.prepare("UPDATE group_history_snapshots SET body=?").run(JSON.stringify({members:{[MEP]:person(group)},catalogue:{sources:[],bodies:[]}}));
  return db;
}
const readerFor=db=>new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00:00Z')});

test('the breakdown lists topics and countries clearly below the member\'s overall share, with labels and the evidence behind them',()=>{
  const data=readerFor(breakdownDatabase()).query(MEP,{...query(),language:'en'});
  // 35 of 75 with the group overall; the tagged votes are 10 of 25.
  assert.equal(data.breakdown.overall,60/75);
  assert.deepEqual(data.breakdown.topics.rows,[{key:'topic:100195',label:'consumption',language:'en',comparable:25,withGroup:10,share:0.4}]);
  assert.deepEqual(data.breakdown.countries.rows,[{key:'country:FRA',label:'France',language:'en',comparable:25,withGroup:10,share:0.4}]);
  assert.deepEqual([data.breakdown.topics.eligible,data.breakdown.countries.eligible],[1,1]);
  // Other languages use the metadata where it has them and name the language where it falls back.
  const hungarian=readerFor(breakdownDatabase()).query(MEP,{...query({lang:'hu'}),language:'hu'});
  assert.equal(hungarian.breakdown.countries.rows[0].language,'hu');
  assert.deepEqual([hungarian.breakdown.topics.rows[0].label,hungarian.breakdown.topics.rows[0].language],['consumption','en'],'the microthesaurus labels exist in English only');
});

test('the breakdown is absent without enough votes or texts, and when the member has no group line',()=>{
  assert.equal(readerFor(breakdownDatabase({tagged:19,againstTagged:12})).query(MEP,{...query(),language:'en'}).breakdown,null,'19 comparable votes');
  assert.equal(readerFor(breakdownDatabase({procedures:['2026-1','2026-2']})).query(MEP,{...query(),language:'en'}).breakdown,null,'two procedures');
  assert.equal(readerFor(breakdownDatabase({group:'NI'})).query(MEP,{...query(),language:'en'}).breakdown,null,'non-attached');
  // Eligible but not clearly below: a section with no rows, so the reader can say so.
  const level=readerFor(breakdownDatabase({againstTagged:2,withOthers:2})).query(MEP,{...query(),language:'en'});
  assert.deepEqual([level.breakdown.topics.eligible,level.breakdown.topics.rows.length],[1,0]);
});

test('a tag filters the departures to that exact tag and keeps paginating',()=>{
  const reader=readerFor(breakdownDatabase());
  const all=reader.query(MEP,{...query(),language:'en'});
  assert.equal(all.departures.total,15);assert.equal(all.departures.tag,null);
  const first=reader.query(MEP,{...query({tag:'topic:100195'}),language:'en'});
  assert.equal(first.departures.total,15);
  assert.deepEqual(first.departures.tag,{key:'topic:100195',label:'consumption',language:'en'});
  assert.equal(first.departures.items.length,5);assert.equal(first.departures.nextOffset,5);
  const page=reader.query(MEP,{...query({tag:'country:FRA',limit:'5',offset:'10'}),language:'en'});
  assert.equal(page.departures.items.length,5);assert.equal(page.departures.nextOffset,null);assert.equal(page.departures.total,15);
  const none=reader.query(MEP,{...query({tag:'country:DEU'}),language:'en'});
  assert.equal(none.departures.total,0);assert.deepEqual(none.departures.items,[]);
  // The scope still applies: no whole-text vote carries the tag, so Final is empty.
  assert.equal(reader.query(MEP,{...query({tag:'topic:100195',scope:'final'}),language:'en'}).departures.total,0);
});

test('former members retain historical figures without inventing a current group or median',()=>{
  const db=fullDatabase({complete:true}),past=structuredClone(history);
  past.members[MEP].mandates[0].end='2026-10-07';past.members[MEP].groups[0].end='2026-10-07';
  db.prepare('UPDATE group_history_snapshots SET body=?').run(JSON.stringify(past));
  const data=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00Z')}).query(MEP,{...query(),language:'en'});
  assert.deepEqual(data.group,{code:null,status:'not-serving'});assert.equal(data.alignment.all.with,3);assert.equal(data.departures.total,3);assert.equal(data.comparison,null);
});

test('unprojected named decisions force partial coverage without treating their missing arrays as zero',()=>{
  const db=fullDatabase({complete:true});db.prepare('UPDATE member_vote_record_sittings SET unprojected=1 WHERE sitting_id=?').run(A);
  const data=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00Z')}).query(MEP,{...query(),language:'en'});
  assert.equal(data.coverage.status,'partial');assert.equal(data.coverage.unprojectedDecisions,1);
});

test('an attached member has no alignment observations while every sitting is still pending',()=>{
  const {db}=database({includeC:true});
  const data=new MemberVoteRecordReader({snapshots:{connection:()=>db},clock:()=>Date.parse('2026-10-08T12:00Z')}).query(MEP,{...query(),language:'en'});
  assert.equal(data.group.status,'attached');assert.equal(data.coverage.included,0);assert.equal(data.coverage.status,'pending');
  assert.equal(data.alignment,null);assert.equal(data.comparison,null);assert.equal(data.breakdown,null);
});
