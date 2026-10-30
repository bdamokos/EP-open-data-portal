import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {DocumentContext,documentContextQuery} from './document-context.mjs';
import {extractAmendments} from './amendment-documents.mjs';
import {resolveAmendmentPlacement,segmentMotionUnits} from './document-context-model.mjs';
import {documentText,docxContent} from './document-text.mjs';
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

test('the context endpoint projects exact Council XHTML and keeps report wording evidence independent',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/council-position-excerpts.json',import.meta.url),'utf8'));
  const selected={...indexed,baseline:'council-position',baselineSource:{category:'council-position',conflicted:false},targetLabelLanguage:'en',targetLabel:'Article 30 – title',originalText:'Code of conduct',proposedText:'Binding code of conduct'};
  let reads=0;
  const reader=service({findAmendment:()=>selected,readCouncil:async options=>{reads++;assert.equal(options.reportId,id);assert.equal(options.language,'en');return {status:'available',celex:fixture.celex,workId:'http://publications.europa.eu/resource/cellar/94b1ab29-4450-11f1-8095-01aa75ed71a1',gaps:[],evidence:[],items:[{kind:'act',index:1,itemId:fixture.sourceUrl.replace('https:','http:'),buffer:Buffer.from(fixture.xhtml),source:{url:fixture.sourceUrl,sha256:fixture.sourceSha256,fetchedAt:fixture.retrievedAt,stale:false}}]};}});
  const result=await reader.query(query({amendmentId,listId,wordingLanguage:'en'}),{store:{}});
  assert.equal(reads,1);assert.equal(result.baseline.kind,'council-position');assert.equal(result.proposal.items[0].proposal.sourceKind,'xhtml');assert.equal(result.placement.status,'placed');assert.equal(result.placement.originalText,'Code of conduct');assert.equal(result.document.selectedText,undefined);assert.equal(result.target.evidence.amendmentId,amendmentId);
});

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

function archive(documentXml,stylesXml,parts={}) {
  const entries=[['word/document.xml',documentXml],['word/styles.xml',stylesXml],...Object.entries(parts)],local=[],central=[];let offset=0;
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
  for(const value of ['B-11-2026-0424','../secret',id+'-AM-40'])assert.throws(()=>documentContextQuery(value,new URLSearchParams()),{status:400});
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
  const absent=await reader.query(query({amendmentId,listId,language:'hu'}),{store:{}});assert.equal(absent.target.status,'found');assert.equal(absent.target.evidence.wordingLanguage,'hu');assert.equal(Object.hasOwn(absent,'requestedWordingLanguage'),false);
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

test('missing document languages use one exact translated list and amendment number in preference order',async()=>{
  for(const [requested,originals,expected] of [['hu',['de'],'de'],['en',['de'],'de'],['en',['it'],'fr']]) {
    const languages=['fr','de','es'],calls=[],bodyCalls=[];
    const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:'eli/dl/doc/'+id,is_realized_by:languages.map(language=>({language,is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:source.url.replace('_en','_'+language)}]}))};
    const publication={...work,originalLanguage:originals,inverse_foresees_change_of:['eli/dl/doc/'+listId]};
    const reader=service({findAmendment:()=>({...indexed,language:requested,baseline:'motion-resolution'}),request:async path=>{calls.push(path);return record(path==='/documents/'+listId?list:publication);},readText:async(_work,language)=>{bodyCalls.push(language);return {...summary,textLanguage:languages.includes(language)?language:'fr',availableTextLanguages:languages};}});
    reader.readList=async(_list,file)=>({source:{...source,url:file.url,language:file.language},extraction:{amendments:[{number:40,originalText:summary.paragraphs[0],proposedText:'Translated proposal',authors:[],baseline:'motion-resolution'}]}});
    const result=await reader.query(query({amendmentId,listId,wordingLanguage:requested}),{store:{}});
    assert.deepEqual(result.wordingLanguageFallback,{listId,requestedLanguage:requested,language:expected});
    assert.equal(result.target.evidence.wordingLanguage,expected);assert.equal(result.document.selectedText.textLanguage,expected);
    assert.equal(result.amendment.variants.at(-1).source.language,expected);assert.deepEqual(calls,['/plenary-documents/'+id,'/documents/'+listId]);
    assert.equal(bodyCalls.length,expected==='fr'?1:2);
  }
});

test('translation fallback retains unavailable evidence for a different number, target, or duplicate language file',async()=>{
  for(const failure of ['number','target','duplicate']) {
    const file={format:'file-type/DOCX',is_exemplified_by:source.url.replace('_en','_fr')};
    const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:'eli/dl/doc/'+(failure==='target'?'B-10-2026-0424':id),is_realized_by:[{language:'fr',is_embodied_by:failure==='duplicate'?[file,{...file,is_exemplified_by:file.is_exemplified_by.replace('.docx','-rev.docx')}]:[file]}]};
    const reader=service({findAmendment:()=>indexed,request:async path=>record(path==='/documents/'+listId?list:{...work,inverse_foresees_change_of:['eli/dl/doc/'+listId]}),readText:async()=>({...summary,textLanguage:'fr',availableTextLanguages:['fr']})});
    reader.readList=async()=>({source,extraction:{amendments:[{number:41,originalText:'Different amendment',proposedText:'Different proposal',authors:[]}]}});
    const result=await reader.query(query({amendmentId,listId,wordingLanguage:'en'}),{store:{}});
    assert.equal(result.wordingLanguageFallback,null);assert.equal(result.target.evidence.wordingLanguage,'en');assert.equal(result.placement.status,'unresolved');assert.equal(result.amendment.variants.length,1);
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

test('wording responses preserve each justification and its source without reading the body',async()=>{
  const french={...source,url:source.url.replace('_en','_fr'),language:'fr'};
  const variants=[{...indexed,justification:'First paragraph.\nSecond paragraph.',metadataSource:source},
    {...indexed,listId:id+'-AM-040-040',language:'fr',justification:'Motif publié.',metadataSource:french,wordingSource:french}];
  const reader=service({findAmendment:()=>({...indexed,variants}),readText:async()=>assert.fail('body=0 must not read the body')});
  const result=await reader.query(query({amendmentId,includeBody:false}),{store:{}});
  assert.deepEqual(result.amendment.variants.map(row=>[row.listId,row.language,row.justification,row.metadataSource]),
    variants.map(row=>[row.listId,row.language,row.justification,row.metadataSource]));
  const missing=service({findAmendment:()=>indexed});
  assert.equal((await missing.query(query({amendmentId,includeBody:false}),{store:{}})).amendment.variants[0].justification,null);
});

test('a cold published-list read exposes the extracted Danish justification with the exact DOCX source',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-docx-layouts-20261016.json',import.meta.url))).documents.find(row=>row.language==='da');
  const list={id:'eli/dl/doc/'+fixture.listId,identifier:fixture.listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:'eli/dl/doc/'+fixture.targetDocumentId,
    is_realized_by:[{language:'language/DAN',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:fixture.sourceUrl}]}]};
  const reader=service({request:async()=>record({...work,id:'eli/dl/doc/'+fixture.targetDocumentId,identifier:fixture.targetDocumentId,inverse_foresees_change_of:[list]}),
    download:async()=>({buffer:archive(fixture.documentXml,fixture.stylesXml),resolvedSourceUrl:fixture.sourceUrl}),readText:async()=>assert.fail('body=0 must not read the body')});
  const result=await reader.query({...query(),id:fixture.targetDocumentId,amendmentId:fixture.targetDocumentId+'-AM-41',language:'da',includeBody:false});
  const variant=result.amendment.variants[0];
  assert.equal(variant.justification,'I overensstemmelse med Parlamentets holdning, der blev vedtaget med et flertal i 2024.');
  assert.equal(variant.language,'da');assert.equal(variant.fieldSources.justification.url,fixture.sourceUrl);
  assert.equal(variant.fieldSources.justification.language,'da');assert.equal(result.amendment.basis,'published-list');
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
    {root:{...work,inverse_foresees_change_of:['eli/dl/doc/'+listId,'eli/dl/doc/'+secondList]},extra:{amendmentId},documents:{['/documents/'+listId]:{id:'eli/dl/doc/'+listId,identifier:listId,padding:'x'.repeat(6000)}},paths:['/plenary-documents/'+id,'/documents/'+listId]},
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

test('published Commission wording retains its source descriptor and separate target paths in context',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-docx-excerpts-20261016.json',import.meta.url))).documents.find(row=>row.targetDocumentId==='A-10-2025-0085');
  const documentId=fixture.targetDocumentId,amendmentId=documentId+'-AM-7',listId=fixture.listId;
  const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+documentId],is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:fixture.sourceUrl}]}]};
  const report={...work,id:'eli/dl/doc/'+documentId,identifier:documentId,inverse_foresees_change_of:[list]};
  const proposals=[],reader=service({request:async()=>record(report),download:async url=>({buffer:archive(fixture.documentXml,fixture.stylesXml),resolvedSourceUrl:url}),readProposal:async request=>{proposals.push(request);return {status:'unresolved',celex:'52025PC0087',workId:null,language:request.language,items:[],gaps:['proposal-identity-unavailable'],evidence:[]};}});
  const result=await reader.query(documentContextQuery(documentId,new URLSearchParams({amendment:amendmentId,list:listId,'wording-lang':'en'})));
  const [variant]=result.amendment.variants;
  assert.equal(result.amendment.basis,'published-list');assert.equal(variant.baseline,'commission-proposal');
  assert.equal(variant.baselineSource.category,'commission-proposal');assert.equal(variant.baselineSource.headings[0].left.raw,'Text proposed by the Commission');
  assert.equal(variant.baselineSource.headings[0].right.raw,'Amendment');assert.equal(variant.baselineSource.conflicted,false);
  assert.equal(variant.baselineSource.language,'en');assert.equal(variant.baselineSource.sourceUrl,fixture.sourceUrl);assert.equal(variant.baselineSource.fetchedAt,variant.source.fetchedAt);
  assert(variant.documentReferences.some(row=>row.field==='DocAmend2'&&/2023\/956/.test(row.raw)));
  assert.equal(variant.targetPath.proposal[0].raw,'Article 1 – paragraph 1 – point 21 – point a');
  assert.equal(variant.targetPath.underlying[0].raw,'Article 26 – paragraph 1 a (new)');assert.match(variant.targetPath.underlying[0].document,/2023\/956/);
  assert.equal(variant.targetPath.sourceUrl,fixture.sourceUrl);assert.equal(variant.targetPath.language,'en');assert.equal(variant.targetPath.fetchedAt,variant.source.fetchedAt);
  assert.equal(result.placement.status,'unresolved');assert.equal(result.placement.reason,'proposal_baseline_unavailable');
  assert.equal(proposals.length,1);assert.equal(proposals[0].reportId,documentId);assert.equal(proposals[0].language,'en');
  assert.deepEqual(proposals[0].documentReferences,variant.documentReferences);
});

test('legacy baseline placement still requires exact document identity and its expected work type',async()=>{
  for(const baseline of ['unknown',null])for(const invalid of [
    {...work,identifier:'B-10-2026-0424'},
    {...work,work_type:'def/ep-document-types/TEXT_ADOPTED'},
    {...work,work_type:null},
  ]) {
    let bodies=0;const reader=service({request:async()=>record(invalid),findAmendment:()=>({...indexed,baseline}),readText:async()=>{bodies++;return summary;}});
    await assert.rejects(reader.query(query({amendmentId,listId}),{store:{}}),{code:'invalid_document_source'});assert.equal(bodies,0);
  }
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
  assert.equal(result.version,48);assert.equal(result.placement.status,'placed');assert.equal(result.placement.operation,'insert');assert.equal(result.placement.insertAfter,3);assert.equal(result.placement.insertBefore,4);
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

test('proposal selection uses the wording language, preserves source identity and avoids proposal reads for other baselines',async()=>{
  let calls=[];
  const selected={...indexed,baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false},language:'hu',targetLabelLanguage:'hu',targetPath:{language:'hu',proposal:[{raw:'1. cikk – (1) bekezdés'}],underlying:[]},originalText:'Eredeti szöveg.',proposedText:'Javasolt szöveg.'};
  const reader=service({findAmendment:()=>selected,readProposal:async request=>{calls.push(request);return {status:'language-unavailable',celex:'52025PC0087',workId:'exact-work',language:'hu',items:[],gaps:['language-unavailable'],evidence:[]};}});
  const result=await reader.query(query({amendmentId,listId,wordingLanguage:'hu'}),{store:{}});
  assert.equal(calls.length,1);assert.equal(calls[0].language,'hu');assert.equal(calls[0].reportId,id);
  assert.equal(result.baseline.kind,'commission-proposal');assert.equal(result.baseline.workId,'exact-work');assert.equal(result.placement.reason,'proposal_baseline_unavailable');assert.equal(reader.cache.size,0);
  for(const [baseline,reason] of [['present-text','amends_existing_law'],['council-position','council_position_unavailable'],['unknown','baseline_unavailable']]){
    const other=service({findAmendment:()=>({...indexed,baseline}),readProposal:async()=>assert.fail('No proposal fetch for '+baseline)});
    const value=await other.query(query({amendmentId,listId}),{store:{}});assert.equal(value.placement.reason,reason);assert.equal(value.baseline,null);
  }
  const wordingOnly=await reader.query(query({amendmentId,listId,wordingLanguage:'hu',includeBody:false}),{store:{}});assert.equal(calls.length,1);assert.equal(wordingOnly.baseline,null);
});

test('available Commission DOCX projection retains provenance and places only the source paragraph',async()=>{
  const original='1. Original proposal sentence.',variant={...indexed,baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false},language:'en',targetLabelLanguage:'en',targetLabel:'Article 1 – paragraph 1',originalText:original,proposedText:'1. Changed proposal sentence.'};
  const xml='<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Article 1</w:t></w:r></w:p><w:p><w:r><w:t>'+original+'</w:t></w:r></w:p><w:p><w:r><w:t>Article 2</w:t></w:r></w:p><w:p><w:r><w:t>Keep this source.</w:t></w:r></w:p></w:body></w:document>';
  const buffer=archive(xml,'<w:styles xmlns:w="urn:word"/>');
  const reader=service({findAmendment:()=>variant,readProposal:async()=>({status:'available',celex:'52025PC0087',workId:'exact-work',language:'en',gaps:[],evidence:[],items:[{kind:'act',index:1,itemId:'exact-item',expressionId:'exact-expression',buffer,source:{url:'https://publications.europa.eu/resource/celex/52025PC0087',sha256:'a'.repeat(64),fetchedAt:new Date(at).toISOString(),stale:false,refreshError:null}}]})});
  const value=await reader.query(query({amendmentId,listId,wordingLanguage:'en'}),{store:{}});
  assert.equal(value.baseline.attribution,'Legal text © European Union.');assert.equal(value.baseline.celex,'52025PC0087');assert.equal(value.baseline.items[0].source.sha256,'a'.repeat(64));assert.equal(value.proposal.items[0].proposal.paragraphs.length,4);
  assert.equal(value.placement.status,'placed');assert.equal(value.placement.originalText,original);assert.deepEqual(value.placement.span,{start:1,end:1});assert.equal(value.document.selectedText,undefined);
});


test('DOCX soft-break section labels exclude annex and explanatory prose in all 24 languages', () => {
  const samples=JSON.parse(readFileSync(new URL('./fixtures/resolution-end-headings.json',import.meta.url),'utf8'));
  const paragraph=value=>'<w:p><w:r><w:t>'+value+'</w:t></w:r></w:p>';
  assert.equal(samples.length,24);
  for(const {language,opening,annex,explanatoryStatement} of samples)for(const label of [annex+' I',explanatoryStatement])for(const lineBreak of ['br','cr']) {
    const heading='<w:p><w:r><w:t>'+label+'</w:t><w:'+lineBreak+'/><w:t>Technical requirements</w:t></w:r></w:p>';
    const xml='<w:document xmlns:w="urn:word"><w:body>'+paragraph(opening+',')+paragraph('1. Resolution provision;')+paragraph('19. Final provision;')+heading+paragraph('1. Annex provision;')+paragraph('Quoted outside prose.')+'</w:body></w:document>';
    const text={...docxContent(archive(xml,'<w:styles xmlns:w="urn:word"/>')),textLanguage:language};
    assert.equal(text.paragraphs[3],label+'\nTechnical requirements');
    const units=segmentMotionUnits(text,language);
    assert.equal(units.find(unit=>unit.label==='19').end,2,language+' / '+label);
    assert(!units.some(unit=>unit.start>=3),language+' / '+label);
    for(const originalText of ['1. Annex provision;','Quoted outside prose.']) {
      const result=resolveAmendmentPlacement(text,{language,originalText,proposedText:'Changed;'});
      assert.equal(result.reason,'target_not_found',language+' / '+label);
    }
    const inside=resolveAmendmentPlacement(text,{language,originalText:'1. Resolution provision;',proposedText:'Changed;'});
    assert.equal(inside.status,'placed',language+' / '+label);assert.deepEqual(inside.span,{start:1,end:1});
    if(language==='en') {
      const inserted=resolveAmendmentPlacement(text,{language,originalText:'',proposedText:'New;',targetLabel:'Paragraph 19 a (new)'});
      assert.equal(inserted.status,'placed');assert.equal(inserted.insertBefore,3);
    }
  }
});

test('motion and legacy Irish baselines place only within the exact motion or report resolution body',async()=>{
  for(const documentId of [id,'B-10-2026-0424','RC-10-2026-0441']) {
    const motionWork={...work,id:'eli/dl/doc/'+documentId,identifier:documentId,work_type:'def/ep-document-types/'+(documentId===id?'REPORT_PLENARY':documentId.startsWith('RC-')?'RESOLUTION_MOTION_JOINT':'RESOLUTION_MOTION')};
    const amendment={...indexed,id:documentId+'-AM-40',targetDocumentId:documentId,listId:documentId+'-AM-037-046',language:'ga',baseline:'unknown',originalText:'19. An téacs bunaidh;',proposedText:'19. Téacs leasaithe;',targetLabel:'Mír 19',targetLabelLanguage:'ga'};
    const paragraphs=['Parlaimint na hEorpa,',amendment.originalText,'20. An chéad mhír eile;'];
    const text={...summary,textLanguage:'ga',paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))};
    const request={...query(),id:documentId,language:'ga',amendmentId:amendment.id,listId:amendment.listId,wordingLanguage:'ga'};
    for(const baseline of ['motion-resolution','unknown',null,undefined]) {
      const variant={...amendment,baseline};
      if(baseline===undefined)delete variant.baseline;
      const reader=service({request:async()=>record(motionWork),readText:async()=>text,findAmendment:()=>variant});
      const result=await reader.query(request,{store:{}});
      assert.equal(result.placement.status,'placed',documentId+' / '+baseline);assert.deepEqual(result.placement.span,{start:1,end:1});
      assert.equal(result.amendment.variants[0].baseline,baseline??null,'source category is retained without conversion to another baseline');
    }
    for(const [baseline,reason] of [['commission-proposal','proposal_baseline_unavailable'],['present-text','existing-law-target-unavailable'],['council-position','council_position_unavailable'],['other','baseline_unavailable']]) {
      const blocked=service({request:async()=>record(motionWork),readText:async()=>text,findAmendment:()=>({...amendment,baseline,baselineSource:{category:baseline,conflicted:false}}),readProposal:async()=>({status:'unresolved',items:[],gaps:['proposal-identity-unavailable'],evidence:[]})});
      assert.equal((await blocked.query(request,{store:{}})).placement.reason,reason,baseline);
    }
    const noResolution=service({request:async()=>record(motionWork),readText:async()=>({...text,paragraphs:[...paragraphs.slice(1)],paragraphSources:text.paragraphSources.slice(1)}),findAmendment:()=>amendment});
    assert.equal((await noResolution.query(request,{store:{}})).placement.reason,'baseline_unavailable');
  }
});


for(const heading of ['Follow-up:','Further action:','Follow-up.','Further action;'])test(`DOCX ${heading} does not extend paragraph 19 across a heading`,()=>{
  const paragraphs=['The European Parliament,','19. Calls for:','– first item;',heading,'follow-up prose;','20. Next;'];
  const xml='<w:document xmlns:w="urn:word"><w:body>'+paragraphs.map(value=>'<w:p><w:r><w:t>'+value+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>';
  const text={...docxContent(archive(xml,'<w:styles xmlns:w="urn:word"/>')),textLanguage:'en'};
  const inserted=resolveAmendmentPlacement(text,{language:'en',originalText:'',proposedText:'New;',targetLabel:'Paragraph 19 a (new)'});
  assert.equal(inserted.reason,'resolution_extent_uncertain');
  assert.equal(resolveAmendmentPlacement(text,{language:'en',originalText:'follow-up prose;',proposedText:'Changed;'}).reason,'target_not_found');
  assert.equal(resolveAmendmentPlacement(text,{language:'en',originalText:'20. Next;',proposedText:'Changed;',targetLabel:'Paragraph 20'}).status,'placed');
});

for (const [name,properties,styles,level] of [
  ['inherited Heading 1','<w:pStyle w:val="FollowUp"/>','<w:style w:type="paragraph" w:styleId="Heading1"><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="FollowUp"><w:basedOn w:val="Heading1"/></w:style>',1],
  ['Heading 2','<w:pStyle w:val="Heading2"/>','<w:style w:type="paragraph" w:styleId="Heading2"><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>',2],
  ['direct outline 4','<w:outlineLvl w:val="3"/>','',4],
  ['direct outline 9','<w:outlineLvl w:val="8"/>','',6],
])for (const heading of ['Further action and monitoring.','Follow-up actions and recommendations;'])test(`DOCX ${name} excludes punctuated heading prose from context placement: ${heading}`,async()=>{
  const paragraph=value=>'<w:p><w:r><w:t>'+value+'</w:t></w:r></w:p>';
  const title='<w:p><w:pPr>'+properties+'</w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>'+heading+'</w:t></w:r></w:p>';
  const prose='<w:p><w:hyperlink r:id="source"><w:r><w:t>follow-up prose;</w:t></w:r></w:hyperlink><w:r><w:footnoteReference w:id="1"/></w:r></w:p>';
  const xml='<w:document xmlns:w="urn:word" xmlns:r="urn:relationships"><w:body>'+paragraph('The European Parliament,')+paragraph('19. Calls for:')+paragraph('– first item;')+title+prose+paragraph('20. Next;')+'</w:body></w:document>';
  const parsed=docxContent(archive(xml,'<w:styles xmlns:w="urn:word">'+styles+'</w:styles>',{
    'word/_rels/document.xml.rels':'<Relationships><Relationship Id="source" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.europarl.europa.eu/" TargetMode="External"/></Relationships>',
    'word/footnotes.xml':'<w:footnotes xmlns:w="urn:word"><w:footnote w:id="1">'+paragraph('Source note.')+'</w:footnote></w:footnotes>',
  }));
  assert.equal(parsed.paragraphFormats[3].heading,level);
  assert.deepEqual(parsed.links,[{paragraph:4,start:0,end:16,url:'https://www.europarl.europa.eu/'}]);
  assert.deepEqual(parsed.anchors,[{paragraph:4,offset:16,note:'1',label:'1'}]);
  const text={...summary,...parsed},before=structuredClone(text);
  const units=segmentMotionUnits(text,'en');assert.equal(units.find(unit=>unit.label==='19').end,2);assert.equal(units.find(unit=>unit.kind==='heading').start,3);
  for (const [originalText,proposedText,targetLabel,reason] of [
    ['','19a. New;','Paragraph 19 a (new)','resolution_extent_uncertain'],
    ['19. Calls for: – first item;','Changed;','Paragraph 19',null],
    ['19. Calls for:','Changed;','Paragraph 19','resolution_extent_uncertain'],
    ['– first item;','Changed;',null,'resolution_extent_uncertain'],
    [heading,'Changed;',null,'target_not_found'],
    ['follow-up prose;','Changed;',null,'target_not_found'],
    ['follow-up prose;','deleted',null,'target_not_found'],
    ['20. Next;','Changed;','Paragraph 20',null],
  ]) {
    const amendment={...indexed,baseline:'motion-resolution',originalText,proposedText,targetLabel,targetLabelLanguage:'en'};
    const reader=service({readText:async()=>text,findAmendment:()=>amendment});
    const result=await reader.query(query({amendmentId,listId,wordingLanguage:'en'}),{store:{}});
    if(reason) {assert.equal(result.placement.status,'unresolved');assert.equal(result.placement.reason,reason);}
    else {assert.equal(result.placement.status,'placed');assert.deepEqual(result.placement.span,targetLabel==='Paragraph 19'?{start:1,end:2}:{start:5,end:5});}
    assert.deepEqual(result.document.selectedText,before,'full source, formatting, links, notes and offsets remain intact');
    assert.equal(result.target.evidence.amendmentId,amendmentId);assert.equal(result.target.evidence.listId,listId);assert.equal(result.target.evidence.wordingLanguage,'en');
  }
  assert.deepEqual(text,before);
});


test('indexed comparison conflicts block only the selected variant and retain the complete source descriptor',async()=>{
  const paragraphs=['The European Parliament,','19. Original wording;','20. Next;'];
  const text={...summary,paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))};
  const headings=[{left:{raw:'Motion for a resolution',category:'motion-resolution'},right:{raw:'Amendment',category:'other'}},{left:{raw:'Text proposed by the Commission',category:'commission-proposal'},right:{raw:'Amendment',category:'other'}}];
  for(const conflicted of [true,false,undefined]) {
    const baselineSource={category:'unknown',headings,language:'en',sourceUrl:source.url,fetchedAt:source.fetchedAt,...(conflicted===undefined?{}:{conflicted})};
    const selected={...indexed,baseline:'unknown',baselineSource,originalText:paragraphs[1],proposedText:'19. Revised wording;',targetLabel:'Paragraph 19',targetLabelLanguage:'en'};
    const alternate={...selected,language:'fr',baselineSource:{...baselineSource,conflicted:true}};
    const reader=service({readText:async()=>text,findAmendment:()=>({...selected,variants:[selected,alternate]})});
    const result=await reader.query(query({amendmentId,listId,wordingLanguage:'en'}),{store:{}});
    assert.equal(result.amendment.basis,'index');assert.deepEqual(result.amendment.variants[0].baselineSource,baselineSource);assert.equal(result.amendment.variants[0].baseline,'unknown');
    assert.equal(result.placement.status,conflicted===true?'unresolved':'placed');
    if(conflicted===true){assert.equal(result.placement.reason,'conflicting_baselines');assert.equal(result.placement.span,undefined);}
    else assert.deepEqual(result.placement.span,{start:1,end:1});
  }
});

test('published comparison headings retain conflict provenance while withholding motion recovery',async()=>{
  const p=text=>'<w:p><w:r><w:t>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t></w:r></w:p>';
  const table=(heading,before,after)=>'<w:tbl><w:tr><w:tc>'+p(heading)+'</w:tc><w:tc>'+p('Amendment')+'</w:tc></w:tr><w:tr><w:tc>'+p(before)+'</w:tc><w:tc>'+p(after)+'</w:tc></w:tr></w:tbl>';
  const paragraphs=['The European Parliament,','19. Original wording continued;','20. Next;'];
  const text={...summary,paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))};
  const cases=[
    {headings:['Motion for a resolution','Text proposed by the Commission'],category:'unknown',conflicted:true},
    {headings:['Text proposed by the Commission','Council position'],category:'unknown',conflicted:true},
    ...[['Motion for a resolution','motion-resolution'],['Unrecognised source label','unknown'],['Text proposed by the Commission','commission-proposal'],['Council position','council-position'],['Present text','present-text']].map(([heading,category])=>({headings:[heading,heading],category,conflicted:false})),
  ];
  for(const scenario of cases) {
    const xml='<w:document xmlns:w="urn:word"><w:body>'+p('<Amend><NumAm>40</NumAm><DocAmend>Proposal for a regulation</DocAmend><Article>Paragraph 19</Article>')+table(scenario.headings[0],'19. Original wording','19. Revised wording')+table(scenario.headings[1],'continued;','continued with changes;')+p('</Amend>')+'</w:body></w:document>';
    const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+id],is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:source.url}]}]};
    const reader=service({request:async()=>record({...work,inverse_foresees_change_of:[list]}),download:async()=>({buffer:archive(xml,'<w:styles xmlns:w="urn:word"/>'),resolvedSourceUrl:source.url}),readText:async()=>text,readProposal:async()=>({status:'unresolved',items:[],gaps:['proposal-identity-unavailable'],evidence:[]})});
    const result=await reader.query(query({amendmentId,listId,wordingLanguage:'en'}));
    const [variant]=result.amendment.variants;
    assert.equal(result.amendment.basis,'published-list');assert.equal(variant.wordingStatus,'available',JSON.stringify({scenario,variant}));assert.equal(variant.baseline,scenario.category);
    assert.equal(variant.baselineSource.category,scenario.category);assert.equal(variant.baselineSource.conflicted,scenario.conflicted);assert.deepEqual(variant.baselineSource.headings.map(row=>row.left.raw),scenario.headings);
    assert.equal(variant.baselineSource.language,'en');assert.equal(variant.baselineSource.sourceUrl,source.url);assert.equal(variant.baselineSource.fetchedAt,source.fetchedAt);
    assert.equal(variant.gaps.some(gap=>gap.code==='baseline-conflict'),scenario.conflicted);
    if(scenario.conflicted){assert.equal(result.placement.status,'unresolved');assert.equal(result.placement.reason,'conflicting_baselines');assert.equal(result.placement.span,undefined);}
    else if(['motion-resolution','unknown'].includes(scenario.category)){assert.equal(result.placement.status,'placed');assert.deepEqual(result.placement.span,{start:1,end:1});}
    else assert.equal(result.placement.reason,scenario.category==='commission-proposal'?'proposal_baseline_unavailable':scenario.category==='present-text'?'existing-law-target-unavailable':scenario.category==='council-position'?'council_position_unavailable':'baseline_unavailable');
  }
});

for(const basis of ['index','published-list'])test(`${basis} Commission routing requires matching category and explicit non-conflict evidence`,async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-docx-excerpts-20261016.json',import.meta.url))).documents.find(row=>row.targetDocumentId==='A-10-2025-0085');
  const documentId=fixture.targetDocumentId,amendmentId=documentId+'-AM-7',listId=fixture.listId;
  const buffer=archive(fixture.documentXml,fixture.stylesXml);
  const extraction=extractAmendments(buffer,{listId,targetDocumentId:documentId,language:'en',sourceUrl:fixture.sourceUrl,fetchedAt:source.fetchedAt});
  const published=extraction.amendments.find(row=>row.number===7);
  assert.equal(published.baselineSource.conflicted,false);
  const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+documentId],is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:fixture.sourceUrl}]}]};
  const report={...work,id:'eli/dl/doc/'+documentId,identifier:documentId,inverse_foresees_change_of:[list]};
  const cases=[
    {name:'confirmed',baseline:'commission-proposal',baselineSource:published.baselineSource,reads:1,reason:'proposal_baseline_unavailable'},
    {name:'conflicting',baseline:'commission-proposal',baselineSource:{...published.baselineSource,conflicted:true},reads:0,reason:'conflicting_baselines'},
    {name:'missing conflict',baseline:'commission-proposal',baselineSource:Object.fromEntries(Object.entries(published.baselineSource).filter(([key])=>key!=='conflicted')),reads:0,reason:'baseline_unavailable'},
    {name:'unknown conflict',baseline:'commission-proposal',baselineSource:{...published.baselineSource,conflicted:null},reads:0,reason:'baseline_unavailable'},
    {name:'missing source',baseline:'commission-proposal',baselineSource:null,reads:0,reason:'baseline_unavailable'},
    {name:'category disagreement',baseline:'commission-proposal',baselineSource:{...published.baselineSource,category:'motion-resolution'},reads:0,reason:'baseline_unavailable'},
    {name:'unknown category',baseline:'commission-proposal',baselineSource:{...published.baselineSource,category:'unknown'},reads:0,reason:'baseline_unavailable'},
    {name:'baseline disagreement',baseline:'other',baselineSource:published.baselineSource,reads:0,reason:'baseline_unavailable'},
    ...['unknown','motion-resolution','present-text','council-position'].map(baseline=>({name:'conflicting '+baseline,baseline,baselineSource:{...published.baselineSource,category:baseline,conflicted:true},reads:0,reason:'conflicting_baselines'})),
  ];
  for(const scenario of cases){
    let proposalReads=0;
    const fields={baseline:scenario.baseline,baselineSource:scenario.baselineSource};
    const selected={...published,...fields,id:amendmentId,targetDocumentId:documentId,listId,language:'en',textIntegrity:'complete',wordingSource:source,
      decisions:[{id:'one',amendmentIds:[amendmentId],reference:'Paragraph 19',source},{id:'two',amendmentIds:[amendmentId],reference:'Paragraph 20',source}]};
    // Conflicting target references must not replace a comparison-conflict result.
    if(scenario.reason!=='conflicting_baselines')delete selected.decisions;
    const reader=service({request:async()=>record(report),findAmendment:()=>basis==='index'?selected:null,download:async url=>({buffer,resolvedSourceUrl:url}),
      readProposal:async()=>{proposalReads++;return {status:'unresolved',items:[],gaps:['proposal-identity-unavailable'],evidence:[]};}});
    if(basis==='published-list'){
      const readList=reader.readList.bind(reader);
      reader.readList=async(...args)=>{const value=await readList(...args);return {...value,extraction:{...value.extraction,amendments:value.extraction.amendments.map(row=>row.number===7?{...row,...fields}:row)}};};
    }
    const result=await reader.query(documentContextQuery(documentId,new URLSearchParams({amendment:amendmentId,list:listId,'wording-lang':'en'})),{store:basis==='index'?{}:null});
    assert.equal(result.amendment.basis,basis,scenario.name);assert.equal(result.amendment.variants[0].baseline,scenario.baseline,scenario.name);
    assert.deepEqual(result.amendment.variants[0].baselineSource,scenario.baselineSource,scenario.name);
    assert.equal(proposalReads,scenario.reads,scenario.name);assert.equal(result.placement.status,'unresolved',scenario.name);assert.equal(result.placement.reason,scenario.reason,scenario.name);
    if(!scenario.reads){assert.equal(result.baseline,null,scenario.name);assert.equal(result.proposal,null,scenario.name);assert.deepEqual(result.document.selectedText,summary,scenario.name);}
  }
});

test('unparsed vote descriptions stay in provenance without overriding a comparable location',async()=>{
  const paragraphs=['The European Parliament,','– having regard to public sources,','19. Exact wording;','20. Next;'];
  const text={...summary,paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))};
  for(const references of [['Compromise amendment','Joint statement on the report'],['Compromise amendment','Paragraph 19'],['Compromise amendment','Paragraph 20'],['Paragraph 19','Paragraph 20']]) {
    const decisions=references.map((reference,i)=>({id:'MTG-PL-2026-10-07-DEC-'+(197430+i),amendmentIds:[amendmentId],reference,source}));
    const reader=service({readText:async()=>text,findAmendment:()=>({...indexed,baseline:'motion-resolution',targetLabel:'Paragraph 19',targetLabelLanguage:'en',originalText:paragraphs[2],decisions})});
    const result=await reader.query(query({amendmentId}),{store:{}});
    assert.equal(result.placement.status,references.includes('Paragraph 20')?'unresolved':'placed');
    assert.deepEqual(result.target.evidence.referenceDecisions.map(d=>d.reference),references);
  }
});

test('indexed wording ranges remain tied to their exact selected source columns',async()=>{
  const originalFormatting=[{start:2,end:3,kind:'subscript'}],proposedFormatting=[{start:2,end:3,kind:'superscript'}];
  const reader=service({findAmendment:()=>({...indexed,originalText:'CO2',proposedText:'CO2',originalFormatting,proposedFormatting})});
  const result=await reader.query(query({amendmentId,listId,includeBody:false}),{store:{}});
  assert.deepEqual(result.amendment.variants[0].originalFormatting,originalFormatting);
  assert.deepEqual(result.amendment.variants[0].proposedFormatting,proposedFormatting);
});

test('a selected unaffected language edition has no placement, replacement target or legal-baseline acquisition',async()=>{
  const note='(Ne concerne pas la version française.)';
  const selected={...indexed,language:'fr',targetLabelLanguage:'fr',originalText:'C. Texte existant.',proposedText:note,baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false}};
  const reader=service({findAmendment:()=>selected,readText:async()=>({...summary,textLanguage:'fr',paragraphs:['C. Texte existant.']}),readProposal:async()=>assert.fail('An unaffected edition needs no legal baseline')});
  const result=await reader.query(query({language:'fr',amendmentId,listId,wordingLanguage:'fr'}),{store:{}});
  assert.equal(result.placement.status,'not-applicable');assert.equal(result.placement.operation,null);
  assert.equal(result.target.status,'unavailable');assert.equal(result.target.reason,'language-version-unaffected');
  assert.deepEqual(result.target.paragraphs,[]);assert.equal(result.baseline,null);assert.equal(result.proposal,null);
  assert.equal(result.amendment.variants[0].proposedText,note);
  assert.equal(result.target.evidence.wordingLanguage,'fr');
  assert.deepEqual(result.document.selectedText.paragraphs,['C. Texte existant.']);
});

for(const baseline of ['motion-resolution','commission-proposal','council-position','present-text'])test('an unaffected French edition does not describe the English document: '+baseline,async()=>{
  const note='(Ne concerne pas la version française.)';
  const selected={...indexed,language:'fr',targetLabelLanguage:'fr',originalText:'C. Texte existant.',proposedText:note,baseline,baselineSource:{category:baseline,conflicted:false}};
  const reader=service({findAmendment:()=>selected,readText:async()=>({...summary,availableTextLanguages:['en','fr']}),
    readProposal:async()=>assert.fail('A language-scope note needs no proposal baseline'),
    readCouncil:async()=>assert.fail('A language-scope note needs no Council baseline'),
    readExistingLaw:async()=>assert.fail('A language-scope note needs no existing-law baseline')});
  const result=await reader.query(query({amendmentId,listId,wordingLanguage:'fr'}),{store:{}});
  assert.equal(result.placement.status,'unresolved');assert.equal(result.placement.operation,null);
  assert.equal(result.placement.reason,'different_text_languages');assert.deepEqual(result.placement.evidence,[]);
  assert.equal(result.target.status,'unavailable');assert.equal(result.target.reason,'different-text-languages');
  assert.deepEqual(result.target.paragraphs,[]);assert.equal(result.baseline,null);assert.equal(result.proposal,null);
  assert.equal(result.amendment.variants[0].proposedText,note);assert.equal(result.target.evidence.wordingLanguage,'fr');
  assert.deepEqual(result.document.selectedText.paragraphs,summary.paragraphs);
});

test('wording-only scope notes leave the document target unrequested',async()=>{
  const note='(Ne concerne pas la version française.)';
  const reader=service({findAmendment:()=>({...indexed,language:'fr',proposedText:note}),readText:async()=>assert.fail('Wording-only requests do not read document text')});
  const result=await reader.query(query({amendmentId,listId,wordingLanguage:'fr',includeBody:false}),{store:{}});
  assert.equal(result.target.status,'not-requested');assert.equal(result.target.reason,null);
  assert.deepEqual(result.target.paragraphs,[]);assert.equal(result.placement,null);
  assert.equal(result.amendment.variants[0].proposedText,note);assert.equal(result.target.evidence.wordingLanguage,'fr');
});

for(const baseline of ['motion-resolution','commission-proposal','council-position','present-text'])test('mixed scope notes preserve changed footnotes and matching-language baseline reads without a splice: '+baseline,async()=>{
  const example=JSON.parse(readFileSync(new URL('./fixtures/amendment-language-layouts.json',import.meta.url))).examples.find(row=>row.language==='sk'&&row.number===53);
  const selected={...indexed,...example,id:amendmentId,listId,baseline,baselineSource:{category:baseline,conflicted:false},targetLabelLanguage:'sk'};
  const calls=[];
  const read=async(kind,request)=>{assert.equal(request.language,'sk');calls.push(kind);return {status:'unavailable',language:'sk',items:[],gaps:['test-baseline-unavailable'],evidence:[]};};
  const reader=service({findAmendment:()=>selected,readText:async()=>({...summary,textLanguage:'en',availableTextLanguages:['en','sk'],paragraphs:['Original document stays intact.']}),
    readProposal:request=>read('commission-proposal',request),readCouncil:request=>read('council-position',request),readExistingLaw:request=>read('present-text',request)});
  for(const includeBody of [true,false]) {
    const result=await reader.query(query({amendmentId,listId,wordingLanguage:'sk',includeBody}),{store:{}});
    assert.equal(result.amendment.variants[0].originalText,example.originalText);assert.equal(result.amendment.variants[0].proposedText,example.proposedText);
    assert.equal(result.proposal,null);assert.deepEqual(result.target.paragraphs,[]);
    if(includeBody) {
      assert.equal(result.placement.status,'unresolved');assert.equal(result.placement.operation,null);assert.equal(result.placement.reason,'language_scope_mixed');
      assert.equal(result.placement.evidence[0].status,'partial');assert.equal(result.placement.evidence[0].field,'proposedText');
      assert.equal(result.target.reason,'mixed-language-scope');assert.equal(result.target.evidence.wordingLanguage,'sk');
      if(baseline==='motion-resolution')assert.equal(result.baseline,null);
      else {assert.equal(result.baseline.language,'sk');assert.equal(result.baseline.status,'unavailable');}
      assert.deepEqual(result.document.selectedText.paragraphs,['Original document stays intact.']);
    } else {assert.equal(result.target.status,'not-requested');assert.equal(result.target.reason,null);assert.equal(result.placement,null);assert.equal(result.baseline,null);}
  }
  assert.deepEqual(calls,baseline==='motion-resolution'?[]:[baseline]);
});

for(const broken of [false,true])test('mixed scope retains readable legal context or its explicit source gap without changing the placement reason: '+broken,async()=>{
  const example=JSON.parse(readFileSync(new URL('./fixtures/amendment-language-layouts.json',import.meta.url))).examples.find(row=>row.language==='sk'&&row.number===53);
  const selected={...indexed,...example,id:amendmentId,listId,baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false},targetLabelLanguage:'sk'};
  const xml='<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Článok 1</w:t></w:r></w:p><w:p><w:r><w:t>1. Readable original legal text.</w:t></w:r></w:p></w:body></w:document>';
  const reader=service({findAmendment:()=>selected,readProposal:async request=>{assert.equal(request.language,'sk');return {status:'available',workId:'exact-work',language:'sk',gaps:[],evidence:[],items:[{kind:'act',index:1,itemId:'exact-item',expressionId:'exact-expression',buffer:broken?Buffer.from('Not a DOCX'):archive(xml,'<w:styles xmlns:w="urn:word"/>'),source:{url:'https://publications.europa.eu/resource/celex/52025PC0087',sha256:'a'.repeat(64),fetchedAt:new Date(at).toISOString()}}]};}});
  const result=await reader.query(query({amendmentId,listId,wordingLanguage:'sk'}),{store:{}});
  assert.equal(result.placement.status,'unresolved');assert.equal(result.placement.operation,null);assert.equal(result.placement.reason,'language_scope_mixed');assert.equal(result.placement.splice,undefined);
  assert.equal(result.baseline.language,'sk');assert.equal(result.amendment.variants[0].proposedText,example.proposedText);
  if(broken){assert.equal(result.proposal,null);assert.equal(result.baseline.status,'unavailable');assert(result.baseline.gaps.includes('proposal-projection-unavailable'));}
  else {assert.equal(result.baseline.status,'available');assert.equal(result.document.selectedText,undefined);assert(result.proposal.items[0].proposal.paragraphs.some(p=>p.text==='1. Readable original legal text.'));}
});

for(const status of ['error','unavailable','available'])test('a selected file language without body paragraphs does not override a standalone scope note: '+status,async()=>{
  const note='(Ne concerne pas la version française.)';
  const selected={...indexed,language:'fr',targetLabelLanguage:'fr',proposedText:note,baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false}};
  const missing={...summary,status,textLanguage:'en',availableTextLanguages:['en','fr'],paragraphs:[]};
  const reader=service({findAmendment:()=>selected,readText:async()=>missing,readProposal:async()=>assert.fail('Standalone scope notes need no legal baseline')});
  const result=await reader.query(query({amendmentId,listId,wordingLanguage:'fr'}),{store:{}});
  assert.equal(result.placement.status,'not-applicable');assert.equal(result.placement.operation,null);assert.equal(result.placement.reason,'language_version_unaffected');
  assert.equal(result.placement.evidence[0].note,note);assert.equal(result.placement.evidence[0].language,'fr');
  assert.equal(result.target.reason,'language-version-unaffected');assert.deepEqual(result.target.paragraphs,[]);
  assert.equal(result.document.selectedText.status,status);assert.deepEqual(result.document.selectedText.paragraphs,[]);
  const ordinary=service({findAmendment:()=>({...indexed,language:'fr',originalText:'Original français.',proposedText:'Nouveau texte.'}),readText:async()=>missing});
  const value=await ordinary.query(query({amendmentId,listId,wordingLanguage:'fr'}),{store:{}});
  assert.equal(value.target.status,'unavailable');assert.equal(value.target.reason,'source_structure_unavailable');
});

test('historical public reports remain readable on demand without expanding indexed amendment scope',()=>{
  for(const id of ['A-8-2017-0014','A-8-2016-0283','TA-8-2015-0263'])assert.equal(documentContextQuery(id,new URLSearchParams({lang:'en'})).id,id);
  assert.throws(()=>documentContextQuery('A-11-2027-0001',new URLSearchParams({lang:'en'})));
});
