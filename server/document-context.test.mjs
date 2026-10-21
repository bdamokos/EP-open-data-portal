import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {DocumentContext,documentContextQuery} from './document-context.mjs';
import {documentText} from './document-text.mjs';
import {HttpError} from './http-utils.mjs';
import {createRequestBudget,runWithRequestSignal,requestTimeout} from './request-budget.mjs';

const id='A-10-2026-0237',amendmentId=id+'-AM-40',listId=id+'-AM-037-046',ta='TA-10-2026-0339';
const at=Date.parse('2026-10-18T10:00:00Z');
const work={id:'eli/dl/doc/'+id,identifier:id,document_date:'2026-09-16',work_type:'def/ep-document-types/REPORT_PLENARY',title_dcterms:{en:'EU–China political relations'},is_realized_by:[]};
const summary={status:'available',paragraphs:['AO. Original wording'],textLanguage:'en',structureStatus:'extracted',paragraphSources:[{path:'w:p[0]',ordinal:0,container:'body',containerPath:'body',segment:0,complete:true}],sourceUrl:'https://data.europarl.europa.eu/distribution/doc/report_en.docx',fetchedAt:new Date(at).toISOString()};
const record=node=>({payload:{data:[node]},fetchedAt:at});
const query=(extra={})=>({...documentContextQuery(id,new URLSearchParams()),...extra});
const service=(extra={})=>new DocumentContext({request:async()=>record(work),readText:async()=>structuredClone(summary),clock:()=>at,...extra});
const source={url:'https://data.europarl.europa.eu/distribution/doc/list_en.docx',fetchedAt:new Date(at).toISOString(),language:'en'};
const indexed={id:amendmentId,targetDocumentId:id,listId,language:'en',textIntegrity:'complete',originalText:'AO. Original wording',proposedText:'AO. Proposed wording',targetLabel:'Recital AO',authors:[],wordingSource:source};

test('the real cold document reader preserves local failures and allows an immediate context retry',async()=>{
  for(const failure of [Object.assign(new HttpError(503,'upstream_busy','The document reader is busy.'),{retryAfter:1}),requestTimeout()]) {
    const url=`https://data.europarl.europa.eu/distribution/doc/context-local-${failure.code}-${Date.now()}.docx`;
    const publication={...work,is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:url}]}]};
    let downloads=0;
    const reader=service({request:async()=>record(publication),readText:(node,language)=>documentText(node,language,{directory:null,clock:()=>at,download:async()=>{if(++downloads===1)throw failure;return structuredClone(summary);}})});
    await assert.rejects(reader.query(query()),error=>error===failure&&error.status===503);
    assert.equal(reader.cache.size,0);assert.equal(downloads,1);
    const recovered=await reader.query(query());
    assert.equal(recovered.document.selectedText.status,'available');assert.deepEqual(recovered.document.selectedText.paragraphs,summary.paragraphs);assert.equal(downloads,2);
  }
});

function archive(documentXml,stylesXml) {
  const entries=[['word/document.xml',documentXml],['word/styles.xml',stylesXml]],local=[],central=[];let offset=0;
  for(const [path,xml] of entries) {
    const name=Buffer.from(path),body=Buffer.from(xml),compressed=deflateRawSync(body),header=Buffer.alloc(30),directory=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(8,8);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(body.length,22);header.writeUInt16LE(name.length,26);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(8,10);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(body.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
    local.push(header,name,compressed);central.push(directory,name);offset+=header.length+name.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}

test('document context validates exact identity, source variant and query keys',()=>{
  assert.equal(documentContextQuery(ta,new URLSearchParams()).id,ta);
  assert.deepEqual(documentContextQuery(id,new URLSearchParams({amendment:amendmentId,list:listId})),{id,language:'en',amendmentId,listId,adopted:false,includeBody:true});
  for(const value of ['B-9-2026-0424','../secret',id+'-AM-40'])assert.throws(()=>documentContextQuery(value,new URLSearchParams()),{status:400});
  for(const params of ['amendment=B-10-2026-0424-AM-40','list='+listId,'amendment='+amendmentId+'&list=B-10-2026-0424-AM-001-099','adopted=0','lang=en&lang=fr','unknown=1','adopted=1&amendment='+amendmentId])assert.throws(()=>documentContextQuery(id,new URLSearchParams(params)),{status:400});
  assert.throws(()=>documentContextQuery(ta,new URLSearchParams('adopted=1')),{status:400});
  for(const language of ['en','hu','zz','unknown']) {
    const parsed=documentContextQuery(id,new URLSearchParams({amendment:amendmentId,list:listId,'wording-lang':language}));
    assert.equal(parsed.wordingLanguage,language==='unknown'?null:language);
  }
  assert.equal(Object.hasOwn(query(),'wordingLanguage'),false);
  for(const language of ['','EN','HU','eng','en-US','null','Unknown',' en','en ','e1','éé','a'.repeat(1000)])assert.throws(()=>documentContextQuery(id,new URLSearchParams({amendment:amendmentId,list:listId,'wording-lang':language})),{status:400});
  for(const params of [{'wording-lang':'hu'},{amendment:amendmentId,'wording-lang':'hu'},{list:listId,'wording-lang':'unknown'}])assert.throws(()=>documentContextQuery(id,new URLSearchParams(params)),{status:400});
});

test('an explicit wording language selects only one exact list variant and retains all alternatives and provenance',async()=>{
  const hungarian='AO. Eredeti magyar szöveg',hungarianSource={...source,url:source.url.replace('_en','_hu'),language:'hu',contentHash:'b'.repeat(64),sourceVersion:{byteSize:912,issued:'2026-09-16'}};
  const variants=[{...indexed,sourceFreshness:{status:'fresh'},gaps:[]},{...indexed,language:'hu',originalText:hungarian,proposedText:'AO. Javasolt magyar szöveg',targetLabel:'Preambulumbekezdés AO',targetLabelLanguage:'hu',wordingSource:hungarianSource,targetLabelSource:hungarianSource,fieldSources:{wording:hungarianSource,targetLabel:hungarianSource},sourceFreshness:{status:'fresh'},gaps:[]}];
  const bodyLanguages=[],reader=service({findAmendment:()=>({...indexed,variants}),readText:async(_work,language)=>{bodyLanguages.push(language);return {...summary,textLanguage:language,paragraphs:[language==='hu'?hungarian:indexed.originalText]};}});
  const pinned=(wordingLanguage,language)=>query({amendmentId,listId,wordingLanguage,language});
  const hu=await reader.query(pinned('hu','hu'),{store:{}});
  assert.equal(hu.requestedWordingLanguage,'hu');assert.equal(hu.requestedLanguage,'hu');assert.equal(hu.target.status,'found');assert.equal(hu.target.basis,'quoted-original');assert.equal(hu.target.quoteMatches,true);assert.deepEqual(hu.target.paragraphs,[0]);
  assert.equal(hu.target.evidence.wordingLanguage,'hu');assert.deepEqual(hu.target.evidence.wordingSource,hungarianSource);assert.deepEqual(hu.target.evidence.fieldSources,variants[1].fieldSources);assert.deepEqual(hu.amendment.variants.map(row=>row.language),['en','hu']);
  const en=await reader.query(pinned('en','en'),{store:{}});assert.equal(en.target.status,'found');assert.equal(en.target.evidence.wordingLanguage,'en');assert.equal(en.amendment.variants[0].originalText,indexed.originalText);
  const fallback=await reader.query(pinned('hu','en'),{store:{}});assert.equal(fallback.target.reason,'different-text-languages');assert.deepEqual(fallback.target.paragraphs,[]);assert.deepEqual(fallback.target.evidence.wordingSource,hungarianSource);
  const absent=await reader.query(query({amendmentId,listId,language:'hu'}),{store:{}});assert.equal(absent.target.reason,'choose-source-version');assert.equal(Object.hasOwn(absent,'requestedWordingLanguage'),false);
  const missing=await reader.query(pinned('fr','hu'),{store:{}});assert.equal(missing.target.status,'unavailable');assert.equal(missing.target.evidence,null);assert.equal(missing.amendment.variants.length,2);
  await reader.query(pinned('hu','hu'),{store:{}});assert.deepEqual(bodyLanguages,['hu','en','en','hu','hu'],'full-query cache entries retain the independent body and wording choices');
  const wording=await reader.query({...pinned('hu','hu'),includeBody:false},{store:{}});assert.equal(wording.document,null);assert.equal(wording.target.status,'not-requested');assert.equal(wording.target.evidence.wordingLanguage,'hu');assert.equal(bodyLanguages.length,5);
});

test('an explicit selector cannot hide a conflicting or unreadable same-list same-language alternative',async()=>{
  for(const competing of [{originalText:'Conflicting wording'},{textIntegrity:'incomplete',originalText:null,proposedText:null}]) {
    const reader=service({findAmendment:()=>({...indexed,variants:[indexed,{...indexed,...competing},{...indexed,language:'hu'}]})});
    const result=await reader.query(query({amendmentId,listId,wordingLanguage:'en'}),{store:{}});
    assert.equal(result.amendment.variants.length,3);assert.equal(result.target.status,'unavailable');assert.equal(result.target.reason,'choose-source-version');assert.equal(result.target.evidence,null);assert.deepEqual(result.target.paragraphs,[]);
  }
});

test('unknown wording selects only a null source language and cannot establish body language',async()=>{
  for(const textLanguage of ['en',null]) {
    const variants=[indexed,{...indexed,language:null,wordingSource:{...source,language:null}}];
    const reader=service({findAmendment:()=>({...indexed,variants}),readText:async()=>({...summary,textLanguage})});
    const result=await reader.query(query({amendmentId,listId,wordingLanguage:null}),{store:{}});
    assert.equal(Object.hasOwn(result,'requestedWordingLanguage'),true);assert.equal(result.requestedWordingLanguage,null);assert.equal(result.target.evidence.wordingLanguage,null);assert.equal(result.target.evidence.wordingSource.language,null);assert.equal(result.target.reason,'different-text-languages');assert.equal(result.amendment.variants.length,2);
  }
  const reader=service({findAmendment:()=>indexed});
  const missing=await reader.query(query({amendmentId,listId,wordingLanguage:null}),{store:{}});assert.equal(missing.target.status,'unavailable');assert.equal(missing.target.evidence,null);assert.equal(missing.amendment.variants.length,1);
});

test('wording-only reads defer the source body until context is requested',async()=>{
  let bodies=0;const reader=service({findAmendment:()=>indexed,readText:async()=>{bodies++;return summary;}});
  const wording=await reader.query(documentContextQuery(id,new URLSearchParams({amendment:amendmentId,body:'0'})),{store:{}});
  assert.equal(wording.document,null);assert.equal(wording.target.status,'not-requested');assert.equal(wording.amendment.status,'available');assert.equal(bodies,0);
  const context=await reader.query(query({amendmentId}),{store:{}});assert.equal(context.target.status,'found');assert.equal(bodies,1);
  for(const text of ['body=1','body=0','body=0&adopted=1','body=0&amendment='+amendmentId+'&adopted=1'])assert.throws(()=>documentContextQuery(id,new URLSearchParams(text)),{status:400});
});

test('exact requested source is required before any body is read',async()=>{
  for(const nodes of [[{...work,id:'eli/dl/doc/B-10-2026-0424'}],[work,work],[]]) {
    let reads=0;const reader=service({request:async()=>({payload:{data:nodes},fetchedAt:at}),readText:async()=>{reads++;return summary;}});
    await assert.rejects(reader.query(query()),{code:'invalid_document_source'});assert.equal(reads,0);
  }
});

test('checked off-page amendment selects its exact source without fetching lists',async()=>{
  let downloads=0;const reader=service({findAmendment:()=>indexed,download:async()=>{downloads++;throw Error();}});
  const result=await reader.query(query({amendmentId,listId}),{store:{}});
  assert.equal(result.amendment.basis,'index');assert.equal(result.amendment.variants[0].listId,listId);assert.equal(result.target.status,'found');assert.equal(downloads,0);
  assert.equal(result.document.selectedText.paragraphs[0],summary.paragraphs[0]);
});

test('conflicting variants require exact list selection and preserve language boundaries',async()=>{
  const variants=[indexed,{...indexed,listId:id+'-AM-040-040',originalText:'Different source version'}];
  const reader=service({findAmendment:()=>({...indexed,variants})});
  const ambiguous=await reader.query(query({amendmentId}),{store:{}});assert.equal(ambiguous.target.reason,'choose-source-version');assert.equal(ambiguous.amendment.variants.length,2);
  const pinned=await reader.query(query({amendmentId,listId}),{store:{}});assert.equal(pinned.target.status,'found');
  const french=service({findAmendment:()=>({...indexed,language:'fr'})});assert.equal((await french.query(query({amendmentId}),{store:{}})).target.reason,'different-text-languages');
});

test('an insertion uses an explicitly linked source decision, never its new-label lettering',async()=>{
  const insertion={...indexed,originalText:'',proposedText:'New recital',targetLabel:'Recital F a (new)',decisions:[{id:'MTG-PL-2026-10-07-DEC-197436',amendmentIds:[amendmentId],reference:'After recital F',source}]};
  const reader=service({findAmendment:()=>insertion,readText:async()=>({...summary,paragraphs:['F. Published recital.']})});
  const result=await reader.query(query({amendmentId}),{store:{}});assert.equal(result.target.status,'found');assert.equal(result.target.relation,'after');assert.equal(result.target.basis,'published-reference');
  const unlinked=service({findAmendment:()=>({...insertion,decisions:[{...insertion.decisions[0],amendmentIds:[id+'-AM-99']}]})});
  assert.equal((await unlinked.query(query({amendmentId}),{store:{}})).target.status,'unavailable');
});

test('adding conflicting decision references cannot restore a previously withheld passage',async()=>{
  const paragraphs=['D. Exact original wording.','E. Another passage.','F. A third passage.'];
  const text={...summary,paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({...summary.paragraphSources[0],path:'w:p['+ordinal+']',ordinal}))};
  for(const references of [['Recital E'],['Recital E','Recital F']]) {
    const decisions=references.map((reference,index)=>({id:'MTG-PL-2026-10-07-DEC-'+(197430+index),amendmentIds:[amendmentId],reference,source}));
    const reader=service({findAmendment:()=>({...indexed,targetLabel:'Recital D',targetLabelLanguage:'en',originalText:paragraphs[0],decisions}),readText:async()=>text});
    const result=await reader.query(query({amendmentId}),{store:{}});
    assert.equal(result.target.status,'ambiguous');assert.deepEqual(result.target.paragraphs,[]);assert.deepEqual(result.target.evidence.referenceDecisions.map(decision=>decision.reference),references);
  }
});

test('the aggregate metadata limit stops procedure, adopted-text and amendment-list traversal',async()=>{
  const procedure='2026-2868',secondProcedure='2026-2869',secondTA='TA-10-2026-0342',secondList=id+'-AM-040-040';
  const procedureNode={id:'eli/dl/proc/'+procedure,created_a_realization_of:['eli/dl/doc/'+ta,'eli/dl/doc/'+secondTA]};
  const scenarios=[
    {root:{...work,inverse_created_a_realization_of:['eli/dl/proc/'+procedure,'eli/dl/proc/'+secondProcedure]},extra:{adopted:true},documents:{['/procedures/'+procedure]:{...procedureNode,padding:'x'.repeat(6000)}},paths:['/plenary-documents/'+id,'/procedures/'+procedure]},
    {root:{...work,inverse_created_a_realization_of:['eli/dl/proc/'+procedure]},extra:{adopted:true},documents:{['/procedures/'+procedure]:procedureNode,['/adopted-texts/'+ta]:{id:'eli/dl/doc/'+ta,identifier:ta,padding:'x'.repeat(6000)}},paths:['/plenary-documents/'+id,'/procedures/'+procedure,'/adopted-texts/'+ta]},
    {root:{...work,inverse_foresees_change_of:['eli/dl/doc/'+listId,'eli/dl/doc/'+secondList]},extra:{amendmentId},documents:{['/plenary-documents/'+listId]:{id:'eli/dl/doc/'+listId,identifier:listId,padding:'x'.repeat(6000)}},paths:['/plenary-documents/'+id,'/plenary-documents/'+listId]},
  ];
  for(const scenario of scenarios) {
    const paths=[];const reader=service({limits:{metadataBytes:5000},request:async path=>{paths.push(path);return record(path==='/plenary-documents/'+id?scenario.root:scenario.documents[path]);}});
    await assert.rejects(reader.query(query(scenario.extra)),{status:502,code:'document_source_budget'});
    assert.deepEqual(paths,scenario.paths);assert.equal(reader.cache.size,0);
  }
});

test('an unreadable competing version cannot silently make another version the default target',async()=>{
  const variants=[indexed,{...indexed,listId:id+'-AM-040-040',textIntegrity:'incomplete',originalText:null,proposedText:null}];
  const reader=service({findAmendment:()=>({...indexed,variants})});
  const result=await reader.query(query({amendmentId}),{store:{}});assert.equal(result.amendment.variants.length,2);assert.deepEqual(result.amendment.gaps,['source-versions-incomplete']);assert.equal(result.amendment.variants[1].wordingStatus,'unavailable');assert.equal(result.amendment.variants[1].originalText,null);assert.equal(result.target.status,'unavailable');
  const pinned=await reader.query(query({amendmentId,listId}),{store:{}});assert.equal(pinned.target.status,'found');
});

test('target label language and field provenance remain independent of wording language',async()=>{
  const retained={...indexed,originalText:'Quotation from another version.',targetLabelLanguage:null,targetLabelSource:source,fieldSources:{targetLabel:{source}},textParserVersion:'10',wordingRetained:true,proposerRetained:true,recordRetained:true};
  const reader=service({findAmendment:()=>retained});const result=await reader.query(query({amendmentId}),{store:{}});
  assert.equal(result.target.status,'unavailable');const variant=result.amendment.variants[0];assert.equal(variant.targetLabelLanguage,null);assert.deepEqual(variant.targetLabelSource,source);assert.deepEqual(variant.fieldSources,retained.fieldSources);assert.equal(variant.wordingRetained,true);assert.equal(variant.textParserVersion,'10');
  const english=service({findAmendment:()=>({...retained,targetLabelLanguage:'en'})});const found=await english.query(query({amendmentId}),{store:{}});assert.equal(found.target.status,'found');assert.equal(found.target.quoteMatches,false);assert.deepEqual(found.target.evidence.targetLabelSource,source);
});

test('null adopted relationships are unavailable, while explicitly empty relationships remain observed',async()=>{
  for(const field of ['created_a_realization_of','adopts']) {
    const reader=service({request:async path=>path==='/plenary-documents/'+id?record({...work,inverse_created_a_realization_of:['eli/dl/proc/2026-2868']}):path==='/procedures/2026-2868'?record({id:'eli/dl/proc/2026-2868',created_a_realization_of:field==='created_a_realization_of'?null:['eli/dl/doc/'+ta]}):record({id:'eli/dl/doc/'+ta,identifier:ta,work_type:'def/ep-document-types/TEXT_ADOPTED',adopts:null})});
    const result=await reader.query(query({adopted:true}));assert.equal(result.related.status,'unavailable');assert.equal(result.related.items.length,0);assert(result.related.gaps.length);
  }
  const empty=service({request:async path=>path.startsWith('/plenary-documents/')?record({...work,inverse_created_a_realization_of:['eli/dl/proc/2026-2868']}):record({id:'eli/dl/proc/2026-2868',created_a_realization_of:[]})});assert.equal((await empty.query(query({adopted:true}))).related.status,'available');
});

test('root document types use exact canonical identities rather than the last URI component',async()=>{
  for(const type of ['def/ep-document-types/AMENDMENT_LIST','https://other.example/def/ep-document-types/REPORT_PLENARY','REPORT_PLENARY']) {
    let bodies=0;const reader=service({request:async()=>record({...work,work_type:type}),readText:async()=>{bodies++;return summary;}});await assert.rejects(reader.query(query()),{code:'invalid_document_source'});assert.equal(bodies,0);
  }
});

test('retained or unverified indexed wording never receives a fresh computed TTL',async()=>{
  for(const fields of [{sourceFreshness:{status:'pending'}},{sourceFreshness:{status:'fresh'},gaps:['retained source']},{sourceFreshness:{status:'fresh'},wordingRetained:true}]) {
    for(const selector of [{},{listId,wordingLanguage:'en'}]) {
      let reads=0;const reader=service({findAmendment:()=>({...indexed,...fields}),request:async()=>{reads++;return record(work);}});await reader.query(query({amendmentId,...selector}),{store:{}});await reader.query(query({amendmentId,...selector}),{store:{}});assert.equal(reads,2);
    }
  }
});

test('adopted candidates require exact procedure edges and reciprocal adopts, independently of original outcome',async()=>{
  const paths=[],root={...work,inverse_created_a_realization_of:['eli/dl/proc/2026-2868']};
  const procedure={id:'eli/dl/proc/2026-2868',created_a_realization_of:['eli/dl/doc/'+ta,'eli/dl/doc/TA-10-2026-0342']};
  const adopted={id:'eli/dl/doc/'+ta,identifier:ta,work_type:'def/ep-document-types/TEXT_ADOPTED',adopts:['eli/dl/doc/'+id]};
  const documents={[`/plenary-documents/${id}`]:root,'/procedures/2026-2868':procedure,['/adopted-texts/'+ta]:adopted,'/adopted-texts/TA-10-2026-0342':{...adopted,id:'eli/dl/doc/TA-10-2026-0342',identifier:'TA-10-2026-0342',adopts:['eli/dl/doc/B-10-2026-0424']}};
  const reader=service({request:async path=>{paths.push(path);return record(documents[path]);},readText:async()=>{throw Error('Body must remain lazy');}});
  const result=await reader.query(query({adopted:true}));assert.equal(result.document,null);assert.equal(result.related.status,'available');assert.deepEqual(result.related.items.map(item=>item.id),[ta]);assert.equal(paths.length,4);
});

test('partial adopted discovery retains verified choices but never calls the relationship complete',async()=>{
  const root={...work,inverse_created_a_realization_of:['eli/dl/proc/2026-2868','eli/dl/proc/2026-9999']};
  const reader=service({request:async path=>{if(path==='/plenary-documents/'+id)return record(root);if(path==='/procedures/2026-2868')return record({id:'eli/dl/proc/2026-2868',created_a_realization_of:['eli/dl/doc/'+ta]});if(path==='/adopted-texts/'+ta)return record({id:'eli/dl/doc/'+ta,identifier:ta,work_type:'def/ep-document-types/TEXT_ADOPTED',adopts:['eli/dl/doc/'+id]});throw Error('Source unavailable');}});
  const result=await reader.query(query({adopted:true}));assert.equal(result.related.status,'partial');assert.equal(result.related.items.length,1);assert.deepEqual(result.related.gaps,['procedure-unavailable']);
});

test('bounded published list fallback parses actual DOCX columns and never invents proposer identities',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-docx-excerpts-20261016.json',import.meta.url))).documents[0];
  const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+id],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:fixture.sourceUrl}]}]};
  let downloads=0;const reader=service({request:async()=>record({...work,inverse_foresees_change_of:[list]}),download:async url=>{downloads++;assert.equal(url,fixture.sourceUrl);return {buffer:archive(fixture.documentXml,fixture.stylesXml),resolvedSourceUrl:url};}});
  const result=await reader.query(query({amendmentId}));const wording=result.amendment.variants[0];assert.equal(result.amendment.basis,'published-list');assert.equal(wording.originalText,fixture.expected[0].originalText);assert.equal(wording.proposedText,fixture.expected[0].proposedText);assert(wording.authors.every(author=>author.personId===null));assert.equal(downloads,1);assert.equal(result.sources.at(-1).contentHash.length,64);
  const later=await reader.query(query({amendmentId:id+'-AM-41'}));assert.equal(later.amendment.status,'unavailable');assert.equal(downloads,1,'different amendments reuse the same bounded list extraction');assert.equal(later.sources.at(-1).fetchedAt,result.sources.at(-1).fetchedAt);assert.equal(later.sources.at(-1).contentHash,result.sources.at(-1).contentHash);
});

test('published-list reads pin exact wording language without fetching or dropping declared alternatives',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-docx-excerpts-20261016.json',import.meta.url))).documents[0];
  const urls=[fixture.sourceUrl,fixture.sourceUrl.replace('_en.docx','_hu.docx'),fixture.sourceUrl.replace('_en.docx','_unknown.docx')];
  const expressions=['ENG','HUN',null].map((language,index)=>({language:language&&'http://publications.europa.eu/resource/authority/language/'+language,is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:urls[index],byteSize:1234,issued:'2026-09-30'}]}));
  const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+id],is_realized_by:expressions};
  const bytes=archive(fixture.documentXml,fixture.stylesXml),downloads=[];
  const reader=service({request:async()=>record({...work,inverse_foresees_change_of:[list]}),download:async url=>{downloads.push(url);return {buffer:bytes,resolvedSourceUrl:url};},readText:async()=>({...summary,paragraphs:[fixture.expected[0].originalText]})});
  const pinned=wordingLanguage=>query({amendmentId,listId,wordingLanguage});
  const hu=await reader.query(pinned('hu'));assert.deepEqual(downloads,[urls[1]]);assert.equal(hu.target.reason,'different-text-languages');assert.equal(hu.target.evidence.wordingLanguage,'hu');assert.equal(hu.target.evidence.wordingSource.url,urls[1]);
  assert.deepEqual(hu.amendment.variants.map(row=>row.language),['en','hu',null]);assert.deepEqual(hu.amendment.variants.map(row=>row.source.url),urls);assert.deepEqual(hu.amendment.variants.map(row=>row.wordingStatus),['unavailable','available','unavailable']);assert.equal(hu.target.evidence.wordingSource.contentHash.length,64);assert.equal(hu.target.evidence.wordingSource.retrievedByteSize,bytes.byteLength);assert.deepEqual(hu.target.evidence.wordingSource.sourceVersion,{byteSize:1234,issued:'2026-09-30'});
  for(const variant of hu.amendment.variants){assert.deepEqual(variant.source.sourceVersion,{byteSize:1234,issued:'2026-09-30'});assert.deepEqual(variant.metadataSource,hu.sources[0]);}
  const en=await reader.query(pinned('en'));assert.equal(en.target.status,'found');assert.equal(en.target.evidence.wordingLanguage,'en');assert.deepEqual(downloads,[urls[1],urls[0]]);
  const unknown=await reader.query(pinned(null));assert.equal(unknown.requestedWordingLanguage,null);assert.equal(unknown.target.evidence.wordingLanguage,null);assert.equal(unknown.target.evidence.wordingSource.url,urls[2]);assert.equal(unknown.target.reason,'different-text-languages');assert.deepEqual(downloads,[urls[1],urls[0],urls[2]]);
  const missing=await reader.query(pinned('fr'));assert.equal(missing.amendment.status,'unavailable');assert.equal(missing.amendment.variants.length,3);assert.equal(missing.target.evidence,null);assert.equal(downloads.length,3);
  const duplicate={...list,is_realized_by:[expressions[0],{...expressions[0],is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:urls[0].replace('.docx','_revision.docx')}]}]};
  const conflicting=service({request:async()=>record({...work,inverse_foresees_change_of:[duplicate]}),download:async()=>{throw Error('Conflicting sources must not be read');}});
  const result=await conflicting.query(pinned('en'));assert.equal(result.amendment.variants.length,2);assert.equal(result.target.evidence,null);assert.equal(result.target.reason,'choose-source-version');assert.deepEqual(result.amendment.gaps,['amendment-file-unavailable-or-ambiguous']);
});

test('selected published wording propagates local failures without caching source gaps or reading the body',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-docx-excerpts-20261016.json',import.meta.url))).documents[0];
  const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+id],is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:fixture.sourceUrl}]}]};
  for(const failure of [requestTimeout(),Object.assign(new HttpError(503,'upstream_busy','The source reader is busy.'),{retryAfter:1})]) {
    let downloads=0;const reader=service({request:async()=>record({...work,inverse_foresees_change_of:[list]}),download:async url=>{if(++downloads===1)throw failure;return {buffer:archive(fixture.documentXml,fixture.stylesXml),resolvedSourceUrl:url};},readText:async()=>{assert.fail('body=0 must not read the body');}});
    const selected=query({amendmentId,listId,wordingLanguage:'en',includeBody:false});
    await assert.rejects(reader.query(selected),error=>error===failure);assert.equal(reader.cache.size,0);assert.equal(reader.extractions.size,0);
    const recovered=await reader.query(selected);assert.equal(recovered.amendment.status,'available');assert.deepEqual(recovered.amendment.gaps,[]);assert.equal(recovered.target.status,'not-requested');assert.equal(downloads,2);
  }
});

test('declared DOCX competitors remain visible before download admission and preserve legacy selection',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-docx-excerpts-20261016.json',import.meta.url))).documents[0];
  const unsupported=[fixture.sourceUrl.replace('.docx','_other.docx?download=1'),'https://other.example/wording.docx','not a download URL',null,undefined,{id:fixture.sourceUrl}];
  const expression=(language,url)=>({language,is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:url,byteSize:4321,issued:'2026-09-30'}]});
  const create=expressions=>{
    const downloads=[],list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+id],is_realized_by:expressions};
    const reader=service({request:async()=>record({...work,inverse_foresees_change_of:[list]}),readText:async()=>({...summary,paragraphs:[fixture.expected[0].originalText]}),download:async url=>{assert.equal(url,fixture.sourceUrl,'unsupported declarations must never be fetched');downloads.push(url);return {buffer:archive(fixture.documentXml,fixture.stylesXml),resolvedSourceUrl:url};}});
    return {reader,downloads};
  };
  const selected=query({amendmentId,listId,wordingLanguage:'en'});
  for(const url of unsupported) {
    const {reader,downloads}=create([expression('language/ENG',fixture.sourceUrl),expression('language/ENG',url)]);
    const result=await reader.query(selected);assert.equal(result.amendment.variants.length,2);assert.equal(result.target.status,'unavailable');assert.equal(result.target.evidence,null);assert.deepEqual(result.target.paragraphs,[]);assert.deepEqual(downloads,[]);
    const alternative=result.amendment.variants[1];assert.equal(alternative.language,'en');assert.equal(alternative.wordingStatus,'unavailable');assert.deepEqual(alternative.source.sourceVersion,{byteSize:4321,issued:'2026-09-30'});assert.deepEqual(alternative.metadataSource,result.sources[0]);assert.equal(Object.hasOwn(alternative.source,'url'),typeof url==='string');if(typeof url==='string')assert.equal(alternative.source.url,url);
    const legacy=await reader.query(query({amendmentId,listId}));assert.equal(legacy.target.status,'found');assert.equal(legacy.amendment.variants.length,1);assert.equal(Object.hasOwn(legacy,'requestedWordingLanguage'),false);assert.deepEqual(downloads,[fixture.sourceUrl]);
    const only=create([expression('language/ENG',url)]),unavailable=await only.reader.query(selected);assert.equal(unavailable.amendment.variants.length,1);assert.equal(unavailable.amendment.status,'unavailable');assert.equal(unavailable.target.status,'unavailable');assert.equal(unavailable.target.evidence,null);assert.deepEqual(only.downloads,[]);
    const otherLanguage=create([expression('language/ENG',fixture.sourceUrl),expression('language/HUN',url)]),found=await otherLanguage.reader.query(selected);assert.equal(found.target.status,'found');assert.equal(found.target.evidence.wordingLanguage,'en');assert.equal(found.amendment.variants.length,2);assert.equal(found.amendment.variants[1].language,'hu');assert.equal(found.amendment.variants[1].wordingStatus,'unavailable');assert.deepEqual(otherLanguage.downloads,[fixture.sourceUrl]);
  }
});

test('absent or unrelated lists remain unavailable without a download or absence claim',async()=>{
  let downloads=0;const reader=service({download:async()=>{downloads++;throw Error();}});const result=await reader.query(query({amendmentId}));assert.equal(result.amendment.status,'unavailable');assert.equal(result.target.reason,'amendment-wording-unavailable');assert.equal(downloads,0);
});

test('an observed exact alias is usable, while numeric resemblance alone cannot select wording',async()=>{
  const alias=id+'-AM-040';let downloads=0;
  const reader=service({findAmendment:()=>({...indexed,officialIds:['eli/dl/doc/'+alias]}),download:async()=>{downloads++;throw Error();}});
  assert.equal((await reader.query(query({amendmentId:alias}),{store:{}})).amendment.basis,'index');
  const missing=service({findAmendment:()=>({...indexed,officialIds:[]}),download:async()=>{downloads++;throw Error();}});
  const result=await missing.query(query({amendmentId:alias}),{store:{}});assert.equal(result.amendment.status,'unavailable');assert.deepEqual(result.amendment.gaps,['amendment-identity-unverified']);assert.equal(downloads,0);
});

test('one cancelled reader cannot cancel shared source loading; local failures are never cached as source gaps',async()=>{
  let release,reads=0;const ready=new Promise(resolve=>release=resolve);const reader=service({request:async()=>{reads++;await ready;return record(work);}});
  const budget=createRequestBudget(60_000),first=runWithRequestSignal(budget.signal,()=>reader.query(query()));
  const second=reader.query(query());budget.abort(requestTimeout());await assert.rejects(first,{code:'request_timeout'});release();assert.equal((await second).document.id,id);assert.equal(reads,1);budget.dispose();
  let failures=0;const failing=service({request:async()=>{failures++;throw requestTimeout();}});await assert.rejects(failing.query(query()),{code:'request_timeout'});await assert.rejects(failing.query(query()),{code:'request_timeout'});assert.equal(failures,2);
});

test('stale metadata and text are not given a fresh computed cache lifetime',async()=>{
  for(const stale of ['metadata','text']) {
    let reads=0;const reader=service({request:async()=>{reads++;return {...record(work),stale:stale==='metadata'};},readText:async()=>({...summary,stale:stale==='text'})});
    const result=await reader.query(query());await reader.query(query());assert.equal(reads,2);assert.equal(stale==='metadata'?result.sources[0].stale:result.document.selectedText.stale,true);
  }
});


test('context returns column operation and complete placement independently of compatibility target',async()=>{
  const paragraphs=['The European Parliament,','– having regard to sources,','19. Parent provision:','(a) last point;','20. Next provision;'];
  const text={...summary,paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))};
  const amendment={...indexed,originalText:'',proposedText:'19a. New provision;',targetLabel:'Paragraph 19 a (new)',targetLabelLanguage:'en'};
  const reader=service({readText:async()=>text,findAmendment:()=>amendment});
  const result=await reader.query(query({amendmentId,listId,wordingLanguage:'en'}),{store:{}});
  assert.equal(result.version,2);assert.equal(result.placement.status,'placed');assert.equal(result.placement.operation,'insert');assert.equal(result.placement.insertAfter,3);assert.equal(result.placement.insertBefore,4);
  assert.equal(result.target.status,'unavailable','old target remains a separate compatibility observation');
  assert.equal(result.target.evidence.wordingLanguage,'en');
});
test('context explicitly withholds a proposal baseline and conflicting decision placements',async()=>{
  const amendment={...indexed,originalText:'Existing text',proposedText:'deleted',targetLabel:'Recital A',targetLabelLanguage:'en',baseline:'other'};
  const reader=service({findAmendment:()=>amendment});
  const result=await reader.query(query({amendmentId,listId}),{store:{}});
  assert.equal(result.placement.operation,'delete');assert.equal(result.placement.reason,'baseline_unavailable');
  assert.equal(result.placement.status,'unresolved');
});
