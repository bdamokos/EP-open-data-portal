import test from 'node:test';
import assert from 'node:assert/strict';
import {loopback} from './test-support/loopback.mjs';
import {memberVotes} from './member-votes.mjs';
import {voteFixture,decisionId} from './test-support/decision-votes.mjs';
import {API_VERSION} from './api-version.mjs';

test('decision-votes HTTP route is versioned, read-only and never publicly cached',loopback,async t=>{
 const old={snapshot:memberVotes.snapshot,activity:process.env.ACTIVITY_INDEX_ENABLED,corpus:process.env.CORPUS_ENABLED},f=voteFixture();
 process.env.ACTIVITY_INDEX_ENABLED='false';process.env.CORPUS_ENABLED='false';memberVotes.snapshot=f.reader.snapshot.bind(f.reader);
 const {server}=await import('./index.mjs?decision-votes-http');
 t.after(async()=>{memberVotes.snapshot=old.snapshot;for(const [key,value] of [['ACTIVITY_INDEX_ENABLED',old.activity],['CORPUS_ENABLED',old.corpus]])value===undefined?delete process.env[key]:process.env[key]=value;if(server.listening)await new Promise(resolve=>server.close(resolve));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/api/decision-votes/'+decisionId;
 const response=await fetch(base+'?v='+API_VERSION+'&lang=en');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('cdn-cache-control'),'no-store');const data=await response.json();assert.equal(data.decisionId,decisionId);assert.equal(data.integrity,'complete');assert.equal(data.groupHistory,null);
 assert.equal((await fetch(base+'?member=42')).status,400);assert.equal((await fetch(base+'?v=1')).status,409);assert.equal((await fetch(base,{method:'POST'})).status,405);
});
