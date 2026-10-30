import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parsePublicLegalXhtml} from './public-legal-xhtml.mjs';
import {AmendmentFinalText,compareFinalWording,normalizeFinalWording} from './amendment-final-text.mjs';
import {resolveFinalActTree,finalActCorrespondence,createFinalActReader} from './final-act-identity.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/committee-final-text-0318.json',import.meta.url)));
const rdf=readFileSync(new URL('./fixtures/committee-final-text-0318.rdf',import.meta.url),'utf8');
const row=number=>fixture.cases.find(row=>row.number===number),hash=value=>createHash('sha256').update(value).digest('hex');
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;');
// Wrappers contain complete source paragraphs; the fixture declares their
// excerpt scope and gives the original publication hashes and attribution.
const xhtml=(article,paragraph,text)=>`<div id="art_${article}"><div id="${article.padStart(3,'0')}.${paragraph.padStart(3,'0')}"><p class="norm">${escape(text)}</p></div></div>`;
const document=(parts,language='en')=>parsePublicLegalXhtml(`<html><body>${parts.join('')}</body></html>`,{language});
const variant=entry=>({listId:entry.listId,language:'en',wordingStatus:'available',targetLabel:entry.targetLabel,originalText:entry.original,proposedText:entry.proposed,authors:entry.authors});
function projections(entry) {
  const [,article,paragraph]=entry.targetLabel.match(/Article (\d+) – paragraph (\d+)/u);
  return {baseline:document([xhtml(article,paragraph,entry.original)]),destination:document([xhtml(entry.finalAddress.article,entry.finalAddress.paragraph,entry.final)])};
}
const compare=(entry,extra={})=>compareFinalWording({variant:variant(entry),...projections(entry),...extra});

test('AGRI 181 and IMCO 121 retain the identical complete wording without assigning exclusive authorship',()=>{
  for(const number of [181,121]) {
    const entry=row(number),result=compare(entry);
    assert.equal(result.status,'same-wording');assert.equal(result.mapping.to,'Article 9(4)');assert.equal(result.mapping.from,'Article 7(4)');
    assert.equal(result.mapping.officialLineage,false);assert.equal(result.passages.proposed,entry.proposed);assert.equal(result.passages.destination.text,entry.final);
    assert.equal('outcome' in result,false);assert.equal('author' in result,false);
  }
  assert.notDeepEqual(row(181).authors,row(121).authors);
});

test('AGRI 171 shares an inserted phrase with a rewritten provision without a retained-change claim',()=>{
  const result=compare(row(171));assert.equal(result.status,'different-wording');assert.equal(result.wholeProvision,'different');
  assert.equal(result.mapping.to,'Article 8(3)');assert.deepEqual(result.components,[]);
});

test('a shared introductory sentence cannot compete with two uniquely identifying unchanged anchors',()=>{
  const entry=row(171),other='4. The requested enforcement authority shall inform the applicant enforcement authority without delay of any refusal to comply with a request for mutual assistance, together with the reasons for that refusal.';
  const destination=document([xhtml('8','3',entry.final),xhtml('13','4',other)]);
  const result=compare(entry,{destination});
  assert.equal(result.status,'different-wording');assert.equal(result.mapping.to,'Article 8(3)');
  const competing=document([xhtml('8','3',entry.final),xhtml('13','4',entry.final.replace(/^3\./u,'4.'))]);
  assert.equal(compare(entry,{destination:competing}).status,'unavailable');
});

test('negation, conditions, exceptions and changed actors outside shared phrases cannot retain a change',()=>{
  for(const number of [171,181]) {
    const entry=row(number);
    const changes=[
      text=>text.replace('shall inform','shall not inform'),
      text=>text.replace(/^(3\.|4\.)\s*/u,'$1 If requested, '),
      text=>text+' This obligation does not apply where the request concerns an interim measure.',
      text=>text.replace('requested enforcement authority','applicant enforcement authority'),
      text=>text.replace(/\.$/u,' only if the authority agrees.'),
    ];
    for(const change of changes){
      const final=change(entry.final);if(final===entry.final)continue;
      const result=compare({...entry,final});
      assert.notEqual(result.status,'same-wording');assert.deepEqual(result.components,[]);
    }
  }
});

test('anchored notes require correspondence before a complete wording claim or passage is returned',()=>{
  const entry=row(181),note='This obligation does not apply where the request concerns an interim measure.';
  const withNote=(article,paragraph,text)=>document([xhtml(article,paragraph,text).replace('</p>','<a href="#ntr1">(1)</a></p>'),'<p class="oj-note"><a id="ntr1">(1)</a>'+escape(note)+'</p>']);
  const destination=withNote('9','4',entry.final),result=compare(entry,{destination});
  assert.equal(destination.notes[0].complete,true);assert.equal(destination.anchors.length,1);
  assert.equal(result.status,'unavailable');assert.deepEqual(result.gaps,['destination-notes-unverified']);assert.equal(result.passages,null);
  const baseline=withNote('7','4',entry.original);
  assert.deepEqual(compare(entry,{baseline}).gaps,['baseline-notes-unverified']);
  for(const variantProof of [{gaps:[{code:'notes-unavailable'}]},{source:{notesComplete:false}}]){
    assert.deepEqual(compareFinalWording({variant:{...variant(entry),...variantProof},...projections(entry)}).gaps,['amendment-notes-unverified']);
  }
  const unrelated=document([xhtml('9','4',entry.final),xhtml('10','1','Another provision.').replace('</p>','<a href="#ntr1">(1)</a></p>'),'<p class="oj-note"><a id="ntr1">(1)</a>'+escape(note)+'</p>']);
  assert.equal(compare(entry,{destination:unrelated}).status,'same-wording','notes on another provision do not qualify the selected paragraph');
});

test('AGRI 255 added request condition prevents a full or component equality claim',()=>{
  const result=compare(row(255));assert.equal(result.status,'different-wording');assert.equal(result.mapping.to,'Article 25(2)');assert.deepEqual(result.components,[]);
  const entry={...row(255),final:row(255).proposed.replace(/\.$/u,' if requested.')};
  assert.notEqual(compare(entry).status,'same-wording','even a literal proposed substring cannot retain an added condition');
});

test('AGRI 221 and 222 mandatory wording differs from the complete mapped discretionary paragraph',()=>{
  for(const number of [221,222]) {const result=compare(row(number));assert.equal(result.status,'different-wording');assert.equal(result.mapping.to,'Article 12(3)');assert.equal(result.mapping.basis,'unique-unchanged-anchors');}
  const missing=compare(row(221),{destination:document([xhtml('1','1','A different policy provision.')])});assert.equal(missing.status,'unavailable');
});

test('presentation normalization preserves qualifications, punctuation, negation, quantities and cross references',()=>{
  assert.equal(normalizeFinalWording('A\u00a0courtesy trans\u00adlation\n in English.'),'A courtesy translation in English.');
  for(const final of [row(181).final.replace('shall','shall not'),row(181).final.replace('limitation periods','30-day limitation periods'),row(181).final.replace('authority.','authority under Article 12.'),row(181).final.replace('authority.','authority;')])assert.notEqual(compare({...row(181),final}).status,'same-wording');
});

test('incomplete, ambiguous, language-mismatched or missing corresponding provisions remain unavailable',()=>{
  const entry=row(181),{destination}=projections(entry);
  const broken=structuredClone(destination);broken.paragraphs[0].complete=false;broken.units[0].complete=false;broken.units[0].children[0].complete=false;
  assert.equal(compare(entry,{destination:broken}).status,'unavailable');
  assert.equal(compare(entry,{destination:{...destination,contentComplete:false}}).status,'unavailable');
  assert.equal(compare(entry,{destination:{...destination,language:'fr'}}).status,'unavailable');
  assert.equal(compare(entry,{destination:document([xhtml('9','4',entry.final),xhtml('10','4',entry.final)])}).status,'unavailable');
  assert.equal(compare({...entry,original:entry.original.replace('shall','may')},{baseline:projections(entry).baseline}).status,'unavailable');
});

test('deletion needs verified boundaries; language notes, no-change text and new provisions stay unavailable',()=>{
  const entry=row(181);
  for(const proposed of ['', 'deleted','(Does not affect the English version.)',entry.original])assert.equal(compare({...entry,proposed}).status,'unavailable');
  assert.equal(compare({...entry,original:'',targetLabel:'Article 7 – paragraph 4 a (new)'}).status,'unavailable');
});

test('comparison budgets and cancellation cannot produce a wording claim',()=>{
  assert.equal(compare(row(181),{limits:{units:0}}).status,'unavailable');
  assert.equal(compare(row(181),{limits:{passageCharacters:10}}).status,'unavailable');
  const controller=new AbortController();controller.abort(new Error('closed'));assert.throws(()=>compare(row(181),{signal:controller.signal}),/closed/u);
});

const identity={celex:'32026R0697',procedure:'2024/0318(COD)',language:'en'};
test('original-act identity follows declared aliases and language/expression/manifestation/item edges',()=>{
  const result=resolveFinalActTree(rdf,identity);assert.equal(result.status,'available');assert.equal(result.items[0].itemId,fixture.finalAct.sourceUrl.replace('https:','http:'));
  assert.equal(result.date,'2026-03-11');assert.equal(result.ojDate,'2026-03-20');
  assert.equal(resolveFinalActTree(rdf,{...identity,celex:'02026R0697-20260409'}).status,'unavailable');
  assert.equal(resolveFinalActTree(rdf,{...identity,celex:'32026R0698'}).status,'unavailable');
  assert.equal(resolveFinalActTree(rdf,{...identity,procedure:'2025/0318(COD)'}).status,'unavailable');
  assert.equal(resolveFinalActTree(rdf,{...identity,procedure:'2024/0318(CNS)'}).status,'unavailable');
  assert.equal(resolveFinalActTree(rdf,{...identity,language:'fr'}).status,'unavailable');
  assert.equal(resolveFinalActTree(rdf.replaceAll('/corporate-body/EP','/corporate-body/COM'),identity).status,'unavailable');
  assert.equal(resolveFinalActTree(rdf.replaceAll('/resource-type/REG','/resource-type/CONS_TEXT'),identity).status,'unavailable');
});

test('a competing XHTML manifestation, expression or item is never silently selected',()=>{
  const suffix=rdf.match(/(<[^>]+Description[^>]+about="[^"]+\.0006\.03"[\s\S]*?<\/[^>]+Description>)/u)?.[1];assert(suffix);
  const competing=rdf.replace(/<\/[^>]+RDF>\s*$/u,suffix.replaceAll('.0006.03','.0006.04')+'$&');
  assert.equal(resolveFinalActTree(competing,identity).status,'unavailable');
});

test('resolution-only correspondence requires the complete explicit statement and declared language',()=>{
  const source={url:'https://example.test/text',contentHash:hash('source')},text={paragraphs:[fixture.correspondence.text]};
  assert.equal(finalActCorrespondence(text,{language:'en',source}).celex,'32026R0697');
  assert.equal(finalActCorrespondence({paragraphs:['Having regard to Regulation (EU) 2026/697.']},{language:'en',source}).status,'unavailable');
  assert.equal(finalActCorrespondence(text,{language:'fr',source}).status,'unavailable');
  assert.equal(finalActCorrespondence({...text,paragraphSources:[{complete:false}]},{language:'en',source}).status,'unavailable');
  assert.equal(finalActCorrespondence({paragraphs:[...text.paragraphs,...text.paragraphs]},{language:'en',source}).status,'unavailable');
});

test('the actual final-act reader verifies body identity, bounds, freshness and complete extraction',async()=>{
  const buffer=Buffer.from(`<html><body>${xhtml('9','4',row(181).final)}</body></html>`),declaration=resolveFinalActTree(rdf,identity).items[0];let reads=0;
  const documents={metadata:async()=>({xml:rdf,url:'https://publications.europa.eu/resource/celex/32026R0697'}),content:async selected=>{reads++;assert.equal(selected.itemId,declaration.itemId);return {buffer,source:{url:fixture.finalAct.sourceUrl,sha256:hash(buffer),stale:false}};}};
  const correspondence={status:'available',celex:identity.celex,evidence:[]};
  const result=await createFinalActReader({documents})({...identity,correspondence});assert.equal(result.status,'available');assert.equal(result.items[0].proposal.complete,true);
  assert.equal((await createFinalActReader({documents,bodyBytes:10})({...identity,correspondence})).gaps[0],'final-act-body-budget');
  assert.equal((await createFinalActReader({documents,metadataBytes:10})({...identity,correspondence})).gaps[0],'final-act-metadata-budget');assert.equal(reads,2);
  const direct={metadata:documents.metadata,request:async(url,options)=>{assert.equal(options.maximum,2048);assert.equal(options.accept,'application/xhtml+xml');return {status:200,url,buffer};}};
  assert.equal((await createFinalActReader({documents:direct,bodyBytes:2048})({...identity,correspondence})).status,'available');
  direct.request=async url=>({status:200,url,buffer:Buffer.from(buffer.toString().replace('<html>','<html lang="fr">'))});
  assert.equal((await createFinalActReader({documents:direct,bodyBytes:2048})({...identity,correspondence})).gaps[0],'final-act-body-language-conflict');
});

function serviceHarness(entry=row(181),options={}) {
  const listId=entry.listId,root=listId.startsWith('IMCO')?'IMCO-PA-770204':'AGRI-PR-773115',report='A-10-2025-0153',adopted='TA-10-2026-0048',procedure='2024-0318';
  const source=fixture.sources.find(source=>source.documentId===listId),query={id:root,amendmentId:`committee:${listId}:${entry.number}`,listId,wordingLanguage:'en',language:'en'};
  const selected={...variant(entry),source:{url:source.sourceUrl,contentHash:source.sha256},parserVersion:'test-source-excerpt'};
  const {baseline,destination}=projections(entry),context={documentId:root,amendment:{id:query.amendmentId,variants:[selected]},baseline:{kind:'commission-proposal',celex:'52024PC0576',workId:'verified-baseline-work',status:'available',items:[{source:{url:'https://publications.europa.eu/resource/celex/52024PC0576',sha256:baseline.sourceHash}}],evidence:[{kind:'cellar-identity',celex:'52024PC0576',workId:'verified-baseline-work',procedures:['2024/0318(COD)']}]},proposal:{items:[{kind:'act',index:1,proposal:baseline}]},placement:{status:'placed',itemIndex:0}};
  const work=(id,kind,extra={})=>({id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/'+kind,inverse_created_a_realization_of:['eli/dl/proc/'+procedure],...extra});
  const files=url=>[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'http://publications.europa.eu/resource/authority/file-type/DOCX',is_exemplified_by:url}]}];
  const taUrl='https://data.europarl.europa.eu/distribution/doc/TA-10-2026-0048_en.docx';
  const records={
    ['/committee-documents/'+root]:work(root,root.includes('-PA-')?'OPINION_PARLIAMENTARY_COMMITTEE_DRAFT':'REPORT_PARLIAMENTARY_COMMITTEE_DRAFT',{inverse_foresees_change_of:['eli/dl/doc/'+listId]}),
    ['/documents/'+listId]:work(listId,'AMENDMENT_LIST',{foresees_change_of:'eli/dl/doc/'+root,is_realized_by:files(source.sourceUrl)}),
    ['/procedures/'+procedure]:{id:'eli/dl/proc/'+procedure,process_type:'def/ep-procedure-types/COD',created_a_realization_of:[root,report,adopted].map(id=>'eli/dl/doc/'+id)},
    ['/plenary-documents/'+report]:work(report,'REPORT_PLENARY',{adopts:['eli/dl/doc/AGRI-PR-773115']}),
    ['/adopted-texts/'+adopted]:work(adopted,'TEXT_ADOPTED',{adopts:['eli/dl/doc/'+report],document_date:'2026-02-12',is_realized_by:files(taUrl)}),
  };
  const reads=[];let finalReads=0,textReads=0;
  const finalIdentity=resolveFinalActTree(rdf,identity),item=finalIdentity.items[0];
  const service=new AmendmentFinalText({context:{query:async()=>context},findAmendment:()=>null,request:async endpoint=>{reads.push(endpoint);assert(records[endpoint],endpoint);return {payload:{data:[records[endpoint]]},fetchedAt:Date.parse('2026-10-30'),url:'https://data.europarl.europa.eu/api/v2'+endpoint};},
    readText:async()=>{textReads++;return {status:'available',textLanguage:'en',sourceUrl:taUrl,paragraphs:[fixture.correspondence.text],paragraphSources:[],documentObjects:[],extractionVersion:'1'};},
    readFinalAct:async()=>{finalReads++;return {...finalIdentity,items:[{...item,proposal:destination,source:{url:fixture.finalAct.sourceUrl,sha256:fixture.finalAct.sha256}}]};},...options});
  return {service,context,query,records,reads,selected,counts:()=>({finalReads,textReads})};
}

test('service obtains the exact selected context and keeps resolution-only TA and final EU act separate',async()=>{
  const h=serviceHarness(),result=await h.service.query(h.query,{store:{}});
  assert.equal(result.wording.status,'same-wording');assert.equal(result.selection.source.contentHash,h.selected.source.contentHash);
  assert.equal(result.lineage.status,'partial');assert(result.lineage.gaps.includes('individual-amendment-lineage-unavailable'));
  assert.equal(result.destination.kind,'final-eu-act');assert.equal(result.stages[0].wording.status,'unavailable');assert.equal(result.stages[0].destination.kind,'parliament-adopted-text');assert.equal(result.stages[1].wording.status,'same-wording');
  assert.deepEqual(result.vote,{status:'unavailable',stage:'committee',scope:'individual-amendment',outcome:null,decisions:[]});assert.equal(h.counts().finalReads,1);
  const noBody=await h.service.query({...h.query,includeBody:false});assert.equal(noBody.wording.passages,null);assert.equal(noBody.wording.status,'same-wording');assert.equal(noBody.stages[1].wording.passages,null);
});

test('no explicit final act correspondence leaves the resolution-only publication unavailable',async()=>{
  const h=serviceHarness(undefined,{readText:async work=>({status:'available',textLanguage:'en',sourceUrl:work.is_realized_by[0].is_embodied_by[0].is_exemplified_by,paragraphs:['Parliament adopts its position.']})});
  const result=await h.service.query(h.query);assert.equal(result.wording.status,'unavailable');assert.equal(result.destination.kind,'parliament-adopted-text');assert.equal(h.counts().finalReads,0);
});

test('published adopted-text links may include a sitting activity alongside the exact procedure',async()=>{
  const h=serviceHarness(),work=h.records['/adopted-texts/TA-10-2026-0048'];
  work.inverse_created_a_realization_of.unshift('eli/dl/event/MTG-PL-2026-02-12-PVCRE-ITM-6-4');
  assert.equal((await h.service.query(h.query)).wording.status,'same-wording');
  for(const links of [
    ['eli/dl/event/MTG-PL-2026-02-12-PVCRE-ITM-6-4'],
    ['eli/dl/proc/2024-0319','eli/dl/event/MTG-PL-2026-02-12-PVCRE-ITM-6-4'],
    ['eli/dl/proc/2024-0318','eli/dl/proc/2024-0319'],
    ['eli/dl/proc/2024-0318','invalid-relationship'],
  ]) {
    work.inverse_created_a_realization_of=links;
    assert((await h.service.query(h.query)).gaps.includes('adopted-identity-conflict'));
  }
});

test('another report on the same procedure cannot supply the adopted text for a plenary amendment',async()=>{
  const h=serviceHarness(),root='A-10-2025-0152',list=root+'-AM-001-001',id=root+'-AM-1';
  const priorRoot=h.query.id,priorList=h.query.listId;
  const work=structuredClone(h.records['/committee-documents/'+priorRoot]);
  Object.assign(work,{id:'eli/dl/doc/'+root,identifier:root,work_type:'def/ep-document-types/REPORT_PLENARY',inverse_foresees_change_of:['eli/dl/doc/'+list]});
  const published=structuredClone(h.records['/documents/'+priorList]);
  Object.assign(published,{id:'eli/dl/doc/'+list,identifier:list,foresees_change_of:'eli/dl/doc/'+root});
  h.records['/plenary-documents/'+root]=work;h.records['/documents/'+list]=published;
  h.records['/procedures/2024-0318'].created_a_realization_of.push('eli/dl/doc/'+root);
  Object.assign(h.query,{id:root,listId:list,amendmentId:id});
  h.context.documentId=root;h.context.amendment.id=id;h.selected.listId=list;
  const result=await h.service.query(h.query);
  assert.equal(result.wording.status,'unavailable');assert(result.gaps.includes('adopted-text-unavailable'));
  assert.equal(h.counts().finalReads,0);
});

test('unknown and empty relationships have distinct gaps and cannot fetch an act',async()=>{
  for(const [value,gap] of [[undefined,'root-list-relationships-unavailable'],[[],'list-not-linked-to-root']]){
    const h=serviceHarness();h.records['/committee-documents/'+h.query.id].inverse_foresees_change_of=value;
    const result=await h.service.query(h.query);assert(result.gaps.includes(gap));assert.equal(h.counts().finalReads,0);
  }
});

test('competing edition, wrong baseline, wrong selected variant and changed source versions block comparisons',async()=>{
  for(const mutate of [h=>h.selected.language='fr',h=>h.selected.source.contentHash=null,h=>h.selected.wordingRetained=true,h=>h.selected.recordRetained=true,h=>h.selected.sourceFreshness={status:'pending'},h=>h.selected.sourceFreshness={status:'failed'},h=>h.context.placement.status='unresolved',h=>h.context.baseline.evidence[0].procedures=['2024/0319(COD)'],h=>h.context.baseline.items[0].source.sha256=hash('wrong-body'),h=>h.records['/documents/'+h.query.listId].is_realized_by.push(h.records['/documents/'+h.query.listId].is_realized_by[0]),h=>{h.selected.source.sourceVersion={issued:'2025-05-20'};h.records['/documents/'+h.query.listId].is_realized_by[0].is_embodied_by[0].issued='2025-05-21';}]) {
    const h=serviceHarness();mutate(h);const result=await h.service.query(h.query);assert.equal(result.wording.status,'unavailable');assert.equal(h.counts().finalReads,0);
  }
});

test('a competing Parliament publication is retained as ambiguity rather than selecting the newest date',async()=>{
  const h=serviceHarness(),id='TA-10-2026-0049',copy=structuredClone(h.records['/adopted-texts/TA-10-2026-0048']);
  copy.id='eli/dl/doc/'+id;copy.identifier=id;copy.document_date='2026-03-01';h.records['/adopted-texts/'+id]=copy;h.records['/procedures/2024-0318'].created_a_realization_of.push('eli/dl/doc/'+id);
  const result=await h.service.query(h.query);assert.equal(result.gaps[0],'competing-adopted-publications');assert.equal(h.counts().textReads,0);assert.equal(h.counts().finalReads,0);
});

test('service budgets, parent cancellation and deadline limit a lazy read without source/index writes',async()=>{
  const h=serviceHarness(undefined,{limits:{metadataReads:1}});assert.equal((await h.service.query(h.query)).gaps[0],'final-text-read-budget');
  const controller=new AbortController();controller.abort(new Error('reader closed'));await assert.rejects(h.service.query(h.query,{signal:controller.signal}),/reader closed/u);
  const slow=serviceHarness(undefined,{context:{query:()=>new Promise(()=>{})},limits:{deadlineMs:10}});
  const keeper=setTimeout(()=>{},100);try{await assert.rejects(slow.service.query(slow.query),error=>error.code==='request_timeout');}finally{clearTimeout(keeper);}
  await new Promise(resolve=>setImmediate(resolve));assert.equal(slow.service.queue.active,0,'cancelled unresponsive readers release admission');
});

test('saved individual decisions remain independent; incomplete split results withhold an outcome',async()=>{
  const decision={id:'published-decision',amendmentIds:['committee:AGRI-AM-773343:181'],outcome:'REJECTED',source:{url:'https://www.europarl.europa.eu/document.html',fetchedAt:'2026-10-30'}};
  for(const split of [false,true]) {
    const h=serviceHarness(undefined,{findAmendment:()=>({id:'committee:AGRI-AM-773343:181',targetDocumentId:'AGRI-PR-773115',decisions:[{...decision,...(split?{partId:'part-1'}:{})}],splitCoverageComplete:!split})});
    const result=await h.service.query(h.query,{store:{}});assert.equal(result.wording.status,'same-wording');assert.equal(result.vote.outcome,split?null:'REJECTED');assert.equal(result.vote.status,split?'unavailable':'available');
  }
});
