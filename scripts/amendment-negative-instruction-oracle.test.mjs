import test from 'node:test';import assert from 'node:assert/strict';import {deflateRawSync} from 'node:zlib';
import {parseProposal} from '../server/proposal-structure.mjs';import {documentContextPlacement} from '../server/document-context-placement.mjs';import {instructionFrameWording,verifyPlacement} from './amendment-benchmark-model.mjs';
function zip(xml){
  const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}

// Native source shape: COM(2025)0531 Czech DOC_1, Article 2 point 2;
// amendment A-10-2026-0104-AM-102-105_cs.docx, AM104.
const p=(text,style='Normal')=>'<w:p><w:pPr><w:pStyle w:val="'+style+'"/></w:pPr><w:r><w:t>'+text+'</w:t></w:r></w:p>';
const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+p('Článek 2','Titrearticle')+p('Nařízení (ES) č. 1223/2009 se mění takto:')+p('1) jiný článek se mění takto:','Point0')+p('2) článek 15 se mění takto:','Point0')+p('a) odstavec 2 se mění takto:','Point1')+p('b) odstavec 7 se nahrazuje tímto:','Point1')+p('Článek 3','Titrearticle')+p('Další ustanovení.')+'</w:body></w:document>';
const wording={number:104,language:'cs',baseline:'present-text',baselineSource:{category:'present-text',conflicted:false},targetLabel:'Čl. 2 – odst. 1 – bod 2 – písm. -a (nové)',targetPath:{language:'cs',proposal:[],underlying:[{raw:'Čl. 15 – odst. 2 – první pododstavec'}]},documentReferences:[{field:'Article2',raw:'Čl. 15 – odst. 2 – první pododstavec'}],originalText:'Unchecked present text.',proposedText:'-a) odstavec 1 se nahrazuje tímto:\n„Nové znění.“\n(v případě přijetí se změní další odkazy)'};
function input(rewrite=s=>s){const buffer=zip(rewrite(xml)),items=[{kind:'act',proposal:parseProposal(buffer,{language:'cs'})}],placement=documentContextPlacement({chosen:wording,baseline:{status:'unresolved'},proposalItems:items});return {items,wording:instructionFrameWording(wording),placement,nativeQuoted:{proposalBuffer:buffer}};}
test('negative nested instruction uses the native first-child boundary',()=>{
 const a=input();assert.equal(a.placement.status,'placed',a.placement.reason);assert.equal(a.placement.insertBefore,4);assert.equal(verifyPlacement(a).status,'verified');
 assert(a.placement.evidence.some(e=>e.basis==='negative-nested-instruction'));
 assert.equal(verifyPlacement({...a,placement:{...a.placement,insertAfter:4,insertBefore:5}}).status,'failed');
});
test('incomplete, duplicate or differently addressed native instructions cannot prove the boundary',()=>{
 const forced={status:'placed',operation:'insert',itemIndex:0,insertBefore:4,insertAfter:3};
 for(const rewrite of [s=>s.replace('2) článek 15','2) článek 16'),s=>s.replace('a) odstavec 2','b) odstavec 2'),s=>s.replace('2) článek 15', '1) článek 15'),s=>s.replace('2) článek 15', '2) článek 15<w:drawing/>')]){
  const a=input(rewrite);assert.notEqual(verifyPlacement({...a,placement:forced}).status,'verified');
 }
});
