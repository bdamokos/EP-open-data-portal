import test from 'node:test';import assert from 'node:assert/strict';import {deflateRawSync} from 'node:zlib';
import {extractAmendments} from '../server/amendment-documents.mjs';import {documentContextPlacement} from '../server/document-context-placement.mjs';import {resolveAmendmentPlacement} from '../server/document-context-model.mjs';import {verifyPlacement} from './amendment-benchmark-model.mjs';
function zip(xml){
  const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}

// B-10-2026-0333-AM-002-011_en.docx prints stamp7, heading11, Paragraph9.
const p=text=>'<w:p><w:r><w:t>'+text+'</w:t></w:r></w:p>',cell=s=>'<w:tc>'+p(s)+'</w:tc>',row=(a,b)=>'<w:tr>'+cell(a)+cell(b)+'</w:tr>';
const original='9. Calls on the Member States to ensure that survivors of rape have full access to medical services;',proposed='9. Calls on the Member States to ensure that survivors of rape have access to the full range of services;';
const block=(stamp,heading)=>p('&lt;Amend&gt;&lt;ANo&gt;B10-0333&lt;/ANo&gt;/&lt;NumAm&gt;'+stamp+'&lt;/NumAm&gt;')+p('Amendment &lt;NumAm&gt;'+heading+'&lt;/NumAm&gt;')+p('&lt;Article&gt;Paragraph 9&lt;/Article&gt;')+'<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>'+row('Motion for a resolution','Amendment')+row(original,proposed)+'</w:tbl>'+p('&lt;/Amend&gt;');
const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+block(7,7)+block(7,11)+'</w:body></w:document>';
function input(rewrite=s=>s){const buffer=zip(rewrite(xml)),extraction=extractAmendments(buffer,{language:'en',listId:'B-10-2026-0333-AM-007-011'}),wording=extraction.amendments.find(a=>a.number===11);const paragraphs=['The European Parliament,','1. First provision.',original,'10. Last provision.'];const text={structureStatus:'extracted',textLanguage:'en',paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({ordinal,path:'body/p'+ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphFormats:paragraphs.map(()=>({}))};return {wording,text,voteReferences:['§ 9'],nativeQuoted:{number:11,amendmentBuffer:buffer},extraction};}
const place=a=>resolveAmendmentPlacement(a.text,{...a.wording,resolutionDocument:true,numberingReferenceTexts:a.voteReferences});
test('visible heading number needs an agreeing vote and the exact complete original',()=>{
 const a=input();assert(a.wording);assert(a.extraction.amendments.some(a=>a.number===7),'the real AM7 remains');
 const placement=place(a);assert.equal(placement.status,'placed',placement.reason);assert.deepEqual(placement.span,{start:2,end:2});assert.equal(verifyPlacement({...a,placement}).status,'verified');
 // API variants omit number; the endpoint wrapper supplies the requested AM number.
 const {number,...variant}=a.wording;const wrapped=documentContextPlacement({chosen:{...variant,targetLabelLanguage:'en'},amendmentNumber:11,text:a.text,referenceTexts:a.voteReferences,resolutionDocument:true});assert.equal(wrapped.status,'placed');
 for(const change of [a=>a.voteReferences=[],a=>a.voteReferences=['§ 8'],a=>a.voteReferences.push('§ 8'),a=>a.text.paragraphSources[2].complete=false,a=>a.wording.originalText+='.',a=>a.wording.number=12]){const a=input();change(a);assert.equal(place(a).status,'unresolved',String(change));}
});
test('independent native numbering proof rejects changed columns, stamps and boundaries',()=>{
 const a=input(),placement=place(a);
 assert.equal(verifyPlacement({...a,placement:{...placement,span:{start:2,end:3}}}).status,'failed');
 assert.equal(verifyPlacement({...a,wording:{...a.wording,proposedText:'Other text.'},placement}).status,'failed');
 for(const change of [a=>a.voteReferences=[],a=>a.voteReferences=['§ 8'],a=>a.text.paragraphs[2]+='.',a=>a.nativeQuoted.number=12]){const a=input();change(a);assert.notEqual(verifyPlacement({...a,placement}).status,'verified');}
});
