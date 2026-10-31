import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {replayRuntime,sourceReplay,publicDocumentUrl} from './amendment-benchmark-replay.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const id='A-10-2026-0001',options={reportId:id,language:'en',documentReferences:[]};
const report={id:'eli/dl/doc/'+id,work_type:'def/ep-document-types/REPORT_PLENARY',is_realized_by:[{title_alternative:{en:'COM(2026)1 – 2026/0001(NLE)'}}]};
const metadata={url:publicDocumentUrl(id),ok:true,status:200,fetchedAt:'2026-10-27T00:00:00Z',sha256:'a'.repeat(64),body:Buffer.from(JSON.stringify({data:[report]}))};
test('NLE replay requires explicit selected amendment context without inventing HTTP observations',async()=>{
 const runtime=await replayRuntime(root),calls=[],cache={sealed:new Set(),get:async url=>{calls.push(url);return metadata;},assertHealthy(){}};
 const result=await sourceReplay(cache,runtime).proposal(options);
 assert.deepEqual(result.baseline.gaps,['nle-selected-source-context-unavailable']);assert.deepEqual(result.items,[]);
 assert.equal(Object.hasOwn(result.baseline,'httpStatus'),false);assert.deepEqual(calls,[publicDocumentUrl(id)]);
});
test('a legacy runtime without the production native seam retains its own source result',async()=>{
 const current=await replayRuntime(root);let invoked=0;
 const runtime={...current,DocumentContext:undefined,createProposalBaseline:()=>async arg=>{invoked++;assert.deepEqual(arg,options);return {status:'unresolved',language:'en',items:[],gaps:['legacy-missing-report-reference']};}};
 const cache={get:async()=>{throw Error('Unexpected input');},assertHealthy(){}};
 const result=await sourceReplay(cache,runtime).proposal(options);
 assert.equal(invoked,1);assert.deepEqual(result.baseline.gaps,['legacy-missing-report-reference']);assert.deepEqual(result.items,[]);
});
test('an unrelated missing sealed report remains fatal',async()=>{
 const runtime=await replayRuntime(root),failure=Error('input-not-in-snapshot: exact report');
 const cache={sealed:new Set(),get:async()=>{throw failure;},assertHealthy(){throw failure;}};
 await assert.rejects(sourceReplay(cache,runtime).proposal(options),error=>error===failure);
});
