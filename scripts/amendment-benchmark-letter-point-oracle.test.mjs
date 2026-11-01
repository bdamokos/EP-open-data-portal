import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {rawLetterPointAssertion} from './amendment-benchmark-letter-point-oracle.mjs';
import {quotedWordBody,quotedWordComparison} from './amendment-benchmark-quoted-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/letter-point-oracle.json',import.meta.url)));
const wrap=body=>'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>';
function zip(xml){
  const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}
function input(number=113){
  const body='<w:p/>'.repeat(fixture.proposalParagraphs[0].nativeParagraph-1)+fixture.proposalParagraphs.map(p=>p.xml).join(''),proposalBuffer=zip(wrap(body));
  const amendment=fixture.amendments.find(a=>a.number===number),amendmentBuffer=zip(wrap(amendment.xml));
  const fields=quotedWordComparison(quotedWordBody(amendmentBuffer),number),paragraphs=[];
  for(const p of quotedWordBody(proposalBuffer)){
    const row=fixture.proposalParagraphs.find(row=>p.path===`/w:document[1]/w:body[1]/w:p[${row.nativeParagraph}]`);
    if(row?.projectionIndex!=null)paragraphs[row.projectionIndex]={index:row.projectionIndex,text:p.text.trim(),source:{path:p.path}};
  }
  const before=paragraphs.find(p=>p?.text.startsWith('(f)')).index;
  return {proposal:{paragraphs},wording:{language:'en',baseline:'commission-proposal',targetLabel:fields.outer+'\n'+fields.act+' — '+fields.inner,originalText:fields.original,proposedText:fields.proposed},placement:{status:'placed',operation:'insert',itemIndex:0,insertBefore:before,insertAfter:before-1},nativeQuoted:{number,proposalBuffer,amendmentBuffer},body,amendmentXml:amendment.xml};
}
const check=arg=>rawLetterPointAssertion(arg);
test('AM113/114 native Word fields independently prove the Article 4a(1) e/f boundary',()=>{
  for(const number of [113,114]){
    const arg=input(number);Object.defineProperty(arg.proposal,'units',{get(){throw new Error('production structure forbidden');}});
    Object.defineProperty(arg.placement,'evidence',{get(){throw new Error('placer evidence forbidden');}});
    const result=check(arg);assert.equal(result.status,'verified');
    assert.equal(result.assertion.nativePredecessor,'/w:document[1]/w:body[1]/w:p[180]');
    assert.equal(result.assertion.nativeFollowing,'/w:document[1]/w:body[1]/w:p[181]');
    assert.equal(result.assertion.nativeNextParagraph,'/w:document[1]/w:body[1]/w:p[182]');
    assert.equal(verifyPlacement({...arg,items:[{proposal:arg.proposal}]}).status,'verified');
  }
});
test('wrong coordinates fail after native boundary proof',()=>{
  for(const delta of [-2,-1,1,2]){const arg=input();arg.placement.insertBefore+=delta;arg.placement.insertAfter+=delta;assert.equal(check(arg).status,'failed');}
});
test('raw act, article, paragraph and the same proposed point must all agree',()=>{
  for(const change of [a=>a.wording.targetLabel=a.wording.targetLabel.replace('2024/1689','2023/956'),a=>a.wording.targetLabel=a.wording.targetLabel.replace('Article 4 a','Article 2'),a=>a.wording.proposedText=input(114).wording.proposedText,a=>a.wording.originalText='Borrowed original.']){
    const arg=input();change(arg);assert.equal(check(arg).status,'unverified');
  }
});
test('projection paths and complete native text must correspond without gaps or duplicates',()=>{
  for(const change of [a=>a.proposal.paragraphs[a.placement.insertBefore].text='Clipped.',a=>a.proposal.paragraphs[a.placement.insertBefore].source.path='/invented',a=>a.proposal.paragraphs.splice(a.placement.insertBefore-1,1),a=>a.proposal.paragraphs.push({...a.proposal.paragraphs[a.placement.insertBefore]})]){
    const arg=input();change(arg);assert.equal(check(arg).status,'failed');
  }
});
test('native list damage, missing paragraph boundary and hidden text cannot prove placement',()=>{
  for(const rewrite of [s=>s.replace('(d) the special','(e) the special'),s=>s.replace('>2. P<','>Continuation. P<'),s=>s.replace('occur:','occur.'),s=>s.replace('(e) the special','<w:vanish/>(e) the special')]){
    const arg=input(),body=rewrite(arg.body);assert.notEqual(body,arg.body);arg.nativeQuoted.proposalBuffer=zip(wrap(body));assert.equal(check(arg).status,'unverified');
  }
});
test('no native package, wrong operation and cross-language comparisons stay unsupported',()=>{
  const noNative=input();delete noNative.nativeQuoted;assert.equal(check(noNative).status,'unverified');
  const different=input();different.wording.language='fi';assert.equal(check(different).status,'unverified');
  const operation=input();operation.placement.operation='replace';assert.equal(verifyPlacement({...operation,items:[{proposal:operation.proposal}]}).reason,'oracle-operation-mismatch');
});
