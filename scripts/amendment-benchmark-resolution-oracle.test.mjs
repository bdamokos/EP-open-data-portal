import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {nativeBlankPairs,rawResolutionUnits} from './amendment-benchmark-resolution-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/resolution-blank-boundaries.json',import.meta.url)));
const wrap=body=>'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>';
function zip(xml,compressed=true) {
  const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),packed=compressed?deflateRawSync(raw):raw,local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(compressed?8:0,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(compressed?8:0,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}

function input(xml) {
 const nativeBuffer=zip(wrap(xml)),body=quotedWordBody(nativeBuffer),visible=body.filter(row=>row.kind==='paragraph'&&row.text.trim());
 return {nativeBuffer,paragraphs:visible.map(row=>row.text.trim()),paragraphFormats:visible.map(()=>({})),paragraphSources:visible.map((row,i)=>({path:row.path,container:'body',containerPath:'/w:document[1]/w:body[1]',ordinal:body.indexOf(row),segment:i,complete:true}))};
}
test('native corpus blank pairs are independent of production continuity claims',()=>{
 for(const row of fixture){const text=input(row.paragraphXml.join(''));for(const source of text.paragraphSources)Object.defineProperty(source,'previousParagraph',{get(){throw Error('placer proof forbidden');}});assert.equal(nativeBlankPairs(text).size>0,row.documentId!=='A-10-2026-0042',row.documentId+':'+row.label);}
});
test('native omitted content cannot be waived by a forged placer continuity marker',()=>{
 const row=fixture[0],original=input(row.paragraphXml.join(''));
 for(const gap of ['<w:p><w:r><w:t>hidden continuation</w:t></w:r></w:p>','<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden</w:t></w:r></w:p>','<w:tbl/>','<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:p>']){
 const text={...original,nativeBuffer:zip(wrap(row.paragraphXml[0]+gap+row.paragraphXml[2]))};assert.equal(nativeBlankPairs(text).size,0);
 }
 assert.equal(nativeBlankPairs({...original,nativeBuffer:undefined}).size,0);
 const clipped={...original,paragraphs:original.paragraphs.map((value,i)=>i===0?value.slice(0,40):value)};assert.equal(nativeBlankPairs(clipped).size,0);
});
test('literal Finnish pre-first insertion requires the exact raw paragraph-one boundary',()=>{
 const text=input('<w:p><w:r><w:t>Euroopan parlamentti,</w:t></w:r></w:p><w:p><w:r><w:t>1. First provision;</w:t></w:r></w:p><w:p><w:r><w:t>2. Next provision;</w:t></w:r></w:p>');
 // Consecutive native rows retain ordinary structure for the established oracle.
 text.paragraphSources.forEach(source=>source.segment=0);
 for(const suffix of ['', ' a',' b',' c']){
 const wording={language:'fi',baseline:'motion-resolution',targetLabel:'-1'+suffix+' kohta (uusi)',originalText:'',proposedText:'-1'+suffix+'. New text;'};
 const placement={status:'placed',operation:'insert',insertBefore:1,insertAfter:0};
 assert.equal(verifyPlacement({text,wording,placement}).status,'verified');
 assert.equal(verifyPlacement({text,wording,placement:{...placement,insertBefore:2,insertAfter:1}}).status,'failed');
 }
});

test('cached Finnish comparison fields independently identify all four negative insertions',()=>{
 const example=JSON.parse(readFileSync(new URL('./fixtures/resolution-negative-insertions.json',import.meta.url)));
 const text=input('<w:p><w:r><w:t>Euroopan parlamentti,</w:t></w:r></w:p>'+example.sourceXml.join(''));
 text.paragraphSources.forEach(source=>source.segment=0);
 for(const row of example.amendments){const wording={...row,language:'fi',baseline:'motion-resolution'};
 assert.equal(verifyPlacement({text,wording,placement:{status:'placed',operation:'insert',insertBefore:2,insertAfter:1}}).status,'verified',row.id);}
});
