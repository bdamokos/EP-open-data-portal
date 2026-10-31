import {DocumentContext} from './document-context.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {nativeNleDecisionProcedure,nativeNleReferencePair,nativeConsultationProcedure} from './commission-proposal-native-identity.mjs';
import {commissionProcedures,reportProposalReference,resolveProposalTree} from './commission-proposal-identity.mjs';
import {documentContextPlacement} from './document-context-placement.mjs';

// Small supplied XML packages, not recorded HTTP observations. Full native
// source bytes remain outside Git; the private actual-byte cohort is separate.
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function word(body) {
  const name=Buffer.from('word/document.xml'),bytes=Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  const local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+bytes.length,16);
  return Buffer.concat([local,name,bytes,central,name,end]);
}
const p=(text,style='Normal',hidden=false)=>`<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r>${hidden?'<w:rPr><w:vanish/></w:rPr>':''}<w:t>${text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</w:t></w:r></w:p>`;
const heading=(procedure='2026/0137 (NLE)',type='COUNCIL DECISION',hidden=false)=>p(procedure,'Rfrenceinterinstitutionnelle',hidden)+p('Proposal for a','Statut',hidden)+p(type,'Typedudocument',hidden);
const reportId='A-10-2026-0260',procedure='2026/0137(NLE)',reference='(COM(2026)0510 – C10-0153/2026 – '+procedure+')';
const source=(buffer,extra={})=>({buffer,reportId,...extra,source:{url:'https://example.invalid/supplied-native-fixture.docx',fetchedAt:new Date(0).toISOString(),language:'en',sha256:hash(buffer),fixture:true}});
const pair=(reportRaw=reference,listRaw=reference)=>nativeNleReferencePair({report:source(word(p('<NoDocSe>A10-0260/2026</NoDocSe>')+p('<DocRef>'+reportRaw+'</DocRef>'))),list:source(word(p('<A5Nr>A10-0260/2026</A5Nr>')+p('<NumOfAM>001-033</NumOfAM>')+p('<ReferenceNo>'+listRaw+'</ReferenceNo>')),{listId:reportId+'-AM-001-033'})},{reportId,language:'en'});
const report={id:'eli/dl/doc/'+reportId,work_type:'def/ep-document-types/REPORT_PLENARY',inverse_created_a_realization_of:['eli/dl/proc/2026-0137'],is_realized_by:[{title_alternative:{en:reference}}]};

test('NLE needs separate visible hash-bound report and exact list references',()=>{
  const native=pair();assert.equal(native.report.status,'verified');assert.equal(native.list.status,'verified');assert.equal(native.list.references[0].field,'ReferenceNo');
  assert.deepEqual(commissionProcedures(reference),[procedure]);
  assert.equal(reportProposalReference(report,{reportId,nativeReferencePair:native}).status,'resolved');
  assert.equal(reportProposalReference(report,{reportId,nativeReferencePair:structuredClone(native)}).status,'unresolved');
  assert.equal(reportProposalReference(report,{reportId}).gaps[0],'native-nle-report-reference-unavailable');
  assert.equal(reportProposalReference(report,{reportId,nativeReferencePair:pair(reference,reference.replace('0510','0511'))}).gaps[0],'native-nle-list-reference-conflict');
  assert.equal(reportProposalReference(report,{reportId,nativeReferencePair:pair(reference.replace('(NLE)','(COD)'),reference)}).gaps[0],'native-nle-report-reference-conflict');
  assert.equal(reportProposalReference({...report,inverse_created_a_realization_of:['eli/dl/proc/2026-0138']},{reportId,nativeReferencePair:native}).gaps[0],'report-procedure-mismatch');
});

test('native reference list range, report identity, language, hash and hidden text fail closed',()=>{
  const reportBytes=word(p('<NoDocSe>A10-0260/2026</NoDocSe>')+p('<DocRef>'+reference+'</DocRef>'));
  const listBytes=word(p('<A5Nr>A10-0260/2026</A5Nr>')+p('<NumOfAM>034-037</NumOfAM>')+p('<ReferenceNo>'+reference+'</ReferenceNo>'));
  const inputs={report:source(reportBytes),list:source(listBytes,{listId:reportId+'-AM-001-033'})};
  assert.equal(nativeNleReferencePair(inputs,{reportId,language:'en'}).list.reason,'native-reference-list-range');
  inputs.list=source(word(p('<A5Nr>A10-0261/2026</A5Nr>')+p('<NumOfAM>001-033</NumOfAM>')+p('<ReferenceNo>'+reference+'</ReferenceNo>')),{listId:reportId+'-AM-001-033'});
  assert.equal(nativeNleReferencePair(inputs,{reportId,language:'en'}).list.reason,'native-reference-report-identity');
  inputs.list=source(word(p('<A5Nr>A10-0260/2026</A5Nr>')+p('<NumOfAM>001-033</NumOfAM>')+p('<ReferenceNo>'+reference+'</ReferenceNo>','Normal',true)),{listId:reportId+'-AM-001-033'});
  assert.equal(nativeNleReferencePair(inputs,{reportId,language:'en'}).list.status,'unresolved');
  inputs.report.source.sha256='0'.repeat(64);assert.equal(nativeNleReferencePair(inputs,{reportId,language:'en'}).report.reason,'native-reference-source-unavailable');
  assert.equal(nativeNleReferencePair(inputs,{reportId,language:'fr'}).report.status,'unresolved');
});

test('native NLE legal heading is generic, visible, complete and distinct from CNS',()=>{
  const bytes=word(heading());assert.equal(nativeNleDecisionProcedure(bytes,{procedure,language:'en'}).status,'verified');
  const other=word(heading('2024/0007 (NLE)'));assert.equal(nativeNleDecisionProcedure(other,{procedure:'2024/0007(NLE)',language:'en'}).status,'verified');
  assert.equal(nativeConsultationProcedure(bytes,{procedure,language:'en'}).status,'unresolved');
  for(const xml of [heading('2026/0137 (CNS)'),heading(procedure,'COUNCIL DIRECTIVE'),heading().replaceAll('Rfrenceinterinstitutionnelle','Normal'),heading()+heading(),heading(undefined,undefined,true),'<w:tbl><w:tr><w:tc>'+heading()+'</w:tc></w:tr></w:tbl>'])assert.equal(nativeNleDecisionProcedure(word(xml),{procedure,language:'en'}).status,'unresolved');
  assert.equal(nativeNleDecisionProcedure(bytes,{procedure,language:'fr'}).status,'unresolved');
  assert.equal(nativeNleDecisionProcedure(bytes,{procedure:'2026/0138(NLE)',language:'en'}).reason,'native-procedure-reference-conflict');
});

test('NLE metadata retains existing COM-presence and proposal type/final checks',()=>{
  const xml=readFileSync(new URL('./fixtures/proposal-52025PC0087.rdf',import.meta.url),'utf8');
  const nle='2025/0039(NLE)',good=resolveProposalTree(xml,{celex:'52025PC0087',language:'en',procedure:nle});assert.equal(good.status,'resolved');assert.equal(good.procedure,nle);
  assert.equal(resolveProposalTree(xml,{celex:'52025PC0087',language:'en'}).procedure,null);
  assert(resolveProposalTree(xml.replaceAll('corporate-body/COM','corporate-body/CONSIL'),{celex:'52025PC0087',language:'en',procedure:nle}).gaps.includes('commission-author-unverified'));
  assert(resolveProposalTree(xml.replaceAll('>final<','>final/2<'),{celex:'52025PC0087',language:'en',procedure:nle}).gaps.includes('proposal-version-unresolved'));
  const cp=xml.replaceAll('_annexe_proposition_part','_annexe_proposition_cp_part');
  assert.equal(resolveProposalTree(cp,{celex:'52025PC0087',language:'en',procedure:nle}).status,'resolved');
  assert(resolveProposalTree(cp,{celex:'52025PC0087',language:'en',procedure:'2025/0039(COD)'}).gaps.includes('item-role-unresolved'));
});

test('NLE native evidence keeps note payloads and all unproved annex ordinals held',()=>{
  const baseline={evidence:[{kind:'native-procedure',status:'verified',procedure},{kind:'native-nle-annex-part',ordinal:null,legalPlacement:false}]};
  const chosen={baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false},language:'en',targetLabelLanguage:'en',targetLabel:'Recital 1',originalText:'Old.',proposedText:'New.\n_____\n1 Published note.'};
  const before=structuredClone(chosen);assert.equal(documentContextPlacement({chosen,baseline,items:[]}).reason,'proposal_note_scope_unavailable');assert.deepEqual(chosen,before);
  assert.equal(documentContextPlacement({chosen:{...chosen,targetLabel:'Annex I – paragraph 1',proposedText:'New.'},baseline,items:[]}).reason,'proposal_annex_ordinal_unverified');
  assert.equal(documentContextPlacement({chosen:{...chosen,proposedText:'New.'},baseline,items:[]}).reason,'proposal_baseline_unavailable');
  const supported={evidence:[{kind:'native-procedure',status:'verified',procedure},{kind:'native-nle-annex-part',ordinal:'I',legalPlacement:true}]};
  assert.equal(documentContextPlacement({chosen:{...chosen,targetLabel:'Annex I – paragraph 1',proposedText:'New.'},baseline:supported,items:[]}).reason,'proposal_baseline_unavailable');
});

test('annex ordinal evidence uses a complete native label, never a declared part number',async()=>{
  const {nativeAnnexOrdinal}=await import('./commission-proposal-native-identity.mjs');
  assert.equal(nativeAnnexOrdinal(word(p('ANNEX','Annexetitre')),{language:'en'}).reason,'native-annex-unnumbered');
  assert.equal(nativeAnnexOrdinal(word(p('ANNEX I','Annexetitre')),{language:'en'}).ordinal,'I');
  assert.equal(nativeAnnexOrdinal(word(p('Guideline 5')),{language:'en'}).reason,'native-annex-heading-unavailable');
  for(const body of [p('ANNEX I','Annexetitre',true),'<w:tbl><w:tr><w:tc>'+p('ANNEX I','Annexetitre')+'</w:tc></w:tr></w:tbl>',p('ANNEX I','Annexetitre')+p('ANNEX II','Annexetitre')])assert.equal(nativeAnnexOrdinal(word(body),{language:'en'}).status,'unresolved');
});

test('the live DocumentContext caller binds downloaded report and selected list before NLE discovery',async()=>{
  const {DocumentContext,documentContextQuery}=await import('./document-context.mjs');
  const {createProposalBaseline}=await import('./proposal-baseline.mjs');
  const rid='A-10-2025-0085',lid=rid+'-AM-002-002',ref='COM(2025)0087 – 2025/0039(NLE)',at='2026-10-27T10:00:00.000Z';
  const url=id=>'https://data.europarl.europa.eu/distribution/doc/'+id+'_en.docx';
  const declaration=id=>[{id:'eli/dl/doc/'+id+'/en',language:'http://publications.europa.eu/resource/authority/language/ENG',title_alternative:{en:ref},is_embodied_by:[{id:'eli/dl/doc/'+id+'/en/docx',format:'authority/DOCX',is_exemplified_by:url(id),issued:at,byteSize:'123'}]}];
  const list={id:'eli/dl/doc/'+lid,identifier:lid,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+rid],is_realized_by:declaration(lid)};
  const report={id:'eli/dl/doc/'+rid,identifier:rid,work_type:'def/ep-document-types/REPORT_PLENARY',inverse_created_a_realization_of:['eli/dl/proc/2025-0039'],inverse_foresees_change_of:[list],is_realized_by:declaration(rid)};
  const reportBytes=word(p('<NoDocSe>A10-0085/2025</NoDocSe>')+p('<DocRef>'+ref+'</DocRef>'));
  const cell=text=>'<w:tc>'+p(text)+'</w:tc>';
  const listBytes=word(p('<A5Nr>A10-0085/2025</A5Nr>')+p('<NumOfAM>002-002</NumOfAM>')+p('<ReferenceNo>'+ref+'</ReferenceNo>')+p('Amendment 2','AmNumberTabs')+p('Proposal for a decision','NormalBold')+p('<Article>Recital 1</Article>','NormalBold')+'<w:tbl><w:tr>'+cell('Text proposed by the Commission')+cell('Amendment')+'</w:tr><w:tr>'+cell('(1) Old wording.')+cell('(1) New wording.')+'</w:tr></w:tbl>');
  const act=word(heading('2025/0039 (NLE)')+p('THE COUNCIL OF THE EUROPEAN UNION,','Institutionquiagit')+p('Whereas:')+p('(1) Old wording.','ManualConsidrant'));
  const xml=readFileSync(new URL('./fixtures/proposal-52025PC0087.rdf',import.meta.url),'utf8').replaceAll('/PROP_REG','/PROP_DEC'),tree=resolveProposalTree(xml,{celex:'52025PC0087',language:'en',procedure:'2025/0039(NLE)'});
  const request=async()=>({payload:{data:[report]},url:'https://data.europarl.europa.eu/api/v2/plenary-documents/'+rid,fetchedAt:Date.parse(at)});
  let discoveries=0,downloads=[];
  const documents={candidates:async()=>{discoveries++;return {data:{results:{bindings:[{work:{value:tree.workId},celex:{value:'52025PC0087'},version:{value:'final'}}]}},fetchedAt:at};},metadataByWork:async work=>{assert.equal(work,tree.workId);return {xml,fetchedAt:at};},docx:async item=>{const buffer=item.kind==='act'?act:word(p('ANNEX','Annexetitre'));return {buffer,source:{url:item.itemId,language:item.languageUri,itemId:item.itemId,expressionId:item.expressionId,manifestationId:item.manifestationId,sha256:hash(buffer),fetchedAt:at}};}};
  const reader=new DocumentContext({request,clock:()=>Date.parse(at),readText:async()=>({status:'available',textLanguage:'en',paragraphs:[]}),download:async u=>{downloads.push(u);assert([url(rid),url(lid)].includes(u));return {buffer:u===url(rid)?reportBytes:listBytes,resolvedSourceUrl:u,fetchedAt:at};},readProposal:createProposalBaseline({request,documents})});
  const result=await reader.query(documentContextQuery(rid,new URLSearchParams({amendment:rid+'-AM-2',list:lid,'wording-lang':'en'})));
  assert.equal(result.baseline.status,'partial',JSON.stringify(result));assert.equal(result.placement.status,'placed',JSON.stringify(result.placement));assert.equal(discoveries,1);assert.deepEqual(downloads,[url(lid),url(rid)]);
  assert.equal(result.baseline.evidence.find(e=>e.kind==='native-nle-list-reference').source.contentHash,hash(listBytes));
  assert.equal(JSON.stringify(result).includes('"type":"Buffer"'),false);
});


test('indexed NLE proof binds the exact selected number, complete columns, target evidence and every supplied hash',async()=>{
  const listId=reportId+'-AM-001-033',query={id:reportId,amendmentId:reportId+'-AM-7'},native=pair();
  const source={url:'https://example.invalid/list.docx',language:'en',contentHash:'a'.repeat(64),sourceVersion:{byteSize:100,issued:'2026-10-01'}};
  const row={number:7,baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false,language:'en',headings:[]},documentReferences:[{field:'DocRef',raw:reference}],targetPath:{proposal:[{raw:'Recital 4'}],underlying:[],language:'en'},targetLabel:'Recital 4',originalText:'Original complete column.',proposedText:'Proposed complete column.'};
  const selected={...row,listId,language:'en',targetLabelLanguage:'en',source};
  const publication={...report,inverse_foresees_change_of:['eli/dl/doc/'+listId],is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/report.docx'}]}]};
  const cases=[
    ['published selection',()=>{},true],
    ['equivalent supplied hash',s=>s.chosen.source.sha256=s.chosen.source.contentHash,true],
    ['different retrieval time',s=>s.chosen.baselineSource.fetchedAt='2000-01-01',true],
    ['number outside selected list',s=>s.query.amendmentId=reportId+'-AM-38',false],
    ['changed original',s=>s.chosen.originalText+=' Different.',false],
    ['changed proposed',s=>s.chosen.proposedText+=' Different.',false],
    ['changed target',s=>s.chosen.targetLabel='Recital 5',false],
    ['changed baseline evidence',s=>s.chosen.baselineSource.headings=[{left:{category:'motion-resolution'}}],false],
    ['changed reference',s=>s.chosen.documentReferences[0].raw=reference.replace('0510','0511'),false],
    ['changed target path',s=>s.chosen.targetPath.proposal[0].raw='Recital 5',false],
    ['conflicting hash aliases',s=>s.chosen.source.sha256='0'.repeat(64),false],
    ['duplicate native number',s=>s.rows.push(structuredClone(row)),false],
    ['native text loss',s=>s.rows[0].gaps=[{code:'comparison-columns',number:7}],false],
  ];
  for(const [name,mutate,expected] of cases){
    const state={query:structuredClone(query),chosen:structuredClone(selected),rows:[structuredClone(row)]};mutate(state);
    const reader=new DocumentContext();let reportReads=0;
    reader.readList=async()=>{reportReads++;return {source,nativeReference:native.report};};
    const selections=new Map([[listId+'|en',{source,extraction:{amendments:state.rows},nativeReference:native.list}]]);
    const actual=await reader.readNleReferences(state.query,state.chosen,publication,()=>assert.fail('No metadata fetch'),[],selections,{});
    assert.equal(actual.list.status==='verified',expected,name);
    assert.equal(reportReads,expected?1:0,name+' rejects before loading another source');
  }
});
