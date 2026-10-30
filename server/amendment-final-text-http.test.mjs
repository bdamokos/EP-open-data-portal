import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import {once} from 'node:events';

test('the final-text route pins source selectors, preserves ordinary context reads and rejects malformed queries',async t=>{
  const previous=process.env.ACTIVITY_INDEX_ENABLED;
  process.env.ACTIVITY_INDEX_ENABLED='false';
  t.after(()=>{if(previous===undefined)delete process.env.ACTIVITY_INDEX_ENABLED;else process.env.ACTIVITY_INDEX_ENABLED=previous;});
  const {handleRequest}=await import('./index.mjs');
  const {documentContext}=await import('./document-context.mjs');
  const {amendmentFinalText}=await import('./amendment-final-text.mjs');
  const calls=[];
  t.mock.method(amendmentFinalText,'query',async(query,options)=>{calls.push({query,options});return {version:2,reader:'final-text',query};});
  t.mock.method(documentContext,'query',async()=>({version:44,reader:'context'}));
  t.mock.method(globalThis,'fetch',()=>assert.fail('Dispatch must not bypass the selected reader.'));
  const base='/api/document-context/AGRI-PR-773115';
  const selected=new URLSearchParams({scope:'committee',amendment:'committee:AGRI-AM-773343:181',list:'AGRI-AM-773343','wording-lang':'en','final-text':'1'});
  async function read(params,method='GET',headers={}) {
    const values={},chunks=[];
    const response=new Writable({write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done();}});
    response.setHeader=(name,value)=>{values[name.toLowerCase()]=value;};
    response.removeHeader=name=>{delete values[name.toLowerCase()];};
    const finished=once(response,'finish');
    await handleRequest({url:base+'?'+params,method,headers},response);await finished;
    const text=Buffer.concat(chunks).toString();
    return {status:response.statusCode,headers:values,text,body:text?JSON.parse(text):null};
  }
  const final=await read(selected);
  assert.equal(final.status,200);assert.equal(final.body.reader,'final-text');
  assert.deepEqual(calls[0],{query:{id:'AGRI-PR-773115',scope:'committee',language:'en',amendmentId:'committee:AGRI-AM-773343:181',listId:'AGRI-AM-773343',wordingLanguage:'en',finalText:true,adopted:false,includeBody:true},options:{store:null}});
  assert.equal(final.headers['cache-control'],'no-store');assert.equal(final.headers['cdn-cache-control'],'no-store');
  const ordinary=new URLSearchParams(selected);ordinary.delete('final-text');
  assert.equal((await read(ordinary)).body.reader,'context');assert.equal(calls.length,1);
  const bodyless=new URLSearchParams(selected);bodyless.set('body','0');bodyless.set('wording-lang','unknown');
  assert.equal((await read(bodyless)).status,200);assert.equal(calls.at(-1).query.includeBody,false);assert.equal(calls.at(-1).query.wordingLanguage,null);
  assert.equal((await read(selected,'HEAD')).text,'');
  for(const change of [q=>q.set('final-text','0'),q=>q.append('final-text','1'),q=>q.delete('wording-lang'),q=>q.delete('amendment'),q=>q.delete('list'),q=>q.set('adopted','1'),q=>q.set('scope','plenary'),q=>q.set('list','IMCO-AM-772127')]) {
    const query=new URLSearchParams(selected);change(query);const before=calls.length;
    assert.equal((await read(query)).status,400,query.toString());assert.equal(calls.length,before);
  }
  assert.equal((await read(selected,'POST')).status,405);
  assert.equal((await read(selected,'GET',{origin:'https://unrelated.example',host:'explorer.example'})).status,403);
});
