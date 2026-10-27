import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {languageMetrics,compareLanguages,parityLocation,LANGUAGES,LANGUAGE_SAMPLE} from './amendment-language-benchmark.mjs';
import {rawDocument,rawExpected,verifyLanguagePlacement,simpleAddress} from './amendment-language-oracle.mjs';
import {options} from './amendment-benchmark.mjs';

const row=(language,outcome='correct',more={})=>({key:'list:5:'+language,identity:'list:5',language,outcome,reason:outcome,location:{section:1,kind:'recital',value:'13',scope:'body'},...more});
const report=rows=>({snapshotId:'fixed',sample:['sample'],inputs:['bytes'],oracleVersion:1,rows});
test('language mode is explicit and keeps the default identity benchmark',()=>{
  assert.equal(options(['--languages','--record-language-baseline']).languages,true);
  assert.equal(options([]).languages,undefined);
  assert.equal(LANGUAGES.length,24);
  assert.ok(LANGUAGE_SAMPLE.some(s=>s.type==='second-reading'));
});
test('each language keeps its own denominator, missing extraction and withholding reasons',()=>{
  const rows=[row('en'),row('fi','placed-unverified',{location:null}),row('hr','withheld',{reason:'amendment-not-extracted',location:null}),row('ga','withheld',{reason:'language-wording-unpublished',location:null})];
  const m=languageMetrics(rows);
  assert.equal(m.find(m=>m.language==='hr').total,1);
  assert.deepEqual(m.find(m=>m.language==='hr').withheldByReason,{'amendment-not-extracted':1});
  assert.equal(m.find(m=>m.language==='fi').behindEnglish,1);
  assert.equal(m.find(m=>m.language==='fi').sameLocation,0);
  assert.equal(m.find(m=>m.language==='fi').locatedPairs,0);
});
test('parity compares exact list and number, with semantic locations rather than source offsets',()=>{
  const rows=[row('en'),row('fi'),row('lt','correct',{location:{section:2,kind:'recital',value:'13',scope:'body'}}),row('nl','correct',{identity:'another-list:5'})];
  const m=languageMetrics(rows);
  assert.equal(m.find(m=>m.language==='fi').sameLocation,1);
  assert.equal(m.find(m=>m.language==='lt').sameLocation,0);
  assert.equal(m.find(m=>m.language==='nl').paired,0);
});
test('language gate rejects a loss in any language even when English improves',()=>{
  const before=report([row('en','withheld'),row('fi')]),after=report([row('en'),row('fi','withheld')]);
  const gate=compareLanguages(after,before);
  assert.equal(gate.failed,true);assert.equal(gate.regressions[0].key,'list:5:fi');
  assert.equal(compareLanguages(report([row('en'),row('fi')]),before).failed,false);
});
test('language gate rejects false placements, removed rows, duplicate identities and changed snapshots',()=>{
  const base=report([row('en'),row('fi')]);
  assert.equal(compareLanguages(report([row('en'),row('fi','false-placement')]),base).failed,true);
  assert.equal(compareLanguages(report([row('en')]),base).failed,true);
  assert.throws(()=>compareLanguages(report([row('en'),row('en')]),base),/Duplicate/);
  assert.throws(()=>compareLanguages({...base,snapshotId:'new'},base),/snapshot/);
  assert.throws(()=>compareLanguages({...base,oracleVersion:2},base),/oracle/);
});
function docx(xml) {
  return execFileSync('python3',['-c',"import io,sys,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr('word/document.xml',sys.stdin.buffer.read()); z.close(); sys.stdout.buffer.write(b.getvalue())"],{input:`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${xml}</w:body></w:document>`});
}
const p=value=>'<w:p><w:r><w:t>'+value+'</w:t></w:r></w:p>';
const cell=value=>'<w:tc>'+p(value)+'</w:tc>';
test('raw cell observations catch the real Finnish deletion even if extracted operation says replace',()=>{
  const xml=p('Tarkistus &lt;NumAm&gt;5&lt;/NumAm&gt;')+p('Tarkistus 5')+p('Ehdotus asetukseksi')+p('Johdanto-osan 13 kappale')+'<w:tbl><w:tr>'+cell('Komission teksti')+cell('Tarkistus')+'</w:tr><w:tr>'+cell('(13) Published original.')+cell('Poistetaan.')+'</w:tr></w:tbl>';
  const raw=rawDocument(docx(xml)),expected=rawExpected(raw.amendments[0],'fi');
  assert.equal(raw.amendments.length,1);assert.equal(expected.number,5);assert.equal(expected.operation,'delete');
  assert.equal(expected.targetLabel,'Johdanto-osan 13 kappale');
  assert.equal(verifyLanguagePlacement({expected,placement:{status:'placed',operation:'replace'}}).reason,'raw-operation-mismatch');
  assert.ok(expected.cellPaths[0][0].endsWith('/w:tc[1]'));
});
test('raw census retains Croatian headings and unsupported comparison layouts',()=>{
  const raw=rawDocument(docx(p('Amandman 1')+'<w:tbl><w:tr>'+cell('One merged column')+'</w:tr></w:tbl>'));
  assert.equal(raw.amendments.length,1);assert.equal(raw.amendments[0].gap,'raw-comparison-layout');
});
test('raw location assertions reject a placement in the wrong numbered source paragraph',()=>{
  const paths=['/opening','/one','/two'];
  const rawText={motionDocument:true,paragraphs:[{body:true,text:'The European Parliament,',path:paths[0]},{body:true,text:'1. Same original.',path:paths[1]},{body:true,text:'2. Same original.',path:paths[2]}]};
  const text={paragraphs:rawText.paragraphs.map(p=>p.text),paragraphSources:paths.map(path=>({path}))};
  const expected={operation:'replace',language:'en',sectionKind:'resolution',originalText:'Same original.',targetLabel:'Paragraph 1'};
  assert.equal(verifyLanguagePlacement({expected,placement:{status:'placed',operation:'replace',span:{start:2,end:2}},text,rawText}).reason,'raw-address-mismatch');
  assert.equal(verifyLanguagePlacement({expected,placement:{status:'placed',operation:'replace',span:{start:1,end:1}},text,rawText}).status,'verified');
});
test('unavailable section and complex target expectations stay unverified',()=>{
  assert.equal(simpleAddress('Article 1 – paragraph 2'),null);
  const rawText={paragraphs:[{body:true,text:'1. Original.',path:'/one'}]},text={paragraphs:['1. Original.'],paragraphSources:[{path:'/one'}]};
  assert.equal(verifyLanguagePlacement({expected:{operation:'replace',originalText:'Original.',targetLabel:'Paragraph 1'},placement:{status:'placed',operation:'replace',span:{start:0,end:0}},text,rawText}).reason,'raw-section-unverified');
});

test('location parity preserves source labels while comparing translated insertion conventions',()=>{
  const make=(language,value)=>row(language,'correct',{placement:{operation:'insert'},location:{section:'resolution',kind:'paragraph',value,scope:'body'}});
  assert.deepEqual(parityLocation(make('en','5b')),parityLocation(make('fr','5ter')));
  assert.deepEqual(parityLocation(make('en','5a')),parityLocation(make('el','5α')));
  assert.equal(make('fr','5ter').location.value,'5ter');
});
