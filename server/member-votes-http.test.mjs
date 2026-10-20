import {test} from 'node:test';
import {API_VERSION} from './api-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemberVotes,memberVotes} from './member-votes.mjs';

const API='https://data.europarl.europa.eu/api/v2';
const sittingId='MTG-PL-2026-10-07';
const clock=()=>Date.parse('2026-10-17T19:00:00Z');
const sourceFixture=JSON.parse(readFileSync(new URL('./fixtures/insights-live-20261014.json',import.meta.url),'utf8'));

function fixtureService({unavailable=false}={}) {
  const calls=[];
  // A deliberately reduced graph retains the existing public fixture's actual
  // voter arrays, labels and links, with only two declared result children.
  // It is a contract fixture, not a claim about the sitting's total vote count.
  const named=sourceFixture.decisions.payload.data.slice(0,2).map(node=>({...node,type:'Vote'}));
  const decisionIds=new Set(named.map(node=>node.id));
  const resultIds=new Set(named.flatMap(node=>node.inverse_consists_of));
  const results=sourceFixture.results.payload.data.filter(node=>resultIds.has(node.id)).map(node=>({...node,consists_of:node.consists_of.filter(id=>decisionIds.has(id))}));
  const meeting={...sourceFixture.meetings.payload.data.find(node=>node.activity_id===sittingId),consists_of:results.map(node=>node.id)};
  const census=named.map(node=>Object.fromEntries(Object.entries(node).filter(([key])=>!key.startsWith('had_voter_'))));
  const request=async(endpoint,params={})=>{
    calls.push({endpoint,params});
    if(unavailable)throw Object.assign(new Error('Fixture public source unavailable'),{code:'fixture_source_unavailable'});
    let data;
    if(endpoint==='/meetings/'+sittingId||endpoint==='/meetings')data=[meeting];
    else if(endpoint==='/meetings/'+sittingId+'/decisions')data=params['filter-output']==='voters'?census:named;
    else if(endpoint==='/meetings/'+sittingId+'/vote-results')data=results;
    else if(endpoint==='/meetings/'+sittingId+'/foreseen-activities')data=sourceFixture.foreseen.payload.data;
    else assert.fail('Unexpected public source request: '+endpoint);
    return {url:API+endpoint+'?'+new URLSearchParams(params),fetchedAt:clock(),stale:false,refreshInProgress:false,refreshError:null,payload:{data:Number(params.offset||0)===0?structuredClone(data):[]}};
  };
  return {service:new MemberVotes({request,clock}),calls};
}

test('member-votes HTTP contract retains actual positions, bounded snapshot pagination and explicit failures',async t=>{
  const originalFetch=globalThis.fetch,originalQuery=memberVotes.query;
  const enabled={activity:process.env.ACTIVITY_INDEX_ENABLED,corpus:process.env.CORPUS_ENABLED};
  process.env.ACTIVITY_INDEX_ENABLED='false';process.env.CORPUS_ENABLED='false';
  globalThis.fetch=async(input,options)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
    assert.equal(url.hostname,'127.0.0.1','HTTP contract tests must not access the network');
    return originalFetch(input,options);
  };
  let server;
  t.after(async()=>{
    memberVotes.query=originalQuery;globalThis.fetch=originalFetch;
    if(server?.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    for(const [key,value] of [['ACTIVITY_INDEX_ENABLED',enabled.activity],['CORPUS_ENABLED',enabled.corpus]]){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });
  ({server}=await import('./index.mjs?member-votes-http-test'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/member-votes/`;
  const fixture=fixtureService();memberVotes.query=fixture.service.query.bind(fixture.service);
  const route=base+'197591',period='v='+API_VERSION+'&sitting='+sittingId;
  const firstResponse=await fetch(route+'?'+period+'&lang=hu&limit=1&decision='+sittingId+'-DEC-197457');
  assert.equal(firstResponse.status,200);
  const first=await firstResponse.json();
  assert.equal(first.version,3);
  assert.deepEqual(first.member,{id:'197591',uri:'https://data.europarl.europa.eu/person/197591',mandateStatus:'not-assessed',historicalGroupStatus:'not-collected'});
  assert.deepEqual(first.period,{kind:'sitting',week:null,sittingId,from:'2026-10-07',to:'2026-10-07'});
  assert.match(first.snapshotId,/^[a-f0-9]{64}$/);
  assert.deepEqual(first.pagination,{offset:0,limit:1,returned:1,observedTotal:2,filteredTotal:2,nextOffset:1});
  assert.equal(first.coverage.termWide,false);
  assert.equal(first.coverage.collectionComplete,true);
  assert.deepEqual(first.coverage.scannedSittingIds,[sittingId]);
  assert.equal(first.selected.status,'found');
  assert.equal(first.selected.item.id,sittingId+'-DEC-197457');
  assert.deepEqual(first.selected.item.actualPosition,{status:'recorded',position:'for'});
  assert.deepEqual(first.selected.item.intention,{status:'reported',positions:['abstaining']});
  assert.equal(first.selected.item.historicalGroup,null);
  assert.equal(first.selected.item.titleLanguage,'hu');
  assert.deepEqual(first.selected.item.context.procedureIds,['2025-2117']);
  assert(first.selected.item.sources.decisions.every(source=>source.url.startsWith(API)&&source.fetchedAt&&/^[a-f0-9]{64}$/.test(source.contentHash)));
  const requestsAfterCollection=fixture.calls.length;
  const selectedId=first.items[0].id;
  const secondResponse=await fetch(route+'?'+period+'&lang=hu&limit=1&offset=1&snapshot='+first.snapshotId+'&decision='+selectedId);
  assert.equal(secondResponse.status,200);
  const second=await secondResponse.json();
  assert.equal(second.snapshotId,first.snapshotId);
  assert.deepEqual(second.pagination,{offset:1,limit:1,returned:1,observedTotal:2,filteredTotal:2,nextOffset:null});
  assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,2);
  assert.equal(second.selected.status,'found');
  assert.equal(second.selected.item.id,selectedId);
  assert(!second.items.some(item=>item.id===selectedId),'selection remains available outside the current page');
  assert.equal(fixture.calls.length,requestsAfterCollection,'normal pagination must read the collected snapshot');
  const otherMember=await fetch(base+'42?'+period+'&snapshot='+first.snapshotId);
  assert.equal(otherMember.status,200);
  assert.equal((await otherMember.json()).selected.status,'not-requested');
  assert.equal(fixture.calls.length,requestsAfterCollection,'public source collection is shared across members');
  const head=await fetch(route+'?'+period,{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.match(head.headers.get('content-type'),/^application\/json/);
  assert.equal((await fetch(route+'?'+period,{method:'POST'})).status,405);
  assert.equal((await fetch(route+'?'+period,{headers:{Origin:'https://example.invalid'}})).status,403);
  for(const id of ['0','-1','abc','9007199254740992'])assert.equal((await fetch(base+id+'?'+period)).status,400,id);
  for(const query of [
    period+'&limit=0',period+'&limit=101',period+'&offset=-1',period+'&offset=1e2',period+'&offset=10001',
    period+'&limit=1&limit=2',period+'&lang=en&lang=hu',period+'&url=https://example.invalid',
    period+'&snapshot=',period+'&snapshot=ABC',period+'&lang=',period+'&positions=',period+'&positions=bad',period+'&positions=all&positions=recorded',
    'week=','week=2026-10-06','week=2026-02-30','week=2999-01-04',
    'sitting=MTG-PL-2024-07-15','sitting=MTG-PL-2026-02-30',
    period+'&week=2026-10-05',period+'&decision=MTG-PL-2026-10-08-DEC-197457'
  ])assert.equal((await fetch(route+'?'+query)).status,400,query);
  const unknownSnapshot=await fetch(route+'?'+period+'&snapshot='+'0'.repeat(64));
  assert.equal(unknownSnapshot.status,409);
  assert((await unknownSnapshot.json()).error.code);
  const failed=fixtureService({unavailable:true});memberVotes.query=failed.service.query.bind(failed.service);
  const failureResponse=await fetch(route+'?'+period+'&decision='+sittingId+'-DEC-197457');
  assert.equal(failureResponse.status,200);
  const failure=await failureResponse.json();
  assert.deepEqual(failure.items,[]);
  assert.equal(failure.coverage.status,'unavailable');
  assert.equal(failure.coverage.collectionComplete,false);
  assert.equal(failure.coverage.termWide,false);
  assert.deepEqual(failure.coverage.failedSittingIds,[sittingId]);
  assert.equal(failure.selected.status,'unavailable');
  const latestResponse=await fetch(route+'?week=latest');
  assert.equal(latestResponse.status,200);
  const latest=await latestResponse.json();
  assert.deepEqual(latest.period,{kind:'week',week:null,sittingId:null,from:null,to:null});
  assert.equal(latest.coverage.status,'unavailable');
  assert.equal(latest.coverage.collectionComplete,false);
  assert.equal(latest.coverage.catalogue.state,'unavailable');
  assert.deepEqual(latest.items,[]);
});
