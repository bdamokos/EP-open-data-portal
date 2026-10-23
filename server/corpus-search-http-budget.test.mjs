import '../scripts/test-network-guard.mjs';
import {loopback} from './test-support/loopback.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('HTTP response budget paginates complete multilingual question/answer groups without collection',loopback,async t=>{
  // This file runs in its own test process. Configure the existing response
  // limit before importing config or any server module that captures it.
  const directory=mkdtempSync(path.join(os.tmpdir(),'corpus-http-budget-'));
  const fixture={JSON_RESPONSE_LIMIT_BYTES:'65536',CORPUS_ENABLED:'true',CORPUS_DIR:path.join(directory,'corpus'),
    ACTIVITY_INDEX_DIR:path.join(directory,'index'),ODP_CACHE_DIR:undefined};
  const saved=Object.fromEntries(Object.keys(fixture).map(key=>[key,process.env[key]]));
  for(const [key,value] of Object.entries(fixture))value===undefined?delete process.env[key]:process.env[key]=value;
  let index,store,service,server,readerTimeout;
  try {
    const {config}=await import('./config.mjs');
    const {readerTimeoutMs}=await import('./test-support/corpus-reader.mjs');
    const {ActivityStore}=await import('./activity-index-store.mjs');
    const {CorpusStore}=await import('./corpus-store.mjs');
    const {corpus}=await import('./corpus-worker.mjs');
    ({server}=await import('./index.mjs'));
    assert.equal(config.jsonResponseLimitBytes,65536);
    const fetchedAt='2026-10-16T10:00:00.000Z',date='2026-05-01';
    index=new ActivityStore(fixture.ACTIVITY_INDEX_DIR);assert(index.acquire());
    index.db.exec("INSERT INTO meta VALUES ('active','1')");
    store=new CorpusStore(fixture.CORPUS_DIR,{indexFile:index.filename});assert(store.acquire());
    const languages=['de','en','fr','hu','it','pl'],authors=Array.from({length:12},(_,n)=>String(100000+n)),ids=[];
    const putMember=index.db.prepare('INSERT INTO members VALUES (?,?)'),putItem=index.db.prepare('INSERT INTO items VALUES (1,?,?,?,?,?,?)');
    for(const [n,id] of authors.entries())putMember.run(id,JSON.stringify({id,name:'Alessandra Maria Fernández '+n}));
    for(let n=0;n<6;n++){
      const questionId='E-10-2026-'+String(100+n).padStart(6,'0');ids.push(questionId);
      for(const [sourceId,kind,parentId] of [[questionId,'question',null],[questionId+'-ASW','answer',questionId]]){
        store.putDocument({sourceId,kind,parentId,date},languages.map(language=>({sourceKey:language,language,translationType:'original',sourceFormat:'docx',
          sourceUrl:`https://data.europarl.europa.eu/distribution/reds_iMaQp_Asw/${sourceId}/${sourceId}_${language}.docx`,
          fetchedAt,body:'PFAS contamination in drinking water and environmental protection.',raw:null})));
        for(const author of authors)putItem.run('/parliamentary-questions/'+questionId,sourceId,author,'written-questions',date,'{}');
      }
    }
    const options={query:'PFAS',group:'question',limit:ids.length};
    const unbounded={...store.search(options),coverage:store.coverage()};
    const unboundedBytes=Buffer.byteLength(JSON.stringify(unbounded))+1;
    assert(unboundedBytes>config.jsonResponseLimitBytes,'serialized unbounded response must exceed the configured budget');
    assert.equal(unbounded.results.length,ids.length);
    const expected=new Map(unbounded.results.map(result=>[result.sourceId,result]));
    t.diagnostic(`unbounded=${unboundedBytes} bytes; budget=${config.jsonResponseLimitBytes}; groups=${ids.length}`);
    // Fixture writes precede listen; disable idle reuse races as in corpus.test.
    server.keepAliveTimeout=0;
    service=corpus();
    readerTimeout=service.reader.timeoutMs;service.reader.timeoutMs=readerTimeoutMs;
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}/api/corpus/search`;
    for(const method of ['GET','POST']){
      const seen=[];let offset=0,pages=0;
      do {
        const response=method==='POST'
          ?await fetch(base,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({...options,offset})})
          :await fetch(base+'?q=PFAS&group=question&limit='+ids.length+'&offset='+offset);
        assert.equal(response.status,200,method);
        const body=await response.text();assert(Buffer.byteLength(body)<=config.jsonResponseLimitBytes,method+' response bytes');
        const page=JSON.parse(body);assert.equal(page.total,ids.length);assert.equal(page.coverage.authoritativeComplete,false);
        assert.deepEqual(page.hits,page.results.flatMap(result=>result.hits),'legacy hits exactly match returned groups');
        assert(page.results.length>0);assert.equal(page.offset,offset);
        for(const result of page.results){
          assert.deepEqual(result,expected.get(result.sourceId),'complete group matches the unbounded retained search');
          assert.equal(result.hits.length,2*languages.length);
          assert.deepEqual(result.hits.map(hit=>[hit.sourceId,hit.sourceKey]).sort(),
            [result.sourceId,result.sourceId+'-ASW'].flatMap(id=>languages.map(language=>[id,language])).sort());
          for(const hit of result.hits)assert.deepEqual(hit.people.map(person=>String(person.id)).sort(),authors,'every variant retains all repeated authors');
        }
        if(offset===0){assert.equal(page.responseLimited,true);assert(page.nextOffset>0&&page.nextOffset<ids.length);}
        seen.push(...page.results.map(result=>result.sourceId));pages++;
        assert(pages<=ids.length,'continuation must make progress');
        if(page.nextOffset!==null)assert.equal(page.nextOffset,offset+page.results.length);
        offset=page.nextOffset;
      }while(offset!==null);
      assert(pages>1);assert.deepEqual([...seen].sort(),ids);assert.equal(new Set(seen).size,ids.length);
      t.diagnostic(method+' pages='+pages);
    }
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0,'bounded HTTP reads schedule no corpus collection');
  } finally {
    if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    if(service){service.reader.timeoutMs=readerTimeout;service.store.close();}
    store?.close();index?.close();
    for(const [key,value] of Object.entries(saved))value===undefined?delete process.env[key]:process.env[key]=value;
    rmSync(directory,{recursive:true,force:true});
  }
});
