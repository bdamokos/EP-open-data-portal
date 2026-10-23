import {loopback} from './test-support/loopback.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {HttpError} from './http-utils.mjs';
import {requestSignal,requestTimeout} from './request-budget.mjs';

test('document context HTTP contract is bounded, query-separated and never starts a writer',loopback,async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'document-context-http-'));
  process.env.ACTIVITY_INDEX_ENABLED='true';process.env.ACTIVITY_INDEX_DIR=directory;
  const {server}=await import('./index.mjs');const {activityIndex}=await import('./activity-index-worker.mjs');
  const {store,worker}=activityIndex();store.db.exec('PRAGMA query_only=ON');
  const calls=[];
  t.mock.method(globalThis,'fetch',async value=>{
    const url=new URL(value);calls.push(url.href);const id=url.pathname.split('/').at(-1);
    return new Response(JSON.stringify({data:[{id:'eli/dl/doc/'+id,identifier:id,document_date:'2026-10-08',work_type:'def/ep-document-types/'+(id.startsWith('TA-')?'TEXT_ADOPTED':'RESOLUTION_MOTION'),title_dcterms:{en:'Published document'},is_realized_by:[],inverse_foresees_change_of:[]}]}),{status:200,headers:{'content-type':'application/ld+json'}});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.db.exec('PRAGMA query_only=OFF');store.close();await rm(directory,{recursive:true,force:true});delete process.env.ACTIVITY_INDEX_ENABLED;delete process.env.ACTIVITY_INDEX_DIR;});
  const read=(route,options={})=>new Promise((resolve,reject)=>{const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,...options},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:response.statusCode,headers:response.headers,text,body:text?JSON.parse(text):null});});});request.on('error',reject);request.end();});
  const endpoint='/api/document-context/B-10-2026-0424';
  const first=await read(endpoint+'?lang=en');assert.equal(first.status,200);assert.equal(first.body.documentId,'B-10-2026-0424');assert.equal(first.body.document.selectedText.status,'unavailable');assert.equal(first.body.amendment,null);assert.equal(first.headers['cache-control'],'no-store');assert.equal(first.headers['cdn-cache-control'],'no-store');
  assert.equal((await read(endpoint+'?lang=en',{headers:{'If-None-Match':first.headers.etag}})).status,304);
  const french=await read(endpoint+'?lang=fr',{headers:{'If-None-Match':first.headers.etag}});assert.equal(french.status,200);assert.equal(french.body.requestedLanguage,'fr');assert.notEqual(french.headers.etag,first.headers.etag);
  const amendment=await read(endpoint+'?amendment=B-10-2026-0424-AM-13');assert.equal(amendment.body.amendment.status,'unavailable');assert.equal(amendment.body.target.reason,'amendment-wording-unavailable');assert.notEqual(amendment.headers.etag,first.headers.etag);
  const adopted=await read('/api/document-context/TA-10-2026-0342');assert.equal(adopted.status,200);assert.equal(adopted.body.document.selectedDocumentId,'TA-10-2026-0342');
  for(const suffix of ['?lang=en&lang=fr','?member=256918','?adopted=0','?amendment=RC-10-2026-0441-AM-1','?list=B-10-2026-0424-AM-001-020'])assert.equal((await read(endpoint+suffix)).status,400,suffix);
  assert.equal((await read(endpoint,{method:'POST'})).status,405);assert.equal((await read(endpoint,{headers:{Origin:'https://unrelated.example'}})).status,403);assert.equal((await read(endpoint,{method:'HEAD'})).text,'');
  assert.equal((await read('/api/document-context/A-9-2026-0237')).status,400);assert.equal((await read('/api/poc/document-context/B-10-2026-0424')).status,404);
  assert.equal(worker.running,false);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs').get().n,0);assert.equal(calls.length,2);
  assert(calls.every(url=>url.startsWith('https://data.europarl.europa.eu/api/v2/')));

  const {documentContext}=await import('./document-context.mjs');
  const id='B-10-2026-0424',amendmentId=id+'-AM-13',listId=id+'-AM-001-020',fetchedAt='2026-10-18T10:00:00.000Z';
  const wording={en:'1. Published English wording.',hu:'1. Közzétett magyar szöveg.'};
  const variants=['en','hu',null].map(language=>{
    const source={url:'https://data.europarl.europa.eu/distribution/doc/list_'+(language||'unknown')+'.docx',language,fetchedAt,contentHash:(language==='en'?'a':language==='hu'?'b':'c').repeat(64),sourceVersion:{byteSize:1024,issued:'2026-10-08'}};
    const baseline=language==='en'?'commission-proposal':language==='hu'?'present-text':'unknown';
    const baselineSource={category:baseline,headings:[{left:{raw:language==='en'?'Text proposed by the Commission':language==='hu'?'Hatályos szöveg':'Unrecognised source label',category:baseline},right:{raw:language==='hu'?'Módosítás':'Amendment',category:'other'}}],conflicted:false,language,sourceUrl:source.url,fetchedAt};
    const documentReferences=language?[{field:'DocRef',raw:'COM(2025)87 final',scope:'amendment'}]:null;
    const targetPath=language?{proposal:[{raw:'Article 1 – paragraph 1',labels:[{raw:'Article 1'},{raw:'paragraph 1'}]}],underlying:[{document:'Regulation (EU) 2023/956',raw:'Article 26 – paragraph 1 a (new)',labels:[{raw:'Article 26'},{raw:'paragraph 1 a (new)'}]}],language,sourceUrl:source.url,fetchedAt}:null;
    return {id:amendmentId,targetDocumentId:id,listId,language,baseline,baselineSource,documentReferences,targetPath,textIntegrity:'complete',originalText:wording[language]||'Unknown-language source wording.',proposedText:'Published replacement.',targetLabel:null,targetLabelLanguage:language,authors:[],wordingSource:source,fieldSources:{wording:source},sourceFreshness:{status:'fresh'},gaps:[]};
  });
  t.mock.method(documentContext,'findAmendment',()=>({id:amendmentId,targetDocumentId:id,variants}));
  let bodyReads=0;
  const text=language=>({status:'available',paragraphs:[wording[language]||wording.en],textLanguage:language,structureStatus:'extracted',paragraphSources:[{path:'w:p[0]',ordinal:0,container:'body',containerPath:'body',segment:0,complete:true}],sourceUrl:'https://data.europarl.europa.eu/distribution/doc/body_'+language+'.docx',fetchedAt});
  let readBody=async(_work,language)=>text(language);
  t.mock.method(documentContext,'readText',async(...args)=>{bodyReads++;return readBody(...args);});
  const selected=(selector,{language='en',body=true}={})=>endpoint+'?'+new URLSearchParams({amendment:amendmentId,list:listId,lang:language,...(selector===undefined?{}:{'wording-lang':selector}),...(body?{}:{body:'0'})});
  const noStore=response=>{assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['cdn-cache-control'],'no-store');};

  await t.test('exact source language is independent of body language and preserves every source version',async()=>{
    const responses=new Map();
    for(const selector of [undefined,'en','hu','unknown']) {
      const route=selected(selector),result=await read(route);assert.equal(result.status,200);noStore(result);responses.set(selector,result);
      assert.equal(Object.hasOwn(result.body,'requestedWordingLanguage'),selector!==undefined);
      if(selector!==undefined)assert.equal(result.body.requestedWordingLanguage,selector==='unknown'?null:selector);
      assert.deepEqual(result.body.amendment.variants.map(variant=>variant.language),['en','hu',null]);
      assert.deepEqual(result.body.amendment.variants.map(variant=>variant.source),variants.map(variant=>variant.wordingSource));
      for(const field of ['baseline','baselineSource','documentReferences','targetPath'])assert.deepEqual(result.body.amendment.variants.map(variant=>variant[field]),variants.map(variant=>variant[field]),field);
      const conditional=await read(route,{headers:{'If-None-Match':result.headers.etag}});assert.equal(conditional.status,304);assert.equal(conditional.text,'');noStore(conditional);
      const head=await read(route,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.text,'');assert.equal(head.headers.etag,result.headers.etag);noStore(head);
      const conditionalHead=await read(route,{method:'HEAD',headers:{'If-None-Match':result.headers.etag}});assert.equal(conditionalHead.status,304);assert.equal(conditionalHead.text,'');noStore(conditionalHead);
      const reversed=endpoint+'?'+[...new URL(route,'http://localhost').searchParams].reverse().map(([key,value])=>new URLSearchParams({[key]:value}).toString()).join('&');
      assert.equal((await read(reversed,{headers:{'If-None-Match':result.headers.etag}})).status,304);
    }
    assert.equal(new Set([...responses.values()].map(result=>result.headers.etag)).size,4);
    const english=responses.get('en');assert.equal(english.body.target.status,'found');assert.equal(english.body.target.quoteMatches,true);assert.equal(english.body.target.evidence.wordingLanguage,'en');assert.deepEqual(english.body.target.paragraphs,[0]);
    const hungarian=responses.get('hu');assert.equal(hungarian.body.target.reason,'different-text-languages');assert.equal(hungarian.body.target.evidence.wordingLanguage,'hu');assert.deepEqual(hungarian.body.target.evidence.wordingSource,variants[1].wordingSource);
    const unknown=responses.get('unknown');assert.equal(unknown.body.target.reason,'different-text-languages');assert.equal(unknown.body.target.evidence.wordingLanguage,null);
    const absent=responses.get(undefined);assert.equal(absent.body.target.reason,'choose-source-version');assert.equal(absent.body.target.evidence,null);
    for(const [selector,result] of responses)for(const [otherSelector,other] of responses)if(selector!==otherSelector)assert.equal((await read(selected(selector),{headers:{'If-None-Match':other.headers.etag}})).status,200);
    assert.equal(bodyReads,4,'conditional and reordered reads share only their exact selector cache entry');
    const sameLanguage=await read(selected('hu',{language:'hu'}));assert.equal(sameLanguage.body.target.status,'found');assert.equal(sameLanguage.body.target.quoteMatches,true);assert.equal(sameLanguage.body.document.selectedText.paragraphs[0],wording.hu);assert.equal(sameLanguage.body.target.evidence.wordingLanguage,'hu');
    const missing=await read(selected('fr'));assert.equal(missing.status,200);assert.equal(missing.body.requestedWordingLanguage,'fr');assert.equal(missing.body.target.status,'unavailable');assert.equal(missing.body.target.evidence,null);assert.equal(missing.body.amendment.variants.length,3);
    const before=bodyReads;const wordingOnly=await read(selected('hu',{body:false}));assert.equal(wordingOnly.status,200);assert.equal(wordingOnly.body.document,null);assert.equal(wordingOnly.body.target.status,'not-requested');assert.equal(wordingOnly.body.requestedWordingLanguage,'hu');assert.equal(wordingOnly.body.amendment.variants.length,3);assert.equal(bodyReads,before);
  });

  await t.test('invalid selectors and missing exact dependencies return non-cacheable 400 responses',async()=>{
    const before=bodyReads,sourceReads=calls.length;
    const invalid=['','EN','HU','eng','en-US','null','Unknown',' en','en ','e1','éé','a'.repeat(1000)];
    const routes=invalid.map(value=>selected(value));
    routes.push(endpoint+'?wording-lang=hu',endpoint+'?amendment='+amendmentId+'&wording-lang=hu',endpoint+'?list='+listId+'&wording-lang=hu',selected('hu')+'&wording-lang=hu',selected('hu')+'&wording-lang=en',endpoint+'?amendment='+amendmentId+'&list=RC-10-2026-0441-AM-001-020&wording-lang=hu');
    for(const route of routes){const result=await read(route);assert.equal(result.status,400,route);noStore(result);assert(result.body.error.code.startsWith('invalid_'));}
    assert.equal(bodyReads,before);assert.equal(calls.length,sourceReads);
  });

  await t.test('selected wording preserves typed local failures and permits an immediate retry',async()=>{
    for(const failure of [Object.assign(new HttpError(503,'upstream_busy','The document reader is busy.'),{retryAfter:1}),requestTimeout()]) {
      let attempts=0;readBody=async(_work,language)=>{if(++attempts===1)throw failure;return text(language);};
      const route=selected('hu',{language:failure.code==='upstream_busy'?'fr':'de'});
      const failed=await read(route);assert.equal(failed.status,503);assert.equal(failed.body.error.code,failure.code);assert.equal(failed.headers['retry-after'],'1');noStore(failed);assert.equal(Object.hasOwn(failed.body,'amendment'),false);
      const recovered=await read(route);assert.equal(recovered.status,200);assert.equal(recovered.body.requestedWordingLanguage,'hu');assert.equal(recovered.body.target.reason,'different-text-languages');assert.equal(attempts,2);
    }
  });

  await t.test('closing one HTTP reader leaves the selected shared source job available to another',async()=>{
    let started,release,sharedSignal;const entered=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    t.after(()=>release());
    readBody=async(_work,language)=>{sharedSignal=requestSignal();started();await gate;return text(language);};
    const route=selected('unknown',{language:'it'}),before=bodyReads;
    const abandoned=http.request({hostname:'127.0.0.1',port:server.address().port,path:route});
    const closed=new Promise(resolve=>{abandoned.on('error',()=>{});abandoned.once('close',resolve);});abandoned.end();
    await entered;abandoned.destroy();await closed;
    assert.equal(sharedSignal.aborted,false);
    const arrived=new Promise(resolve=>server.once('request',resolve));
    const survivor=read(route);await arrived;assert.equal(bodyReads,before+1);release();const result=await survivor;
    assert.equal(result.status,200);assert.equal(result.body.requestedWordingLanguage,null);assert.equal(result.body.target.evidence.wordingLanguage,null);assert.equal(bodyReads,before+1);assert.equal(sharedSignal.aborted,false);
  });

  await t.test('unsupported declared distributions remain exact source-language competitors over HTTP',async tt=>{
    const fixture=JSON.parse(await readFile(new URL('./fixtures/amendment-docx-excerpts-20261016.json',import.meta.url),'utf8')).documents[0];
    const original=fixture.expected[0],documentId=fixture.targetDocumentId,exactAmendment=documentId+'-AM-'+original.number;
    const allowed=fixture.sourceUrl,unsupported=allowed.replace('.docx','_other.docx?download=1');
    const entries=[['word/document.xml',fixture.documentXml],['word/styles.xml',fixture.stylesXml]],local=[],central=[];let offset=0;
    for(const [entry,xml] of entries) {
      const name=Buffer.from(entry),body=Buffer.from(xml),header=Buffer.alloc(30),directory=Buffer.alloc(46);
      header.writeUInt32LE(0x04034b50);header.writeUInt32LE(body.length,18);header.writeUInt32LE(body.length,22);header.writeUInt16LE(name.length,26);
      directory.writeUInt32LE(0x02014b50);directory.writeUInt32LE(body.length,20);directory.writeUInt32LE(body.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
      local.push(header,name,body);central.push(directory,name);offset+=header.length+name.length+body.length;
    }
    const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
    const buffer=Buffer.concat([...local,directory,end]),downloads=[];
    const expression=(language,url)=>({language:'http://publications.europa.eu/resource/authority/language/'+language,is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:url,byteSize:1234,issued:'2026-09-30'}]});
    let publishedList;
    tt.mock.method(documentContext,'findAmendment',()=>null);
    tt.mock.method(documentContext,'request',async route=>{
      assert.equal(route,'/plenary-documents/'+documentId);
      return {payload:{data:[{id:'eli/dl/doc/'+documentId,identifier:documentId,work_type:'def/ep-document-types/REPORT_PLENARY',document_date:'2026-09-16',is_realized_by:[],inverse_foresees_change_of:[publishedList]}]},fetchedAt:Date.parse(fetchedAt)};
    });
    tt.mock.method(documentContext,'readText',async()=>({...text('en'),paragraphs:[original.originalText]}));
    tt.mock.method(documentContext,'download',async url=>{assert.equal(url,allowed,'unsupported declared files must never be downloaded');downloads.push(url);return {buffer,resolvedSourceUrl:url};});
    const cases=[
      {listId:documentId+'-AM-037-046',expressions:[expression('ENG',allowed),expression('ENG',unsupported)],languages:['en','en'],urls:[allowed,unsupported],found:false},
      {listId:documentId+'-AM-040-040',expressions:[expression('ENG',unsupported)],languages:['en'],urls:[unsupported],found:false},
      {listId:documentId+'-AM-039-041',expressions:[expression('ENG',allowed),expression('HUN',unsupported)],languages:['en','hu'],urls:[allowed,unsupported],found:true},
    ];
    for(const scenario of cases) {
      publishedList={id:'eli/dl/doc/'+scenario.listId,identifier:scenario.listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+documentId],is_realized_by:scenario.expressions};
      const route='/api/document-context/'+documentId+'?'+new URLSearchParams({amendment:exactAmendment,list:scenario.listId,'wording-lang':'en'});
      const result=await read(route);assert.equal(result.status,200);noStore(result);assert.equal(result.body.requestedWordingLanguage,'en');
      assert.deepEqual(result.body.amendment.variants.map(variant=>variant.language),scenario.languages);assert.deepEqual(result.body.amendment.variants.map(variant=>variant.source.url),scenario.urls);
      const withheld=result.body.amendment.variants.find(variant=>variant.source.url===unsupported);assert.equal(withheld.wordingStatus,'unavailable');assert.equal(withheld.originalText,null);assert.equal(withheld.proposedText,null);assert.deepEqual(withheld.source.sourceVersion,{byteSize:1234,issued:'2026-09-30'});assert.equal(withheld.metadataSource.url,'https://data.europarl.europa.eu/api/v2/plenary-documents/'+documentId);
      if(scenario.found){assert.equal(result.body.target.status,'found');assert.equal(result.body.target.quoteMatches,true);assert.equal(result.body.target.evidence.wordingLanguage,'en');assert.equal(result.body.target.evidence.wordingSource.url,allowed);assert.deepEqual(downloads,[allowed]);}
      else {assert.equal(result.body.target.status,'unavailable');assert.equal(result.body.target.evidence,null);assert.deepEqual(downloads,[]);}
    }
  });

  assert.equal(worker.running,false);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs').get().n,0);assert.equal(calls.length,2);
  process.env.ACTIVITY_INDEX_ENABLED='false';assert.equal((await read(endpoint)).status,200);
});
