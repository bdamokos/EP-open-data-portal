import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRejection,nativeRejectionParagraphs,nativeRejectionCell} from './amendment-rejection-oracle.mjs';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {classifyRow} from './amendment-benchmark-model.mjs';
const sentences=JSON.parse(readFileSync(new URL('./fixtures/amendment-rejection-sentences.json',import.meta.url)));
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const p=value=>'<w:p><w:r><w:t>'+escape(value)+'</w:t></w:r></w:p>';
function zip(body) {
  const name=Buffer.from('word/document.xml'),raw=Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>'),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}
function input(text,language='en',{original='',extra='',prefix='',suffix=''}={}) {
  const body=p('<Amend><ANo>A10-0175</ANo>/<NumAm>17</NumAm>')+p('<TitreType>Recommendation for second reading</TitreType> A10-0175/2026')+p('<Article>Citation 1 a (new)</Article>')+'<w:tbl><w:tr><w:tc>'+p('Council position')+'</w:tc><w:tc>'+p('Amendment')+'</w:tc></w:tr><w:tr><w:tc>'+p(original)+'</w:tc><w:tc>'+prefix+p(text)+extra+suffix+'</w:tc></w:tr></w:tbl>'+p('</Amend>');
  const scope=sentences[language].indexOf(text)>=2?'council-position':'commission-proposal';
  return {id:'A-10-2026-0175-AM-17',language,buffer:zip(body),wording:{originalText:original,proposedText:text},placement:{status:'document-operation',operation:'reject',scope}};
}
test('complete native rejection cells in all 24 languages verify document scope independently of a numbered citation',()=>{
  assert.equal(Object.keys(sentences).length,24);
  for(const [language,texts] of Object.entries(sentences))for(const text of texts){
    const arg=input(text,language),result=verifyRejection(arg);
    assert.equal(result.status,'verified',language+': '+text);
    assert.deepEqual(classifyRow({S5:arg.placement},result),{outcome:'correct',reason:'whole-document-rejection'});
    const insertion={...arg,placement:{status:'placed',operation:'insert',insertBefore:0}};
    assert.equal(verifyRejection(insertion).status,'unverified');
  }
});
test('native rejection assertion requires the full cells and exact source identity',()=>{
  const text=sentences.en[2];
  for(const change of [{original:'Existing text.'},{extra:p('Additional proposed provision.')},{prefix:'<w:del>'+p('Deleted text.')+'</w:del>'},{suffix:'<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden provision.</w:t></w:r></w:p>'}])assert.notEqual(verifyRejection(input(text,'en',change)).status,'verified');
  const arg=input(text);
  assert.equal(nativeRejectionCell(arg.buffer,'A-10-2026-0175-AM-18'),null);
  assert.equal(nativeRejectionCell(arg.buffer,'A-10-2025-0175-AM-17'),null);
  assert.equal(nativeRejectionCell(Buffer.from('broken'),'A-10-2026-0175-AM-17'),null);
  for(const wording of [{originalText:null,proposedText:text},{originalText:'',proposedText:text+' Another sentence.'}])assert.notEqual(verifyRejection({...arg,wording})?.status,'verified');
  assert.notEqual(verifyRejection({...arg,placement:{...arg.placement,insertAfter:1}}).status,'verified');
});
test('rejection oracle refuses unrelated sources and uncalibrated document operations',()=>{
  assert.equal(verifyRejection({id:'A-10-2025-0158-AM-422',language:'en',buffer:Buffer.from('unrelated')} ).status,'failed');
  assert.equal(verifyRejection({id:'unknown',language:'en',placement:{status:'document-operation'}}).status,'unverified');
  assert.equal(verifyRejection({id:'unknown',language:'en',placement:{status:'unresolved'}}),null);
});

import {execFileSync} from 'node:child_process';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('large native XML reads use bounded file input and remove temporary bytes on success and failure',t=>{
  const temporaryRoot=mkdtempSync(join(tmpdir(),'rejection-transport-test-'));t.after(()=>rmSync(temporaryRoot,{recursive:true,force:true}));
  const buffer=execFileSync('python3',['-c',`import io,sys,zipfile
body='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+('A'*262144)+'</w:t></w:r></w:p><w:p><w:r><w:t>Native paragraph.</w:t></w:r></w:p></w:body></w:document>'
out=io.BytesIO()
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_STORED) as source: source.writestr('word/document.xml',body)
sys.stdout.buffer.write(out.getvalue())`],{maxBuffer:1024*1024,timeout:30_000,stdio:['ignore','pipe','pipe']});
  assert.ok(buffer.length>64*1024);assert.deepEqual(nativeRejectionParagraphs(buffer,{temporaryRoot}),['A'.repeat(262144),'Native paragraph.']);assert.deepEqual(readdirSync(temporaryRoot),[]);
  assert.throws(()=>nativeRejectionParagraphs(Buffer.from('broken ZIP'),{temporaryRoot}));assert.deepEqual(readdirSync(temporaryRoot),[]);
});

test('native rejection templates permit only attested proposed-only headings with complete blank original cells',()=>{
 const headings={cs:'Návrh na zamítnutí',fr:'Proposition de rejet',it:'Proposta di reiezione'};
 for(const [language,heading] of Object.entries(headings)) {
  const text=sentences[language].at(-1),arg=input(text,language);
  const body=p('<Amend><ANo>A10-0175</ANo>/<NumAm>17</NumAm>')+p('<TitreType>Report</TitreType> A10-0175/2026')+'<w:tbl><w:tr><w:tc>'+p('')+'</w:tc><w:tc>'+p(heading)+'</w:tc></w:tr><w:tr><w:tc>'+p('')+'</w:tc><w:tc>'+p(text)+'</w:tc></w:tr></w:tbl>'+p('</Amend>');
  assert.equal(verifyRejection({...arg,buffer:zip(body)}).status,'verified');
  assert.notEqual(verifyRejection({...arg,buffer:zip(body.replace(escape(heading),'Unverified heading'))}).status,'verified');
  assert.notEqual(verifyRejection({...arg,buffer:zip(body.replace(escape(text),escape(text+' Additional legal wording.')))}).status,'verified');
 }
});
