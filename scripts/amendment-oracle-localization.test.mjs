import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {oracleAddress,oracleRelative,oracleInstruction,oracleFold} from './amendment-oracle-grammar.mjs';
import {rawExpected,rawDocument} from './amendment-language-oracle.mjs';
import {rawProposalAssertion} from './amendment-benchmark-proposal-oracle.mjs';
import {compareLanguages} from './amendment-language-benchmark.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/amendment-oracle-localization.json',import.meta.url)));
const shape=segments=>segments?.map(({kind,value})=>[kind,value]);
for(const e of fixture.examples){
 test(e.language+': published outer and inner addresses, native suffixes, titles and relative headings',()=>{
  assert.deepEqual(shape(oracleAddress(e.outer.headings[1],e.language)),e.outer.expected);
  const block={tables:[{before:e.outer.headings}],targetLabel:e.outer.headings.at(-1),section:e.outer.headings.at(-2)};
  const expected=rawExpected(block,e.language);
  assert.equal(expected.sectionKind,'commission-proposal');
  assert.equal(expected.targetLabel,e.outer.headings[1]);
  assert.equal(expected.underlyingTargetLabel,e.outer.headings[3]);
  assert.deepEqual(shape(oracleAddress(e.insertion.label,e.language)),[e.insertion.expected]);
  assert(oracleAddress(e.insertion.label,e.language).at(-1).isNew);
  assert.deepEqual(shape(oracleAddress(e.intro.label,e.language)),e.intro.expected);
  assert.deepEqual(shape(oracleAddress(e.title.label,e.language)),e.title.expected);
  assert.equal(oracleRelative(e.relative.label,e.language)?.after??null,e.relative.expected);
  for(const selector of Object.values(e.selectors))assert.deepEqual(shape(oracleAddress(selector.label,e.language)),selector.expected);
 });
 test(e.language+': raw published instruction rows keep quoted numbered wording in the addressed subtree',()=>{
  const paragraphs=e.proposal.rows.map((row,index)=>({index,text:row.text,properties:{styleId:row.style},source:{container:'body',complete:true},complete:true}));
  const instructions=paragraphs.map(row=>({...oracleInstruction(row.text,e.language),index:row.index}));
  assert(instructions.some(row=>row.value==='1'&&row.level===0));
  assert(instructions.some(row=>row.value==='2'&&row.level===0));
  const last=paragraphs.at(-1).index;
  const target=e.outer.headings[1];
  const source=paragraphs.find(row=>/^(?:\(10\)|10[.)])\s/u.test(row.text));
  assert(source,'the published quoted definition 10 is retained');
  assert.equal(oracleInstruction(source.text,e.language),null,'quoted wording is not an outer amendment instruction');
  const result=rawProposalAssertion({proposal:{sourceKind:'docx',paragraphs},wording:{language:e.language,targetLabel:target},placement:{operation:'replace',span:{start:source.index,end:source.index}}});
  assert.equal(result.status,'verified',JSON.stringify(result));
  assert.equal(rawProposalAssertion({proposal:{sourceKind:'docx',paragraphs},wording:{language:e.language,targetLabel:target},placement:{operation:'replace',span:{start:last,end:last}}}).status,'failed');
 });
}
test('oracle typography retains words, numbers and scripts while folding the published quote/dash/apostrophe forms',()=>{
 assert.equal(oracleFold('n‑oibreoidh'), 'n-oibreoidh');
 assert.equal(oracleFold('ta’ “test” – 13'), 'ta\' "test" - 13');
 assert.notEqual(oracleFold('n-oibreoidh'),oracleFold('noibreoidh'));
 assert.notEqual(oracleFold('B'),oracleFold('Β'));
});
test('observed compound, bare and misspelled labels retain every independently supported address',()=>{
 for(const e of fixture.otherPublishedForms){
  assert.equal(e.rawLabel.trim(),e.label,e.id);
  const relative=oracleRelative(e.label,e.language),segments=relative?[relative]:oracleAddress(e.label,e.language,{resolution:true});
  assert.deepEqual(shape(segments),e.expected,e.id);
 }
});

test('published Irish noBreakHyphen survives independent XML extraction',()=>{
 const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+fixture.irishHyphen.xml+'</w:body></w:document>';
 const buffer=execFileSync('python3',['-c',"import io,sys,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr('word/document.xml',sys.stdin.buffer.read()); z.close(); sys.stdout.buffer.write(b.getvalue())"],{input:xml});
 assert.equal(rawDocument(buffer).paragraphs[0].text,fixture.irishHyphen.text);
});
const hash=value=>createHash('sha256').update(value).digest('hex');
const assertion=row=>JSON.stringify({expected:row.expected,verification:row.verification});
test('calibration binds every changed assertion to source evidence and cannot waive losses or false placements',()=>{
 const row={key:'list:1:de',identity:'list:1',language:'de',outcome:'placed-unverified',expected:{operation:'replace'},verification:{status:'unverified'}},next={...row,outcome:'correct',verification:{status:'verified'}};
 const report={snapshotId:'same',sample:[],inputs:[],oracleVersion:1,oracleFingerprint:'before',rows:[row]},candidate={...report,oracleFingerprint:'after',rows:[next]};
 const evidence={snapshotId:'same',baselineOracleFingerprint:'before',candidateOracleFingerprint:'after',rows:[{key:row.key,beforeDigest:hash(assertion(row)),afterDigest:hash(assertion(next)),checkedBy:'gpt-6.1-sol',note:'Address and source span checked against the official document.',sources:[{url:'https://data.europarl.europa.eu/distribution/public.docx',sha256:'a'.repeat(64),retrievedAt:'2026-10-27T20:00:00Z',paths:['/w:document[1]/w:body[1]/w:p[1]']}]}]};
 assert.throws(()=>compareLanguages(candidate,report),/reviewed calibration/);
 assert.equal(compareLanguages(candidate,report,evidence).failed,false);
 for(const change of [e=>{e.snapshotId='wrong';},e=>{e.candidateOracleFingerprint='wrong';},e=>{e.rows=[];},e=>{e.rows[0].beforeDigest='wrong';},e=>{e.rows[0].sources=[];},e=>{e.rows.push({...e.rows[0]});}]){const invalid=structuredClone(evidence);change(invalid);assert.throws(()=>compareLanguages(candidate,report,invalid),/calibration/);}
 const bad={...next,outcome:'false-placement',verification:{status:'failed'}},badEvidence=structuredClone(evidence);badEvidence.rows[0].afterDigest=hash(assertion(bad));
 assert.equal(compareLanguages({...candidate,rows:[bad]},report,badEvidence).failed,true);
 const wasCorrect={...row,outcome:'correct'},lost={...next,outcome:'placed-unverified'},lossEvidence=structuredClone(evidence);lossEvidence.rows[0].beforeDigest=hash(assertion(wasCorrect));lossEvidence.rows[0].afterDigest=hash(assertion(lost));
 assert.equal(compareLanguages({...candidate,rows:[lost]},{...report,rows:[wasCorrect]},lossEvidence).failed,true);
});
for(const e of fixture.examples)test(e.language+': published new instruction follows the full quoted predecessor, before instruction 3',()=>{
 const paragraphs=e.proposal.rows.map((row,index)=>({index,text:row.text,properties:{styleId:row.style},source:{container:'body',complete:true},complete:true}));
 const before=paragraphs.findIndex(row=>/^(?:\(3\)|3[.)])\s/u.test(row.text));
 assert(before>0);
 const args={proposal:{sourceKind:'docx',paragraphs},wording:{language:e.language,targetLabel:e.outerInsertion.label}};
 assert.equal(rawProposalAssertion({...args,placement:{operation:'insert',insertBefore:before,insertAfter:before-1}}).status,'verified');
 assert.equal(rawProposalAssertion({...args,placement:{operation:'insert',insertBefore:before-1,insertAfter:before-2}}).status,'failed');
});
test('the second published Irish report-heading form scopes the resolution independently',async()=>{
 const {rawSections,verifyLanguagePlacement}=await import('./amendment-language-oracle.mjs');
 const rawText=fixture.irishReportHeading,sections=rawSections(rawText);
 assert.equal(sections.find(row=>row.text.startsWith('2.')).sectionKind,'resolution');
 const text={paragraphs:rawText.paragraphs.map(row=>row.text),paragraphSources:rawText.paragraphs.map(({path})=>({path}))};
 const expected={language:'ga',operation:'insert',sectionKind:'resolution',targetLabel:'Mír 2 a (nua)'};
 assert.equal(verifyLanguagePlacement({expected,rawText,text,placement:{status:'placed',operation:'insert',insertAfter:2,insertBefore:3}}).status,'verified');
});
test('a published indent selector cannot disappear into a unique-quote success',async()=>{
 const {parseBenchmarkTarget,verifyPlacement}=await import('./amendment-benchmark-model.mjs');
 // A-10-2025-0150 publishes Annex VIII – indent 11 (AM119's underlying
 // address). An unsupported child must remain explicit to the oracle.
 const wording={language:'en',baseline:'motion-resolution',targetLabel:'Annex VIII – indent 11',originalText:'A unique source sentence.',proposedText:'Changed.'};
 assert.equal(parseBenchmarkTarget(wording).segments.at(-1).kind,'indent');
 const text={paragraphs:['A unique source sentence.'],paragraphSources:[{complete:true,container:'body'}]};
 assert.equal(verifyPlacement({wording,text,placement:{status:'placed',operation:'replace',span:{start:0,end:0}}}).reason,'oracle-address-grammar-unavailable');
});
test('Lithuanian citation 21a uses the citation boundary rather than operative paragraph 21',async()=>{
 const {verifyLanguagePlacement}=await import('./amendment-language-oracle.mjs');
 const rawText=JSON.parse(await readFile(new URL('./fixtures/amendment-oracle-lithuanian-citation.json',import.meta.url)));
 const text={paragraphs:rawText.paragraphs.map(row=>row.text),paragraphSources:rawText.paragraphs.map(({path})=>({path}))};
 const expected={language:'lt',operation:'insert',sectionKind:'resolution',targetLabel:rawText.targetLabel};
 assert.deepEqual(shape(oracleAddress(expected.targetLabel,'lt',{resolution:true})),[['citation','21a']]);
 assert.deepEqual(shape(oracleAddress('21 dalis','lt',{resolution:true})),[['paragraph','21']]);
 const correct={status:'placed',operation:'insert',insertAfter:22,insertBefore:23};
 assert.equal(verifyLanguagePlacement({expected,rawText,text,placement:correct}).status,'verified');
 assert.equal(verifyLanguagePlacement({expected,rawText,text,placement:{...correct,insertAfter:24,insertBefore:25}}).status,'failed');
});
test('existing-law oracle selects the published inner address independently',async()=>{
 const {parseBenchmarkTarget}=await import('./amendment-benchmark-model.mjs');
 const wording={language:'en',baseline:'present-text',targetLabel:'Article 1 – point 2',targetPath:{proposal:[{raw:'Article 1 – point 2'}],underlying:[{raw:'Article 17 – paragraph 3'}]}};
 assert.deepEqual(shape(parseBenchmarkTarget(wording).segments),[['article','17'],['paragraph','3']]);
});
