import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {extractAmendments} from '../server/amendment-documents.mjs';
import {assertHorizontalInstruction} from './amendment-horizontal-instruction-oracle.mjs';
function zip(xml){
  const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}


// Native layout: A-10-2026-0266-AM-016-017_hu.docx, AM17.
// https://data.europarl.europa.eu/distribution/reds_iPlRp_Amd/A-10-2026-0266-AM-016-017/A-10-2026-0266-AM-016-017_hu.docx
const note='(Horizontális módosítás – elfogadása esetén e rendelet címét megfelelően ki kell igazítani.)';
const p=s=>'<w:p><w:r><w:t>'+s+'</w:t></w:r></w:p>';
const cell=(s,span=1)=>'<w:tc><w:tcPr><w:gridSpan w:val="'+span+'"/></w:tcPr>'+p(s)+'</w:tc>';
const row=(a,b)=>'<w:tr>'+cell(a)+cell(b)+'</w:tr>';
const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+p('&lt;Amend&gt;&lt;NumAm&gt;17&lt;/NumAm&gt;')+p('Módosítás &lt;NumAm&gt;17&lt;/NumAm&gt;')+p('&lt;Article&gt;1 cikk&lt;/Article&gt;')+'<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>'+row('A Bizottság által javasolt szöveg','Módosítás')+row('1 cikk','törölve')+row('Az (EU) 2023/1542 rendelet 56. cikke (3) bekezdésének felfüggesztése','')+'<w:tr>'+cell(note,2)+'</w:tr></w:tbl>'+p('&lt;/Amend&gt;')+'</w:body></w:document>';
const extract=xml=>extractAmendments(zip(xml),{language:'hu',listId:'A-10-2026-0266-AM-017-017'}).amendments[0];
test('full-width deletion instruction is retained separately and independently checked',()=>{
 const wording=extract(xml);assert.equal(wording.proposedText,'törölve');assert.equal(wording.documentReferences.at(-1).raw,note);assert(!wording.gaps.some(g=>g.code==='comparison-grid'));
 const input={wording,nativeQuoted:{number:17,amendmentBuffer:zip(xml)}};assert.equal(assertHorizontalInstruction(input).status,'verified');
 input.wording=structuredClone(wording);input.wording.documentReferences.at(-1).raw+=' altered';assert.equal(assertHorizontalInstruction(input).status,'failed');
});
test('substantive spans, unsupported content and non-deletion rows stay withheld',()=>{
 for(const changed of [xml.replace(note,'Ordinary legal wording'),xml.replace('törölve','Replacement text'),xml.replace(note,note+'<w:drawing/>'),xml.replace('w:val="2"','w:val="3"')]){const wording=extract(changed);assert.equal(wording.originalText,null);}
});

test('the missing ordinal dot is confined to the addressed article heading',async()=>{
 const {parseProposal}=await import('../server/proposal-structure.mjs'),{resolveProposalPlacement}=await import('../server/proposal-placement.mjs'),{verifyPlacement}=await import('./amendment-benchmark-model.mjs');
 const heading=s=>'<w:p><w:pPr><w:pStyle w:val="Titrearticle"/></w:pPr><w:r><w:t>'+s+'</w:t></w:r></w:p>';
 const source=zip('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+p('ELFOGADTA EZT A RENDELETET:')+heading('1. cikk')+p('Az (EU) 2023/1542 rendelet 56. cikke (3) bekezdésének felfüggesztése')+heading('2. cikk')+p('Másik rendelkezés.')+'</w:body></w:document>');
 const items=[{kind:'act',proposal:parseProposal(source,{language:'hu'})}],wording=extract(xml),placement=resolveProposalPlacement(items,wording);
 assert.equal(placement.status,'placed',placement.reason);assert.equal(placement.operation,'delete');
 assert.equal(verifyPlacement({items,wording,placement,nativeQuoted:{number:17,amendmentBuffer:zip(xml),proposalBuffer:source}}).status,'verified');
 for(const revision of ['ins','del','moveFrom','moveTo']){
  const changed=xml.replace(p(note),p(note).replace('<w:p>','<w:p><w:pPr><w:rPr><w:'+revision+' w:id="999"/></w:rPr></w:pPr>'));
  const extracted=extract(changed);assert.equal(extracted.originalText,null,revision);assert(extracted.gaps.some(g=>g.code==='structural-revision'),revision);
  const input={items,wording,placement,nativeQuoted:{number:17,amendmentBuffer:zip(changed),proposalBuffer:source}};
  assert.equal(assertHorizontalInstruction(input).status,'unverified',revision);
  assert.equal(verifyPlacement(input).status,'unverified',revision);
 }
 const historical=xml.replace(p(note),p(note).replace('<w:p>','<w:p><w:pPr><w:pPrChange w:id="999"><w:pPr><w:rPr><w:ins w:id="998"/></w:rPr></w:pPr></w:pPrChange></w:pPr>'));
 assert.equal(assertHorizontalInstruction({wording,nativeQuoted:{number:17,amendmentBuffer:zip(historical)}}).status,'verified','historical revision markers are not current paragraph-mark changes');
 assert.equal(resolveProposalPlacement(items,{...wording,documentReferences:[]}).status,'unresolved');
 assert.equal(resolveProposalPlacement(items,{...wording,originalText:wording.originalText.replace('1542','1543')}).status,'unresolved');
});
