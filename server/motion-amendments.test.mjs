import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {AMENDMENT_LINKS_VERSION} from './activity-index-model.mjs';
import {AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {AMENDMENTS_VERSION,AMENDMENT_SITTING_PROJECTION_VERSION,AMENDMENT_DISTRIBUTION_PROOF_VERSION,distributionEvidenceFor} from './amendments.mjs';
import {enqueueAmendment,saveAmendmentRows} from './amendments-store.mjs';
import {parseSavedSplits,rebuildAmendmentTarget} from './amendments-worker.mjs';
import {motionSourceKey} from './motion-outcomes.mjs';
import {motionAmendmentsPage,motionAmendmentsQuery} from './motion-amendments.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/motion-amendments-public.json',import.meta.url),'utf8'));
const motionFixture=JSON.parse(readFileSync(new URL('./fixtures/motion-outcomes-live-20261015.json',import.meta.url),'utf8'));
const target='B-10-2026-0424',joint='RC-10-2026-0441',original='B-10-2026-0441';
const date='2026-10-02',at='2026-10-17T19:00:00.000Z',imart='256918',loiseau='197494',nacho='197722';
const clone=value=>structuredClone(value);
const query=(document=target,params='')=>motionAmendmentsQuery(document,new URLSearchParams(params));
const page=(store,params='',document=target)=>motionAmendmentsPage(store,query(document,params));

function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'motion-amendments-contract-'));
  const store=new ActivityStore(directory,{clock:()=>Date.parse(at)});
  assert(store.acquire());
  const {generation}=store.beginCycle();
  const worker=new ActivityWorker(store,{clock:()=>Date.parse(at),fetchRecord:async()=>{throw new Error('Motion amendment contract tests must not retrieve upstream data.');}});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,worker,generation};
}
function seedPublic(t) {
  const context=setup(t),{store,worker,generation}=context;
  for(const record of fixture.works)store.putSource(generation,'/plenary-documents/'+record.work.identifier,'document',{...clone(record.work),amendmentLinksVersion:AMENDMENT_LINKS_VERSION},record.source.fetchedAt);
  const existing=motionFixture.documents.find(record=>record.work.identifier===original);
  assert(existing,'The frozen motion outcome fixture must identify the original B motion.');
  store.putSource(generation,'/plenary-documents/'+original,'document',clone(existing.work),existing.retrievedAt);
  for(const record of fixture.lists) {
    const work=clone(record.work),source=record.wordingSource;
    work.targetDocumentId=Array.isArray(work.foresees_change_of)?work.foresees_change_of[0].split('/').at(-1):work.foresees_change_of.split('/').at(-1);
    work.amendmentDistributionDeclared=true;
    work.distributionEvidence=distributionEvidenceFor(work,record.source);
    work.extraction={...clone(record.extraction),language:'en',sourceUrl:source.url,fetchedAt:source.fetchedAt,sourceDescriptor:{url:source.url,language:'en',byteSize:Number(work.is_realized_by[0].is_embodied_by.find(file=>file.format.endsWith('/DOCX')).byteSize)},parserVersion:AMENDMENT_EXTRACTION_VERSION};
    if(!record.projectionComplete)work.extraction.gaps.push({code:'fixture-projection',message:'This isolated fixture contains only amendments 31 and 32 from the observed list.'});
    store.putSource(generation,'amendment:list:'+work.identifier,'amendment-list',work,record.source.fetchedAt);
  }
  store.putSource(generation,'amendment:roster:'+date,'amendment-roster',{members:fixture.roster.members.map(member=>({...member,id:member.identifier})),sources:[fixture.roster.source]},fixture.roster.source.fetchedAt);
  const sitting=fixture.sitting;
  const work=parseSavedSplits(worker,{...clone(sitting),amendmentVersion:AMENDMENTS_VERSION,amendmentProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION,results:[],coverage:{missingResultIds:[],missingDecisionIds:[]},truncated:true});
  store.putSource(generation,motionSourceKey(sitting.id),'motion-outcomes',work,at);
  for(const id of [target,joint])rebuildAmendmentTarget(worker,generation,id);
  return context;
}
const source={url:'https://data.europarl.europa.eu/distribution/example/isolated-amendment_en.docx',fetchedAt:at,language:'en'};
const metadata=(id=target)=>({id,date,listProjectionVersion:AMENDMENT_LINKS_VERSION,titles:{en:'Isolated motion'},procedureIds:[]});
const coverage={complete:true,gaps:[],lastUpdated:at};
function row(number,extra={}) {
  return {id:target+'-AM-'+number,targetDocumentId:target,number,date,documentDate:date,proposerDate:date,proposerDateBasis:'individual-amendment-document',listId:target+'-AM-001-001',language:'en',originalText:'Original wording',proposedText:'Proposed wording',textIntegrity:'complete',textParserVersion:AMENDMENT_EXTRACTION_VERSION,sourceFreshness:{version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,status:'fresh',distributionState:'available',descriptor:{url:source.url,language:'en',byteSize:null},sourceDescriptor:{url:source.url,language:'en',byteSize:null}},wordingSource:source,metadataSource:source,proposerSource:source,authors:[{name:'Isolated Member',personId:'101',status:'resolved',method:'exact_full_name_active_mandate',evidence:[{type:'full_name',date,activeMandate:{start:date,end:date}}]}],decisions:[],splitParts:[],sources:[source],gaps:[],...extra};
}
function isolatedMotion(extra={}) {
  return {id:'eli/dl/doc/'+target,identifier:target,work_type:'def/ep-document-types/RESOLUTION_MOTION',document_date:date,title_dcterms:{en:'Isolated motion'},amendmentLinksVersion:AMENDMENT_LINKS_VERSION,inverse_foresees_change_of:[],...extra};
}
function rebuildIsolatedMotion({store,worker,generation},work=isolatedMotion(),fetchedAt=at) {
  store.putSource(generation,'/plenary-documents/'+target,'document',work,fetchedAt);
  rebuildAmendmentTarget(worker,generation,target);
}

test('motion amendment queries accept only bounded exact motion/member scopes',()=>{
  assert.deepEqual(query(),{document:target,member:null,scope:'all',amendment:null,language:'en',limit:20,offset:0});
  assert.deepEqual(query(joint,'member=197722&scope=member&lang=fr&limit=50&offset=1000000'),{document:joint,member:nacho,scope:'member',amendment:null,language:'fr',limit:50,offset:1000000});
  for(const id of ['A-10-2026-0424','B-9-2026-0424','B10-0424/2026','B-10-2026-0424-AM-13','https://data.europarl.europa.eu/eli/dl/doc/'+target,'../'+target])assert.throws(()=>query(id),error=>error.status===400);
  for(const params of ['scope=member','scope=other','member=0','member=-1','member=01','member=9007199254740992','member=person%2F101','limit=0','limit=51','offset=-1','offset=1000001','limit=1e1','member=101&member=102','lang=en&lang=fr','document='+joint,'unknown=yes'])assert.throws(()=>query(target,params),error=>error.status===400,params);
});

test('public B motion preserves list gaps, exact member matching and other proposers in all results',t=>{
  const {store}=seedPublic(t),all=page(store,'member='+imart),own=page(store,'member='+imart+'&scope=member');
  assert.equal(all.schemaVersion,2);assert.equal(all.text.id,target);assert.equal(all.text.kind,'original');
  assert.equal(all.text.memberAuthorship.status,'recorded');assert(all.text.memberAuthorship.relationships.some(value=>value.includes('AUTHOR')));
  assert.equal(all.scope.results,'all');assert.equal(own.scope.results,'member');
  assert.equal(all.total,6);assert.deepEqual(all.totals,{allIndexed:6,memberMatched:4});assert.equal(own.total,4);
  assert.deepEqual(all.items.map(item=>item.number),[13,15,18,20,31,32]);assert.deepEqual(own.items.map(item=>item.number),[13,15,18,20]);
  assert.deepEqual(all.items.filter(item=>item.memberMatch.matched).map(item=>item.id),own.items.map(item=>item.id));
  for(const item of own.items) {
    assert.equal(item.memberMatch.basis,'aggregate');assert.equal(item.memberMatch.status,'recorded');
    assert.equal(item.authors[0].personId,imart);assert.equal(item.proposerDate,date);assert.equal(item.onBehalfOf,'on behalf of the PPE Group');
    assert.equal(item.wording.language,'en');assert.equal(item.wording.proposedStatus,'available');
    assert.equal(item.wholeAmendmentOutcome,'ADOPTED');assert(item.decisions.every(vote=>vote.scope==='whole-amendment'));
    assert(item.sources.some(value=>value.url.endsWith('B-10-2026-0424-AM-013-020_en.docx')&&value.fetchedAt));
  }
  const other=all.items.filter(item=>!item.memberMatch.matched);
  assert(other.every(item=>item.authors[0].personId===loiseau&&item.memberMatch.status==='not-recorded'));
  assert.deepEqual(page(store,'member='+loiseau+'&scope=member').items.map(item=>item.number),[31,32]);
  const insertion=own.items.find(item=>item.number===15);
  assert.equal(insertion.originalText,'');assert.equal(insertion.wording.originalStatus,'available');
  assert.equal(all.coverage.observationComplete,false);assert.equal(all.coverage.resultState,'records');
  assert(all.coverage.gaps.some(value=>value.includes('14, 16, 17, 19')));
  const second=page(store,'member='+imart+'&limit=2&offset=2');
  assert.deepEqual(second.items.map(item=>item.number),[18,20]);assert.equal(second.total,6);assert.deepEqual(second.totals,all.totals);
});

test('joint motion authorship stays independent of amendment proposers, language and split outcomes',t=>{
  const {store}=seedPublic(t),all=page(store,'member='+nacho,joint),own=page(store,'member='+nacho+'&scope=member',joint);
  assert.equal(all.text.kind,'joint');assert.equal(all.text.memberAuthorship.status,'recorded');
  assert(!all.text.availableLanguages.includes('en'));assert.equal(all.text.languageFallback,true);assert.equal(all.text.titleLanguage,'en');
  assert.equal(all.total,2);assert.equal(own.total,0);assert.equal(own.coverage.resultState,'no-indexed-member-matches');
  assert.deepEqual(all.totals,{allIndexed:2,memberMatched:0});
  assert.deepEqual(all.items.map(item=>item.authors.map(author=>author.name)),[['Manon Aubry','Marina Mesure'],['Danilo Della Valle']]);
  assert(all.items.every(item=>!item.memberMatch.matched&&item.wording.language==='en'&&item.wording.languageFallback===false));
  const amendment=all.items.find(item=>item.number===1);
  assert.equal(amendment.wholeAmendmentOutcome,'unavailable');
  assert.deepEqual(amendment.decisions.map(vote=>[vote.id,vote.outcome,vote.scope]),[['MTG-PL-2026-10-08-DEC-198211','REJECTED','split-part'],['MTG-PL-2026-10-08-DEC-198212','LAPSED','split-part']]);
  assert.deepEqual(amendment.decisions.map(vote=>vote.partId),[1,2].map(number=>'eli/dl/doc/MTG-PL-2026-10-08-VOT-ITM-993193-SPLIT-3-'+number));
  assert.equal(amendment.splitParts.length,2);assert(amendment.splitParts.every(part=>part.wordingGrounding==='not-validated'));
  const linked=all.relations.originalMotions.find(text=>text.id===original);
  assert(linked);assert.equal(linked.memberAuthorship.status,'recorded');assert.equal(linked.relationship.type,'is_derivative_of');
  const originalPage=page(store,'member='+nacho,original);
  assert(originalPage.relations.jointMotions.some(text=>text.id===joint&&text.memberAuthorship.status==='recorded'));
  assert.equal(originalPage.total,0);assert.equal(originalPage.coverage.resultState,'not-indexed');
});

test('an exact original-to-joint relationship never transfers the original member author to the joint text',t=>{
  const {store,generation}=seedPublic(t),saved=store.source(generation,'/plenary-documents/'+joint),work=clone(saved.work);
  work.workHadParticipation=work.workHadParticipation.filter(participation=>!participation.had_participant_person?.includes('person/'+nacho));
  store.putSource(generation,'/plenary-documents/'+joint,'document',work,at);
  const result=page(store,'member='+nacho,original),related=result.relations.jointMotions.find(text=>text.id===joint);
  assert.equal(result.text.memberAuthorship.status,'recorded');assert(related);
  assert.equal(related.memberAuthorship.status,'not-recorded');assert.deepEqual(related.memberAuthorship.relationships,[]);
  assert.equal(page(store,'member='+nacho,joint).text.memberAuthorship.status,'not-recorded');
});

test('all-scope highlights and member filtering share variant/date protections without inheriting aggregate authorship',t=>{
  const {store,generation}=setup(t);
  const a=row(1),b=row(1,{listId:target+'-AM-001-002',authors:[{name:'Other Member',personId:'102',status:'resolved'}],proposedText:'Different revised wording'});
  saveAmendmentRows(store,generation,metadata(),[row(1,{conflicted:true,authors:[{name:'Untrusted aggregate',personId:'103',status:'resolved'}],variants:[a,b]}),row(2,{documentDate:null,proposerDate:null,listDocumentDate:null,authors:[{name:'Undated',personId:'101',status:'resolved'}]})],coverage);
  const all=page(store,'member=101'),filtered=page(store,'member=101&scope=member'),conflict=all.items.find(item=>item.number===1);
  assert.equal(all.total,2);assert.equal(filtered.total,1);assert.equal(filtered.items[0].id,conflict.id);
  assert.deepEqual(conflict.memberMatch,filtered.items[0].memberMatch);assert.equal(conflict.memberMatch.basis,'variant');
  assert.deepEqual(conflict.memberMatch.variantListIds,[a.listId]);assert.equal(conflict.memberMatch.aggregateMatched,false);
  assert.equal(conflict.originalText,null);assert.equal(conflict.proposedText,null);assert.equal(conflict.wording.proposedStatus,'withheld');assert.deepEqual(conflict.authors,[]);
  assert.deepEqual(conflict.variants.map(variant=>variant.memberMatch.matched),[true,false]);
  assert.equal(all.items.find(item=>item.number===2).memberMatch.status,'unavailable');
  assert.equal(page(store,'member=103&scope=member').total,0);
  assert.equal(page(store,'member=102&scope=member').items[0].memberMatch.basis,'variant');
});

test('not indexed, complete observed emptiness and unrelated global jobs remain distinct',t=>{
  const context=setup(t),{store,generation}=context;
  const missing=page(store);
  assert.equal(missing.text.status,'unavailable');assert.equal(missing.coverage.indexStatus,'not-indexed');assert.equal(missing.coverage.resultState,'not-indexed');assert.equal(missing.coverage.observationComplete,false);assert.equal(missing.coverage.targetProcessing,'unknown');
  rebuildIsolatedMotion(context);
  const empty=page(store);
  assert.equal(empty.total,0);assert.equal(empty.coverage.indexStatus,'indexed');assert.equal(empty.coverage.resultState,'observed-empty');assert.equal(empty.coverage.observationComplete,true);
  assert.equal(empty.text.status,'indexed');assert.equal(empty.coverage.complete,false);
  assert.equal(empty.coverage.observationScope,'published-amendment-list-relationships');
  assert.deepEqual(empty.coverage.emptyObservation,{version:1,documentId:target,relationship:'inverse_foresees_change_of',scope:'published-amendment-list-relationships',listCount:0,source:{url:'https://data.europarl.europa.eu/api/v2/plenary-documents/'+target+'?format=application%2Fld%2Bjson',fetchedAt:at,language:null}});
  enqueueAmendment(store,generation,'unrelated','amendment-extract',{targetDocumentId:joint});
  const pending=page(store);
  assert.equal(pending.coverage.backgroundPending,true);assert.equal(pending.coverage.backgroundPendingScope,'index');assert.equal(pending.coverage.targetProcessing,'unknown');
  assert.equal(pending.coverage.observationComplete,true);assert.equal(pending.coverage.resultState,'observed-empty');assert.equal(pending.coverage.complete,false);
  const neverObserved=page(store,'',joint);
  assert.equal(neverObserved.coverage.resultState,'not-indexed');assert.equal(neverObserved.coverage.backgroundPending,true);assert.equal(neverObserved.coverage.targetProcessing,'unknown');
});

test('the production rebuild cannot certify missing, legacy or malformed amendment-list observations as empty',async t=>{
  const missing=isolatedMotion();delete missing.inverse_foresees_change_of;
  const legacy=isolatedMotion();delete legacy.amendmentLinksVersion;
  for(const [name,work] of [
    ['missing relationship',missing],
    ['null relationship',isolatedMotion({inverse_foresees_change_of:null})],
    ['legacy projection',legacy],
    ['stale projection',isolatedMotion({amendmentLinksVersion:AMENDMENT_LINKS_VERSION-1})],
    ['empty scalar',isolatedMotion({inverse_foresees_change_of:''})],
    ['object relationship',isolatedMotion({inverse_foresees_change_of:{}})],
    ['malformed array entry',isolatedMotion({inverse_foresees_change_of:[null]})],
  ])await t.test(name,t=>{
    const context=setup(t);rebuildIsolatedMotion(context,work);
    const result=page(context.store);
    assert.equal(result.total,0);assert.equal(result.coverage.observationComplete,false);
    assert.equal(result.coverage.resultState,'unavailable');assert.equal(result.coverage.complete,false);
    assert.equal(result.coverage.observationScope,'indexed-plenary-amendment-sources');assert.equal(result.coverage.emptyObservation??null,null);
  });
});

test('retained amendment rows prevent an explicit empty list observation from becoming an empty amendment result',t=>{
  const context=setup(t),{store,generation}=context;
  saveAmendmentRows(store,generation,metadata(),[row(1)],coverage);
  rebuildIsolatedMotion(context);
  const result=page(store);
  assert.equal(result.total,1);assert.equal(result.items[0].id,target+'-AM-1');
  assert.equal(result.coverage.resultState,'records');assert.equal(result.coverage.observationComplete,false);
  assert.equal(result.coverage.observationScope,'indexed-plenary-amendment-sources');assert.equal(result.coverage.emptyObservation??null,null);
  assert(result.items[0].gaps.includes('Source was absent from the latest partial refresh.'));
});

test('a refreshed unknown relationship revokes a previously verified empty list observation',t=>{
  const context=setup(t);rebuildIsolatedMotion(context);
  assert.equal(page(context.store).coverage.resultState,'observed-empty');
  const unknown=isolatedMotion();delete unknown.inverse_foresees_change_of;
  rebuildIsolatedMotion(context,unknown,'2026-10-17T19:01:00.000Z');
  const result=page(context.store);
  assert.equal(result.total,0);assert.equal(result.coverage.observationComplete,false);assert.equal(result.coverage.resultState,'unavailable');
  assert.equal(result.coverage.observationScope,'indexed-plenary-amendment-sources');assert.equal(result.coverage.emptyObservation??null,null);
});

test('retained and stale partial evidence remains labelled, and index-only reads do not mutate it',t=>{
  const {store,generation}=setup(t);
  saveAmendmentRows(store,generation,metadata(),[row(1),row(2)],coverage);
  saveAmendmentRows(store,generation,metadata(),[row(1,{originalText:null,proposedText:null,authors:[],sourceFreshness:{version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,status:'failed',distributionState:'available',error:'isolated fetch failure',failedAt:at}})],{complete:false,lastUpdated:at,gaps:['The latest isolated source projection is partial.']});
  const before=store.db.prepare('SELECT * FROM amendments ORDER BY id').all(),jobs=store.db.prepare('SELECT * FROM amendment_jobs').all(),sources=store.db.prepare('SELECT * FROM sources').all();
  const result=page(store,'member=101');
  assert.equal(result.total,2);assert.equal(result.coverage.observationComplete,false);assert.equal(result.coverage.resultState,'records');
  const kept=result.items.find(item=>item.number===1);
  assert.equal(kept.proposedText,'Proposed wording');assert.equal(kept.wordingRetained,true);assert.equal(kept.sourceFreshness.status,'failed');assert.equal(kept.proposerRetained,true);assert.equal(kept.memberMatch.matched,true);
  assert(result.items.find(item=>item.number===2).gaps.includes('Source was absent from the latest partial refresh.'));
  assert(result.coverage.gaps.some(gap=>gap.includes('retained')));
  page(store,'member=101&scope=member&limit=1&offset=1');
  assert.deepEqual(store.db.prepare('SELECT * FROM amendments ORDER BY id').all(),before);assert.deepEqual(store.db.prepare('SELECT * FROM amendment_jobs').all(),jobs);assert.deepEqual(store.db.prepare('SELECT * FROM sources').all(),sources);
});

test('stale wording parser evidence is withheld on every page without hiding a valid dated proposer',t=>{
  const {store,generation}=setup(t);
  saveAmendmentRows(store,generation,metadata(),[row(1),row(2,{textParserVersion:AMENDMENT_EXTRACTION_VERSION+'-obsolete'})],coverage);
  const result=page(store,'member=101&limit=1'),later=page(store,'member=101&limit=1&offset=1');
  assert.equal(result.total,2);assert.equal(result.coverage.observationComplete,false);
  assert.equal(result.items[0].wording.proposedStatus,'available');
  assert.equal(later.items[0].proposedText,null);assert.equal(later.items[0].originalText,null);
  assert.equal(later.items[0].wording.proposedStatus,'withheld');assert.equal(later.items[0].memberMatch.status,'recorded');
  assert(result.coverage.gaps.some(gap=>gap.includes('current document parser')));
  assert.deepEqual(result.coverage,later.coverage);
});

test('motion display titles skip blanks and retain unknown language keys',t=>{
  const {store,generation}=setup(t);
  for(const [titles,expected,titleLanguage] of [
    [{bg:'Bulgarian title',fr:'   '},'Bulgarian title','bg'],
    [{it:'Italian title','':'Unknown-language title'},'Unknown-language title',null],
    [{bg:'Bulgarian title',fr:'French title'},'French title','fr'],
  ]) {
    store.putSource(generation,'/plenary-documents/'+target,'document',{id:'eli/dl/doc/'+target,identifier:target,work_type:'def/ep-document-types/RESOLUTION_MOTION',title_dcterms:titles},at);
    const result=page(store,'lang=ga');
    assert.equal(result.text.title,expected);assert.equal(result.text.titleLanguage,titleLanguage);
  }
});
