import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {nativeBlankPairs,rawResolutionUnits,assertTerminalIndent,assertSwedishRecommendation} from './amendment-benchmark-resolution-oracle.mjs';
import {verifyPlacement,parseBenchmarkTarget} from './amendment-benchmark-model.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/resolution-blank-boundaries.json',import.meta.url)));
test('a fully emphasized numbered section title does not duplicate a recital',()=>{
 const paragraphs=['The European Parliament,','V. whereas a recital;','W. whereas another;','42. Previous;','V. Rule of law','43. Next;'];
 const text={paragraphs,paragraphFormats:paragraphs.map((v,i)=>i===4?{marks:[{kind:'bold',start:0,end:v.length},{kind:'italic',start:0,end:v.length}]}:{}),paragraphSources:paragraphs.map((_,ordinal)=>({path:'p'+ordinal,container:'body',containerPath:'body',ordinal,segment:0,complete:true}))};
 const units=rawResolutionUnits(text,'en').units;
 assert.deepEqual(units.filter(u=>u.kind==='recital'&&u.label==='V').map(u=>u.start),[1]);
});

test('a bounded source editorial reference is not recital wording',()=>{
 const paragraphs=['The European Parliament,','AG. whereas original;','(Ex AM 49 (Or. EN) of FdR example.docx)','AH. whereas next;','1. Operative;'];
 const text={paragraphs,paragraphFormats:paragraphs.map(()=>({})),paragraphSources:paragraphs.map((_,ordinal)=>({path:'p'+ordinal,container:'body',containerPath:'body',ordinal,segment:0,complete:true}))};
 const raw=rawResolutionUnits(text,'en'),ag=raw.units.find(u=>u.label==='AG');
 assert.deepEqual({start:ag.start,end:ag.end,complete:ag.complete},{start:1,end:1,complete:true});
 for(const altered of ['(Ex AM 49 (Or. EN) of FdR example.pdf)','(Some legal continuation)','(Ex AM 49 (Or. EN) of FdR example.docx) (whereas safeguards apply in annex.docx)','(Ex AM49 (Or. EN) of FdR example.docx) (whereas safeguards apply)','(Ex  AM 49 (Or. EN) of FdR example.docx) (whereas safeguards apply)','(Ex AM 49 (Or. EN) of FdR example\n.docx)','(Ex AM 49 (Or. EN) of FdR example.docx)\n']) {
  const modified={...text,paragraphs:paragraphs.map((v,i)=>i===2?altered:v)};
  assert.notEqual(rawResolutionUnits(modified,'en').units.find(u=>u.label==='AG').end,1);
  const wording={language:'en',baseline:'motion-resolution',targetLabel:'Recital AG',originalText:'AG. whereas original;',proposedText:'AG. whereas changed;'};
  assert.notEqual(verifyPlacement({text:modified,wording,placement:{status:'placed',operation:'replace',span:{start:1,end:1}}}).status,'verified');
 }
});

test('raw terminal indent proof requires the complete dash list and next paragraph',()=>{
 const paragraphs=['The European Parliament,','122. Observes:','– first;','– second;','– third;','123. Next;'];
 const text={paragraphs,paragraphFormats:paragraphs.map((_,i)=>({indent:i>=2&&i<=4?4.72:2.36,hanging:2.36})),paragraphSources:paragraphs.map((_,ordinal)=>({path:'p'+ordinal,container:'body',containerPath:'body',ordinal,segment:0,complete:true}))};
 const wording={language:'en',baseline:'motion-resolution',targetLabel:'Paragraph 122 – indent 3 a (new)',originalText:'',proposedText:'– New item;'},placement={operation:'insert',insertAfter:4,insertBefore:5};
 assert.equal(assertTerminalIndent({text,wording,placement}).status,'verified');
 assert.equal(parseBenchmarkTarget(wording).complete,true);
 assert.equal(verifyPlacement({text,wording,placement:{...placement,status:'placed'}}).status,'verified');
 for(const index of [2,3,4]){const modified={...text,paragraphSources:text.paragraphSources.map((v,i)=>i===index?{...v,complete:false}:v)};assert.equal(assertTerminalIndent({text:modified,wording,placement}).status,'unverified');}
 assert.notEqual(assertTerminalIndent({text,wording,placement:{...placement,insertAfter:3}}).status,'verified');
 const multiline={...text,paragraphs:paragraphs.map((v,i)=>i===2?'– first;\n– extra;':v)};
 const nested={...text,paragraphFormats:text.paragraphFormats.map((v,i)=>i===3?{...v,indent:7}:v)};
 const duplicate={...text,paragraphs:[...paragraphs,'122. damaged duplicate;'],paragraphFormats:[...text.paragraphFormats,{}],paragraphSources:[...text.paragraphSources,{path:'p6',container:'body',containerPath:'body',ordinal:6,segment:0,complete:false}]};
 for(const modified of [multiline,nested,duplicate]) {
  assert.notEqual(assertTerminalIndent({text:modified,wording,placement}).status,'verified');
  assert.notEqual(verifyPlacement({text:modified,wording,placement:{...placement,status:'placed'}}).status,'verified');
 }

});
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
test('native recommendation proof requires the identified annex and point boundaries',()=>{
 const p=value=>'<w:p><w:r><w:t>'+value+'</w:t></w:r></w:p>';
 const text=input(p('BILAGA TILL RESOLUTIONSFÖRSLAGET')+p('Rekommendation 5')+p('Ämne')+p('1. Original;')+p('2. Nästa;')+p('Rekommendation 6')+p('MOTIVERING'));
 text.paragraphSources.forEach(source=>source.segment=0);
 const wording={language:'sv',baseline:'motion-resolution',targetLabel:'Bilaga I – rekommendation 5 – punkt 1',originalText:'1. Original;',proposedText:'1. Ändrad;'},placement={status:'placed',operation:'replace',span:{start:3,end:3}};
 assert.equal(assertSwedishRecommendation({text,wording,placement}).status,'verified');
 assert.equal(verifyPlacement({text,wording,placement}).status,'verified');
 for(const change of [x=>x.wording.originalText='1. Different;',x=>x.placement.span={start:4,end:4},x=>x.text.paragraphSources[3].complete=false]) {const modified={text:{...text,paragraphSources:text.paragraphSources.map(s=>({...s}))},wording:{...wording},placement:{...placement}};change(modified);assert.notEqual(assertSwedishRecommendation(modified).status,'verified');}
});
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
 const units=rawResolutionUnits(text,'en',{includeTables:true}).units;for(const label of ['D','1','2','5'])assert.equal(units.find(unit=>unit.label===label&&unit.kind===(label==='D'?'recital':'paragraph'))?.complete,true,label);
});

import {docxContent} from '../server/document-text.mjs';
import {nativeAttachedTables} from './amendment-table-oracle.mjs';
test('native table boundaries include all cells before the following numbered paragraph',()=>{
  const source=fixture.find(row=>row.documentId==='A-10-2026-0081');
  const xml=wrap('<w:p><w:r><w:t>The European Parliament,</w:t></w:r></w:p>'+source.paragraphXml.join(''));
  const nativeBuffer=zip(xml),text={...docxContent(nativeBuffer),nativeBuffer};
  const tables=nativeAttachedTables(text);
  assert.deepEqual(tables,[{start:1,end:84,following:85,label:'149'}]);
  const units=rawResolutionUnits(text,'en',{includeTables:true}).units;
  assert.equal(units.find(unit=>unit.label==='149').complete,true);
  for(const suffix of ['a','b']) {
    const wording={language:'en',baseline:'motion-resolution',targetLabel:'Paragraph 149 '+suffix+' (new)',originalText:'',proposedText:'New provision;'};
    const placement={operation:'insert',status:'placed',insertAfter:84,insertBefore:85};
    assert.equal(verifyPlacement({text,wording,placement}).status,'verified');
    assert.equal(verifyPlacement({text,wording,placement:{...placement,insertAfter:1,insertBefore:2}}).status,'failed');
  }
  assert.deepEqual(nativeAttachedTables({...text,nativeBuffer:null}),[]);
  const changed={...text,paragraphs:text.paragraphs.map((value,index)=>index===5?value+' omitted':value)};
  assert.deepEqual(nativeAttachedTables(changed),[]);
  const incomplete={...text,paragraphSources:text.paragraphSources.map((value,index)=>index===5?{...value,complete:false}:value)};
  assert.deepEqual(nativeAttachedTables(incomplete),[]);
});
test('a wholly italic title closes a paragraph only between consecutive raw numbers',()=>{
 // A-10-2026-0085 prints its recurring "Recommendations" titles in italics only.
 const rows=(title,next,before='81. Recalls the earlier findings;')=>{
  const paragraphs=['The European Parliament,',before,title,next];
  return {paragraphs,paragraphFormats:paragraphs.map((value,i)=>i===2?{marks:[{kind:'italic',start:0,end:value.length}]}:{}),
   paragraphSources:paragraphs.map((_,ordinal)=>({path:'p'+ordinal,container:'body',containerPath:'body',ordinal,segment:0,complete:true}))};
 };
 const unit=text=>rawResolutionUnits(text,'en').units.find(candidate=>candidate.label==='81');
 assert.deepEqual([unit(rows('Recommendations','82. Calls on the Commission to:')).end,unit(rows('Recommendations','82. Calls on the Commission to:')).complete],[1,true]);
 assert.equal(unit(rows('Recommendations','83. Calls on the Commission to:')).complete,false,'a skipped number leaves the extent open');
 assert.equal(unit(rows('Recommendations','82. Calls;','81. Calls on the Commission to:')).complete,false,'an introduced list may continue');
 const plain=rows('Recommendations','82. Calls;');plain.paragraphFormats[2]={};
 assert.equal(unit(plain).complete,false,'unformatted titles remain uncertain');
 const partial=rows('Recommendations','82. Calls;');partial.paragraphFormats[2]={marks:[{kind:'italic',start:0,end:5}]};
 assert.equal(unit(partial).complete,false,'partial emphasis is not a title');
});
test('an italic title separated by native blank rows still closes the preceding paragraph',()=>{
 // A-10-2026-0025 (EN) prints empty Word paragraphs around its italic titles.
 const p=value=>'<w:p><w:r><w:t>'+value+'</w:t></w:r></w:p>',blank='<w:p><w:pPr><w:ind w:left="567"/></w:pPr></w:p>';
 const build=gap=>{
  const text=input(p('The European Parliament,')+p('27. Calls for new dwellings;')+blank+p('Granting legal certainty')+gap+p('28. Stresses the balance;'));
  text.paragraphSources.forEach(source=>source.segment=0);
  text.paragraphFormats[2]={marks:[{kind:'italic',start:0,end:text.paragraphs[2].length}]};
  return text;
 };
 const unit=text=>rawResolutionUnits(text,'en').units.find(candidate=>candidate.label==='27');
 const certified=build(blank);
 assert.equal(certified.paragraphSources[3].ordinal-certified.paragraphSources[2].ordinal,2,'the fixture omits a blank row before 28');
 assert.equal(unit(certified).complete,true);
 const tabled=build('<w:tbl/>');
 assert.equal(tabled.paragraphs.length,certified.paragraphs.length,'the table is omitted like the blank row');
 assert.equal(unit(tabled).complete,false,'an omitted non-paragraph row is not certified');
 assert.equal(unit({...certified,nativeBuffer:undefined}).complete,false,'without native XML the gap is not certified');
});

test('label placement remains the oracle target when a vote list names another unit',()=>{
 const p=value=>'<w:p><w:r><w:t>'+value+'</w:t></w:r></w:p>';
 const text=input(p('The European Parliament,')+p('19. Exact wording;')+p('20. Next;')+p('21. Last;'));
 text.paragraphSources.forEach(source=>source.segment=0);
 for(const referenceText of ['After § 20','After recital D']) {
  const wording={language:'en',baseline:'motion-resolution',targetLabel:'Paragraph 19 a (new)',originalText:'',proposedText:'New wording;',referenceText};
  assert.equal(verifyPlacement({text,wording,placement:{status:'placed',operation:'insert',insertAfter:1,insertBefore:2}}).status,'verified');
  assert.equal(verifyPlacement({text,wording,placement:{status:'placed',operation:'insert',insertAfter:2,insertBefore:3}}).status,'failed');
 }
});

test('native page-break-only rows close a final paragraph before its annex',()=>{
 const p=value=>'<w:p><w:r><w:t>'+value+'</w:t></w:r></w:p>';
 const gap='<w:p><w:pPr><w:widowControl/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p><w:p/>';
 for(const [middle,expected] of [[gap,true],[gap.replace('w:type="page"','w:type="column"'),false],[gap.replace('<w:br','<w:t>Hidden</w:t><w:br'),false],[gap.replace('<w:br','<w:rPr><w:vanish/></w:rPr><w:br'),false]]){
  const buffer=zip(wrap(p('The European Parliament,')+p('50. Instructs its President to forward this resolution.')+middle+p('ANNEX: DECLARATION OF INPUT'))),body=quotedWordBody(buffer),visible=body.filter(row=>row.kind==='paragraph'&&row.text.trim());
  const text={nativeBuffer:buffer,paragraphs:visible.map(row=>row.text.trim()),paragraphFormats:visible.map(()=>({})),paragraphSources:visible.map(row=>({path:row.path,container:'body',containerPath:'/w:document[1]/w:body[1]',ordinal:body.indexOf(row),segment:body.indexOf(row),complete:true}))};
  assert.equal(rawResolutionUnits(text,'en').units.find(u=>u.label==='50')?.complete,expected);
 }
});
