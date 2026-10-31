import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {documentRows,projectDocument} from './activity-index-model.mjs';
const fetchedAt='2026-10-30T12:00:00Z';
const motion=(id='B-10-2026-0213',rules=['136'])=>({id:'eli/dl/doc/'+id,identifier:id,label:id,document_date:'2026-04-27',parliamentary_term:'org/ep-10',work_type:'def/ep-document-types/RESOLUTION_MOTION',creator:['person/197433','org/S-D'],title_dcterms:{en:'Motion'},based_on:rules.map(rule=>'eli/dl/doc/RULES-10-2025-07-07-ITM-A'+rule)});
test('term-10 institutional bases classify original and joint motions without author-count inference',()=>{
  for(const type of ['RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT'])for(const rules of [['114'],['136'],['150'],['150','136']]){
    const work={...motion(undefined,rules),work_type:'def/ep-document-types/'+type};
    const [row]=documentRows(projectDocument(work),'/plenary-documents/'+work.identifier,fetchedAt).rows;
    assert.equal(row.category,'motions');assert.equal(row.motionType,'institutional');
    assert.deepEqual(row.rulesBasis,work.based_on);assert.equal(row.provenance.sourceFetchedAt,fetchedAt);
  }
  for(const rules of [[],['999'],['144'],['149','136'],['149','114']])assert.equal(documentRows(motion(undefined,rules),'/test',fetchedAt).rows[0].category,'unclassified-motions');
  assert.equal(documentRows(motion(undefined,['149']),'/test',fetchedAt).rows[0].category,'individual-motions');
  const otherTerm=motion();otherTerm.based_on=['eli/dl/doc/RULES-9-2023-01-01-ITM-A136'];
  assert.equal(documentRows(otherTerm,'/test',fetchedAt).rows[0].category,'unclassified-motions');
});
test('retained motion reclassification is bounded, resumable, writer-fenced and published atomically',()=>{
  const directory=mkdtempSync(join(tmpdir(),'motion-classification-'));let store=new ActivityStore(directory,{clock:()=>Date.parse(fetchedAt)});
  try{
    store.acquire();const first=store.beginCycle();store.setMembers([{id:'197433',name:'Member'}]);
    for(let i=0;i<103;i++){
      const work=motion('B-10-2026-'+String(i).padStart(4,'0')),key='/plenary-documents/'+work.identifier;
      const rows=documentRows(work,key,fetchedAt).rows.map(row=>({...row,category:'unclassified-motions',categoryLabel:'Motion - category not established',motionType:'unspecified'}));
      store.putSource(first.generation,key,'document',work,fetchedAt,rows);
    }
    store.publish(first.generation);store.set('lastSuccess',fetchedAt);
    assert.equal(new ActivityWorker(store,{clock:()=>Date.parse(fetchedAt)}).coreDue(),true,'upgrade is due even after today\'s publication');
    assert.throws(()=>store.reclassifyMotions(first.generation),/working generation/);
    const cycle=store.beginCycle();store.updateCycle({initialized:true,customCursor:42});
    assert.equal(store.reclassifyMotions(cycle.generation),true);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM items WHERE generation=? AND category='motions'").get(cycle.generation).n,100);
    assert.equal(store.page('197433',{category:'motions'}).items.length,0,'active reader remains on old snapshot');
    store.close();store=new ActivityStore(directory,{clock:()=>Date.parse(fetchedAt)});store.acquire();
    assert.equal(store.get('working').customCursor,42);
    assert.equal(store.reclassifyMotions(cycle.generation),false);
    const source=store.source(cycle.generation,'/plenary-documents/B-10-2026-0000');assert.equal(source.fetchedAt,fetchedAt);assert.deepEqual(source.work.based_on,motion().based_on);
    store.publish(cycle.generation);
    const page=store.page('197433',{category:'motions'});assert.equal(page.indexedTotal,103);assert.equal(page.unclassifiedMotionCount,0);assert.equal(page.categoryCoverage.motions.indexedCount,103);
    assert.equal(new ActivityWorker(store,{clock:()=>Date.parse(fetchedAt)}).coreDue(),false);
    store.release();assert.throws(()=>store.reclassifyMotions(cycle.generation),/lease/);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
