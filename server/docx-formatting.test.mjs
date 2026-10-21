import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {docxContent,documentFormatting} from './document-text.mjs';

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
const doc=body=>`<w:document xmlns:w="urn:word" xmlns:r="urn:rel"><w:body>${body}</w:body></w:document>`;
const run=(text,properties='')=>`<w:r>${properties?`<w:rPr>${properties}</w:rPr>`:''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const styles=`<w:styles xmlns:w="urn:word">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="NormalBold"><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="DocType"><w:basedOn w:val="NormalBold"/><w:pPr><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="48"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Hanging"><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567" w:hanging="567"/></w:pPr></w:style>
  <w:style w:type="character" w:styleId="Strong"><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="table" w:styleId="Grid"><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

test('paragraph styles, character toggles and direct emphasis are recorded beside unchanged text',()=>{
  const xml=doc(`<w:p><w:pPr><w:pStyle w:val="DocType"/></w:pPr>${run('MOTION')}</w:p>`
    +`<w:p><w:pPr><w:pStyle w:val="Hanging"/></w:pPr>${run('A.')}<w:r><w:tab/></w:r>${run('plain ')}${run('italic','<w:i/>')}${run(' strong','<w:rStyle w:val="Strong"/>')}${run('2','<w:vertAlign w:val="superscript"/>')}</w:p>`
    +`<w:p><w:pPr><w:pStyle w:val="NormalBold"/></w:pPr>${run('bold ')}${run('toggled off','<w:rStyle w:val="Strong"/>')}${run(' direct off','<w:b w:val="0"/>')}</w:p>`
    +`<w:p><w:pPr><w:jc w:val="both"/><w:ind w:firstLine="480"/></w:pPr>${run('small','<w:sz w:val="18"/><w:u w:val="single"/>')}</w:p>`);
  const result=docxContent(zip(xml,{'word/styles.xml':styles}));
  assert.deepEqual(result.paragraphs,['MOTION','A.\tplain italic strong2','bold toggled off direct off','small']);
  assert.deepEqual(result.paragraphFormats,[
    {align:'center',heading:1,size:'xl',marks:[{start:0,end:6,kind:'bold'}]},
    {indent:2.36,hanging:2.36,marks:[{start:15,end:22,kind:'bold'},{start:9,end:15,kind:'italic'},{start:22,end:23,kind:'superscript'}].sort((a,b)=>a.start-b.start)},
    {marks:[{start:0,end:5,kind:'bold'}]},
    {align:'justify',firstLine:2,size:'sm',marks:[{start:0,end:5,kind:'underline'}]},
  ]);
  assert.equal(documentFormatting(result).formatStatus,'extracted');
});

test('outer tables keep exact paragraph ranges, merged cells and border state; nested tables stay in their cell',()=>{
  const cell=(content,properties='')=>`<w:tc>${properties?`<w:tcPr>${properties}</w:tcPr>`:''}${content}</w:tc>`,p=text=>`<w:p>${run(text)}</w:p>`;
  const nested=`<w:tbl><w:tr>${cell(p('Inner'))}</w:tr></w:tbl>`;
  const bordered=`<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tr>${cell(p('Head'),'<w:gridSpan w:val="2"/>')}</w:tr><w:tr>${cell(p('Left'),'<w:vMerge w:val="restart"/>')}${cell(p('Right')+nested)}</w:tr><w:tr>${cell('<w:p/>','<w:vMerge/>')}${cell('<w:p/>')}</w:tr></w:tbl>`;
  const layout=`<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tr>${cell(p('Logo'),'<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>')}</w:tr></w:tbl>`;
  const result=docxContent(zip(doc(p('Before')+bordered+p('Between')+layout+`<w:tbl><w:tr>${cell('<w:p/>')}</w:tr></w:tbl>`),{'word/styles.xml':styles}));
  assert.deepEqual(result.paragraphs,['Before','Head','Left','Right','Inner','Between','Logo']);
  assert.deepEqual(result.tables,[
    {rows:[[{start:1,end:2,colSpan:2}],[{start:2,end:3,rowSpan:2},{start:3,end:5}],[{start:5,end:5}]],bordered:true},
    {rows:[[{start:6,end:7}]]},
  ],'an empty table is not laid out; borders cleared on every cell leave a layout table');
});

test('invalid or outdated formatting records are not presented',()=>{
  const record={formattingVersion:1,paragraphs:['Short'],paragraphFormats:[{marks:[{start:0,end:9,kind:'bold'}]}],tables:[]};
  assert.equal(documentFormatting(record).formatStatus,'not-extracted');
  assert.equal(documentFormatting({...record,paragraphFormats:[{}],formattingVersion:0}).formatStatus,'not-extracted');
  assert.equal(documentFormatting({...record,paragraphFormats:[{}],tables:[{rows:[[{start:0,end:2}]]}]}).formatStatus,'not-extracted');
  assert.equal(documentFormatting({...record,paragraphFormats:[{align:'center'}]}).formatStatus,'extracted');
});
