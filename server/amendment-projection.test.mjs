import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AMENDMENT_LINKS_VERSION,projectDocument} from './activity-index-model.mjs';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {amendmentsPage} from './amendments-store.mjs';
import {prepareAmendments,rebuildAmendmentTarget,amendmentTask} from './amendments-worker.mjs';
import {AMENDMENTS_VERSION} from './amendments.mjs';
import {AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {SPLIT_PARSER_VERSION} from './amendment-splits.mjs';

const targetId='A-10-2026-0254',listId=targetId+'-AM-001-001';
const endpoint='/plenary-documents/'+targetId,at='2026-10-16T18:00:00.000Z';
const target={id:'eli/dl/doc/'+targetId,identifier:targetId,type:'Work',work_type:'def/ep-document-types/REPORT_PLENARY',parliamentary_term:'org/ep-10',document_date:'2026-10-01',title_dcterms:{en:'Projection fixture'}};
const linked={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:[target.id]};
function context(t,raw) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-projection-'));
  const store=new ActivityStore(directory,{clock:()=>Date.parse(at)});
  assert(store.acquire());const cycle=store.beginCycle();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const worker=new ActivityWorker(store,{clock:()=>Date.parse(at),fetchRecord:async url=>{
    assert.equal(url,endpoint);return {payload:{data:[raw]},fetchedAt:at};
  }});
  store.putSource(cycle.generation,'amendment:list:'+listId,'amendment-list',{...linked,targetDocumentId:targetId,document_date:target.document_date,extraction:{parserVersion:AMENDMENT_EXTRACTION_VERSION,language:'en',fetchedAt:at,sourceUrl:'https://data.europarl.europa.eu/distribution/example/list_en.docx',gaps:[],amendments:[{number:1,date:target.document_date,authors:[],targetLabel:'Article 1',originalText:'Original',proposedText:'Proposal',language:'en',gaps:[]}]}},at);
  return {store,worker,generation:cycle.generation};
}

test('document projection preserves missing, unavailable, empty and exact list relationship evidence',()=>{
  assert.equal(AMENDMENT_LINKS_VERSION,2);
  for(const type of ['REPORT_PLENARY','RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT']) {
    const raw={...target,work_type:'def/ep-document-types/'+type};
    for(const value of [undefined,null]) {
      const projected=projectDocument({...raw,inverse_foresees_change_of:value});
      assert.equal(Object.hasOwn(projected,'inverse_foresees_change_of'),false);
      assert.equal(projected.amendmentLinksVersion,AMENDMENT_LINKS_VERSION);
    }
    assert.deepEqual(projectDocument({...raw,inverse_foresees_change_of:[]}).inverse_foresees_change_of,[]);
    const references=projectDocument({...raw,inverse_foresees_change_of:[linked,'https://data.europarl.europa.eu/'+linked.id]}).inverse_foresees_change_of;
    assert.equal(references[0].id,linked.id);assert.deepEqual(references[0].foresees_change_of,[target.id]);
    assert.equal(references[1],'https://data.europarl.europa.eu/'+linked.id);
  }
});

test('amendment distribution declaration survives reprojection without turning synthesized empty arrays into published observations',()=>{
  const published=[{language:'http://publications.europa.eu/resource/authority/language/ENG',title:{en:'Amendments'},is_embodied_by:[{format:'authority/DOCX',byteSize:1234,is_exemplified_by:'https://data.europarl.europa.eu/distribution/example/list_en.docx'}]}];
  const states=[
    {name:'missing',fields:{},declared:false,files:[]},
    {name:'undefined',fields:{is_realized_by:undefined},declared:false,files:[]},
    {name:'unavailable',fields:{is_realized_by:null},declared:false,files:[]},
    {name:'observed empty',fields:{is_realized_by:[]},declared:true,files:[]},
    {name:'published',fields:{is_realized_by:published},declared:true,files:published},
  ];
  for(const {name,fields,declared,files} of states) {
    const projected=projectDocument({...linked,...fields});
    assert.equal(projected.amendmentDistributionDeclared,declared,name);
    assert.deepEqual(projected.is_realized_by,files,name);
    const reprojected=projectDocument(projected);
    assert.equal(reprojected.amendmentDistributionDeclared,declared,name+' reprojected');
    assert.deepEqual(reprojected.is_realized_by,files,name+' reprojected');
    for(const type of ['REPORT_PLENARY','RESOLUTION_MOTION']) {
      const ordinary=projectDocument({...target,work_type:'def/ep-document-types/'+type,...fields});
      assert.equal(Object.hasOwn(ordinary,'amendmentDistributionDeclared'),false,type+' '+name);
      assert.deepEqual(ordinary.is_realized_by,files,type+' '+name);
      const ordinaryAgain=projectDocument(ordinary);
      assert.equal(Object.hasOwn(ordinaryAgain,'amendmentDistributionDeclared'),false,type+' '+name+' reprojected');
      assert.deepEqual(ordinaryAgain.is_realized_by,files,type+' '+name+' reprojected');
    }
  }
});

test('document worker ingestion keeps unknown list relationships distinct from observed empty and URI-only links',async t=>{
  for(const state of ['missing','unavailable','empty','uri']) {
    const raw={...target};
    if(state==='unavailable')raw.inverse_foresees_change_of=null;
    if(state==='empty')raw.inverse_foresees_change_of=[];
    if(state==='uri')raw.inverse_foresees_change_of=[linked.id];
    const {store,worker,generation}=context(t,raw);
    store.enqueue(generation,endpoint,'document',{endpoint},120);
    await worker.task(store.nextTask(generation));
    const projected=store.source(generation,endpoint).work;
    const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
    assert.equal(item.proposedText,'Proposal',state);
    if(['missing','unavailable'].includes(state)) {
      assert.equal(Object.hasOwn(projected,'inverse_foresees_change_of'),false,state);
      assert.equal(item.listRelationship,'unverified',state);
      assert(item.gaps.some(gap=>gap.includes('unverified')),state);
      assert(!item.gaps.some(gap=>gap.includes('absent from the current')),state);
      assert.equal(page.coverage.complete,false,state);
    } else if(state==='empty') {
      assert.deepEqual(projected.inverse_foresees_change_of,[]);
      assert.equal(item.listRelationship,'absent-current-relationship');
    } else {
      assert.deepEqual(projected.inverse_foresees_change_of,[linked.id]);
      assert.equal(item.listRelationship,'unverified');
      assert.equal(page.coverage.complete,false);assert.equal(page.coverage.pending,true);
      assert(page.coverage.gaps.some(gap=>gap.includes(listId)&&gap.includes('verification')));
      const job=store.db.prepare("SELECT * FROM amendment_jobs WHERE generation=? AND kind='amendment-list-detail'").get(generation);
      assert.equal(JSON.parse(job.body).listId,listId);
      worker.fetchRecord=async path=>{assert.equal(path,'/documents/'+listId);return {payload:{data:[linked]},fetchedAt:at};};
      await amendmentTask(worker,{...job,body:JSON.parse(job.body),amendmentJob:true});
      const verified=amendmentsPage(store,{document:targetId});
      assert.equal(verified.items[0].listRelationship,'current');
      assert(!verified.coverage.gaps.some(gap=>gap.includes(listId)&&gap.includes('verification')));
    }
  }
});

test('legacy synthesized empty relationships stay unverified and queue a bounded projection upgrade immediately',async t=>{
  const {store,worker,generation}=context(t,target);
  store.putSource(generation,endpoint,'document',{...projectDocument(target),amendmentLinksVersion:1,inverse_foresees_change_of:[]},at);
  rebuildAmendmentTarget(worker,generation,targetId);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].listRelationship,'unverified');
  store.updateCycle({amendmentsPreparedVersion:AMENDMENTS_VERSION,amendmentsPreparedDay:'2026-10-16',splitParserVersion:SPLIT_PARSER_VERSION,amendmentDocumentParserVersion:AMENDMENT_EXTRACTION_VERSION,amendmentDocumentLinksVersion:1});
  await prepareAmendments(worker,store.get('working'));
  const job=store.db.prepare('SELECT kind,body FROM tasks WHERE generation=? AND key=?').get(generation,endpoint);
  assert.equal(job.kind,'document');assert.deepEqual(JSON.parse(job.body),{endpoint});
  assert.equal(store.get('working').amendmentDocumentLinksVersion,AMENDMENT_LINKS_VERSION);
});
