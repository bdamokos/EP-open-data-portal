import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {assembleBallot,ballotKey,persistBallotBindings,readBallotBindings,groupMajorities} from './your-vote-ballot.mjs';
const doc='A-10-2026-0201',agenda= 'MTG-PL-2026-09-15-OJ-ITM-V-29',parent='MTG-PL-2026-09-15-VOT-ITM-993066';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/your-vote/decisions-15.json',import.meta.url)));
const row=(numbers,part=null,cp=null)=>({kind:'amendment',amendments:numbers.map(number=>({number,cp})),part,row:1,subject:[]});
function ballot(rows,decisions=fixture.decisions){return assembleBallot({document:doc,agendaItemId:agenda,day:{sittingId:'MTG-PL-2026-09-15',date:'2026-09-15',decisions,results:[{id:'eli/dl/event/'+parent,activity_id:parent,executed:['eli/dl/event/'+agenda]}],requests:[],agenda:[]},votingList:{rows,notes:{},revision:{sha256:'abc'}}});}
test('exact real block, identical amendments, split and corresponding parts',()=>{
 const block=fixture.decisions.find(d=>d.activity_id.endsWith('196235')).decided_on_a_realization_of.map(id=>Number(id.split('-').at(-1)));
 const result=ballot([row(block),row([7],1),row([7],3),row([89,105,108]),row([83],1,1),row([83],2,1),row([83],null,2)]);
 assert.deepEqual(result.rows.map(r=>r.decisionId?.split('-').at(-1)),['196235','196237','196239','196260','196479','196480','196481']);
 assert.equal(ballot([row([89,105])]).rows[0].decisionId,null);
 assert.equal(ballot([row([83])]).rows[0].decisionId,null);
 assert.equal(ballot([row([7])]).rows[0].decisionId,null);
});
test('ambiguous and foreign vote decisions stay unbound',()=>{assert.equal(ballot([row([7],1)],[...fixture.decisions,fixture.decisions.find(d=>d.activity_id.endsWith('196237'))]).rows[0].decisionId,null);const foreign=fixture.decisions.map(d=>({...d,inverse_consists_of:['eli/dl/event/other']}));assert.equal(ballot([row([7],1)],foreign).rows[0].decisionId,null);});
test('keys preserve parts and exact text',()=>{assert.equal(ballotKey(doc,row([108,89,105])),doc+':am:89+105+108');assert.equal(ballotKey(doc,row([83],2,1)),doc+':am:83:cp1:part2');});
test('binding survives list purge without retained list content',()=>{const db=new DatabaseSync(':memory:');const scope={sitting:'MTG-PL-2026-09-15',agenda,document:doc};persistBallotBindings(db,{...scope,bindings:ballot([row([7],1)]).bindings});assert.deepEqual(readBallotBindings(db,scope.sitting,agenda,doc).map(x=>({...x})),[{key:doc+':am:7:part1',decisionId:'MTG-PL-2026-09-15-DEC-196237'}]);db.close();});
test('group ties are unavailable; dated membership only',()=>{assert.equal(groupMajorities([{group:{code:'EPP'},position:'for',status:'recorded'},{group:{code:'EPP'},position:'against',status:'recorded'}])[0].position,null);});
test('real original-text votes require exact paragraph AND row position',()=>{
 const decisions=JSON.parse(readFileSync(new URL('./fixtures/your-vote/decisions-17.json',import.meta.url))).decisions;
 const id='MTG-PL-2026-09-17-OJ-ITM-V-1',parent='MTG-PL-2026-09-17-VOT-ITM-993095';
 const make=(subject,position)=>assembleBallot({document:'B-10-2026-0386',agendaItemId:id,day:{decisions,results:[{id:'eli/dl/event/'+parent,executed:['eli/dl/event/'+id]}],requests:[]},votingList:{rows:[{kind:'text',amendments:[],subject:[subject],row:position,part:null}],notes:{}}}).rows[0];
 assert.equal(make('§ 22',28).decisionId,'MTG-PL-2026-09-17-DEC-196836');assert.equal(make('§ 22',27).decisionId,null);assert.equal(make('§ 23',28).decisionId,null);
});
test('source-owner purge retains exact bindings while deleting all voting-list revisions',async()=>{
 const {VotingListCollector,prepareVotingLists}=await import('./voting-list-collector.mjs');
 const db=new DatabaseSync(':memory:'),meta=new Map(),store={db,get:k=>meta.get(k),set:(k,v)=>meta.set(k,v),assertWriter(){},transaction(fn){db.exec('BEGIN');try{fn();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}};
 try {
  prepareVotingLists(store);const sitting='MTG-PL-2026-09-15',document={documentId:doc,agendaItemId:agenda,rows:[row([7],1)],notes:{},revision:{sha256:'hash',observedAt:'2026-09-15'}};
  db.prepare('INSERT INTO voting_list_revisions VALUES (?,?,?,?,?,?)').run('https://www.europarl.europa.eu/sedcms/votingList/example.docx',sitting,'hash','2026-09-15',JSON.stringify(document),1);
  db.prepare('INSERT INTO voting_list_revisions VALUES (?,?,?,?,?,?)').run('https://www.europarl.europa.eu/sedcms/votingList/example.docx',sitting,'other','2026-09-16',JSON.stringify({...document,rows:[row([7],2)],revision:{sha256:'other',observedAt:'2026-09-16'}}),1);
  db.prepare('INSERT INTO voting_list_sources VALUES (?,?,?,?,?)').run('https://www.europarl.europa.eu/sedcms/votingList/example.docx',sitting,JSON.stringify({latestHash:'hash',checkedAt:2}),1,1);
  const day={sittingId:sitting,decisions:fixture.decisions,results:[{id:'eli/dl/event/'+parent,activity_id:parent,executed:['eli/dl/event/'+agenda]}],requests:[]};
  const collector=new VotingListCollector(store,{clock:()=>Date.parse('2026-11-03T10:00Z'),sessions:[],snapshots:{read:()=>({day})},fetchSource:()=>{throw Error('No requests during purge');}});
  await collector.step({controller:new AbortController()});
  assert.equal(db.prepare('SELECT count(*) AS n FROM voting_list_revisions').get().n,0);
  const retained=readBallotBindings(db,sitting,agenda,doc);assert.equal(retained[0].decisionId,'MTG-PL-2026-09-15-DEC-196237');
  const restored=assembleBallot({document:doc,agendaItemId:agenda,day,retained});assert.equal(restored.rows[0].outcome,'ADOPTED');
 }finally{db.close();}
});
test('a later ambiguous observation removes a previously retained binding',()=>{const db=new DatabaseSync(':memory:'),scope={sitting:'MTG-PL-2026-09-15',agenda,document:doc};try{persistBallotBindings(db,{...scope,bindings:ballot([row([7],1)]).bindings});persistBallotBindings(db,{...scope,bindings:[]});assert.deepEqual(readBallotBindings(db,scope.sitting,agenda,doc),[]);}finally{db.close();}});

test('conflicting parent observations cannot bind an otherwise exact amendment',()=>{const day={sittingId:'MTG-PL-2026-09-15',decisions:fixture.decisions,results:[{id:'eli/dl/event/'+parent,activity_id:parent,executed:['eli/dl/event/'+agenda]}],conflictingResults:[{id:'eli/dl/event/'+parent,activity_id:parent,executed:['eli/dl/event/MTG-PL-2026-09-15-OJ-ITM-V-99']}],requests:[]};assert.equal(assembleBallot({document:doc,agendaItemId:agenda,day,votingList:{rows:[row([7],1)],notes:{}}}).rows[0].decisionId,null);});

test('a procedural label cannot supply decision identity',()=>{const raw={...fixture.decisions[0],activity_id:'MTG-PL-2026-09-15-DEC-196072',decided_on_a_realization_of:[],referenceText:{en:'Referral back'},comment:{}};const result=ballot([{kind:'procedural',label:'vote: Referral back',amendments:[],subject:[],part:null,row:77}],[raw]);assert.equal(result.rows[0].decisionId,null);assert.equal(result.added.length,1);});
