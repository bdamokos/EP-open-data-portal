import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ActivityStore} from './activity-index-store.mjs';
import {DocumentContext} from './document-context.mjs';
import {retainedDocumentContext} from './document-context-index.mjs';
import {requestTimeout} from './request-budget.mjs';
import {documentText} from './document-text.mjs';

const now=Date.parse('2026-10-29T01:30:00Z'),stamp=new Date(now).toISOString();
const motion='B-10-2026-0339',adopted='TA-10-2026-0271',motionKey='/plenary-documents/'+motion,adoptedKey='/adopted-texts/'+adopted;
// Synthetic metadata uses the exact public identifier shapes; no runtime cache.
const root={id:'eli/dl/doc/'+motion,identifier:motion,work_type:'def/ep-document-types/RESOLUTION_MOTION',inverse_created_a_realization_of:['eli/dl/proc/2026-0001']};
const work=(extra={})=>({id:'eli/dl/doc/'+adopted,identifier:adopted,work_type:'def/ep-document-types/TEXT_ADOPTED',parliamentary_term:'org/ep-10',title_dcterms:{en:'Retained adoption'},document_date:null,adoptionProjectionVersion:1,adopts:['eli/dl/doc/'+motion],languageVersionsObserved:true,is_realized_by:[{language:'en',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/fixture/adopted_en.docx'}]}],...extra});
const query=(extra={})=>({id:motion,language:'en',adopted:true,includeBody:true,...extra});
const limits={adoptedCandidates:8,metadataBytes:16*1024*1024};
function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'context-index-'));
  const store=new ActivityStore(directory,{clock:()=>now});store.acquire();const first=store.beginCycle();
  store.putSource(first.generation,motionKey,'document',root,stamp);store.publish(first.generation);
  const cycle=store.beginCycle();store.putSource(cycle.generation,adoptedKey,'document',work(),stamp);
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,generation:cycle.generation,active:first.generation};
}

for(const [id,type] of [['A-10-2026-0257','REPORT_PLENARY'],[motion,'RESOLUTION_MOTION'],['RC-10-2026-0476','RESOLUTION_MOTION_JOINT']])test('an exact indexed amendment reads retained '+type+' metadata without waiting on upstream',async t=>{
  const {store,generation}=setup(t),endpoint='/plenary-documents/'+id,listId=id+'-AM-001-163',amendmentId=id+'-AM-86';
  const metadata={...work(),id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/'+type,adopts:undefined,amendmentLinksVersion:3,inverse_foresees_change_of:['eli/dl/doc/'+listId]};
  store.putSource(generation,endpoint,'document',metadata,stamp);
  const indexed={id:amendmentId,targetDocumentId:id,listId,language:'en',textIntegrity:'complete',originalText:'Old source paragraph.',proposedText:'Amended paragraph.',gaps:[],sourceFreshness:{status:'fresh'}};
  const selected=query({id,adopted:false,amendmentId,listId});let requests=0;
  const body={status:'available',paragraphs:['1. Old source paragraph.'],textLanguage:'en',fetchedAt:stamp};
  const reader=new DocumentContext({findAmendment:()=>indexed,request:async()=>{requests++;throw Error('Cold upstream metadata must not block retained context');},readText:async observed=>{assert.deepEqual(observed,JSON.parse(JSON.stringify(metadata)));return body;}});
  const before=store.db.prepare('SELECT total_changes() n').get().n;
  const result=await reader.query(selected,{store});
  assert.equal(requests,0);assert.deepEqual(result.document.selectedText,body);
  assert.equal(result.amendment.basis,'index');assert.equal(result.amendment.variants[0].originalText,indexed.originalText);
  assert.equal(result.sources[0].representation,'retained-index-projection');assert.equal(result.sources[0].fetchedAt,stamp);
  assert.equal(result.sources[0].generation,generation);assert.equal(result.sources[0].epoch,store.get('marksEpoch'));
  assert.equal(result.document.sourceCache.stale,true);assert.equal(reader.cache.size,0);
  assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
  const control=new DocumentContext({findAmendment:()=>indexed,request:async()=>({payload:{data:[metadata]},fetchedAt:stamp}),readText:async()=>body});
  const original=await control.query(selected,{store:{}});
  assert.deepEqual(result.target,original.target);assert.deepEqual(result.placement,original.placement);
});

for(const missing of ['no-amendment','wrong-amendment','wrong-target','wrong-list','unknown-edition','competing-edition','wrong-term'])test('ordinary source recovery remains for retained report context: '+missing,async t=>{
  const {store,generation}=setup(t),id='A-10-2026-0257',endpoint='/plenary-documents/'+id,listId=id+'-AM-001-163',amendmentId=id+'-AM-86';
  const metadata={...work(),id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/REPORT_PLENARY',adopts:undefined,amendmentLinksVersion:3,inverse_foresees_change_of:[]};
  const saved=structuredClone(metadata);
  if(missing==='unknown-edition')saved.languageVersionsObserved=false;
  if(missing==='competing-edition')saved.is_realized_by[0].is_embodied_by.push({...saved.is_realized_by[0].is_embodied_by[0],is_exemplified_by:'https://data.europarl.europa.eu/distribution/fixture/competing.docx'});
  if(missing==='wrong-term')saved.parliamentary_term='org/ep-9';
  store.putSource(generation,endpoint,'document',saved,stamp);
  const indexed={id:missing==='wrong-amendment'?id+'-AM-87':amendmentId,targetDocumentId:missing==='wrong-target'?'A-10-2026-0258':id,listId,language:'en',textIntegrity:'complete',originalText:'Old paragraph',proposedText:'New paragraph',gaps:[]};
  if(missing==='wrong-list')indexed.listId=id+'-AM-164-166';
  let requests=0;
  const reader=new DocumentContext({findAmendment:()=>missing==='no-amendment'?null:indexed,request:async route=>{requests++;assert.equal(route,endpoint);return {payload:{data:[metadata]},fetchedAt:stamp};},readText:async observed=>{assert.deepEqual(observed,metadata);return {status:'available',paragraphs:['Source body'],textLanguage:'en'};}});
  const result=await reader.query(query({id,adopted:false,amendmentId,listId}),{store});
  assert.equal(requests,1);assert.equal(result.sources[0].representation,undefined);
});

test('a missing retained report file still checks fresh metadata and opens only its changed exact edition',async t=>{
  const {store,generation}=setup(t),id='A-10-2026-0257',endpoint='/plenary-documents/'+id,listId=id+'-AM-001-163',amendmentId=id+'-AM-86';
  const metadata={...work(),id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/REPORT_PLENARY',adopts:undefined};
  store.putSource(generation,endpoint,'document',metadata,stamp);
  const fresh=structuredClone(metadata);fresh.is_realized_by[0].is_embodied_by[0].is_exemplified_by='https://data.europarl.europa.eu/distribution/fixture/replaced_en.docx';
  const indexed={id:amendmentId,targetDocumentId:id,listId,language:'en',textIntegrity:'complete',originalText:'Old paragraph',proposedText:'New paragraph',gaps:[]};
  let requests=0,bodies=0;
  const reader=new DocumentContext({findAmendment:()=>indexed,request:async route=>{requests++;assert.equal(route,endpoint);return {payload:{data:[fresh]},fetchedAt:stamp};},readText:async observed=>{bodies++;return observed.is_realized_by[0].is_embodied_by[0].is_exemplified_by.endsWith('replaced_en.docx')?{status:'available',paragraphs:['Recovered body'],textLanguage:'en'}:{status:'unavailable',paragraphs:[]};}});
  const result=await reader.query(query({id,adopted:false,amendmentId,listId}),{store});
  assert.equal(requests,1);assert.equal(bodies,2);assert.deepEqual(result.document.selectedText.paragraphs,['Recovered body']);
  assert.equal(store.source(generation,endpoint).fetchedAt,stamp);assert.deepEqual(store.source(generation,endpoint).work,JSON.parse(JSON.stringify(metadata)));
});

for(const change of ['issued','byteSize','both'])test('real text-cache recovery retries a changed report edition at the same URL: '+change,async t=>{
  const {store,generation}=setup(t),id='A-10-2026-0257',endpoint='/plenary-documents/'+id,listId=id+'-AM-001-163',amendmentId=id+'-AM-86';
  const url='https://data.europarl.europa.eu/distribution/fixture/recovery-'+change+'.docx';
  const metadata={...work(),id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/REPORT_PLENARY',adopts:undefined,
    is_realized_by:[{language:'en',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:url,issued:'2026-10-01T10:00:00Z',byteSize:100}]}]};
  store.putSource(generation,endpoint,'document',metadata,stamp);
  const fresh=structuredClone(metadata),edition=fresh.is_realized_by[0].is_embodied_by[0];
  if(change!=='byteSize')edition.issued=stamp;
  if(change!=='issued')edition.byteSize=200;
  const indexed={id:amendmentId,targetDocumentId:id,listId,language:'en',textIntegrity:'complete',originalText:'Old paragraph',proposedText:'New paragraph',gaps:[]};
  let requests=0,downloads=0;
  const reader=new DocumentContext({findAmendment:()=>indexed,request:async route=>{assert.equal(route,endpoint);requests++;return {payload:{data:[fresh]},fetchedAt:stamp};},
    readText:(observed,language)=>documentText(observed,language,{directory:null,clock:()=>now,download:async()=>{downloads++;if(!requests)throw Error('Original edition is unavailable');return {paragraphs:['Recovered body']};}})});
  const before=store.source(generation,endpoint);
  const result=await reader.query(query({id,adopted:false,amendmentId,listId,wordingLanguage:'en'}),{store});
  assert.equal(requests,1);assert.equal(downloads,2);assert.equal(result.document.selectedText.status,'available');
  assert.deepEqual(result.document.selectedText.paragraphs,['Recovered body']);assert.deepEqual(result.document.selectedText.sourceVersion,{byteSize:edition.byteSize,issued:edition.issued});
  assert.deepEqual(store.source(generation,endpoint),before);assert.equal(reader.cache.size,0);
});

for(const embedded of [false,true])test('a recovered report root drives exact list discovery and body/wording language fallback: '+(embedded?'expanded list':'linked list'),async t=>{
  const {store,generation}=setup(t),id='A-10-2026-0257',endpoint='/plenary-documents/'+id,listId=id+'-AM-001-163',amendmentId=id+'-AM-86';
  const file=language=>({language,is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/fixture/recovered-root_'+language+'.docx'}]});
  const metadata={...work(),id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/REPORT_PLENARY',adopts:undefined,amendmentLinksVersion:3,inverse_foresees_change_of:[],is_realized_by:[file('en')]};
  const fresh={...metadata,inverse_foresees_change_of:['eli/dl/doc/'+listId],is_realized_by:[file('fr')]};
  const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:'eli/dl/doc/'+id,is_realized_by:[file('fr')]};
  if(embedded)fresh.inverse_foresees_change_of=[list];
  store.putSource(generation,endpoint,'document',metadata,stamp);
  const indexed={id:amendmentId,targetDocumentId:id,listId,language:'en',textIntegrity:'complete',originalText:'English paragraph.',proposedText:'Changed paragraph.',baseline:'motion-resolution',gaps:[]};
  const paragraphs=['Le Parlement européen,','1. Texte original;','2. Suite;'];
  const text={status:'available',textLanguage:'fr',availableTextLanguages:['fr'],paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))};
  const selected=query({id,adopted:false,amendmentId,listId,wordingLanguage:'en'}),results=[];
  for(const retained of [true,false]) {
    const requests=[],bodyRoots=[];
    const reader=new DocumentContext({findAmendment:()=>indexed,request:async route=>{requests.push(route);assert([endpoint,'/documents/'+listId].includes(route));return {payload:{data:[route===endpoint?fresh:list]},fetchedAt:stamp};},
      readText:async observed=>{bodyRoots.push(observed);return observed.is_realized_by[0].language==='en'?{status:'error',paragraphs:[],textLanguage:'en',availableTextLanguages:['en']}:text;}});
    reader.readList=async(_list,file)=>({source:{url:file.url,language:'fr',fetchedAt:stamp},extraction:{amendments:[{number:86,originalText:'1. Texte original;',proposedText:'1. Texte modifié;',targetLabel:'Paragraphe 1',authors:[],baseline:'motion-resolution'}]}});
    const result=await reader.query(selected,{store:retained?store:{}});results.push(result);
    assert.deepEqual(requests,embedded?[endpoint]:[endpoint,'/documents/'+listId]);assert.deepEqual(bodyRoots.at(-1),fresh);
    assert.equal(result.document.selectedText.textLanguage,'fr');assert.equal(result.wordingLanguageFallback.language,'fr');
    assert.equal(result.target.status,'found');assert.equal(result.placement.status,'placed');
    const variant=result.amendment.variants.find(row=>row.language==='fr');
    const expectedSource=embedded?result.sources[retained?1:0]:result.sources.find(source=>source.url.endsWith('/documents/'+listId));
    assert.deepEqual(variant.metadataSource,expectedSource);
    assert.equal(Object.hasOwn(variant.metadataSource,'epoch'),false);assert.equal(Object.hasOwn(variant.metadataSource,'generation'),false);
    if(retained){assert.equal(result.sources[0].representation,'retained-index-projection');assert.equal(result.sources[0].epoch,store.get('marksEpoch'));assert.equal(result.sources[0].generation,generation);assert.equal(reader.cache.size,0);}
  }
  assert.deepEqual(results[0].target,results[1].target);assert.deepEqual(results[0].placement,results[1].placement);
  assert.deepEqual(results[0].amendment.variants.find(row=>row.language==='fr').metadataSource,results[1].amendment.variants.find(row=>row.language==='fr').metadataSource);
  assert.deepEqual(store.source(generation,endpoint).work,JSON.parse(JSON.stringify(metadata)));
});

for(const conflict of ['identity','type','term'])test('retained report body recovery rejects conflicting fresh '+conflict,async t=>{
  const {store,generation}=setup(t),id='A-10-2026-0257',endpoint='/plenary-documents/'+id,listId=id+'-AM-001-163',amendmentId=id+'-AM-86';
  const metadata={...work(),id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/REPORT_PLENARY',adopts:undefined};
  store.putSource(generation,endpoint,'document',metadata,stamp);const before=store.source(generation,endpoint);
  const fresh=structuredClone(metadata);fresh.is_realized_by[0].is_embodied_by[0].is_exemplified_by='https://data.europarl.europa.eu/distribution/fixture/replaced_en.docx';
  if(conflict==='identity')fresh.identifier='A-10-2026-0258';
  if(conflict==='type')fresh.work_type='def/ep-document-types/TEXT_ADOPTED';
  if(conflict==='term')fresh.parliamentary_term='org/ep-9';
  let bodies=0;
  const reader=new DocumentContext({findAmendment:()=>({id:amendmentId,targetDocumentId:id,listId,language:'en'}),request:async()=>({payload:{data:[fresh]},fetchedAt:stamp}),readText:async()=>{bodies++;return {status:'unavailable',paragraphs:[]};}});
  const result=await reader.query(query({id,adopted:false,amendmentId,listId}),{store});
  assert.equal(bodies,1);assert.equal(result.document.selectedDocumentId,id);assert.equal(result.document.selectedText.status,'unavailable');
  assert(result.document.sourceCache.refreshError);assert.deepEqual(store.source(generation,endpoint),before);
});

test('a different selected wording language still discovers newly published body languages without changing the requested body',async t=>{
  const {store,generation}=setup(t),id='A-10-2026-0257',endpoint='/plenary-documents/'+id,listId=id+'-AM-001-163',amendmentId=id+'-AM-86';
  const metadata={...work(),id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/REPORT_PLENARY',adopts:undefined};
  store.putSource(generation,endpoint,'document',metadata,stamp);
  const fresh=structuredClone(metadata);fresh.is_realized_by.push({language:'hu',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/fixture/report_hu.docx'}]});
  const indexed={id:amendmentId,targetDocumentId:id,listId,language:'hu',textIntegrity:'complete',originalText:'Régi bekezdés.',proposedText:'Új bekezdés.',gaps:[],sourceFreshness:{status:'fresh'}};
  let requests=0;
  const reader=new DocumentContext({findAmendment:()=>indexed,request:async route=>{requests++;assert.equal(route,endpoint);return {payload:{data:[fresh]},fetchedAt:stamp};},readText:async(observed,language)=>{
    const hu=language==='hu'&&observed.is_realized_by.some(expression=>expression.language==='hu');
    return {status:'available',paragraphs:[hu?'Régi bekezdés.':'English paragraph.'],textLanguage:hu?'hu':'en',availableTextLanguages:observed.is_realized_by.map(expression=>expression.language)};
  }});
  const result=await reader.query(query({id,adopted:false,amendmentId,listId,wordingLanguage:'hu'}),{store});
  assert.equal(requests,1);assert.equal(result.sources[0].representation,undefined);
  assert.equal(result.document.selectedText.textLanguage,'en');assert.deepEqual(result.document.selectedText.availableTextLanguages,['en','hu']);
  assert.equal(result.target.evidence.wordingLanguage,'hu');assert.equal(result.wordingLanguageFallback,null);
});

test('an explicitly pinned matching language can reuse metadata from a multilingual indexed list',async t=>{
  const {store,generation}=setup(t),id='A-10-2026-0257',endpoint='/plenary-documents/'+id,listId=id+'-AM-001-163',amendmentId=id+'-AM-86';
  store.putSource(generation,endpoint,'document',{...work(),id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/REPORT_PLENARY',adopts:undefined},stamp);
  const variant={listId,textIntegrity:'complete',originalText:'Old paragraph',proposedText:'New paragraph',gaps:[],sourceFreshness:{status:'fresh'}};
  const indexed={id:amendmentId,targetDocumentId:id,variants:[{...variant,language:'en'},{...variant,language:'hu'}]};
  const reader=new DocumentContext({findAmendment:()=>indexed,request:async()=>assert.fail('Pinned matching language needs no metadata request'),readText:async()=>({status:'available',paragraphs:['Old paragraph'],textLanguage:'en'})});
  const result=await reader.query(query({id,adopted:false,amendmentId,listId,wordingLanguage:'en'}),{store});
  assert.equal(result.sources[0].representation,'retained-index-projection');assert.equal(result.document.selectedText.textLanguage,'en');
});

test('exact retained adoption choices avoid source requests and body reads while keeping coverage partial and provenance explicit',async t=>{
  const {store,generation,active}=setup(t);let requests=0,bodies=0;
  const reader=new DocumentContext({request:async()=>{requests++;throw Error('Source unavailable');},readText:async()=>{bodies++;throw Error('Body remains lazy');}});
  const before=store.db.prepare('SELECT total_changes() n').get().n;
  const result=await reader.query(query(),{store});
  assert.equal(requests,0);assert.equal(bodies,0);assert.equal(result.document,null);
  assert.equal(result.related.status,'partial');assert.deepEqual(result.related.gaps,['adopted-discovery-incomplete']);
  assert.equal(result.related.items[0].id,adopted);assert.equal(result.related.items[0].date,null);
  assert.deepEqual(result.related.items[0].relationship,{from:adopted,field:'adopts',to:motion});
  const source=result.related.items[0].source;
  assert.equal(source.fetchedAt,stamp);assert.equal(source.generation,generation);assert.equal(source.representation,'retained-index-projection');assert.equal(source.stale,true);
  const epoch=store.get('marksEpoch');assert.match(epoch,/^[0-9a-f-]{36}$/i);
  assert.equal(source.epoch,epoch);assert(result.sources.every(source=>source.epoch===epoch),'root and related observations retain the database epoch');
  assert.equal(source.contentHash,createHash('sha256').update(JSON.stringify({data:[work()]})).digest('hex'));
  assert.equal(reader.cache.size,0,'retained partial discovery receives no fresh computed TTL');
  assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(store.get('active'),active);assert.equal(store.db.isTransaction,false);
});

test('opening the exact adopted body reuses its retained metadata without switching distributions or document identity',async t=>{
  const {store,generation}=setup(t),calls=[];
  const reader=new DocumentContext({request:async()=>{throw Error('Metadata must not refetch');},readText:async(observation,language)=>{
    calls.push({observation,language});return {status:'available',paragraphs:['Retained file text'],textLanguage:language};
  }});
  const result=await reader.query(query({id:adopted,adopted:false}),{store});
  assert.equal(result.document.selectedDocumentId,adopted);assert.equal(result.document.selectedDocumentDate,null);
  assert.equal(result.document.sourceCache.stale,true);assert.equal(result.sources[0].generation,generation);
  assert.equal(calls.length,1);assert.deepEqual(calls[0],{observation:work(),language:'en'});assert.equal(reader.cache.size,0);
});

test('missing or unverified retained adoption relationships keep ordinary exact procedure discovery',async t=>{
  const {store,generation}=setup(t),calls=[];
  store.putSource(generation,adoptedKey,'document',work({adopts:null}),stamp);
  const reader=new DocumentContext({request:async endpoint=>{
    calls.push(endpoint);
    const data=endpoint===motionKey?root:endpoint.startsWith('/procedures/')?{id:'eli/dl/proc/2026-0001',created_a_realization_of:['eli/dl/doc/'+adopted]}:work({adopts:null});
    return {payload:{data:[data]},fetchedAt:stamp};
  }});
  const result=await reader.query(query(),{store});
  assert.equal(calls.length,3);assert.equal(result.related.status,'unavailable');assert.equal(result.related.items.length,0);
  assert(result.related.gaps.includes('adopted-reciprocal-relationship-unavailable'));
  const direct=retainedDocumentContext(store,query({id:adopted,adopted:false}),limits);assert(direct,'missing adopts does not invalidate this exact text body');
});

test('candidate validation rejects conflicting identity, type, term, target and invalid retrieval date',t=>{
  const {store,generation}=setup(t);
  for(const patch of [{identifier:'TA-10-2026-0272'},{id:'eli/dl/doc/TA-10-2026-0272'},{work_type:'def/ep-document-types/REPORT_PLENARY'},{work_type:'https://other.example/TEXT_ADOPTED'},{work_type:'TEXT_ADOPTED'},{parliamentary_term:'org/ep-9'},{adopts:['eli/dl/doc/B-10-2026-0340']},{adopts:null},{}]) {
    store.putSource(generation,adoptedKey,'document',work(patch),Object.keys(patch).length?stamp:'invalid');
    assert.equal(retainedDocumentContext(store,query(),limits),null,JSON.stringify(patch));
  }
});

for(const patch of [{languageVersionsObserved:false,is_realized_by:[]},{is_realized_by:[]},{is_realized_by:[{language:'fr',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/fixture/adopted_fr.docx'}]}]},
  {is_realized_by:[{language:'en',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:'https://other.example/adopted.docx'}]}]},
  {is_realized_by:[{language:'en',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/fixture/adopted_en.docx'},{format:'authority/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/fixture/competing_en.docx'}]}]},
])test('incomplete selected-edition metadata recovers through the ordinary source read: '+JSON.stringify(patch),async t=>{
  const {store,generation}=setup(t);let requests=0;
  store.putSource(generation,adoptedKey,'document',work(patch),stamp);
  const reader=new DocumentContext({request:async endpoint=>{requests++;assert.equal(endpoint,adoptedKey);return {payload:{data:[work()]},fetchedAt:stamp};},readText:async observed=>{
    assert.deepEqual(observed.is_realized_by,work().is_realized_by);return {status:'available',paragraphs:['Recovered selected edition'],textLanguage:'en'};
  }});
  const result=await reader.query(query({id:adopted,adopted:false}),{store});assert.equal(requests,1);assert.equal(result.document.selectedText.status,'available');
  assert.equal(result.sources[0].representation,undefined);
});

test('retained discovery bounds candidates and metadata without treating the retained set as complete',async t=>{
  const {store,generation}=setup(t),second='TA-10-2026-0272';
  store.putSource(generation,'/adopted-texts/'+second,'document',work({id:'eli/dl/doc/'+second,identifier:second}),stamp);
  const reader=new DocumentContext({limits:{adoptedCandidates:1},request:async()=>{throw Error('No request');}});
  const result=await reader.query(query(),{store});assert.equal(result.related.items.length,1);assert.equal(result.related.status,'partial');assert(result.related.gaps.includes('adopted-candidate-budget'));
  const bounded=new DocumentContext({limits:{metadataBytes:100},request:async()=>{throw Error('No request');}});
  await assert.rejects(bounded.query(query(),{store}),{code:'document_source_budget'});assert.equal(store.db.isTransaction,false);
});

test('a changed retained observation gets its own pending read and is copied before asynchronous body work',async t=>{
  const {store,generation}=setup(t);let release,started;
  const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});let bodies=0;
  const reader=new DocumentContext({request:async()=>{throw Error('No request');},readText:async observation=>{
    const call=++bodies;if(call===1){started();await gate;}assert.equal(store.db.isTransaction,false);
    return {status:'available',paragraphs:[observation.title_dcterms.en],textLanguage:'en'};
  }});
  const first=reader.query(query({id:adopted,adopted:false}),{store});await entered;
  store.putSource(generation,adoptedKey,'document',work({title_dcterms:{en:'New retained observation'}}),stamp);
  const second=await reader.query(query({id:adopted,adopted:false}),{store});release();const original=await first;
  assert.equal(bodies,2);assert.deepEqual(original.document.selectedText.paragraphs,['Retained adoption']);assert.deepEqual(second.document.selectedText.paragraphs,['New retained observation']);
  assert.notEqual(original.sources[0].contentHash,second.sources[0].contentHash);
});

test('equal retained generations in rebuilt stores do not share a pending body across database epochs',async t=>{
  const initial=setup(t),rebuilt=setup(t);let release,started,bodies=0;
  assert.equal(initial.generation,rebuilt.generation);assert.notEqual(initial.store.get('marksEpoch'),rebuilt.store.get('marksEpoch'));
  const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
  const reader=new DocumentContext({request:async()=>{throw Error('No request');},readText:async()=>{
    if(++bodies===1){started();await gate;}return {status:'available',paragraphs:['Retained body'],textLanguage:'en'};
  }});
  const first=reader.query(query({id:adopted,adopted:false}),{store:initial.store});await entered;
  const second=reader.query(query({id:adopted,adopted:false}),{store:rebuilt.store});
  await new Promise(resolve=>setImmediate(resolve));release();const [before,after]=await Promise.all([first,second]);
  assert.equal(bodies,2);assert.equal(before.sources[0].epoch,initial.store.get('marksEpoch'));assert.equal(after.sources[0].epoch,rebuilt.store.get('marksEpoch'));
});

test('new working metadata leads older extension metadata without mixing generations or reviving an invalid new root',t=>{
  const {store,generation,active}=setup(t);store.set('amendmentSnapshotGeneration',active);
  assert.equal(retainedDocumentContext(store,query(),limits).root.source.generation,generation);
  store.putSource(generation,motionKey,'document',{...root,identifier:'B-10-2026-0340'},stamp);
  assert.equal(retainedDocumentContext(store,query(),limits),null);
});

test('a failed later refresh keeps the retained body metadata and its error without changing any retry owner',async t=>{
  const {store,generation}=setup(t);
  store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,adoptedKey,'document',JSON.stringify({endpoint:adoptedKey}),101,'EP API returned 500',5,stamp,now+86_400_000,null);
  const before=store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=? AND key=?').get(generation,adoptedKey);
  const reader=new DocumentContext({request:async()=>{throw Error('No request');},readText:async()=>({status:'available',paragraphs:['Retained file'],textLanguage:'en'})});
  const result=await reader.query(query({id:adopted,adopted:false}),{store});
  assert.equal(result.document.sourceCache.refreshError,'EP API returned 500');assert.equal(result.sources[0].refreshError,'EP API returned 500');
  assert.deepEqual(store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=? AND key=?').get(generation,adoptedKey),before);
});

for(const status of ['error','unavailable'])test('a failed retained body gets one metadata recovery and uses the changed declared file: '+status,async t=>{
  const {store}=setup(t),replacement=work({is_realized_by:[{language:'en',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/fixture/replacement_en.docx'}]}]});
  let requests=0;const bodies=[];
  const reader=new DocumentContext({request:async endpoint=>{requests++;assert.equal(endpoint,adoptedKey);return {payload:{data:[replacement]},fetchedAt:stamp};},readText:async observed=>{
    bodies.push(observed);return {status:bodies.length===1?status:'available',paragraphs:bodies.length===1?[]:['Replacement body'],textLanguage:'en'};
  }});
  const result=await reader.query(query({id:adopted,adopted:false}),{store});
  assert.equal(requests,1);assert.equal(bodies.length,2);assert.deepEqual(bodies[1],replacement);assert.equal(result.document.selectedText.status,'available');
  assert.equal(result.document.selectedDocumentId,adopted);assert.equal(result.sources.length,2);assert.equal(result.sources[0].representation,'retained-index-projection');assert.equal(result.sources[1].representation,undefined);
});

test('unchanged metadata does not repeat the failed distribution; failed metadata keeps the retained identity and body result',async t=>{
  const {store}=setup(t);
  for(const scenario of [{},{failure:new Error('Metadata source unavailable')},{extraLanguage:true}]) {
    const {failure}=scenario;
    let requests=0,bodies=0;
    const updated=work();if(scenario.extraLanguage)updated.is_realized_by.push({language:'fr',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/fixture/new_fr.docx'}]});
    const reader=new DocumentContext({request:async()=>{requests++;if(failure)throw failure;return {payload:{data:[updated]},fetchedAt:stamp};},readText:async()=>{bodies++;return {status:'error',paragraphs:[],textLanguage:'en'};}});
    const result=await reader.query(query({id:adopted,adopted:false}),{store});
    assert.equal(requests,1);assert.equal(bodies,1);assert.equal(result.document.selectedDocumentId,adopted);assert.equal(result.document.selectedText.status,'error');assert.equal(reader.cache.size,0);
    if(failure)assert.equal(result.document.sourceCache.refreshError,failure.message);
  }
});

test('a changed selected source version can recover a stable declared URL',async t=>{
  const {store}=setup(t),updated=work();updated.is_realized_by[0].is_embodied_by[0].issued=stamp;let bodies=0;
  const reader=new DocumentContext({request:async()=>({payload:{data:[updated]},fetchedAt:stamp}),readText:async observation=>{
    bodies++;return {status:observation.is_realized_by[0].is_embodied_by[0].issued?'available':'error',paragraphs:[],textLanguage:'en'};
  }});
  const result=await reader.query(query({id:adopted,adopted:false}),{store});assert.equal(bodies,2);assert.equal(result.document.selectedText.status,'available');
});

test('retained-body metadata recovery preserves typed cancellation and exact source identity checks',async t=>{
  const {store}=setup(t);
  const timeout=new DocumentContext({request:async()=>{throw requestTimeout();},readText:async()=>({status:'unavailable',paragraphs:[]})});
  await assert.rejects(timeout.query(query({id:adopted,adopted:false}),{store}),{code:'request_timeout'});
  for(const invalid of [work({id:'eli/dl/doc/TA-10-2026-9999',identifier:'TA-10-2026-9999'}),work({parliamentary_term:'org/ep-9',is_realized_by:[{language:'en',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/fixture/conflicting_en.docx'}]}]})]) {
    let bodies=0;
    const wrong=new DocumentContext({request:async()=>({payload:{data:[invalid]},fetchedAt:stamp}),readText:async()=>{bodies++;return {status:'error',paragraphs:[]};}});
    const result=await wrong.query(query({id:adopted,adopted:false}),{store});assert.equal(bodies,1);assert.equal(result.document.selectedDocumentId,adopted);assert.equal(result.document.selectedText.status,'error');assert(result.document.sourceCache.refreshError);
  }
});
