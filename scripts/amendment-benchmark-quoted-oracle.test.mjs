import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {rawQuotedProposalAssertion} from './amendment-benchmark-quoted-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/quoted-interior-oracle.json',import.meta.url)));
const wrap=body=>'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>';
function zip(xml,compressed=true) {
  const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),packed=compressed?deflateRawSync(raw):raw,local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(compressed?8:0,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(compressed?8:0,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}
function input(number=18) {
  const a=fixture.amendments.find(row=>row.number===number),body='<w:p/>'.repeat(67)+fixture.proposalParagraphs.map(row=>row.xml).join('');
  const paragraphs=[];for(const row of fixture.proposalParagraphs)paragraphs[row.projectionIndex]={index:row.projectionIndex,text:row.text.trim(),source:{path:`/w:document[1]/w:body[1]/w:p[${row.nativeParagraph}]`}};
  return {proposal:{sourceKind:'docx',units:[],paragraphs},wording:{language:'en',baseline:'commission-proposal',targetLabel:a.outer+'\n'+a.act+' — '+a.inner,originalText:a.original,proposedText:a.proposed},placement:{status:'placed',operation:'insert',itemIndex:0,insertBefore:70,insertAfter:69,evidence:[{anchor:'deliberately-false'}]},nativeQuoted:{proposalBuffer:zip(wrap(body)),amendmentBuffer:zip(wrap(a.bodyXml)),number},body,amendmentXml:a.bodyXml};
}
const check=arg=>rawQuotedProposalAssertion(arg);
const source=(arg,body)=>{assert.notEqual(body,arg.body,'source mutation must change native XML');arg.body=body;arg.nativeQuoted.proposalBuffer=zip(wrap(body));};
const amendment=(arg,xml)=>{assert.notEqual(xml,arg.amendmentXml,'amendment mutation must change native XML');arg.amendmentXml=xml;arg.nativeQuoted.amendmentBuffer=zip(wrap(xml));};

test('native quoted assertion proves both predecessor paragraphs before accepting projection coordinates',()=>{
  const arg=input();Object.defineProperty(arg.proposal,'units',{get(){throw new Error('production units forbidden');}});
  const result=check(arg);assert.equal(result.status,'verified');assert.deepEqual(result.assertion.predecessorExtent,{start:68,end:70});
  assert.deepEqual(result.assertion.nativePredecessor,['/w:document[1]/w:body[1]/w:p[72]','/w:document[1]/w:body[1]/w:p[73]']);
  assert.equal(result.assertion.rawInnerTarget,'Article 10a – paragraph 2a a (new)');assert.equal(result.assertion.rawProposedPrefix,'2aa.\t');
  assert.equal(verifyPlacement({...arg,items:[{proposal:arg.proposal}]}).status,'verified','raw assertion precedes unsupported outer target fallback');
});
test('wrong after-lead, clipped and terminal coordinates fail the established exact boundary',()=>{
  for(const before of [67,68,69,71,72,73]) {
    const arg=input();arg.placement.insertBefore=before;arg.placement.insertAfter=before-1;
    assert.equal(check(arg).status,'failed',String(before));
    assert.equal(verifyPlacement({...arg,items:[{proposal:arg.proposal}]}).status,'failed',String(before));
  }
  const arg=input();arg.placement.insertAfter=68;assert.equal(check(arg).status,'failed');
});
test('missing or clipped native correspondence cannot hide a lost predecessor continuation',()=>{
  for(const change of [arg=>arg.proposal.paragraphs.splice(69,1),arg=>arg.proposal.paragraphs.find(row=>row?.index===69).text='Clipped.',arg=>arg.proposal.paragraphs.find(row=>row?.index===69).source.path='/invented',arg=>arg.proposal.paragraphs.push({...arg.proposal.paragraphs.find(row=>row?.index===69)})]) {
    const arg=input();change(arg);assert.equal(check(arg).status,'failed');
  }
});
test('complete raw fields and both comparison columns must agree, with no label folding',()=>{
  for(const change of [arg=>arg.wording.targetLabel=arg.wording.targetLabel.replace('2a a','2aa'),arg=>arg.wording.proposedText+=' Omitted native continuation.',arg=>arg.wording.originalText='Borrowed wording.',arg=>arg.wording.targetLabel=arg.wording.targetLabel.replace('Directive 2003/87/EC','Directive 2003/88/EC'),arg=>arg.wording.targetLabel=arg.wording.targetLabel.replace('Article 10a','Article 10b')]) {
    const arg=input();change(arg);assert.equal(check(arg).status,'unverified',String(change));
  }
  const arg=input();amendment(arg,arg.amendmentXml.replace('2a a (new)','2a  a (new)'));arg.wording.targetLabel=arg.wording.targetLabel.replace('2a a','2a  a');assert.equal(check(arg).status,'unverified');
});
test('wrong native act, conflicting proposed prefix and mixed instructions remain unsupported',()=>{
  for(const [from,to] of [['Directive 2003/87/EC','Directive 2003/88/EC'],['Article 10a','Article 10b'],['2aa.','3aa.'],['2aa.','2aa. Article 10a is replaced by the following:']]) {
    const arg=input();amendment(arg,arg.amendmentXml.replaceAll(from,to));arg.wording.targetLabel=arg.wording.targetLabel.replaceAll(from,to);arg.wording.proposedText=arg.wording.proposedText.replaceAll(from,to);assert.equal(check(arg).status,'unverified');
  }
});
test('real ETS AM14 and AM15 cannot lend an unadopted predecessor or a terminal sibling',()=>{
  for(const number of [14,15]) {const arg=input(number);assert.equal(check(arg).status,'unverified');}
  const arg=input(14);arg.wording.proposedText=fixture.amendments.find(a=>a.number===15).proposed;assert.equal(check(arg).status,'unverified');
});
test('duplicate owners, missing siblings, incomplete quotes, objects and unsupported languages stay unverified',()=>{
  for(const change of [arg=>source(arg,arg.body.replace(fixture.proposalParagraphs[3].xml,fixture.proposalParagraphs[3].xml.repeat(2))),arg=>source(arg,arg.body.replace('2b. Paragraph','2c. Paragraph')),arg=>source(arg,arg.body.replace('’','')),arg=>source(arg,arg.body.replace('‘','')),arg=>source(arg,arg.body.replace('Concerning the update','<w:object/>Concerning the update')),arg=>{arg.wording.language='fr';},arg=>amendment(arg,arg.amendmentXml.replace('{EN}','{FR}'))]) {
    const arg=input();change(arg);assert.equal(check(arg).status,'unverified',String(change));
  }
});
test('the numeric nested family is independent of amendment ID, legal numbers and coordinates',()=>{
  const arg=input();const rewrite=s=>s.replaceAll('Article 10a','Article 12b').replaceAll('Directive 2003/87/EC','Directive 2004/18/EC').replaceAll('2a','7c').replaceAll('2b','7d').replace('after paragraph 2:','after paragraph 7:');
  source(arg,rewrite(arg.body));amendment(arg,rewrite(arg.amendmentXml).replace('NumAm&gt;18&lt;','NumAm&gt;42&lt;'));arg.nativeQuoted.number=42;arg.wording.targetLabel=rewrite(arg.wording.targetLabel);arg.wording.proposedText=rewrite(arg.wording.proposedText);arg.proposal.paragraphs=arg.proposal.paragraphs.reduce((rows,row)=>{const index=row.index+10;rows[index]={...row,index,text:rewrite(row.text)};return rows;},[]);arg.placement.insertBefore+=10;arg.placement.insertAfter+=10;
  assert.equal(check(arg).status,'verified');
});
test('native ZIP proof is mandatory and both stored and deflated main XML work',()=>{
  const arg=input();arg.nativeQuoted.proposalBuffer=zip(wrap(arg.body),false);assert.equal(check(arg).status,'verified');
  arg.nativeQuoted.proposalBuffer=Buffer.from('invented native projection');assert.equal(check(arg).status,'unverified');
  const missing=input();delete missing.nativeQuoted;assert.equal(check(missing).status,'unverified');
});
test('quoted coverage cannot bypass the independent operation oracle',()=>{
  const arg=input();arg.placement.operation='replace';assert.equal(verifyPlacement({...arg,items:[{proposal:arg.proposal}]}).reason,'oracle-operation-mismatch');
});

test('an earlier legal paragraph cannot turn the named act lead into paragraph 1',()=>{
  const arg=input();const earlier='<w:p><w:r><w:t>Earlier legal paragraph.</w:t></w:r></w:p>';
  source(arg,arg.body.replace(fixture.proposalParagraphs[2].xml,earlier+fixture.proposalParagraphs[2].xml));
  assert.equal(check(arg).status,'unverified');
});
test('malformed native XML and hidden source wording cannot establish a boundary',()=>{
  const malformed=input();malformed.nativeQuoted.proposalBuffer=zip(wrap(malformed.body).replace('</w:body>',''));assert.equal(check(malformed).status,'unverified');
  const hidden=input();source(hidden,hidden.body.replace('Concerning the update','<w:vanish/>Concerning the update'));assert.equal(check(hidden).status,'unverified');
});
