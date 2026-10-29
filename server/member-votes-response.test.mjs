import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import {once} from 'node:events';
import {handleRequest} from './index.mjs';
import {memberVotes,MEMBER_VOTES_PERIOD_RESPONSE_BYTES} from './member-votes.mjs';
import {config} from './config.mjs';

test('only full-period vote reads have room for responses beyond the ordinary JSON ceiling',async t=>{
  const payload='x'.repeat(Math.max(8*1024*1024,config.jsonResponseLimitBytes+1024));
  t.mock.method(memberVotes,'query',async(_member,query)=>({pagination:query.view==='period'?{mode:'period'}:{},payload}));
  async function read(view,method='GET'){
    const chunks=[];
    const response=new Writable({write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done();}});
    const headers={};response.setHeader=(name,value)=>headers[name.toLowerCase()]=value;response.removeHeader=name=>delete headers[name.toLowerCase()];
    const finished=once(response,'finish');
    await handleRequest({url:'/api/member-votes/197591?week=2026-03-23&view='+view,method,headers:{}},response);
    await finished;return {status:response.statusCode,body:Buffer.concat(chunks).toString(),headers};
  }
  const period=await read('period');
  assert.equal(period.status,200);assert.equal(JSON.parse(period.body).payload,payload);
  assert.equal(period.headers['cache-control'],'no-store');
  assert.equal((await read('period','HEAD')).status,200);
  const paged=await read('page');assert.equal(paged.status,500);assert.equal(JSON.parse(paged.body).error.code,'response_too_large');
  t.mock.method(memberVotes,'query',async()=>({pagination:{mode:'period'},payload:'x'.repeat(MEMBER_VOTES_PERIOD_RESPONSE_BYTES)}));
  const oversized=await read('period');assert.equal(oversized.status,500);assert.equal(JSON.parse(oversized.body).error.code,'response_too_large');
});
