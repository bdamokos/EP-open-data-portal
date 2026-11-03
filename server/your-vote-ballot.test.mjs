import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {assembleBallot,ballotContext,ballotKey,prepareBallotBindings,persistBallotBindings,readBallotBindings,groupMajorities} from './your-vote-ballot.mjs';
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
test('binding survives list purge without retained list content',()=>{const db=new DatabaseSync(':memory:');prepareBallotBindings(db);const scope={sitting:'MTG-PL-2026-09-15',agenda,document:doc};persistBallotBindings(db,{...scope,bindings:ballot([row([7],1)]).bindings});assert.deepEqual(readBallotBindings(db,scope.sitting,agenda,doc).map(x=>({...x})),[{key:doc+':am:7:part1',decisionId:'MTG-PL-2026-09-15-DEC-196237'}]);db.close();});
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
  prepareVotingLists(store);prepareBallotBindings(db);const sitting='MTG-PL-2026-09-15',document={documentId:doc,agendaItemId:agenda,rows:[row([7],1)],notes:{},revision:{sha256:'hash',observedAt:'2026-09-15'}};
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
test('a later ambiguous observation removes a previously retained binding',()=>{const db=new DatabaseSync(':memory:'),scope={sitting:'MTG-PL-2026-09-15',agenda,document:doc};try{prepareBallotBindings(db);persistBallotBindings(db,{...scope,bindings:ballot([row([7],1)]).bindings});persistBallotBindings(db,{...scope,bindings:[]});assert.deepEqual(readBallotBindings(db,scope.sitting,agenda,doc),[]);}finally{db.close();}});

test('conflicting parent observations cannot bind an otherwise exact amendment',()=>{const day={sittingId:'MTG-PL-2026-09-15',decisions:fixture.decisions,results:[{id:'eli/dl/event/'+parent,activity_id:parent,executed:['eli/dl/event/'+agenda]}],conflictingResults:[{id:'eli/dl/event/'+parent,activity_id:parent,executed:['eli/dl/event/MTG-PL-2026-09-15-OJ-ITM-V-99']}],requests:[]};assert.equal(assembleBallot({document:doc,agendaItemId:agenda,day,votingList:{rows:[row([7],1)],notes:{}}}).rows[0].decisionId,null);});

test('a procedural label cannot supply decision identity',()=>{const raw={...fixture.decisions[0],activity_id:'MTG-PL-2026-09-15-DEC-196072',decided_on_a_realization_of:[],referenceText:{en:'Referral back'},comment:{}};const result=ballot([{kind:'procedural',label:'vote: Referral back',amendments:[],subject:[],part:null,row:77}],[raw]);assert.equal(result.rows[0].decisionId,null);assert.equal(result.added.length,0);});

test('fixed final labels bind only at the exact list position in the exact vote item',async()=>{
 const {parseVotingList}=await import('./voting-lists.mjs');const ds=JSON.parse(readFileSync(new URL('./fixtures/your-vote/decisions-17.json',import.meta.url))).decisions;
 for(const [file,document,id,parent,number,expected]of [['B10-0386_Fisheries_Policy.docx','B-10-2026-0386','MTG-PL-2026-09-17-OJ-ITM-V-1','MTG-PL-2026-09-17-VOT-ITM-993095',30,'MTG-PL-2026-09-17-DEC-196838'],['A10-0220_Ruotolo.docx','A-10-2026-0220','fixture-exact-agenda','MTG-PL-2026-09-17-VOT-ITM-993045',17,'MTG-PL-2026-09-17-DEC-196147']]){
  const votingList=parseVotingList(readFileSync(new URL('./fixtures/voting-lists/september/'+file,import.meta.url)),{sourceUrl:'https://www.europarl.europa.eu/',observedAt:'2026-11-03'}),final=votingList.rows.find(r=>r.kind==='final');assert.equal(final.row,number);
  const day={decisions:ds,results:[{activity_id:parent,executed:['eli/dl/event/'+id]}],requests:[]};
  const run=(row,agendaItemId=id,decisions=ds)=>assembleBallot({document,agendaItemId,day:{...day,decisions},votingList:{rows:[row],notes:{}}});
  assert.equal(run(final).rows[0].decisionId,expected);assert.equal(run({...final,row:number+1}).rows[0].decisionId,null);assert.equal(run(final,'different-agenda').rows[0].decisionId,null);
  assert.equal(run(final,id,ds.map(d=>d.activity_id===expected?{...d,referenceText:{en:'motion for a resolution (as a whole)'}}:d)).rows[0].decisionId,null);
 }
});
test('the verified referral-back label still requires exact position',()=>{
 const raw=fixture.decisions.find(d=>d.activity_id.endsWith('196072'));assert(raw);const procedural={kind:'procedural',label:'vote: Referral back',amendments:[],subject:[],part:null,row:77};
 assert.equal(ballot([procedural]).rows[0].decisionId,raw.activity_id);assert.equal(ballot([{...procedural,row:76}]).rows[0].decisionId,null);
});
test('same-kind text, final and procedural counterparts are never claimed as added',()=>{
 const ds=JSON.parse(readFileSync(new URL('./fixtures/your-vote/decisions-17.json',import.meta.url))).decisions;
 const agendaItemId='text-fixture',parent='MTG-PL-2026-09-17-VOT-ITM-993095',rows=[{kind:'text',subject:['§ 22'],amendments:[],row:27,part:null},{kind:'final',subject:[],amendments:[],row:31,part:null}];
 const response=assembleBallot({document:'B-10-2026-0386',agendaItemId,day:{decisions:ds,results:[{activity_id:parent,executed:['eli/dl/event/'+agendaItemId]}],requests:[]},votingList:{rows,notes:{}}});
 assert(response.rows.every(r=>r.decisionId===null));assert(!response.added.some(r=>r.decisionId.endsWith('196836')||r.decisionId.endsWith('196838')));
 const procedural=ballot([{kind:'procedural',subject:[],amendments:[],row:76,part:null}]);assert(!procedural.added.some(r=>r.decisionId.endsWith('196072')));
});
test('without an official list unmatched outcomes have no addition provenance',()=>{
 const response=assembleBallot({document:doc,agendaItemId:agenda,day:{decisions:fixture.decisions,results:[{activity_id:parent,executed:['eli/dl/event/'+agenda]}],requests:[]}});assert.deepEqual(response.added,[]);
});
test('verified whole-proposal scope remains a final binding path at its exact position',()=>{
 const day=JSON.parse(readFileSync(new URL('./fixtures/whole-proposal-votes.json',import.meta.url))).snapshot,raw=day.decisions.find(r=>r.activity_id.endsWith('199470')),parent=day.results.find(r=>r.id===raw.inverse_consists_of[0]),agendaItemId=String(parent.executed[0]?.id||parent.executed[0]).split('/').at(-1),final={kind:'final',amendments:[],subject:[],part:null,row:Number(raw.activity_order)};
 const run=(r,state=day)=>assembleBallot({document:'A-10-2026-0276',agendaItemId,day:state,votingList:{rows:[r],notes:{}}});assert.equal(run(final).rows[0].decisionId,raw.activity_id);assert.equal(run({...final,row:final.row+1}).rows[0].decisionId,null);assert.equal(run(final,{...day,results:[]}).rows[0].decisionId,null);
});
