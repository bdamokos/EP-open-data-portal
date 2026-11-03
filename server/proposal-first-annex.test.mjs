import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {documentContextPlacement} from './document-context-placement.mjs';
import {DocumentContext,documentContextQuery} from './document-context.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
import {firstAnnexNative,firstAnnexZip} from '../scripts/fixtures/first-annex-native.mjs';
import {docxParts} from './document-text.mjs';import {parseProposal} from './proposal-structure.mjs';
const place=input=>resolveProposalPlacement(input.items,input.wording,{nativeProposalInputs:[input.nativeQuoted.proposalBuffer]});
test('a complete first-annex payload follows the native signature before the financial statement',()=>{
 for(const target of ['Annex 1 - Indicators','Annex I - Indicators','Annex - Indicators','Annex']){
  const input=firstAnnexNative({target}),placement=place(input);assert.equal(placement.status,'placed');assert.equal(placement.insertAfter,input.placement.insertAfter);assert.equal(placement.insertBefore,input.placement.insertBefore);assert.equal(verifyPlacement({...input,placement}).status,'verified');
 }
});
test('missing bytes, ambiguous source paths and incomplete boundaries withhold the new family',()=>{
 const input=firstAnnexNative();assert.equal(resolveProposalPlacement(input.items,input.wording).status,'unresolved');
 for(const mutate of [x=>x.proposal.sourceHash='wrong',x=>x.nativeQuoted.proposalBuffer=Buffer.from('wrong'),x=>x.proposal.paragraphs[x.placement.insertAfter].complete=false,x=>x.proposal.paragraphs[x.placement.insertBefore].source.ordinal++,x=>x.items.push(x.items[0]),x=>x.items[0].kind='annex',x=>x.wording.targetPath.underlying=[{raw:'Annex I'}],x=>x.wording.language='fr']){const input=firstAnnexNative();mutate(input);assert.equal(place(input).status,'unresolved');}
});
test('hidden and wrapped native competitors cannot disappear from first-annex proof',()=>{
 for(const text of ['ANNEX I','Done at Brussels,','For the European Parliament\tFor the Council','The President\tThe President','LEGISLATIVE FINANCIAL AND DIGITAL STATEMENT'])for(const wrap of [p=>p,p=>'<w:sdt><w:sdtContent>'+p+'</w:sdtContent></w:sdt>']){
  const extra=wrap('<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:ins><w:t>'+text+'</w:t></w:ins></w:r></w:p>'),input=firstAnnexNative({sourceChange:xml=>xml.replace('</w:body>',extra+'</w:body>')});assert.equal(place(input).status,'unresolved');assert.notEqual(verifyPlacement(input).status,'verified');
 }
});
test('first-annex scope, native visibility and Word namespaces remain strict',()=>{
 for(const sourceChange of [xml=>xml.replace('Fait','Other'),xml=>xml.replace('<w:t>Done at Brussels,</w:t>','<w:unknown/><w:t>Done at Brussels,</w:t>'),xml=>xml.replace('<w:t>Article 1</w:t>','<w:fldSimple><w:r><w:t>Article 1</w:t></w:r></w:fldSimple>'),xml=>xml.replace('<w:t>Done at Brussels,</w:t>','<w:t xmlns:w="urn:foreign">Done at Brussels,</w:t>'),xml=>xml.replace('The President\tThe President','Other signatory')])assert.equal(place(firstAnnexNative({sourceChange})).status,'unresolved');
 for(const mutate of [x=>x.wording.proposedText=x.wording.proposedText.replace('ANNEX','TABLE'),x=>x.wording.proposedText+='\n…',x=>x.wording.proposedText=x.wording.proposedText.replace('ANNEX','ANNEX II'),x=>x.wording.targetLabel='Annex II - Indicators',x=>x.wording.documentReferences=[],x=>x.wording.documentReferences[0].raw='Proposal for a directive']){const input=firstAnnexNative();mutate(input);assert.equal(place(input).status,'unresolved');}
 const input=firstAnnexNative(),parts=docxParts(input.nativeQuoted.proposalBuffer);parts.set('word/numbering.xml','<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:lvlText w:val="ANNEX %1"/></w:lvl></w:abstractNum></w:numbering>');input.nativeQuoted.proposalBuffer=firstAnnexZip(Object.fromEntries(parts));input.items[0].proposal=parseProposal(input.nativeQuoted.proposalBuffer,{language:'en',item:'act'});input.proposal=input.items[0].proposal;assert.equal(place(input).status,'unresolved');assert.notEqual(verifyPlacement(input).status,'verified');
});
test('the shared live/replay selector forwards bytes privately',()=>{
 const input=firstAnnexNative(),chosen={...input.wording,targetLabelLanguage:'en'},selected=documentContextPlacement({chosen,items:input.items,nativeProposalInputs:[input.nativeQuoted.proposalBuffer]});assert.equal(selected.status,'placed');assert.equal(documentContextPlacement({chosen,items:input.items}).status,'unresolved');assert.equal(JSON.stringify(selected).includes('Buffer'),false);
});
test('deleted and field text remain competing native annex evidence',()=>{
 for(const tag of ['w:delText','w:instrText']){const extra='<w:p><w:r><'+tag+'>ANNEX I</'+tag+'></w:r></w:p>',input=firstAnnexNative({sourceChange:xml=>xml.replace('</w:body>',extra+'</w:body>')});assert.equal(place(input).status,'unresolved');}
});
test('the live endpoint keeps request-local source bytes out of its public projection',async()=>{
 const input=firstAnnexNative(),id='A-10-2026-0001',listId=id+'-AM-001-001',source={url:'https://data.europarl.europa.eu/distribution/doc/test_en.docx',fetchedAt:'2026-11-03T10:00:00Z',language:'en',sha256:createHash('sha256').update(input.nativeQuoted.proposalBuffer).digest('hex')},work={id:'eli/dl/doc/'+id,identifier:id,document_date:'2026-09-15',work_type:'def/ep-document-types/REPORT_PLENARY',title_dcterms:{en:'Test'},is_realized_by:[]};
 const reader=new DocumentContext({request:async()=>({payload:{data:[work]},fetchedAt:Date.parse(source.fetchedAt)}),readText:async()=>({status:'available',paragraphs:['Report'],textLanguage:'en',structureStatus:'extracted'}),findAmendment:()=>({...input.wording,id:id+'-AM-1',targetDocumentId:id,listId,language:'en',textIntegrity:'complete',wordingSource:source,authors:[]}),readProposal:async()=>({status:'available',language:'en',workId:'test',gaps:[],evidence:[],items:[{kind:'act',index:1,itemId:'test',buffer:input.nativeQuoted.proposalBuffer,source}]})});
 const query={...documentContextQuery(id,new URLSearchParams()),amendmentId:id+'-AM-1',listId,wordingLanguage:'en'},result=await reader.query(query,{store:{}});assert.equal(result.placement?.status,'placed');assert.equal(result.placement.insertBefore,input.placement.insertBefore);assert.equal(Object.hasOwn(result,'nativeProposalInputs'),false);assert.equal(JSON.stringify(result).includes('"type":"Buffer"'),false);
});

test('unsupported Word namespace aliases withhold the native first-annex family',()=>{
 const URI='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 for(const prefix of ['x','word']){
  const extra=`<${prefix}:p xmlns:${prefix}="${URI}"><${prefix}:r><${prefix}:t>ANNEX I</${prefix}:t></${prefix}:r></${prefix}:p>`;
  for(const input of [firstAnnexNative({sourceChange:xml=>xml.replace('</w:body>',extra+'</w:body>')}),firstAnnexNative({stylesChange:xml=>xml.replace('w:styleId="Fait" w:type="paragraph"/>',`w:styleId="Fait" w:type="paragraph" xmlns:${prefix}="${URI}"><w:rPr><${prefix}:vanish/></w:rPr></w:style>`)})]){assert.equal(place(input).status,'unresolved');assert.notEqual(verifyPlacement(input).status,'verified');}
 }
 const input=firstAnnexNative(),parts=docxParts(input.nativeQuoted.proposalBuffer);parts.set('word/numbering.xml',`<x:numbering xmlns:x="${URI}"><x:abstractNum x:abstractNumId="1"><x:lvl x:ilvl="0"><x:lvlText x:val="ANNEX %1"/></x:lvl></x:abstractNum></x:numbering>`);input.nativeQuoted.proposalBuffer=firstAnnexZip(Object.fromEntries(parts));input.proposal.sourceHash=createHash('sha256').update(input.nativeQuoted.proposalBuffer).digest('hex');assert.equal(place(input).status,'unresolved');assert.notEqual(verifyPlacement(input).status,'verified');
 const canonical=firstAnnexNative({sourceChange:xml=>xml.replace('<w:t>Done at Brussels,',`<w:t xmlns:w="${URI}">Done at Brussels,`)});assert.equal(place(canonical).status,'placed');assert.equal(verifyPlacement(canonical).status,'verified');
});
