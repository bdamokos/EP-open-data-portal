import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {nativeBlankPairs,rawResolutionUnits} from './amendment-benchmark-resolution-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/resolution-blank-boundaries.json',import.meta.url)));
const wrap=body=>'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>';
function zip(document,extra={}) {
  const locals=[],centrals=[],entries=Object.entries({'word/document.xml':document,...extra});let offset=0;
  for(const [file,xml] of entries) {
    const name=Buffer.from(file),body=Buffer.from(xml),compressed=deflateRawSync(body),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,name,compressed);centrals.push(central,name);offset+=30+name.length+compressed.length;
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
function input(xml) {
 const nativeBuffer=zip(wrap(xml)),body=quotedWordBody(nativeBuffer),visible=body.filter(row=>row.kind==='paragraph'&&row.text.trim());
 return {nativeBuffer,paragraphs:visible.map(row=>row.text.trim()),paragraphFormats:visible.map(()=>({})),paragraphSources:visible.map((row,i)=>({path:row.path,container:'body',containerPath:'/w:document[1]/w:body[1]',ordinal:body.indexOf(row),segment:i,complete:true}))};
}
test('native corpus blank pairs are independent of production continuity claims',()=>{
 for(const row of fixture){const text=input(row.paragraphXml.join(''));for(const source of text.paragraphSources)Object.defineProperty(source,'previousParagraph',{get(){throw Error('placer proof forbidden');}});assert.equal(nativeBlankPairs(text).size>0,!['A-10-2026-0042','A-10-2026-0081'].includes(row.documentId),row.documentId+':'+row.label);}
});
test('native omitted content cannot be waived by a forged placer continuity marker',()=>{
 const row=fixture[1],original=input(row.paragraphXml.join(''));
 for(const gap of ['<w:p><w:r><w:t>hidden continuation</w:t></w:r></w:p>','<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden</w:t></w:r></w:p>','<w:tbl/>','<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:p>']){
 const text={...original,nativeBuffer:zip(wrap(row.paragraphXml[0]+gap+row.paragraphXml[2]))};assert.equal(nativeBlankPairs(text).size,0);
 }
 assert.equal(nativeBlankPairs({...original,nativeBuffer:undefined}).size,0);
 const clipped={...original,paragraphs:original.paragraphs.map((value,i)=>i===0?value.slice(0,40):value)};assert.equal(nativeBlankPairs(clipped).size,0);
});
test('literal Finnish pre-first insertion requires the exact raw paragraph-one boundary',()=>{
 const text=input('<w:p><w:r><w:t>EUROOPAN PARLAMENTIN PÄÄTÖSLAUSELMAESITYS</w:t></w:r></w:p><w:p><w:r><w:t>Euroopan parlamentti,</w:t></w:r></w:p><w:p><w:r><w:t>1. First provision;</w:t></w:r></w:p><w:p><w:r><w:t>2. Next provision;</w:t></w:r></w:p>');
 // Consecutive native rows retain ordinary structure for the established oracle.
 text.paragraphSources.forEach(source=>source.segment=0);
 for(const suffix of ['', ' a',' b',' c']){
 const wording={language:'fi',baseline:'motion-resolution',targetLabel:'-1'+suffix+' kohta (uusi)',originalText:'',proposedText:'-1'+suffix+'. New text;'};
 const placement={status:'placed',operation:'insert',insertBefore:2,insertAfter:1};
 assert.equal(verifyPlacement({text,wording,placement}).status,'verified');
 assert.equal(verifyPlacement({text,wording,placement:{...placement,insertBefore:3,insertAfter:2}}).status,'failed');
 }
});

test('cached Finnish comparison fields independently identify all four negative insertions',()=>{
 const example=JSON.parse(readFileSync(new URL('./fixtures/resolution-negative-insertions.json',import.meta.url)));
 const text=input('<w:p><w:r><w:t>EUROOPAN PARLAMENTIN PÄÄTÖSLAUSELMAESITYS</w:t></w:r></w:p><w:p><w:r><w:t>Euroopan parlamentti,</w:t></w:r></w:p>'+example.sourceXml.join(''));
 text.paragraphSources.forEach(source=>source.segment=0);
 for(const row of example.amendments){const wording={...row,language:'fi',baseline:'motion-resolution'};
 assert.equal(verifyPlacement({text,wording,placement:{status:'placed',operation:'insert',insertBefore:3,insertAfter:2}}).status,'verified',row.id);}
});

test('direct hidden blank properties cannot complete a raw resolution unit',()=>{
 const p=value=>'<w:p><w:r><w:t>'+value+'</w:t></w:r></w:p>';
 for(const hidden of ['', '<w:rPr><w:vanish/></w:rPr>']){
  const text=input(p('The European Parliament,')+p('1. First;')+'<w:p><w:pPr>'+hidden+'</w:pPr></w:p>'+p('2. Next;'));
  assert.equal(rawResolutionUnits(text,'en').units.find(unit=>unit.label==='1')?.complete,!hidden);
 }
});
test('Finnish native correspondence rejects a relabelled paragraph two and incomplete first extent',()=>{
 const example=JSON.parse(readFileSync(new URL('./fixtures/resolution-negative-insertions.json',import.meta.url)));
 const body=example.resolutionHeadingXml+'<w:p><w:r><w:t>Euroopan parlamentti,</w:t></w:r></w:p>'+example.sourceXml.join('');
 const make=()=>{const text=input(body);text.paragraphSources.forEach(source=>source.segment=0);return text;};
 const wording={...example.amendments[0],language:'fi',baseline:'motion-resolution'},placement={status:'placed',operation:'insert',insertBefore:3,insertAfter:2};
 let text=make();text.paragraphs[3]=text.paragraphs[4].replace(/^2[.]/u,'1.');text.paragraphSources[3]={...text.paragraphSources[4]};
 assert.notEqual(verifyPlacement({text,wording,placement}).status,'verified');
 text=make();text.paragraphSources[4].segment=1;assert.notEqual(verifyPlacement({text,wording,placement}).status,'verified');
});
test('cached automatic recital and paragraph numbers independently certify blank pairs',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/resolution-automatic-blank-boundaries.json',import.meta.url)));
 const buffer=zip(wrap(fixture.bodyXml),{'word/numbering.xml':fixture.numberingXml});
 const body=quotedWordBody(buffer),visible=body.filter(row=>row.kind==='paragraph'&&row.text.trim());
 const text={nativeBuffer:buffer,paragraphs:visible.map(row=>(row.numberingLabel?row.numberingLabel+'\t':'')+row.text.trim()),paragraphFormats:visible.map(()=>({})),paragraphSources:visible.map(row=>({path:row.path,container:'body',containerPath:'/w:document[1]/w:body[1]',ordinal:body.indexOf(row),segment:body.indexOf(row),complete:true}))};
 assert.equal(visible.filter(row=>row.numberingLabel).map(row=>row.numberingLabel).join(','),'A.,B.,C.,D.,E.,F.,1.,2.,3.,4.,5.,6.,7.,8.,9.');
 const units=rawResolutionUnits(text,'en').units;for(const label of ['D','1','2','5'])assert.equal(units.find(unit=>unit.label===label&&unit.kind===(label==='D'?'recital':'paragraph'))?.complete,true,label);
});
