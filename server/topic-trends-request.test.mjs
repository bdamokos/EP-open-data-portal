import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ActivityStore} from './activity-index-store.mjs';
import {projectProcedure} from './activity-index-model.mjs';
import {EurovocCatalog} from './eurovoc.mjs';
import {TopicTrends,topicTrendsQuery} from './topic-trends.mjs';
import {runWithRequestSignal,requestSignal,waitForRequest} from './request-budget.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/plenary-context-live-20261015.json',import.meta.url)));
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('topic timeline readers detach separately while one shared catalogue job preserves mapping and pagination',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'topic-reader-')),clock=()=>Date.parse('2026-10-15T08:00:00Z');
  const store=new ActivityStore(directory,{clock});
  try {
    store.acquire();const {generation}=store.beginCycle();
    store.putSource(generation,'/procedures/2025-0407','procedure',projectProcedure(fixture.procedure.payload.data[0]),fixture.procedure.fetchedAt,[]);
    store.db.exec('PRAGMA query_only=ON');
    let finish,sourceSignal,loads=0;
    const catalog=new EurovocCatalog({get:url=>{
      sourceSignal=requestSignal();
      return waitForRequest(new Promise(resolve=>finish=()=>resolve({url,fetchedAt:new Date(clock()).toISOString(),data:fixture.topics})));
    }},{directory:null,clock});
    const original=catalog.load.bind(catalog);catalog.load=(...args)=>{loads++;return original(...args);};
    const service=new TopicTrends(store,catalog,{clock}),query=topicTrendsQuery(new URLSearchParams('days=term'),{now:clock()});
    const a=new AbortController(),b=new AbortController(),reason=new Error('first timeline reader closed');
    const first=runWithRequestSignal(a.signal,()=>assert.rejects(service.query(query),e=>e===reason));
    await turn();const second=runWithRequestSignal(b.signal,()=>service.query(query));await turn();
    a.abort(reason);await first;assert.equal(sourceSignal.aborted,false);assert.equal(loads,1);
    finish();const result=await second;
    assert.equal(result.coverage.sourceError,false);assert.equal(result.coverage.mapped,1);
    assert.equal(result.topics.length,11);assert.equal(result.nextPage,null);assert.equal(result.savedSources.length,1);
    assert.equal(b.signal.aborted,false);assert.equal(await service.query(query),result);assert.equal(loads,1);
  } finally {
    store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});
  }
});
