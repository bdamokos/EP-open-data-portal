import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ActivityStore} from './activity-index-store.mjs';
import {AMENDMENT_LINKS_VERSION} from './activity-index-model.mjs';
import {AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {AMENDMENT_DISTRIBUTION_PROOF_VERSION,AMENDMENT_OUTCOME_PROOF_VERSION} from './amendments.mjs';
import {amendmentById,saveAmendmentRows} from './amendments-store.mjs';
import {motionAmendmentsPage,motionAmendmentsQuery} from './motion-amendments.mjs';
import {motionSourceKey} from './motion-outcomes.mjs';

const target='B-10-2026-0424',original='B-10-2026-0441',joint='RC-10-2026-0441';
const adopted='TA-10-2026-0342',date='2026-10-02',at='2026-10-18T12:00:00.000Z';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/motion-outcomes-live-20261015.json',import.meta.url),'utf8'));
const publicAmendments=JSON.parse(readFileSync(new URL('./fixtures/motion-amendments-public.json',import.meta.url),'utf8'));
const source={url:'https://data.europarl.europa.eu/distribution/example/reader-amendments_en.docx',fetchedAt:at,language:'en'};
const clone=value=>structuredClone(value);
const query=(params='',document=target)=>motionAmendmentsQuery(document,new URLSearchParams(params));
const page=(store,params='',document=target)=>motionAmendmentsPage(store,query(params,document));
const selected=(store,id,params='',document=target)=>page(store,'amendment='+id+(params?'&'+params:''),document);

function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'motion-reader-contract-'));
  const store=new ActivityStore(directory,{clock:()=>Date.parse(at)});
  assert(store.acquire());
  const {generation}=store.beginCycle();
  t.after(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,generation};
}
function amendment(number,extra={}) {
  return {id:target+'-AM-'+number,targetDocumentId:target,number,date,documentDate:date,
    proposerDate:date,proposerDateBasis:'individual-amendment-document',listId:target+'-AM-001-020',
    language:'en',originalText:'Original source wording',proposedText:'Proposed source wording',
    textIntegrity:'complete',textParserVersion:AMENDMENT_EXTRACTION_VERSION,
    sourceFreshness:{version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,status:'fresh',distributionState:'available'},
    wordingSource:source,metadataSource:source,proposerSource:source,
    authors:[{name:'A checked proposer',personId:'101',status:'resolved',method:'exact_full_name_active_mandate'}],
    decisions:[],splitParts:[],sources:[source],gaps:[],...extra};
}
function saveRows(context,rows,document=target) {
  saveAmendmentRows(context.store,context.generation,{id:document,date,listProjectionVersion:AMENDMENT_LINKS_VERSION},rows,
    {complete:true,gaps:[],lastUpdated:at});
}
function putMotion(context,id=target,extra={}) {
  const work={id:'eli/dl/doc/'+id,identifier:id,
    work_type:'def/ep-document-types/'+(id.startsWith('RC-')?'RESOLUTION_MOTION_JOINT':'RESOLUTION_MOTION'),
    document_date:date,title_dcterms:{en:'A source motion title'},creator:['person/101'],
    amendmentLinksVersion:AMENDMENT_LINKS_VERSION,inverse_foresees_change_of:[],...extra};
  context.store.putSource(context.generation,'/plenary-documents/'+id,'document',work,at);
  return work;
}
function seedPublicOutcomes(t,change=()=>{}) {
  const context=setup(t);
  for(const record of fixture.documents)context.store.putSource(context.generation,record.endpoint,'document',clone(record.work),record.retrievedAt);
  const record=publicAmendments.works.find(record=>record.work.identifier===target);
  assert(record,'The public amendment fixture must supply its exact target metadata.');
  context.store.putSource(context.generation,'/plenary-documents/'+target,'document',clone(record.work),record.source.fetchedAt);
  const votes=clone(fixture.votes);
  change(votes);
  context.store.putSource(context.generation,motionSourceKey(fixture.sittingId),'motion-outcomes',votes,fixture.retrievedAt);
  return context;
}
function putAdopted(context,extra={},id=adopted) {
  context.store.putSource(context.generation,'/adopted-texts/'+id,'document',{
    id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/TEXT_ADOPTED',
    document_date:'2026-10-08',title_dcterms:{en:'An adopted source title'},adopts:['eli/dl/doc/'+target],
    creator:['person/101'],workHadParticipation:[{participation_role:'def/ep-roles/AUTHOR',had_participant_person:['person/101']}],
    is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/FRA',is_embodied_by:[{
      format:'http://publications.europa.eu/resource/authority/file-type/DOCX',
      is_exemplified_by:'https://data.europarl.europa.eu/distribution/example/adopted_fr.docx',byteSize:1200,
    }]}],...extra,
  },at);
}

test('exact amendment selection validates identity and leaves list defaults intact',()=>{
  assert.equal(query().amendment,null);
  assert.equal(query('amendment='+target+'-AM-13').amendment,target+'-AM-13');
  assert.equal(query('amendment='+joint+'-AM-001',joint).amendment,joint+'-AM-001');
  for(const id of ['',target,target+'-AM-0',target+'-AM-00000',target+'-AM-100000',
    target+'-AM-13-SPLIT-1-1',target+'-AM-013-020',original+'-AM-13',joint+'-AM-1',
    'A-10-2026-0424-AM-13','eli/dl/doc/'+target+'-AM-13','https://data.europarl.europa.eu/eli/dl/doc/'+target+'-AM-13'])
    assert.throws(()=>query('amendment='+encodeURIComponent(id)),error=>error.status===400,id);
  assert.throws(()=>query('amendment='+target+'-AM-13&amendment='+target+'-AM-13'),error=>error.status===400);
});

test('a checked exact selection remains available outside the list page and selected-member scope',t=>{
  const context=setup(t),{store}=context;
  saveRows(context,[amendment(13),amendment(15),amendment(20,{authors:[{name:'Another checked proposer',personId:'102',status:'resolved'}]})]);
  const unselected=page(store,'member=101&scope=member&limit=1');
  assert.deepEqual(unselected.selection,{requestedId:null,status:'not-requested',item:null,inRequestedScope:null,inPage:false});
  const result=selected(store,target+'-AM-20','member=101&scope=member&limit=1');
  assert.deepEqual(result.items.map(item=>item.id),[target+'-AM-13']);
  assert.equal(result.total,2);assert.deepEqual(result.totals,{allIndexed:3,memberMatched:2});
  assert.equal(result.selection.status,'available');assert.equal(result.selection.item.id,target+'-AM-20');
  assert.equal(result.selection.inRequestedScope,false);assert.equal(result.selection.inPage,false);
  assert.equal(result.selection.item.memberMatch.matched,false);
  const inPage=selected(store,target+'-AM-15','member=101&scope=member&limit=1&offset=1');
  assert.equal(inPage.selection.inRequestedScope,true);assert.equal(inPage.selection.inPage,true);
  const {authorMatch,...listed}=inPage.items[0];
  assert.deepEqual(inPage.selection.item,listed);
  const noMember=selected(store,target+'-AM-20','limit=1');
  assert.equal(noMember.selection.inRequestedScope,true);assert.equal(noMember.selection.item.memberMatch.status,'not-requested');
  const missing=selected(store,target+'-AM-99','member=101&scope=member&limit=1');
  assert.deepEqual(missing.selection,{requestedId:target+'-AM-99',status:'unavailable',item:null,inRequestedScope:null,inPage:false});
  assert.deepEqual(missing.items,unselected.items);assert.equal(missing.total,unselected.total);
});

test('exact record reads accept only observed official aliases and reject ambiguous or cross-target matches',t=>{
  const context=setup(t),{store}=context,id=target+'-AM-13',alias=target+'-AM-013';
  saveRows(context,[amendment(13,{officialIds:['eli/dl/doc/'+alias]})]);
  assert.equal(amendmentById(store,{document:target,id,language:'en'}).id,id);
  assert.equal(amendmentById(store,{document:target,id:alias,language:'en'}).id,id);
  assert.equal(selected(store,alias).selection.item.id,id);
  assert.equal(amendmentById(store,{document:target,id:target+'-AM-0013',language:'en'}),null);
  assert.equal(amendmentById(store,{document:original,id,language:'en'}),null);
  assert.equal(amendmentById(store,{document:target,id:'eli/dl/doc/'+id,language:'en'}).id,id);
  assert.equal(amendmentById(store,{document:target,id:'https://example.org/eli/dl/doc/'+id,language:'en'}),null);
  saveRows(context,[amendment(13,{officialIds:['eli/dl/doc/'+alias]}),amendment(14,{officialIds:['eli/dl/doc/'+alias]})]);
  assert.equal(amendmentById(store,{document:target,id:alias,language:'en'}),null);
  assert.equal(selected(store,alias).selection.status,'unavailable');
});

test('selected records pass the same stale-wording and per-variant proposer checks as page items',t=>{
  const context=setup(t),{store}=context;
  const a=amendment(20),b=amendment(20,{listId:target+'-AM-020-021',proposedText:'A conflicting source variant',
    authors:[{name:'Other checked proposer',personId:'102',status:'resolved'}]});
  saveRows(context,[amendment(13),amendment(15,{textParserVersion:AMENDMENT_EXTRACTION_VERSION+'-old'}),
    amendment(20,{conflicted:true,authors:[{name:'Untrusted aggregate',personId:'103',status:'resolved'}],variants:[a,b]})]);
  const stale=selected(store,target+'-AM-15','member=101&limit=1').selection.item;
  assert.equal(stale.originalText,null);assert.equal(stale.proposedText,null);
  assert.equal(stale.wording.proposedStatus,'withheld');assert.equal(stale.memberMatch.status,'recorded');
  const chosen=selected(store,target+'-AM-20','member=101&scope=member&limit=1').selection;
  assert.equal(chosen.status,'available');assert.equal(chosen.inRequestedScope,true);assert.equal(chosen.inPage,false);
  assert.equal(chosen.item.originalText,null);assert.equal(chosen.item.proposedText,null);assert.deepEqual(chosen.item.authors,[]);
  assert.equal(chosen.item.memberMatch.basis,'variant');assert.equal(chosen.item.memberMatch.aggregateMatched,false);
  assert.deepEqual(chosen.item.variants.map(variant=>variant.memberMatch.matched),[true,false]);
  const aggregate=selected(store,target+'-AM-20','member=103&scope=member').selection;
  assert.equal(aggregate.status,'available');assert.equal(aggregate.inRequestedScope,false);assert.equal(aggregate.item.memberMatch.matched,false);
});

test('exact selection uses the serving amendment generation without resurrecting an earlier alias',t=>{
  const context=setup(t),{store}=context,alias=target+'-AM-013';
  saveRows(context,[amendment(13,{officialIds:['eli/dl/doc/'+alias],proposedText:'Earlier observed wording'})]);
  store.publish(context.generation);
  const next=store.beginCycle();
  saveRows({store,generation:next.generation},[amendment(13,{officialIds:[],proposedText:'Later observed wording'})]);
  const result=selected(store,target+'-AM-13');
  assert.equal(result.snapshots.amendments,next.generation);
  assert.equal(result.selection.item.proposedText,'Later observed wording');
  assert.equal(selected(store,alias).selection.status,'unavailable');
});

test('selected split decisions retain rejected and lapsed parts without inventing a whole-amendment decision',t=>{
  const context=setup(t),id=joint+'-AM-1';
  const requestId='eli/dl/event/MTG-PL-2026-10-08-VOT-ITM-993193-SPLIT-3';
  const partIds=[1,2].map(number=>'eli/dl/doc/MTG-PL-2026-10-08-VOT-ITM-993193-SPLIT-3-'+number);
  const proof={version:AMENDMENT_OUTCOME_PROOF_VERSION,requestId,componentCount:2,componentIds:partIds,sourceComplete:true};
  saveRows(context,[amendment(1,{id,targetDocumentId:joint,listId:joint+'-AM-001-002',
    decisions:['REJECTED','LAPSED'].map((outcome,index)=>({id:'MTG-PL-2026-10-08-DEC-'+(198211+index),
      amendmentIds:[id],outcome,partId:partIds[index],partNumber:index+1,componentBinding:'single-amendment',
      componentReferences:[partIds[index]],requestCoverages:[proof],source})),
    splitParts:partIds.map((id,index)=>({id,requestId,number:index+1,description:'Published selection description '+(index+1),
      status:'parsed',language:'en',source,requestCoverage:proof})),
  })],joint);
  const result=selected(context.store,id,'member=101',joint),item=result.selection.item;
  assert.equal(result.selection.status,'available');assert.equal(item.outcome,'mixed');assert.equal(item.wholeAmendmentOutcome,'unavailable');
  assert.deepEqual(item.decisions.map(decision=>[decision.outcome,decision.scope]),[['REJECTED','split-part'],['LAPSED','split-part']]);
  assert(item.splitParts.every(part=>part.wordingGrounding==='not-validated'));
});

test('real B and RC whole outcomes remain independent from amendment results and unknown member positions',t=>{
  const {store}=seedPublicOutcomes(t);
  const expected=[
    [target,'adopted','MTG-PL-2026-10-08-DEC-198051',{for:381,against:167,abstaining:15}],
    [original,'lapsed','MTG-PL-2026-10-08-DEC-197932',null],
    [joint,'adopted','MTG-PL-2026-10-08-DEC-198216',{for:482,against:41,abstaining:39}],
  ];
  for(const [id,status,decisionId,totals] of expected) {
    const result=page(store,'member=197722',id);
    assert.equal(result.text.outcome.status,status);assert.equal(result.text.outcome.decisionId,decisionId);
    assert.deepEqual(result.text.outcome.totals,totals);
    assert.deepEqual(result.text.memberPosition,{memberId:'197722',status:'unavailable',position:null,reason:'named-member-votes-not-in-motion-sources'});
    assert.equal(result.total,0);assert.equal(result.coverage.resultState,'not-indexed');
  }
  const fromOriginal=page(store,'member=197722',original);
  const related=fromOriginal.relations.jointMotions.find(text=>text.id===joint);
  assert.equal(related.outcome.status,'adopted');assert.equal(related.memberPosition.position,null);
  const fromJoint=page(store,'member=197722',joint);
  assert.equal(fromJoint.relations.originalMotions.find(text=>text.id===original).outcome.status,'lapsed');
  assert.deepEqual(page(store,'',target).text.memberPosition,{memberId:null,status:'not-requested',position:null,reason:null});
});

test('whole hand-vote adoption and rejected outcomes with larger For totals use the announced decision',t=>{
  const {store}=seedPublicOutcomes(t);
  const hands=page(store,'member=101','B-10-2026-0423').text;
  assert.equal(hands.outcome.status,'adopted');assert.equal(hands.outcome.method,'VOTE_HAND');assert.equal(hands.outcome.totals,null);
  assert.equal(hands.memberPosition.status,'unavailable');assert.equal(hands.memberPosition.position,null);
  const rejected=page(store,'member=101','B-10-2026-0465').text;
  assert.equal(rejected.outcome.status,'rejected');assert.deepEqual(rejected.outcome.totals,{for:282,against:259,abstaining:23});
  assert.equal(rejected.memberPosition.position,null);
});

test('another motion with a consistent exact direct subject in the same sitting does not hide the selected outcome',t=>{
  const {store}=seedPublicOutcomes(t,votes=>{
    const other=votes.decisions.find(decision=>decision.id.endsWith('DEC-197660'));
    other.decided_on_a_realization_of=['eli/dl/doc/B-10-2026-0423'];
    const selected=votes.decisions.find(decision=>decision.id.endsWith('DEC-198216'));
    selected.decided_on_a_realization_of=['eli/dl/doc/'+joint];
  });
  assert.equal(page(store,'',joint).text.outcome.status,'adopted');
  assert.equal(page(store,'','B-10-2026-0423').text.outcome.status,'adopted');
});

test('conflicting duplicate bindings cannot choose a whole-motion outcome, while count conflicts withhold totals',async t=>{
  for(const [name,change] of [
    ['decision outcome',votes=>{const decision=votes.decisions.find(value=>value.id.endsWith('DEC-198216'));votes.decisions.push({...clone(decision),decision_outcome:'def/ep-statuses/REJECTED'});} ],
    ['result date',votes=>{const result=votes.results.find(value=>value.id.endsWith('VOT-ITM-993193'));votes.results.push({...clone(result),activity_date:'2026-10-09'});}],
    ['result children',votes=>{const result=votes.results.find(value=>value.id.endsWith('VOT-ITM-993193'));votes.results.push({...clone(result),consists_of:[]});}],
    ['contradictory exact document',votes=>{const decision=votes.decisions.find(value=>value.id.endsWith('DEC-198216'));decision.decided_on_a_realization_of=['eli/dl/doc/'+original];}],
  ])await t.test(name,t=>{
    const {store}=seedPublicOutcomes(t,change);
    assert.equal(page(store,'member=197722',joint).text.outcome.status,'unavailable');
  });
  await t.test('decision count conflict',t=>{
    const {store}=seedPublicOutcomes(t,votes=>{
      const decision=votes.decisions.find(value=>value.id.endsWith('DEC-198216'));
      votes.decisions.push({...clone(decision),number_of_votes_favor:1});
    });
    const outcome=page(store,'',joint).text.outcome;
    assert.equal(outcome.status,'adopted');assert.equal(outcome.totals,null);
    assert.equal(outcome.totalsStatus,'conflicting');assert.equal(outcome.evidenceGaps.length,1);
  });
  await t.test('identical duplicate observations',t=>{
    const {store}=seedPublicOutcomes(t,votes=>{
      votes.decisions.push(clone(votes.decisions.find(value=>value.id.endsWith('DEC-198216'))));
      votes.results.push(clone(votes.results.find(value=>value.id.endsWith('VOT-ITM-993193'))));
    });
    assert.equal(page(store,'',joint).text.outcome.status,'adopted');
  });
});

test('retained whole-motion refresh evidence stays visible and partial linked evidence remains unavailable',async t=>{
  await t.test('retained accepted snapshot',t=>{
    const failure={attemptedAt:at,coverage:{missingResultIds:[],missingDecisionIds:['eli/dl/event/MTG-PL-2026-10-08-DEC-198216']},sources:[source]};
    const {store}=seedPublicOutcomes(t,votes=>{votes.lastRefreshFailure=failure;});
    const result=page(store,'',joint);
    assert.equal(result.text.outcome.status,'adopted');assert.deepEqual(result.text.outcome.refreshFailure,failure);
  });
  await t.test('missing declared child',t=>{
    const {store}=seedPublicOutcomes(t,votes=>{votes.decisions=votes.decisions.filter(value=>!value.id.endsWith('DEC-198211'));});
    assert.equal(page(store,'',joint).text.outcome.status,'unavailable');
  });
});

test('indexed adopted texts require their own exact metadata and adoption link without inherited authorship',t=>{
  const context=setup(t),{store}=context;
  putMotion(context);putAdopted(context);
  const result=page(store,'member=101&lang=en'),text=result.relations.adoptedTexts.find(text=>text.id===adopted);
  assert(text);assert.equal(text.kind,'adopted');assert.equal(text.status,'indexed');
  assert.equal(text.title,'An adopted source title');assert.equal(text.preferredFile.language,'fr');assert.equal(text.languageFallback,true);
  assert.equal(text.memberAuthorship.status,'unavailable');assert.deepEqual(text.memberAuthorship.relationships,[]);assert.deepEqual(text.authors,[]);
  assert.deepEqual(text.relationship,{type:'adopts',from:adopted,to:target,sources:text.sources});
  assert(text.sources.every(value=>value.url.includes('/adopted-texts/'+adopted)));
  assert.equal(result.relations.adoptedCoverage.status,'indexed');assert.equal(result.relations.adoptedCoverage.complete,false);
  assert.equal(result.text.id,target);assert.equal(result.text.kind,'original');
  assert(!Object.hasOwn(result.text,'paragraphs'),'Metadata does not substitute adopted body text for original context.');
});

test('missing, malformed, wrong-target or wrongly identified adopted evidence stays unavailable',async t=>{
  for(const [name,extra] of [
    ['missing metadata',null],
    ['wrong target',{adopts:['eli/dl/doc/'+original]}],
    ['external target URI',{adopts:['https://example.org/eli/dl/doc/'+target]}],
    ['missing relationship',{adopts:undefined}],
    ['malformed relationship',{adopts:[null,{},'not-a-reference']}],
    ['wrong document identity',{id:'eli/dl/doc/TA-10-2026-9999'}],
    ['wrong identifier',{identifier:'TA-10-2026-9999'}],
    ['wrong type',{work_type:'def/ep-document-types/RESOLUTION_MOTION'}],
  ])await t.test(name,t=>{
    const context=setup(t);putMotion(context);if(extra)putAdopted(context,extra);
    const result=page(context.store,'member=101');
    assert.deepEqual(result.relations.adoptedTexts,[]);
    assert.equal(result.relations.adoptedCoverage.status,'unavailable');assert.equal(result.relations.adoptedCoverage.complete,false);
    assert(result.relations.adoptedCoverage.gaps.length>0);
  });
});

test('selection, relations and whole outcomes remain readable with a query-only database and no upstream requests',t=>{
  const context=seedPublicOutcomes(t),{store}=context;
  saveRows(context,[amendment(13),amendment(20)]);putAdopted(context);
  const before={rows:store.db.prepare('SELECT * FROM amendments ORDER BY id').all(),
    sources:store.db.prepare('SELECT * FROM sources ORDER BY key').all(),jobs:store.db.prepare('SELECT * FROM amendment_jobs ORDER BY key').all()};
  store.release();store.db.exec('PRAGMA query_only=ON');
  t.mock.method(globalThis,'fetch',async()=>{assert.fail('Motion reader contract reads must not retrieve upstream data.');});
  const result=selected(store,target+'-AM-20','member=101&limit=1');
  assert.equal(result.selection.status,'available');assert.equal(result.text.outcome.status,'adopted');assert.equal(result.relations.adoptedTexts.length,1);
  assert.deepEqual(store.db.prepare('SELECT * FROM amendments ORDER BY id').all(),before.rows);
  assert.deepEqual(store.db.prepare('SELECT * FROM sources ORDER BY key').all(),before.sources);
  assert.deepEqual(store.db.prepare('SELECT * FROM amendment_jobs ORDER BY key').all(),before.jobs);
});

test('a WAL publication during a response cannot mix page, selection, totals or generation metadata',t=>{
  const context=setup(t),{store,generation}=context,nextGeneration=generation+1;
  const other={name:'Another checked proposer',personId:'102',status:'resolved'};
  putMotion(context,target,{title_dcterms:{en:'First generation title'}});
  saveRows(context,[amendment(13,{proposedText:'First generation page wording'}),
    amendment(20,{proposedText:'First generation selected wording',authors:[other]})]);
  store.publish(generation);
  const next={store,generation:nextGeneration};
  putMotion(next,target,{title_dcterms:{en:'Second generation title'}});
  saveRows(next,[amendment(13,{proposedText:'Second generation page wording'}),amendment(15),
    amendment(20,{proposedText:'Second generation selected wording',authors:[other]})]);
  const publisher=new DatabaseSync(store.filename);
  publisher.exec('PRAGMA busy_timeout=100');
  store.release();store.db.exec('PRAGMA query_only=ON');
  const get=store.get.bind(store);
  let published=false;
  t.mock.method(store,'get',key=>{
    const value=get(key);
    if(!published&&key==='active'&&value===generation) {
      publisher.exec('BEGIN');
      publisher.prepare("UPDATE meta SET value=? WHERE key='active'").run(JSON.stringify(nextGeneration));
      publisher.exec('COMMIT');
      published=true;
    }
    return value;
  });
  try {
    const first=selected(store,target+'-AM-20','member=101&scope=all&limit=1');
    assert.equal(published,true);
    assert.deepEqual(first.snapshots,{amendments:generation,text:generation});
    assert.equal(first.text.title,'First generation title');assert.equal(first.total,2);
    assert.deepEqual(first.totals,{allIndexed:2,memberMatched:1});
    assert.equal(first.items[0].proposedText,'First generation page wording');
    assert.equal(first.selection.item.proposedText,'First generation selected wording');
    const second=selected(store,target+'-AM-20','member=101&scope=all&limit=1');
    assert.deepEqual(second.snapshots,{amendments:nextGeneration,text:nextGeneration});
    assert.equal(second.text.title,'Second generation title');assert.equal(second.total,3);
    assert.deepEqual(second.totals,{allIndexed:3,memberMatched:2});
    assert.equal(second.items[0].proposedText,'Second generation page wording');
    assert.equal(second.selection.item.proposedText,'Second generation selected wording');
    assert.equal(store.db.isTransaction,false);
  } finally {publisher.close();}
});

test('standalone exact reads pin their snapshot, roll back their failures and preserve caller-owned transactions',t=>{
  const context=setup(t),{store,generation}=context,nextGeneration=generation+1,id=target+'-AM-13';
  saveRows(context,[amendment(13,{proposedText:'First standalone snapshot'})]);
  store.publish(generation);
  saveRows({store,generation:nextGeneration},[amendment(13,{proposedText:'Second standalone snapshot'})]);
  const publisher=new DatabaseSync(store.filename);
  publisher.exec('PRAGMA busy_timeout=100');
  store.release();store.db.exec('PRAGMA query_only=ON');
  const get=store.get.bind(store);
  let published=false;
  t.mock.method(store,'get',key=>{
    const value=get(key);
    if(!published&&key==='active'&&value===generation) {
      publisher.exec('BEGIN');
      publisher.prepare("UPDATE meta SET value=? WHERE key='active'").run(JSON.stringify(nextGeneration));
      // Pruning the previous generation proves the row remains pinned, rather
      // than merely re-reading old rows that happen to survive publication.
      publisher.prepare('DELETE FROM amendments WHERE generation=?').run(generation);
      publisher.prepare('DELETE FROM amendment_targets WHERE generation=?').run(generation);
      publisher.exec('COMMIT');
      published=true;
    }
    return value;
  });
  const read=()=>amendmentById(store,{document:target,id,language:'en'});
  const prepare=store.db.prepare.bind(store.db),failure=new Error('Isolated exact-read query failure');
  const failCheckedQuery=()=>t.mock.method(store.db,'prepare',(sql,...args)=>{
    if(sql.startsWith('SELECT id,body FROM amendments WHERE'))throw failure;
    return prepare(sql,...args);
  });
  try {
    assert.equal(read().proposedText,'First standalone snapshot');assert.equal(published,true);
    assert.equal(store.db.isTransaction,false);
    assert.equal(read().proposedText,'Second standalone snapshot');
    const ownFailure=failCheckedQuery();
    try {assert.throws(read,error=>error===failure);assert.equal(store.db.isTransaction,false);}
    finally {ownFailure.mock.restore();}
    assert.equal(read().proposedText,'Second standalone snapshot');
    store.db.exec('BEGIN');
    try {
      assert.equal(read().proposedText,'Second standalone snapshot');assert.equal(store.db.isTransaction,true);
      const nestedFailure=failCheckedQuery();
      try {assert.throws(read,error=>error===failure);assert.equal(store.db.isTransaction,true);}
      finally {nestedFailure.mock.restore();}
      assert.equal(read().proposedText,'Second standalone snapshot');assert.equal(store.db.isTransaction,true);
    } finally {store.db.exec('ROLLBACK');}
    assert.equal(store.db.isTransaction,false);
  } finally {publisher.close();}
});
