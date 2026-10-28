import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expectedLanguageScope,verifyLanguageScope} from './amendment-benchmark-scope-oracle.mjs';
import {expectedOperation} from './amendment-benchmark-operation-oracle.mjs';
import {rawExpected,verifyLanguagePlacement} from './amendment-language-oracle.mjs';
import {verifyPlacement,classify,metrics} from './amendment-benchmark-model.mjs';
import {compareLanguages,languageMetrics} from './amendment-language-benchmark.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-language-scope-oracle.json',import.meta.url),'utf8'));
const noChange={status:'not-applicable',operation:null,reason:'language_version_unaffected'};
test('all 23 attested languages retain exact complete-cell source provenance',()=>{
  assert.equal(new Set(fixture.examples.map(r=>r.language)).size,23);
  assert.deepEqual(fixture.unattestedLanguages,['ga']);
  for(const row of fixture.forms) {
    assert.match(row.source.sha256,/^[a-f0-9]{64}$/u);
    assert.ok(Number.isFinite(Date.parse(row.source.retrievedAt)));
    assert.ok(row.source.paths?.length||row.source.pages?.length);
    const wording={language:row.language,originalText:'Original legal wording.',proposedText:row.cell};
    assert.equal(expectedOperation(wording),'not-applicable',row.language);
    assert.deepEqual(expectedLanguageScope(wording).fields,['proposedText']);
    assert.equal(expectedLanguageScope({...wording,language:'ga'}),null);
    for(const proposedText of [row.cell+'\nNew obligation.','Quoted note: '+row.cell,row.cell+'; another change']) {
      assert.equal(expectedOperation({...wording,proposedText}),'replace','partial note remains wording');
    }
    assert.equal(expectedLanguageScope({...wording,originalText:undefined}),null);
    assert.equal(expectedOperation({...wording,proposedText:undefined}),null);
  }
});
test('native raw cells decide semantics before coordinates, including previously correct Italian replacements',()=>{
  const example=fixture.examples.find(row=>row.language==='it');
  const block={originalText:'4. Legal wording.',proposedText:example.cell,section:'Proposta di regolamento',targetLabel:'Articolo 1',tables:[]};
  const expected=rawExpected(block,'it');
  assert.equal(expected.operation,'not-applicable');
  const wrong={status:'placed',operation:'replace',span:{start:1,end:1}};
  assert.equal(verifyLanguagePlacement({expected,placement:wrong}).reason,'oracle-language-scope-placement');
  assert.equal(verifyLanguagePlacement({expected,placement:noChange}).status,'verified');
  assert.equal(verifyPlacement({wording:{...block,language:'it'},placement:wrong}).status,'failed');
  assert.equal(rawExpected({...block,gap:'raw-comparison-layout'},'it').scope,null);
});
test('scope does not turn missing, withheld, coordinates or arbitrary no-change claims into success',()=>{
  const scope=expectedLanguageScope({language:'it',originalText:'Old.',proposedText:'(Non concerne la versione italiana)'});
  assert.equal(verifyLanguageScope(noChange,scope).status,'verified');
  for(const placement of [{status:'unresolved',reason:'baseline_unavailable'}, {...noChange,span:{start:1,end:1}}, {...noChange,splice:{}}, {...noChange,operation:'replace'}])assert.equal(verifyLanguageScope(placement,scope).status,'unverified');
  assert.equal(verifyLanguageScope(noChange,null).status,'failed');
  assert.equal(verifyLanguagePlacement({placement:noChange,expected:rawExpected({originalText:'Old.',proposedText:'New.',tables:[]},'en')}).status,'failed');
});
test('deletion and insertion semantics survive and both empty cells remain unknown',()=>{
  assert.equal(expectedOperation({language:'it',originalText:'Old.',proposedText:'soppresso.'}),'delete');
  assert.equal(expectedOperation({language:'fr',originalText:'Old.',proposedText:'supprimé.'}),'delete');
  assert.equal(expectedOperation({language:'lv',originalText:'',proposedText:'New legal wording.'}),'insert');
  assert.equal(expectedOperation({language:'it',originalText:'',proposedText:''}),null);
});
test('no change is explicit, stays in totals and never receives legal-placement credit',()=>{
  const stages={S1:{status:'passed'},S2:{status:'passed'},S3:{status:'blocked'},S4:{status:'blocked'},S5:noChange,S6:{status:'verified',reason:'oracle-language-version-unaffected'}};
  assert.equal(classify(stages).outcome,'not-applicable');
  const row={key:'list:47:it',identity:'list:47',language:'it',outcome:'not-applicable',reason:'oracle-language-version-unaffected',patterns:[],voteIds:[]};
  assert.equal(metrics([row]).total,1);assert.equal(metrics([row]).counts.correct,0);
  const metric=languageMetrics([row]).find(r=>r.language==='it');
  assert.equal(metric.total,1);assert.equal(metric.counts['not-applicable'],1);
  const report=rows=>({snapshotId:'same',sample:[],inputs:[],oracleVersion:1,rows});
  const gate=compareLanguages(report([row]),report([{...row,outcome:'correct'}]));
  assert.equal(gate.failed,true,'historical ratchet cannot silently accept a semantic migration');
});
