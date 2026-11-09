import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {HttpError} from './http-utils.mjs';
import {DossierActivity} from './dossier-activity.mjs';
import {DossierStatus} from './dossier-status.mjs';
import {OfficialContextSources} from './official-context.mjs';
import {ProcedureContext} from './procedure-context.mjs';

// The client retries 502 for minutes. A reference neither Parliament source
// holds must answer 404 at once, so the dossier page settles on a gap.
const odpMissing=endpoint=>Object.assign(new HttpError(502,'odp_unavailable','Parliament data is unavailable (404). Please try again.'),{upstreamStatus:404,source:{url:'https://data.europarl.europa.eu/api/v2'+endpoint,httpStatus:404}});
const store={status:()=>({servingGeneration:1}),source:()=>null};

test('a procedure Parliament answers 404 for is a missing record on dossier activity and status',async()=>{
  const calls=[],reader={record:async endpoint=>{calls.push(endpoint);throw odpMissing(endpoint);}};
  const activity=new DossierActivity(store,{reader});
  await assert.rejects(activity.procedure('2026-0030','en','2026/0030(COD)'),error=>error.status===404&&error.code==='procedure_not_found'&&error.upstreamStatus===404);
  const status=new DossierStatus({activity,calendar:{catalogue:async()=>({nodes:[]})},votes:{snapshot:async()=>{throw Error('not read');}}});
  await assert.rejects(status.query({reference:'2026/0030(COD)',language:'en'}),error=>error.status===404&&error.code==='procedure_not_found');
  assert.deepEqual(calls,['/procedures/2026-0030','/procedures/2026-0030']);
  const references=await activity.references({ids:['2026-0030'],language:'en'});
  assert.deepEqual(references.items,[]);assert.equal(references.coverage.gaps[0].code,'procedure_not_found');
});
test('other Parliament failures keep their status',async()=>{
  for(const failure of [Object.assign(new HttpError(502,'odp_unavailable','Parliament data is unavailable (500). Please try again.'),{upstreamStatus:500}),new HttpError(503,'odp_rate_limited','Busy.')]) {
    const activity=new DossierActivity(store,{reader:{record:async()=>{throw failure;}}});
    await assert.rejects(activity.procedure('2025-0207','en'),error=>error===failure);
  }
});
test('an official page that does not exist answers 404 without a retry pause',async()=>{
  for(const status of [404,410]) {
    let calls=0;
    const sources=new OfficialContextSources({directory:null,fetchSource:async()=>{calls++;return new Response('<html><main>Not found</main></html>',{status,headers:{'content-type':'text/html'}});}});
    const context=new ProcedureContext(sources,{known:async()=>new Map(),load:async()=>new Map()});
    await assert.rejects(context.query({reference:'2026/0030(COD)',language:'en'}),error=>error.status===404&&error.code==='official_source_not_found'&&error.sourceStatus===status&&error.cause.status===status&&!error.retryAfter);
    assert.equal(calls,1);
  }
  const sources=new OfficialContextSources({directory:null,fetchSource:async()=>new Response('',{status:403,headers:{'content-type':'text/html'}})});
  await assert.rejects(sources.get('https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2026%2F0031(COD)'),error=>error.status===502&&error.code==='official_source_unavailable');
});
test('a missing summary page leaves the procedure file standing',async()=>{
  const procedureHtml=readFileSync(new URL('./fixtures/oeil-procedure-2025-0407.html',import.meta.url),'utf8'),reads=[];
  const sources=new OfficialContextSources({directory:null,fetchSource:async url=>{reads.push(String(url));return String(url).includes('procedure-file')?new Response(procedureHtml,{status:200,headers:{'content-type':'text/html'}}):new Response('',{status:404,headers:{'content-type':'text/html'}});}});
  const result=await new ProcedureContext(sources,{known:async()=>new Map(),load:async()=>new Map()}).query({reference:'2025/0407(COD)',language:'en'});
  assert.equal(result.reference,'2025/0407(COD)');assert.ok(result.title);assert.ok(result.summaries.length);
  assert.equal(result.summary,null);
  assert.deepEqual(reads.map(url=>url.includes('procedure-file')?'file':'summary'),['file','summary']);
});
