import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loopback} from './test-support/loopback.mjs';
import {memberVoteExplanations} from './member-vote-explanations.mjs';

test('explanation HTTP reads validate pinned identities, stay no-store, and enforce the read-only boundary',loopback,async t=>{
  const saved={activity:process.env.ACTIVITY_INDEX_ENABLED,corpus:process.env.CORPUS_ENABLED};
  process.env.ACTIVITY_INDEX_ENABLED='false';process.env.CORPUS_ENABLED='false';
  let server;
  t.after(async()=>{if(server?.listening)await new Promise(resolve=>server.close(resolve));for(const [key,value] of [['ACTIVITY_INDEX_ENABLED',saved.activity],['CORPUS_ENABLED',saved.corpus]])value===undefined?delete process.env[key]:process.env[key]=value;});
  const calls=[];
  t.mock.method(memberVoteExplanations,'query',async(member,query)=>{calls.push({member,query});return {version:2,memberId:String(member),decisionId:query.decision,snapshotId:query.snapshot,items:[],written:{status:'unsupported',count:null}};});
  ({server}=await import('./index.mjs?explanation-http'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/member-vote-explanations/197655`,params=new URLSearchParams({sitting:'MTG-PL-2026-03-26',decision:'MTG-PL-2026-03-26-DEC-189210',snapshot:'a'.repeat(64)}),url=base+'?'+params;
  const response=await fetch(url);assert.equal(response.status,200);assert.equal((await response.json()).written.count,null);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('cdn-cache-control'),'no-store');
  assert.equal(calls.length,1);assert.equal(String(calls[0].member),'197655');
  const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  for(const [target,options,status] of [[base,{},400],[url+'&limit=1',{},400],[url+'&decision=bad',{},400],[url,{method:'POST'},405],[url,{headers:{Origin:'https://example.invalid'}},403]])assert.equal((await fetch(target,options)).status,status);
});
