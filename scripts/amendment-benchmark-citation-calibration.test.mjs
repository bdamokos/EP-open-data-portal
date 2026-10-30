import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
import {rawCitationMarkerAssertion,verifyPlacementWithCitationCalibration} from './amendment-benchmark-citation-calibration.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/resolution-citation-native.json',import.meta.url)));
const wrap=body=>'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>';
function zip(body) {
  const name=Buffer.from('word/document.xml'),raw=Buffer.from(wrap(body)),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const p=value=>'<w:p><w:r><w:t>'+escape(value)+'</w:t></w:r></w:p>';
function input(number=73,native=false) {
  const example=fixture.amendments.find(row=>row.number===number),motion='<w:p/>'.repeat(17)+fixture.motionParagraphs.map(row=>row.xml).join('');
  const motionBuffer=zip(motion),rows=quotedWordBody(motionBuffer).slice(17);
  const ordinal=Number(example.wording.targetLabel.split(' ')[1]);
  const text={paragraphs:rows.map(row=>row.text),paragraphSources:rows.map((row,index)=>({path:row.path,ordinal:index+20,container:'body',containerPath:'/w:document[1]/w:body[1]',segment:10,complete:true}))};
  // Mutation cases use equivalent single-run cells so every change really
  // changes the intended native field, regardless of Word's run splitting.
  const amendment=native?example.bodyXml:p('<Amend><NumAm>'+number+'</NumAm>')+p('<DocAmend>Motion for a resolution</DocAmend>')+p('<Article>'+example.wording.targetLabel+'</Article>')+p('<Original>{EN}en</Original>')+'<w:tbl><w:tr><w:tc>'+p('Motion for a resolution')+'</w:tc><w:tc>'+p('Amendment')+'</w:tc></w:tr><w:tr><w:tc>'+p(example.wording.originalText)+'</w:tc><w:tc>'+p(example.wording.proposedText)+'</w:tc></w:tr></w:tbl>'+p('</Amend>');
  return {wording:structuredClone(example.wording),placement:{status:'placed',operation:'replace',span:{start:ordinal,end:ordinal}},text,nativeCitation:{motionBuffer,amendmentBuffer:zip(amendment),number},motion,amendment};
}
const changeMotion=(arg,change)=>{arg.motion=change(arg.motion);arg.nativeCitation.motionBuffer=zip(arg.motion);};
const changeAmendment=(arg,change)=>{arg.amendment=change(arg.amendment);arg.nativeCitation.amendmentBuffer=zip(arg.amendment);};

test('both native comparison columns and the complete twenty-citation preamble establish marker ownership',()=>{
  for(const number of [73,113]) {
    const arg=input(number,true),before=structuredClone(arg.text);
    Object.defineProperty(arg.text,'units',{get(){throw Error('production units forbidden');}});
    const result=rawCitationMarkerAssertion(arg);
    assert.equal(result.status,'verified');assert.equal(result.assertion.nativePreamble.length,20);
    assert.equal(result.assertion.nativePreambleEnd,'/w:document[1]/w:body[1]/w:p[39]');
    assert.deepEqual(result.assertion.expectedSpan,arg.placement.span);
    assert.equal(verifyPlacement(arg).reason,'oracle-original-span-mismatch','canonical scorer is unchanged');
    assert.equal(verifyPlacementWithCitationCalibration(arg).status,'verified');
    assert.deepEqual(arg.text,before);
  }
});
test('wrong ordinals, clipped extents, altered coordinates and duplicate projected paths fail',()=>{
  for(const change of [arg=>arg.placement.span.start++,arg=>arg.placement.span.end++,arg=>arg.text.paragraphSources[2].path='/invented',arg=>arg.text.paragraphs[2]+=' Extra.',arg=>arg.text.paragraphSources[1].complete=false,arg=>arg.text.paragraphSources[1].segment=99,arg=>arg.text.paragraphSources[1].ordinal=99,arg=>{arg.text.paragraphSources.push({...arg.text.paragraphSources[2]});arg.text.paragraphs.push(arg.text.paragraphs[2]);}]) {
    const arg=input();change(arg);assert.equal(rawCitationMarkerAssertion(arg).status,'failed',String(change));
  }
});
test('missing, interrupted, ambiguous and terminal native preambles do not calibrate',()=>{
  for(const change of [value=>value.replace('The European Parliament,','Another institution,'),value=>value+'<w:p><w:r><w:t>The European Parliament,</w:t></w:r></w:p>',value=>value.replace('–','-'),value=>value.replace(fixture.motionParagraphs.at(-1).xml,fixture.motionParagraphs.at(-1).xml.replace('A.','B.')),value=>value.replace('Rule 136(2)','<w:vanish/>Rule 136(2)'),value=>value.replace('–','<w:numPr/>–'),value=>value.replace('The European Parliament,','The European Parliament,</w:t></w:r></w:p><w:tbl/><w:p><w:r><w:t>')]) {
    const arg=input();changeMotion(arg,change);assert.equal(rawCitationMarkerAssertion(arg).status,'unverified',String(change));
  }
  const arg=input();changeMotion(arg,value=>value.slice(0,value.indexOf(fixture.motionParagraphs[4].xml)));assert.equal(rawCitationMarkerAssertion(arg).status,'unverified');
});
test('no words, numbers, case or punctuation after the owned marker can be changed',()=>{
  for(const [from,to] of [['Articles','articles'],['67','68'],['67, 83','67; 83'],['European Union,','European Union;'],['Functioning','– Functioning']]) {
    const arg=input();changeAmendment(arg,value=>value.replace(from,to));arg.wording.originalText=arg.wording.originalText.replace(from,to);
    assert.equal(rawCitationMarkerAssertion(arg).reason,'oracle-citation-original-mismatch',from);
  }
});
test('complete native fields, language and both columns must match the measured wording',()=>{
  for(const change of [arg=>arg.wording.language='fr',arg=>arg.wording.targetLabel='Citation 3',arg=>arg.wording.originalText+=' Omitted row.',arg=>arg.wording.proposedText+=' Omitted row.',arg=>changeAmendment(arg,value=>value.replace('{EN}en','{FR}fr')),arg=>changeAmendment(arg,value=>value.replace('Motion for a resolution','Other baseline')),arg=>changeAmendment(arg,value=>value.replace('<w:tbl>','<w:tbl><w:tbl/>'))]) {
    const arg=input();change(arg);assert.equal(rawCitationMarkerAssertion(arg).status,'unverified',String(change));
  }
});
test('visible content-control and custom-XML blocks in either native cell preserve canonical failure',()=>{
  const wrappers=[value=>'<w:sdt><w:sdtPr/><w:sdtContent>'+value+'</w:sdtContent></w:sdt>',value=>'<w:customXml>'+value+'</w:customXml>'];
  for(const number of [73,113])for(const column of [3,4])for(const wrapper of wrappers) {
    const arg=input(number,true);let cell=0;
    changeAmendment(arg,value=>value.replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/gu,match=>cell++===column?match.replace('</w:tc>',wrapper(p('ADDITIONAL LEGAL TEXT.'))+'</w:tc>'):match));
    assert.equal(verifyPlacement(arg).reason,'oracle-original-span-mismatch');
    assert.equal(rawCitationMarkerAssertion(arg).reason,'oracle-citation-comparison-unavailable');
    assert.deepEqual(verifyPlacementWithCitationCalibration(arg),verifyPlacement(arg));
  }
});
test('wrapped comparison rows and cells cannot disappear from native proof',()=>{
  const wrappers=[value=>'<w:sdt><w:sdtContent>'+value+'</w:sdtContent></w:sdt>',value=>'<w:customXml>'+value+'</w:customXml>'];
  for(const wrapper of wrappers)for(const level of ['row','cell']) {
    const arg=input(73,true),extra='<w:tc>'+p('ADDITIONAL LEGAL TEXT.')+'</w:tc>';
    changeAmendment(arg,value=>level==='row'?value.replace('</w:tbl>',wrapper('<w:tr>'+extra+extra+'</w:tr>')+'</w:tbl>'):value.replace('</w:tr></w:tbl>',wrapper(extra)+'</w:tr></w:tbl>'));
    assert.equal(rawCitationMarkerAssertion(arg).reason,'oracle-citation-comparison-unavailable');
    assert.deepEqual(verifyPlacementWithCitationCalibration(arg),verifyPlacement(arg));
  }
});
test('unaccounted structural children and visible block text do not establish complete columns',()=>{
  for(const [from,to] of [
    ['</w:tbl>',p('ADDITIONAL LEGAL TEXT.')+'</w:tbl>'],
    ['</w:tr></w:tbl>',p('ADDITIONAL LEGAL TEXT.')+'</w:tr></w:tbl>'],
    ['</w:tc></w:tr></w:tbl>','<w:altChunk/></w:tc></w:tr></w:tbl>'],
    ['</w:tc></w:tr></w:tbl>','ADDITIONAL LEGAL TEXT.</w:tc></w:tr></w:tbl>'],
  ]) {
    const arg=input(73,true);changeAmendment(arg,value=>value.replace(from,to));
    assert.equal(rawCitationMarkerAssertion(arg).reason,'oracle-citation-comparison-unavailable');
    assert.deepEqual(verifyPlacementWithCitationCalibration(arg),verifyPlacement(arg));
  }
});
test('a literal dash inside the citation wording stays meaningful',()=>{
  const arg=input();changeMotion(arg,value=>value.replace('Articles 67','– Articles 67'));
  assert.equal(rawCitationMarkerAssertion(arg).reason,'oracle-citation-original-mismatch');
});
test('calibration preserves canonical success, non-placement and operation failures exactly',()=>{
  for(const change of [arg=>arg.placement.status='unresolved',arg=>arg.placement.operation='delete',arg=>arg.wording.originalText=arg.text.paragraphs[2]]) {
    const arg=input();change(arg);assert.deepEqual(verifyPlacementWithCitationCalibration(arg),verifyPlacement(arg));
  }
  const missing=input();delete missing.nativeCitation;assert.deepEqual(verifyPlacementWithCitationCalibration(missing),verifyPlacement(missing));
});
test('marker proof depends on native contents and ordinal, never an exact amendment ID',()=>{
  const arg=input();changeAmendment(arg,value=>value.replaceAll('NumAm&gt;73&lt;','NumAm&gt;42&lt;'));arg.nativeCitation.number=42;arg.wording.number=42;arg.wording.id='unrelated-id';
  assert.equal(rawCitationMarkerAssertion(arg).status,'verified');
  arg.nativeCitation.motionBuffer=Buffer.from('not Word');assert.equal(rawCitationMarkerAssertion(arg).status,'unverified');
});
