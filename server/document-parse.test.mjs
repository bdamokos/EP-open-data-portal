import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createParseThread} from './amendment-extraction-thread.mjs';
import {OffThreadDocumentParser,inlineDocumentParser,DOCUMENT_PARSE_LIMITS} from './document-parse.mjs';
import {DocumentContext,documentContextQuery} from './document-context.mjs';
import {parseProposal} from './proposal-structure.mjs';
import {extractAmendments} from './amendment-documents.mjs';
import {documentImageDescriptors} from './docx-images.mjs';
import {createRequestBudget,runWithRequestSignal} from './request-budget.mjs';

function archive(documentXml,stylesXml='<w:styles xmlns:w="urn:word"/>') {
  const entries=[['word/document.xml',documentXml],['word/styles.xml',stylesXml]],local=[],central=[];let offset=0;
  for(const [name_,xml] of entries) {
    const name=Buffer.from(name_),body=Buffer.from(xml),compressed=deflateRawSync(body),header=Buffer.alloc(30),directory=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(8,8);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(body.length,22);header.writeUInt16LE(name.length,26);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(8,10);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(body.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
    local.push(header,name,compressed);central.push(directory,name);offset+=30+name.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
const paragraphs=count=>'<w:document xmlns:w="urn:word"><w:body>'+Array.from({length:count},(_,i)=>`<w:p><w:r><w:t>Article ${i+1}</w:t></w:r></w:p><w:p><w:r><w:t>${i+1}. Operative text of paragraph ${i+1}.</w:t></w:r></w:p>`).join('')+'</w:body></w:document>';
const proposalOptions={language:'en',item:'act',sourceUrl:'https://publications.europa.eu/resource/celex/52025PC0087',identity:{work:'w',expression:'e',item:'i'}};
const LIMIT=3*1024*1024;

const threads=[];
const makeThread=(settings={})=>{const thread=createParseThread({idleMs:200,timeoutMs:30_000,maxHeapMiB:256,...settings});threads.push(thread);return thread;};
after(()=>{for(const thread of threads)thread.close();});

const directories=[];
const makeDirectory=async()=>{const directory=await mkdtemp(path.join(process.env.TMPDIR||os.tmpdir(),'document-parse-'));directories.push(directory);return directory;};
after(async()=>{for(const directory of directories)await rm(directory,{recursive:true,force:true});});

// Wraps a thread so tests can count and gate the jobs it receives.
function spy(thread) {
  const calls=[];
  return {calls,run:(task,payload,options)=>{calls.push({task,options});return thread.run(task,payload,options);}};
}
const parser=(thread,directory,extra={})=>new OffThreadDocumentParser({thread,directory:()=>directory,...extra});
// A stored parse is published after its reader has the result; wait for that.
const settled=async instance=>{while(instance.inflight.size)await sleep(5);};
const files=async directory=>(await readdir(path.join(directory,'document-parse-v1')).catch(()=>[])).filter(name=>name.endsWith('.json'));

const listFixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-docx-excerpts-20261016.json',import.meta.url))).documents.find(row=>row.targetDocumentId==='A-10-2025-0085');
const listBuffer=archive(listFixture.documentXml,listFixture.stylesXml);
const listOptions=fetchedAt=>({listId:listFixture.listId,targetDocumentId:listFixture.targetDocumentId,language:'en',sourceUrl:listFixture.sourceUrl,fetchedAt});

test('the parse thread returns the inline parsers\' result for amendment lists and proposals',async()=>{
  const thread=makeThread(),directory=await makeDirectory(),off=parser(thread,directory);
  const fetchedAt='2026-11-08T10:00:00.000Z';
  assert.deepEqual(await off.amendments(listBuffer,listOptions(fetchedAt)),extractAmendments(listBuffer,listOptions(fetchedAt)));
  const buffer=archive(paragraphs(3));
  const parsed=await off.proposal('proposal',buffer,proposalOptions,{limitBytes:LIMIT});
  const inline=parseProposal(buffer,proposalOptions);
  // The result is the parser's JSON, byte for byte, with the same projected sizes.
  assert.equal(JSON.stringify(parsed),JSON.stringify(inline));
  assert.deepEqual(parsed,JSON.parse(JSON.stringify(inline)));
  assert.deepEqual(parsed,inline);
  assert.deepEqual(documentImageDescriptors(parsed),documentImageDescriptors(inline));
  // The Commission and Council XHTML parser runs on the same thread.
  const council=JSON.parse(readFileSync(new URL('./fixtures/council-position-excerpts.json',import.meta.url),'utf8'));
  const xhtmlOptions={language:council.language,sourceUrl:council.sourceUrl,identity:{celex:council.celex},coverage:council.coverage},xhtml=Buffer.from(council.xhtml);
  assert.equal(JSON.stringify(await off.proposal('xhtml',xhtml,xhtmlOptions,{limitBytes:LIMIT})),JSON.stringify(await inlineDocumentParser.proposal('xhtml',xhtml,xhtmlOptions)));
});

test('a parsed amendment list is read from disk by the next request, by a new parser and with a different download time',async()=>{
  const directory=await makeDirectory(),thread=spy(makeThread());
  const first=parser(thread,directory);
  const one=await first.amendments(listBuffer,listOptions('2026-11-08T10:00:00.000Z'));
  assert.equal(thread.calls.length,1);await settled(first);assert.equal((await files(directory)).length,1);
  const again=await first.amendments(listBuffer,listOptions('2026-11-08T10:05:00.000Z'));
  const restarted=await parser(thread,directory).amendments(listBuffer,listOptions('2026-11-08T11:00:00.000Z'));
  assert.equal(thread.calls.length,1,'no parse after the first');
  assert.deepEqual(again,extractAmendments(listBuffer,listOptions('2026-11-08T10:05:00.000Z')));
  assert.deepEqual(restarted,extractAmendments(listBuffer,listOptions('2026-11-08T11:00:00.000Z')));
  assert.notDeepEqual(one,again,'every record carries the download time of its own request');
  assert.equal(JSON.stringify(restarted).includes('placeholder'),false);
});

test('a document context built on the parse thread answers like the inline one and survives a new instance',async()=>{
  const id=listFixture.targetDocumentId,amendmentId=id+'-AM-7',listId=listFixture.listId;
  const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+id],is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:listFixture.sourceUrl}]}]};
  const work={id:'eli/dl/doc/'+id,identifier:id,document_date:'2026-09-16',work_type:'def/ep-document-types/REPORT_PLENARY',title_dcterms:{en:'Report'},is_realized_by:[],inverse_foresees_change_of:[list]};
  const at=Date.parse('2026-10-18T10:00:00Z');
  const context=extra=>new DocumentContext({request:async()=>({payload:{data:[work]},fetchedAt:at}),readText:async()=>({status:'available',paragraphs:[],textLanguage:'en',structureStatus:'extracted',paragraphSources:[],sourceUrl:'https://data.europarl.europa.eu/distribution/doc/report_en.docx',fetchedAt:new Date(at).toISOString()}),clock:()=>at,
    download:async url=>({buffer:listBuffer,resolvedSourceUrl:url,fetchedAt:new Date(at).toISOString()}),readProposal:async()=>({status:'unresolved',items:[],gaps:[],evidence:[]}),...extra});
  const query=()=>documentContextQuery(id,new URLSearchParams({amendment:amendmentId,list:listId,'wording-lang':'en'}));
  const inline=await context().query(query());
  const directory=await makeDirectory(),thread=spy(makeThread());
  const coldParser=parser(thread,directory),cold=await context({parser:coldParser}).query(query());
  assert.deepEqual(cold,inline);assert.equal(thread.calls.length,1);
  await settled(coldParser);
  const restarted=await context({parser:parser(thread,directory)}).query(query());
  assert.deepEqual(restarted,inline);assert.equal(thread.calls.length,1,'the new instance reads the stored parse');
});

test('a proposal projection through the parse thread matches the inline reader and is cached by content',async()=>{
  const original='1. Original proposal sentence.',id='A-10-2026-0237',amendmentId=id+'-AM-40',listId=id+'-AM-037-046';
  const source={url:'https://data.europarl.europa.eu/distribution/doc/list_en.docx',fetchedAt:new Date(0).toISOString(),language:'en'};
  const variant={id:amendmentId,targetDocumentId:id,listId,language:'en',textIntegrity:'complete',authors:[],wordingSource:source,baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false},targetLabelLanguage:'en',targetLabel:'Article 1 – paragraph 1',originalText:original,proposedText:'1. Changed proposal sentence.'};
  const xml='<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Article 1</w:t></w:r></w:p><w:p><w:r><w:t>'+original+'</w:t></w:r></w:p><w:p><w:r><w:t>Article 2</w:t></w:r></w:p><w:p><w:r><w:t>Keep this source.</w:t></w:r></w:p></w:body></w:document>';
  const buffer=archive(xml);
  const work={id:'eli/dl/doc/'+id,identifier:id,document_date:'2026-09-16',work_type:'def/ep-document-types/REPORT_PLENARY',title_dcterms:{en:'Report'},is_realized_by:[]};
  const at=Date.parse('2026-10-18T10:00:00Z');
  const context=extra=>new DocumentContext({request:async()=>({payload:{data:[work]},fetchedAt:at}),readText:async()=>({status:'available',paragraphs:['AO. Original wording'],textLanguage:'en',structureStatus:'extracted',paragraphSources:[{path:'w:p[0]',ordinal:0,container:'body',containerPath:'body',segment:0,complete:true}],sourceUrl:'https://data.europarl.europa.eu/distribution/doc/report_en.docx',fetchedAt:new Date(at).toISOString()}),clock:()=>at,findAmendment:()=>variant,
    readProposal:async()=>({status:'available',celex:'52025PC0087',workId:'exact-work',language:'en',gaps:[],evidence:[],items:[{kind:'act',index:1,itemId:'exact-item',expressionId:'exact-expression',buffer,source:{url:'https://publications.europa.eu/resource/celex/52025PC0087',sha256:'a'.repeat(64),fetchedAt:new Date(at).toISOString(),stale:false,refreshError:null}}]}),...extra});
  const query=()=>documentContextQuery(id,new URLSearchParams({amendment:amendmentId,list:listId,'wording-lang':'en'}));
  const inline=await context().query({...query(),amendmentId,listId,wordingLanguage:'en'},{store:{}});
  const directory=await makeDirectory(),thread=spy(makeThread());
  const shared=parser(thread,directory),run=extra=>context({parser:shared,...extra}).query({...query(),amendmentId,listId,wordingLanguage:'en'},{store:{}});
  const cold=await run();
  assert.deepEqual(cold,inline);assert.equal(inline.placement.status,'placed');assert.equal(thread.calls.length,1);
  await settled(shared);
  assert.deepEqual(await context({parser:parser(thread,directory)}).query({...query(),amendmentId,listId,wordingLanguage:'en'},{store:{}}),inline);assert.equal(thread.calls.length,1,'the second context reads the stored parse');
});

test('a result over the reply limit is remembered on disk and in memory, and parsed again only when the content or the limit changes',async()=>{
  const directory=await makeDirectory(),thread=spy(makeThread()),buffer=archive(paragraphs(200));
  const call=(instance,input=buffer,limitBytes=1000)=>instance.proposal('proposal',input,proposalOptions,{limitBytes});
  const first=parser(thread,directory);
  await assert.rejects(call(first),error=>error instanceof RangeError&&error.message==='proposal-response-budget');
  assert.equal(thread.calls.length,1);
  await assert.rejects(call(first),/proposal-response-budget/);
  assert.equal(thread.calls.length,1,'the same instance remembers the size');
  await settled(first);
  const stored=await files(directory);assert.equal(stored.length,1);
  assert.equal((await readFile(path.join(directory,'document-parse-v1',stored[0]),'utf8')).includes('"parsed"'),false,'only the sizes are stored');
  await assert.rejects(call(parser(thread,directory)),/proposal-response-budget/);
  assert.equal(thread.calls.length,1,'a restart reads the stored size');
  // Another source, or a larger limit, is a new parse.
  await assert.rejects(call(parser(thread,directory),archive(paragraphs(201))),/proposal-response-budget/);
  assert.equal(thread.calls.length,2);
  const parsed=await call(parser(thread,directory),buffer,LIMIT);
  assert.equal(thread.calls.length,3);assert.equal(parsed.paragraphs.length,400);
});

test('changing a parser version, the record version or the source bytes invalidates a stored parse',async()=>{
  const directory=await makeDirectory(),thread=spy(makeThread()),buffer=archive(paragraphs(2));
  const fresh=async(read,versions)=>{const instance=parser(thread,directory,{versions});await read(instance);await settled(instance);};
  const read=(input=buffer)=>instance=>instance.proposal('proposal',input,proposalOptions,{limitBytes:LIMIT});
  await fresh(read());await fresh(read());
  assert.equal(thread.calls.length,1);
  await fresh(read(),{proposal:'next'});assert.equal(thread.calls.length,2);
  await fresh(read(),{record:2});assert.equal(thread.calls.length,3);
  await fresh(read(archive(paragraphs(3))));assert.equal(thread.calls.length,4);
  const list=instance=>instance.amendments(listBuffer,listOptions('2026-11-08T10:00:00.000Z'));
  await fresh(list);await fresh(list,{amendments:'next'});
  assert.equal(thread.calls.length,6);
  await fresh(list);assert.equal(thread.calls.length,6);
});

test('a damaged stored parse is replaced by a fresh one',async()=>{
  const directory=await makeDirectory(),thread=spy(makeThread()),buffer=archive(paragraphs(2));
  const read=async()=>{const instance=parser(thread,directory),value=await instance.proposal('proposal',buffer,proposalOptions,{limitBytes:LIMIT});await settled(instance);return value;};
  const expected=await read();
  const [name]=await files(directory),file=path.join(directory,'document-parse-v1',name);
  for(const damage of ['{"v":1,"rawBytes":12,"parsed":','{"v":9}','null']) {
    await writeFile(file,damage);
    assert.deepEqual(await read(),expected);
  }
  assert.equal(thread.calls.length,4);
  assert.deepEqual(await read(),expected);assert.equal(thread.calls.length,4,'the replacement is stored');
});

test('readers of one document share a single parse, and one reader leaving does not stop it',async()=>{
  const directory=await makeDirectory(),thread=spy(makeThread()),instance=parser(thread,directory),buffer=archive(paragraphs(300));
  const leaving=new AbortController();
  const stay=instance.proposal('proposal',buffer,proposalOptions,{limitBytes:LIMIT});
  const leave=instance.proposal('proposal',buffer,proposalOptions,{limitBytes:LIMIT,signal:leaving.signal});
  const reason=new Error('closed');leaving.abort(reason);
  await assert.rejects(leave,error=>error===reason);
  assert.equal((await stay).paragraphs.length,600);
  assert.equal(thread.calls.length,1);
});

test('a parse whose readers all left still finishes and is stored, but a queued one is dropped',{timeout:60_000},async()=>{
  const directory=await makeDirectory(),thread=spy(makeThread()),instance=parser(thread,directory);
  const big=archive(paragraphs(1500)),small=archive(paragraphs(2));
  const running=new AbortController(),queued=new AbortController();
  const first=instance.proposal('proposal',big,proposalOptions,{limitBytes:LIMIT,signal:running.signal});
  const second=instance.proposal('proposal',small,proposalOptions,{limitBytes:LIMIT,signal:queued.signal});
  await sleep(5);
  running.abort(new Error('closed'));queued.abort(new Error('closed'));
  await assert.rejects(first,/closed/);await assert.rejects(second,/closed/);
  for(let waited=0;(await files(directory)).length<1&&waited<20_000;waited+=50)await sleep(50);
  await settled(instance);await sleep(300);
  const stored=await files(directory);
  assert.equal(stored.length,1,'only the running parse was stored; the queued one was dropped');
  assert.equal(JSON.parse(await readFile(path.join(directory,'document-parse-v1',stored[0]),'utf8')).rawBytes>0,true);
  const calls=thread.calls.length;
  assert.equal((await instance.proposal('proposal',big,proposalOptions,{limitBytes:LIMIT})).paragraphs.length,3000);
  assert.equal(thread.calls.length,calls,'a later reader finds the finished parse');
});

test('a reader that arrives after the last one left joins a running parse but starts a new one for a dropped parse',{timeout:60_000},async()=>{
  const directory=await makeDirectory(),thread=spy(makeThread()),instance=parser(thread,directory);
  const big=archive(paragraphs(1500)),small=archive(paragraphs(2));
  const leavingBig=new AbortController(),leavingSmall=new AbortController();
  const first=instance.proposal('proposal',big,proposalOptions,{limitBytes:LIMIT,signal:leavingBig.signal});
  const second=instance.proposal('proposal',small,proposalOptions,{limitBytes:LIMIT,signal:leavingSmall.signal});
  while(![...instance.inflight.values()].some(job=>job.running))await sleep(5);
  leavingBig.abort(new Error('closed'));leavingSmall.abort(new Error('closed'));
  await assert.rejects(first,/closed/);await assert.rejects(second,/closed/);
  const started=thread.calls.length;
  const joined=instance.proposal('proposal',big,proposalOptions,{limitBytes:LIMIT});
  const again=instance.proposal('proposal',small,proposalOptions,{limitBytes:LIMIT});
  await sleep(10);
  assert.equal(thread.calls.length,started+1,'only the dropped parse was submitted again');
  assert.equal((await joined).paragraphs.length,3000);assert.equal((await again).paragraphs.length,4);
});

test('a request that has already ended starts no parse',async()=>{
  const directory=await makeDirectory(),instance=parser(makeThread(),directory),buffer=archive(paragraphs(2));
  const budget=createRequestBudget(30_000);
  budget.abort(new Error('closed'));
  await assert.rejects(runWithRequestSignal(budget.signal,()=>instance.proposal('proposal',buffer,proposalOptions,{limitBytes:LIMIT})),/closed/);
  budget.dispose();
  assert.equal((await files(directory)).length,0);
  assert.equal((await instance.proposal('proposal',buffer,proposalOptions,{limitBytes:LIMIT})).paragraphs.length,4);
});

test('a parse that exceeds the heap fails that request, the reader reports the source unavailable and the next request is served',{timeout:60_000},async()=>{
  const directory=await makeDirectory();
  const thread=makeThread({maxHeapMiB:24});
  const instance=parser(thread,directory),big=archive(paragraphs(12000));
  await assert.rejects(instance.proposal('proposal',big,proposalOptions,{limitBytes:LIMIT}),error=>error.code==='ERR_WORKER_OUT_OF_MEMORY');
  assert.equal((await files(directory)).length,0,'a failure is never stored');
  // The failure is remembered for a while, so the same bytes are not parsed again at once.
  const calls=spy(thread),again=parser(calls,directory);
  await assert.rejects(instance.proposal('proposal',big,proposalOptions,{limitBytes:LIMIT}),error=>error.code==='ERR_WORKER_OUT_OF_MEMORY');
  assert.equal(calls.calls.length,0);
  // The replacement thread serves other documents.
  assert.equal((await again.proposal('proposal',archive(paragraphs(1)),proposalOptions,{limitBytes:LIMIT})).paragraphs.length,2);
});

test('the document reader answers unavailable for a heap or time failure and keeps serving',{timeout:60_000},async()=>{
  const big=archive(paragraphs(12000)),small=archive(paragraphs(1));
  const at=Date.parse('2026-10-18T10:00:00Z'),id='A-10-2026-0237',amendmentId=id+'-AM-40',listId=id+'-AM-037-046';
  const source={url:'https://data.europarl.europa.eu/distribution/doc/list_en.docx',fetchedAt:new Date(at).toISOString(),language:'en'};
  const variant={id:amendmentId,targetDocumentId:id,listId,language:'en',textIntegrity:'complete',authors:[],wordingSource:source,baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false},targetLabelLanguage:'en',targetLabel:'Article 1 – paragraph 1',originalText:'1. Operative text of paragraph 1.',proposedText:'1. Changed.'};
  const work={id:'eli/dl/doc/'+id,identifier:id,document_date:'2026-09-16',work_type:'def/ep-document-types/REPORT_PLENARY',title_dcterms:{en:'Report'},is_realized_by:[]};
  for(const settings of [{maxHeapMiB:24},{timeoutMs:1}]) {
    const directory=await makeDirectory(),thread=makeThread(settings);
    let buffer=big;
    const context=new DocumentContext({parser:parser(thread,directory),request:async()=>({payload:{data:[work]},fetchedAt:at}),clock:()=>at,findAmendment:()=>variant,
      readText:async()=>({status:'available',paragraphs:['AO. Original wording'],textLanguage:'en',structureStatus:'extracted',paragraphSources:[{path:'w:p[0]',ordinal:0,container:'body',containerPath:'body',segment:0,complete:true}],sourceUrl:'https://data.europarl.europa.eu/distribution/doc/report_en.docx',fetchedAt:new Date(at).toISOString()}),
      readProposal:async()=>({status:'available',celex:'52025PC0087',workId:'exact-work',language:'en',gaps:[],evidence:[],items:[{kind:'act',index:1,itemId:'exact-item',expressionId:'exact-expression',buffer,source:{url:'https://publications.europa.eu/resource/celex/52025PC0087',sha256:'a'.repeat(64),fetchedAt:new Date(at).toISOString(),stale:false,refreshError:null}}]})});
    const query={...documentContextQuery(id,new URLSearchParams({amendment:amendmentId,list:listId,'wording-lang':'en'})),amendmentId,listId,wordingLanguage:'en'};
    const failed=await context.query(query,{store:{}});
    assert.equal(failed.baseline.status,'unavailable');assert.ok(failed.baseline.gaps.includes('proposal-projection-unavailable'));assert.equal(failed.proposal,null);
    assert.equal(failed.placement.reason,'proposal_baseline_unavailable');
    // The same server answers the next document, since the thread was replaced.
    buffer=small;context.cache.clear();
    if(settings.timeoutMs)continue;
    const served=await context.query({...query,amendmentId,listId},{store:{}});
    assert.equal(served.baseline.status,'available');
  }
});

test('the parse thread ends a job at its time limit and runs the queued jobs on a fresh thread',{timeout:60_000},async()=>{
  const thread=makeThread({timeoutMs:50}),input=new Uint8Array(archive(paragraphs(4000)));
  const slow=thread.run('proposal-json',{parser:'proposal',input,options:proposalOptions,limitBytes:LIMIT});
  const waiting=thread.run('proposal-json',{parser:'proposal',input,options:proposalOptions,limitBytes:LIMIT});
  await assert.rejects(slow,error=>error.code==='document_parse_timeout');
  await assert.rejects(waiting,error=>error.code==='document_parse_timeout');
  const fast=makeThread(),done=await fast.run('proposal-json',{parser:'proposal',input:new Uint8Array(archive(paragraphs(1))),options:proposalOptions,limitBytes:LIMIT});
  assert.ok(done.json);
});

test('the parse thread exists only while there is work and starts again on demand',async()=>{
  const thread=makeThread({idleMs:50}),input=()=>new Uint8Array(archive(paragraphs(1)));
  assert.equal(thread.active,false,'nothing starts at construction');
  const job=()=>thread.run('proposal-json',{parser:'proposal',input:input(),options:proposalOptions,limitBytes:LIMIT});
  assert.ok((await job()).json);
  assert.equal(thread.active,true);
  for(let waited=0;thread.active&&waited<5000;waited+=20)await sleep(20);
  assert.equal(thread.active,false,'the idle thread exits');
  assert.ok((await job()).json,'a later job starts a new thread');
});

test('stopping a running job rejects it, starts the next on a new thread and leaves no listener behind',async()=>{
  const thread=makeThread(),controller=new AbortController(),input=new Uint8Array(archive(paragraphs(4000)));
  const running=thread.run('proposal-json',{parser:'proposal',input,options:proposalOptions,limitBytes:LIMIT},{signal:controller.signal});
  const next=thread.run('proposal-json',{parser:'proposal',input:new Uint8Array(archive(paragraphs(1))),options:proposalOptions,limitBytes:LIMIT});
  await sleep(20);
  const reason=new Error('closed');controller.abort(reason);
  await assert.rejects(running,error=>error===reason);
  assert.ok((await next).json);
});

test('a full queue refuses new jobs',async()=>{
  const thread=makeThread({maxQueued:1}),input=new Uint8Array(archive(paragraphs(1500)));
  const job=()=>thread.run('proposal-json',{parser:'proposal',input,options:proposalOptions,limitBytes:LIMIT});
  const running=job(),queued=job();
  await assert.rejects(job(),error=>error.code==='document_parse_busy');
  await Promise.all([running,queued]);
});

test('failed parses are remembered for a limited time',async()=>{
  const directory=await makeDirectory();let now=0;
  const failing={calls:0,run:async()=>{failing.calls++;throw Object.assign(new Error('Document parsing exceeded its time limit.'),{code:'document_parse_timeout'});}};
  const instance=parser(failing,directory,{clock:()=>now}),buffer=archive(paragraphs(1));
  const read=()=>instance.proposal('proposal',buffer,proposalOptions,{limitBytes:LIMIT});
  await assert.rejects(read(),error=>error.code==='document_parse_timeout');
  await assert.rejects(read(),error=>error.code==='document_parse_timeout');
  assert.equal(failing.calls,1);
  now+=DOCUMENT_PARSE_LIMITS.failureTtlMs+1;
  await assert.rejects(read(),error=>error.code==='document_parse_timeout');
  assert.equal(failing.calls,2);
  // A parser rejection of bad bytes is cheap and is not remembered.
  failing.run=async()=>{failing.calls++;throw Object.assign(new Error('Invalid DOCX archive.'),{code:'source_parser_rejection'});};
  const other=()=>instance.proposal('proposal',archive(paragraphs(2)),proposalOptions,{limitBytes:LIMIT});
  await assert.rejects(other(),/Invalid DOCX/);await assert.rejects(other(),/Invalid DOCX/);
  assert.equal(failing.calls,4);
});

test('the stored parses stay within the disk budget',async()=>{
  const directory=await makeDirectory(),thread=makeThread();
  const sizing=parser(thread,directory);
  await sizing.proposal('proposal',archive(paragraphs(5)),proposalOptions,{limitBytes:LIMIT});await settled(sizing);
  const one=(await readFile(path.join(directory,'document-parse-v1',(await files(directory))[0]))).length;
  const bounded=await makeDirectory(),instance=parser(thread,bounded,{maxBytes:Math.floor(one*2.5)});
  for(const count of [5,6,7,8]){await instance.proposal('proposal',archive(paragraphs(count)),proposalOptions,{limitBytes:LIMIT});await settled(instance);}
  await instance.budget(path.join(bounded,'document-parse-v1')).work;
  assert.ok((await files(bounded)).length<=2,'older records were evicted');
  assert.ok((await files(bounded)).length>=1);
});

test('without a cache directory parsing still works and a repeated oversize result is remembered in memory',async()=>{
  const thread=spy(makeThread()),instance=new OffThreadDocumentParser({thread,directory:()=>undefined}),buffer=archive(paragraphs(200));
  await assert.rejects(instance.proposal('proposal',buffer,proposalOptions,{limitBytes:1000}),/proposal-response-budget/);
  await assert.rejects(instance.proposal('proposal',buffer,proposalOptions,{limitBytes:1000}),/proposal-response-budget/);
  assert.equal(thread.calls.length,1);
  assert.deepEqual(await instance.amendments(listBuffer,listOptions('2026-11-08T10:00:00.000Z')),extractAmendments(listBuffer,listOptions('2026-11-08T10:00:00.000Z')));
});
