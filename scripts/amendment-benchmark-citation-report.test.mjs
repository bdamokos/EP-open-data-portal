import test from 'node:test';
import assert from 'node:assert/strict';
import {metrics,classify} from './amendment-benchmark-model.mjs';
import {CITATION_CALIBRATION_MODE as mode} from './amendment-benchmark-citation-bindings.mjs';
import {proposedCitationReport,citationCalibrationMatrix,compareCitationPair} from './amendment-benchmark-citation-report.mjs';
const options={cohort:'primary',mode},compareOptions={...options,currentHarness:'frozen-supplied-bytes',baselineHarness:'frozen-supplied-bytes'};
function row(key='citation'){
  const stages={S1:{status:'passed'},S2:{status:'passed',originalSha256:'original',proposedSha256:'proposed'},S3:{status:'passed'},S4:{status:'passed',sourceUrl:'source',projection:{itemSources:[]}},S5:{status:'unresolved',reason:'conflicting_target_evidence'},S6:{status:'not-applicable',reason:'not-placed'}};
  return {key,id:key,language:'en',listId:'list',documentType:'B/RC-resolution',patterns:[],voteIds:[],stages,...classify(stages)};
}
const report=rows=>({sample:{frozen:true},snapshotId:'sealed-snapshot',inputs:[{sha256:'sealed-observation'}],scope:'full-pipeline-cached-sources',projectionMode:'cached-source-replay',code:{head:'0'.repeat(40),dirty:false},harness:{files:{}},rows,metrics:metrics(rows)});
function placed(value,{verified=true}={}){
  value.stages.S5={status:'placed',operation:'replace',span:{start:2,end:2}};value.stages.S6=verified?{status:'verified',reason:'oracle-addressed-source-span'}:{status:'unverified',reason:'unsupported'};Object.assign(value,classify(value.stages));return value;
}
function candidate(base){
  const value=structuredClone(base),r=value.rows[0];r.stages.S5={status:'placed',operation:'replace',span:{start:2,end:2}};r.stages.S6={status:'failed',reason:'oracle-original-span-mismatch'};Object.assign(r,classify(r.stages));
  const native={status:'verified',reason:'oracle-native-citation-marker',assertion:{motionSha256:'motion-hash',amendmentSha256:'amendment-hash'}};
  r.citationCalibration={mode,accepted:false,canonical:structuredClone(r.stages.S6),proposed:native,native,bindingStatus:'bound',binding:{motion:[{sha256:'motion-hash'}],amendment:[{sha256:'amendment-hash'}]},changed:true,rawComparison:{originalText:'2.\thaving regard to evidence,',proposedText:'2.\thaving regard to changed evidence,'}};
  value.metrics=metrics(value.rows);value.code.head='1'.repeat(40);return value;
}
test('paired reports preserve canonical failures and enumerate exact changed assertions without extracting again',()=>{
  const baseline=report([row()]),current=candidate(baseline),before=structuredClone(current),proposed=proposedCitationReport(current,options),matrix=citationCalibrationMatrix(current,options);
  assert.equal(current.rows[0].outcome,'false-placement');assert.equal(proposed.rows[0].outcome,'correct');assert.deepEqual(current,before);
  assert.equal(matrix.accepted,false);assert.deepEqual(matrix.changed,['citation']);assert.equal(matrix.rows[0].canonical.verification.reason,'oracle-original-span-mismatch');assert.equal(matrix.rows[0].rawComparison.originalText,'2.\thaving regard to evidence,');
  const comparison=compareCitationPair(current,baseline,compareOptions);assert.equal(comparison.canonicalComparison.failed,true);assert.equal(comparison.proposedComparison.failed,false);assert.equal(comparison.failed,false);assert.equal(comparison.accepted,false);
});
test('full preservation includes prior unverified coordinates, operations and sources',()=>{
  const baseline=report([row(),placed(row('protected'),{verified:false})]);
  for(const [field,change]of [['placementDrift',r=>r.stages.S5.span.start++],['placementDrift',r=>r.stages.S5.operation='delete'],['sourceDrift',r=>r.stages.S2.originalSha256='changed']]){
    const current=candidate(baseline);change(current.rows[1]);const result=compareCitationPair(current,baseline,compareOptions);assert.equal(result.failed,true);assert.deepEqual(result[field],['protected']);
  }
});
test('losses of previous correctness, missing/extra rows and new unproven placements fail',()=>{
  const baseline=report([row(),placed(row('protected'))]);
  const lost=candidate(baseline);lost.rows[1]=row('protected');lost.metrics=metrics(lost.rows);assert.equal(compareCitationPair(lost,baseline,compareOptions).failed,true);
  const missing=candidate(baseline);missing.rows.pop();missing.metrics=metrics(missing.rows);assert.deepEqual(compareCitationPair(missing,baseline,compareOptions).missing,['protected']);
  const extra=candidate(baseline);extra.rows.push(placed(row('extra')));extra.metrics=metrics(extra.rows);const changed=compareCitationPair(extra,baseline,compareOptions);assert.equal(changed.failed,true);assert.deepEqual(changed.extra,['extra']);assert.deepEqual(changed.missingNativeProof,['extra']);
});
test('no-change rows and frozen oracle assertions cannot be silently migrated',()=>{
  const unchanged=row('no-change');unchanged.outcome='not-applicable';unchanged.reason='language-version-unaffected';
  const baseline=report([row(),unchanged]),current=candidate(baseline);current.rows[1].reason='changed';assert.equal(compareCitationPair(current,baseline,compareOptions).failed,true);
  const frozen=report([row()]);assert.strictEqual(proposedCitationReport(frozen,{mode,cohort:'holdout'}),frozen);
  assert.throws(()=>proposedCitationReport(candidate(frozen),{mode,cohort:'holdout'}),/Frozen hold-out/);
  assert.throws(()=>proposedCitationReport(frozen,{mode,cohort:'languages'}),/language oracle fingerprint/);
});
test('final pairing requires the exact same frozen harness and proof/source correspondence',()=>{
  const baseline=report([row()]),current=candidate(baseline);
  assert.throws(()=>compareCitationPair(current,baseline,{...compareOptions,baselineHarness:'different'}),/same frozen supplied-byte harness/);
  assert.equal(compareCitationPair(current,baseline,{...options,provisional:true}).provisional,true);
  const changed=candidate(baseline);changed.rows[0].citationCalibration.native.assertion.motionSha256='other';assert.throws(()=>proposedCitationReport(changed,options),/binding hashes differ/);
  const swapped=candidate(baseline);swapped.rows[0].stages.S6={status:'verified',reason:'overwritten'};assert.throws(()=>proposedCitationReport(swapped,options),/Canonical citation assertion was replaced/);
});
