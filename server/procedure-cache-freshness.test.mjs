import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OfficialContextSources} from './official-context.mjs';
import {EurovocCatalog} from './eurovoc.mjs';
import {ProcedureContext} from './procedure-context.mjs';
import {apiCachePolicy} from './response-cache.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/plenary-context-live-20261015.json',import.meta.url)));
const procedure=readFileSync(new URL('./fixtures/oeil-procedure-2025-0407.html',import.meta.url),'utf8');
const summary=readFileSync(new URL('./fixtures/oeil-first-reading-1908635.html',import.meta.url),'utf8');

for(const [name,stale,ambiguous] of [['fresh topics',false,false],['stale topics',true,false],['stale ambiguous topics',true,true]])test('procedure and reference summaries preserve '+name+' from the real catalogue',async()=>{
  let now=Date.parse('2026-10-15T08:00:00Z'),failTopics=false;
  const initial=now,clock=()=>now,data=structuredClone(fixture.topics);
  if(ambiguous)data.results.bindings.push({...data.results.bindings[0],reference:{type:'literal',value:'2025/0407/CNS'}});
  const sources=new OfficialContextSources({clock,directory:null,run:operation=>operation(),fetchSource:async input=>{
    const url=new URL(input);
    if(url.hostname==='publications.europa.eu') {
      if(failTopics)throw new Error('Synthetic topic refresh unavailable');
      return Response.json(data);
    }
    assert.equal(url.hostname,'oeil.europarl.europa.eu');
    return new Response(url.pathname.endsWith('/document-summary')?summary:procedure,{headers:{'content-type':'text/html'}});
  }});
  const catalog=new EurovocCatalog(sources,{clock,directory:null});
  await catalog.load(['2025-0407'],'en');
  if(stale) {
    now+=7*3600_000;failTopics=true;
    await catalog.load(['2025-0407'],'en');
    await Promise.allSettled([...sources.cache.pending.values()]);
  }
  const result=await new ProcedureContext(sources,catalog).query({reference:'2025/0407(COD)',language:'en'});
  assert.equal(result.source.stale,false,'OEIL was fetched independently of the topic cache');
  assert.equal(result.topicError,false,'Retained topic data remains an available observation');
  assert.equal(result.topicSource.stale,stale);
  assert.equal(result.topicSource.fetchedAt,new Date(initial).toISOString());
  assert.equal(new URL(result.topicSource.url).hostname,'publications.europa.eu');
  assert.equal(result.topicState,ambiguous?'ambiguous':'mapped');
  if(ambiguous)assert.deepEqual(result.topics,[]);
  else assert(result.topics.length>0);
  for(const pathname of ['/api/reference-summary','/api/insights/procedure-context']) {
    const policy=apiCachePolicy({method:'GET',headers:{}},new URL(pathname,'https://example.test'),result,{now});
    if(stale)assert.equal(policy.cdnCacheControl,'no-store');
    else assert.match(policy.cdnCacheControl,/max-age=21600/);
  }
});
