import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ActivityStore} from './activity-index-store.mjs';
import {BaseSourceStore,retainBaseSelection} from './base-source-store.mjs';
import {setRetentionForwarder} from './base-source-rpc.mjs';
import {BaseSourceBackfill,backfillJobs} from './base-source-backfill.mjs';
import {runBaseBackfill,backfillContext} from './base-source-backfill-context.mjs';
import {CellarDocuments,CELLAR_DOCX_MIME,CELLAR_RDF_ACCEPT} from './cellar-documents.mjs';
import {OfficialContextSources} from './official-context.mjs';
import {createProposalBaseline} from './proposal-baseline.mjs';
import {isNativeNleReference} from './commission-proposal-native-identity.mjs';
import {RetainedInputs} from '../scripts/amendment-benchmark-retained.mjs';
import {word,p,heading,reportId,procedure,reference} from './test-support/nle-native-fixture.mjs';
const at='2026-10-30T12:00:00.000Z',celex='52026PC0510',work='http://publications.europa.eu/resource/cellar/731e787f-f4fb-11ef-b7db-01aa75ed71a1';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'backfill-nle-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const dir of ['index','corpus','cache'])await mkdir(path.join(root,dir));
 for(const name of ['index/activities-v1.sqlite','corpus/corpus-v1.sqlite']){const db=new DatabaseSync(path.join(root,name));db.exec('CREATE TABLE meta(key TEXT,value TEXT)');db.close();}
 const store=new ActivityStore(path.join(root,'writer'));store.acquire();store.set('active',1);store.set('baseBackfillListSourcesVersion',1);t.after(()=>store.close());
 const directory=path.join(root,'cache'),retention=new BaseSourceStore(path.join(directory,'base-sources-v1'));
 setRetentionForwarder(({observation,body})=>{if(observation.selection&&observation.url==='base-selection:'+observation.selection.type)observation={...observation,url:observation.url+':'+createHash('sha256').update(JSON.stringify(observation.selection.input)).digest('hex')};return retention.save(observation,body);});t.after(()=>setRetentionForwarder(null));
 const worker=new BaseSourceBackfill(store,{directory,retention,log:()=>{},downloadNative:()=>assert.fail('held native bytes fetched')});
 const context={held:q=>worker.held(q),hit:()=>worker.hits++,full:false};worker.hits=0;
 return {root,store,directory,retention,worker,context};
}
const url=id=>'https://data.europarl.europa.eu/distribution/fixture/'+id+'_en.docx';
function declaration(id,buffer){return [{id:'eli/dl/doc/'+id+'/en',language:'http://publications.europa.eu/resource/authority/language/ENG',title_alternative:{en:reference},is_embodied_by:[{id:'eli/dl/doc/'+id+'/en/docx',format:'authority/DOCX',is_exemplified_by:url(id),issued:at,byteSize:String(buffer.length)}]}];}
function listBytes(first,last){
 const cell=text=>'<w:tc>'+p(text)+'</w:tc>';
 return word(p('<A5Nr>A10-0260/2026</A5Nr>')+p(`<NumOfAM>${String(first).padStart(3,'0')}-${String(last).padStart(3,'0')}</NumOfAM>`)+p('<ReferenceNo>'+reference+'</ReferenceNo>')+Array.from({length:last-first+1},(_,n)=>p('Amendment '+(first+n),'AmNumberTabs')+p('Proposal for a decision','NormalBold')+p('<Article>Recital 1</Article>','NormalBold')+'<w:tbl><w:tr>'+cell('Text proposed by the Commission')+cell('Amendment')+'</w:tr><w:tr>'+cell('(1) Old wording.')+cell('(1) New wording.')+'</w:tr></w:tbl>').join(''));
}
test('A-10-2026-0260 / COM(2026)0510 uses real NLE native reference preparation for 41 indexed rows',async t=>{
 const f=await fixture(t),reportBytes=word(p('<NoDocSe>A10-0260/2026</NoDocSe>')+p('<DocRef>'+reference+'</DocRef>'));
 const lists=[];
 for(const [first,last] of [[1,33],[34,41]]){
  const id=reportId+`-AM-${String(first).padStart(3,'0')}-${String(last).padStart(3,'0')}`,buffer=listBytes(first,last);
  lists.push({id:'eli/dl/doc/'+id,identifier:id,targetDocumentId:reportId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+reportId],is_realized_by:declaration(id,buffer),extraction:{language:'en',amendments:Array.from({length:last-first+1},(_,n)=>({number:first+n,baseline:'commission-proposal',originalText:'(1) Old wording.',proposedText:'(1) New wording.',documentReferences:[{field:'DocRef',raw:reference}]}))},buffer});
 }
 const report={id:'eli/dl/doc/'+reportId,identifier:reportId,work_type:'def/ep-document-types/REPORT_PLENARY',inverse_created_a_realization_of:['eli/dl/proc/2026-0137'],inverse_foresees_change_of:lists.map(({buffer,extraction,...metadata})=>metadata),is_realized_by:declaration(reportId,reportBytes)};
 for(const {identifier,buffer,is_realized_by} of [...lists,{identifier:reportId,buffer:reportBytes,is_realized_by:report.is_realized_by}]){
  const manifest=is_realized_by[0].is_embodied_by[0];
  await f.retention.save({url:url(identifier),status:200,fetchedAt:at,request:{accept:'*/*',language:'en'},descriptor:{url:url(identifier),language:'en',byteSize:buffer.length,issued:manifest.issued,format:'DOCX'}},buffer);
 }
 for(const {buffer,...list} of lists)f.store.db.prepare("INSERT INTO sources(generation,key,kind,body) VALUES (1,?,'amendment-list',?)").run('amendment:list:'+list.identifier,JSON.stringify(list));
 f.worker.read=async endpoint=>{assert.equal(endpoint,'/plenary-documents/'+reportId);return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:at,payload:{data:[report]}};};
 const xml=(await readFile(new URL('./fixtures/proposal-52025PC0087.rdf',import.meta.url),'utf8')).replaceAll('52025PC0087',celex).replaceAll('COM_2025_0087','COM_2026_0510').replaceAll('COM%282025%2987','COM%282026%29510').replace('>2025</ns2:resource_legal_internal_number_year>','>2026</ns2:resource_legal_internal_number_year>').replace('>87</ns2:resource_legal_internal_number_sequential_number>','>510</ns2:resource_legal_internal_number_sequential_number>').replaceAll('procedure/2025_39','procedure/2026_137').replaceAll('/PROP_REG','/PROP_DEC');
 const act=word(heading()+p('THE COUNCIL OF THE EUROPEAN UNION,','Institutionquiagit')+p('Whereas:')+p('(1) Old wording.','ManualConsidrant')),annex=word(p('ANNEX I','Annexetitre'));
 const calls=[];
 const fetchSource=async(input,options)=>{
  calls.push({url:input,accept:options.headers.Accept});
  if(input.includes('/sparql'))return Response.json({results:{bindings:[{work:{type:'uri',value:work},celex:{type:'literal',value:celex},version:{type:'literal',value:'final'}}]}});
  if(input.endsWith('/rdf/tree/full'))return new Response(xml,{headers:{'content-type':'application/rdf+xml'}});
  if(input.endsWith('/DOC_1')||input.endsWith('/DOC_2'))return new Response(input.endsWith('/DOC_1')?act:annex,{headers:{'content-type':CELLAR_DOCX_MIME}});
  return assert.fail('unexpected fixture URL '+input);
 };
 const sources=new OfficialContextSources({directory:path.join(f.directory,'official-context-v1'),fetchSource}),documents=new CellarDocuments({directory:path.join(f.directory,'commission-proposals-v1'),sources});
 const proposal=createProposalBaseline({request:f.worker.read,documents});
 f.worker.proposal=options=>{
  assert.equal(isNativeNleReference(options.nativeReferencePair?.report),true);
  assert.equal(isNativeNleReference(options.nativeReferencePair?.list),true);
  return proposal(options);
 };
 assert.equal(lists.reduce((n,l)=>n+l.extraction.amendments.length,0),41);
 for(const list of lists){
  const job=f.worker.jobsForList(1,list).find(j=>j.kind==='proposal'&&(!j.nativeReference||j.nativeReference.listId===list.identifier&&j.nativeReference.number===(list.identifier.endsWith('034-041')?34:1)));
  assert(job);const result=await runBaseBackfill(f.context,()=>f.worker.collect(JSON.parse(JSON.stringify(job))));
  assert.equal(result.status,'available',JSON.stringify(result.gaps));assert.equal(result.evidence.find(e=>e.kind==='native-procedure').procedure,procedure);
 }
 // Existing cursor jobs from the previous implementation also reconstruct the
 // native pair from exact indexed list IDs, without a queue reset or fetch.
 assert.equal((await runBaseBackfill(f.context,()=>f.worker.collect({kind:'proposal',target:reportId,reportId,language:'en'}))).status,'available');
 f.store.set('baseBackfillSeeded',true);
 f.store.db.prepare("INSERT INTO base_backfill_jobs(key,target,body,state,reason) VALUES (?,?,?,'unresolved',?)").run('old-nle',reportId,JSON.stringify({kind:'proposal',target:reportId,reportId,language:'en'}),JSON.stringify(['native-nle-report-reference-unavailable']));
 assert.equal(f.worker.due(),true);await f.worker.step();
 assert.equal(f.store.db.prepare("SELECT state FROM base_backfill_jobs WHERE key='old-nle'").get().state,'skipped-held');
 assert.equal(f.worker.due(),false);
 const reader=await RetainedInputs.open(f.root);t.after(()=>reader.close());
 for(const call of calls){const value=await reader.get(call.url,{accept:call.accept,...(call.accept===CELLAR_DOCX_MIME?{language:'eng'}:{})});assert.equal(value.ok,true,call.url);}
 assert.equal(calls.filter(c=>c.url.includes('/sparql')).length,1);
 assert.equal(calls.filter(c=>c.accept===CELLAR_RDF_ACCEPT).length,1);
 assert.equal(calls.filter(c=>c.accept===CELLAR_DOCX_MIME).length,2);
});
test('full canonical selection input distinguishes request variants without inventing ambiguity',async t=>{
 const f=await fixture(t),id='A-10-2026-0202',decision={status:'available',celex:'52025PC0990',workId:work,items:[],gaps:[]};
 const plain={reportId:id,celex:undefined,language:'en',documentReferences:[]},referenced={...plain,documentReferences:[{field:'DocRef',raw:'COM(2025)0990'}]};
 for(const input of [plain,referenced])await retainBaseSelection('proposal',input,decision,{directory:f.directory});
 let calls=0;f.worker.proposal=input=>{calls++;assert.equal(backfillContext().selection.workId,work);assert.deepEqual(input.documentReferences,(calls===1?plain:referenced).documentReferences);return decision;};
 for(const input of [plain,referenced])assert.equal((await runBaseBackfill(f.context,()=>f.worker.collect({kind:'proposal',target:id,...input}))).status,'available');
 assert.equal(calls,2);
 // Same canonical input in another property order is the same request. Two
 // such observations conflict only if they actually select different works.
 const aliasInput={documentReferences:[],language:'en',reportId:id};
 const observation={url:'base-selection:proposal:legacy-order',status:200,fetchedAt:at,request:{accept:'application/json'},selection:{type:'proposal',input:aliasInput}};
 await f.retention.save(observation,Buffer.from(JSON.stringify(decision)));
 calls=0;assert.equal((await runBaseBackfill(f.context,()=>f.worker.collect({kind:'proposal',target:id,...plain}))).status,'available');
 await f.retention.save(observation,Buffer.from(JSON.stringify({...decision,workId:work.replace('731e787f','731e7880')})));
 assert.deepEqual((await runBaseBackfill(f.context,()=>f.worker.collect({kind:'proposal',target:id,...plain}))).gaps,['conflicting-retained-selection']);
});
