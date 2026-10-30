import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {citationHarnessSource} from './amendment-benchmark-citation-harness.mjs';
import {classify,verifyPlacement} from './amendment-benchmark-model.mjs';
import {CITATION_CALIBRATION_MODE} from './amendment-benchmark-citation-bindings.mjs';

const canonical=readFileSync(new URL('./amendment-benchmark.mjs',import.meta.url),'utf8');
test('the private harness keeps canonical verification/classification and requires explicit opt-in on source replay only',()=>{
  const source=citationHarnessSource(canonical);
  assert.ok(source.startsWith('#!/usr/bin/env node\n'));
  assert.ok(source.includes('stages.S6=verifyPlacement('));
  assert.ok(source.includes("if(replay&&process.env.EP_CITATION_CALIBRATION_MODE===CITATION_CALIBRATION_MODE)"));
  assert.ok(source.includes('canonical:stages.S6'));
  assert.ok(source.includes('provisional?{outcome:\'not-placeable\',reason:\'provisional-agreement\'}:classify(stages)'));
  assert.ok(source.includes('metrics:metrics(resultRows),rows:resultRows'));
  assert.equal((source.match(/await pairedCitationVerification\(/gu)??[]).length,1);
  assert.ok(!source.includes('stages.S6=citationCalibration'));
  assert.ok(!source.includes('process.exitCode=0'));
  assert.equal(readFileSync(new URL('./amendment-benchmark.mjs',import.meta.url),'utf8'),canonical);
});
test('upstream hook changes or duplicate hooks stop the private build rather than skipping verification',()=>{
  assert.throws(()=>citationHarnessSource(canonical.replace('let target=null;','let target;')),/exactly one canonical hook/);
  assert.throws(()=>citationHarnessSource(canonical+'\nlet target=null;'),/exactly one canonical hook/);
  assert.throws(()=>citationHarnessSource(canonical.replace('if(replay) {\n          const native=','if(replay&&false) {\n          const native=')),/exactly one canonical hook/);
});
test('executing the generated probe retains the original failure while recording the proposed native success',async()=>{
  const source=citationHarnessSource(canonical),start=source.indexOf('        stages.S6=verifyPlacement('),end=source.indexOf('        // Keep coordinates',start);
  assert.ok(start>=0&&end>start);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const evaluate=new AsyncFunction('input',`const {verifyPlacement,classify,pairedCitationVerification,sourceBoundCitationVerification,CITATION_CALIBRATION_MODE,process,replay,stages,wording,items,text,target,nativeProposalInputs,fetched,cache,row,variant}=input;const structured=false;let citationCalibration=null,nativeCitationEvidence=null;${source.slice(start,end)}return {verification:stages.S6,calibration:citationCalibration,classification:classify(stages)};`);
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/resolution-citation-native.json',import.meta.url))),text=JSON.parse(readFileSync(new URL('../server/fixtures/resolution-citation-excerpts.json',import.meta.url))),wording=fixture.amendments.find(row=>row.number===73).wording;
  for(const [replay,optIn] of [[true,true],[true,false],[false,true]]) {
    const stages={S1:{status:'passed'},S2:{status:'passed'},S3:{status:'passed'},S4:{status:'passed'},S5:{status:'placed',operation:'replace',span:{start:2,end:2}}},seen=[];
    const result=await evaluate({verifyPlacement,classify,replay,stages,wording,text,items:null,nativeProposalInputs:null,fetched:{body:Buffer.alloc(0)},cache:{},row:{},variant:{},CITATION_CALIBRATION_MODE,process:{env:{EP_CITATION_CALIBRATION_MODE:optIn?CITATION_CALIBRATION_MODE:''}},
      sourceBoundCitationVerification:async()=>({verification:{status:'verified',reason:'oracle-native-citation-marker'},evidence:{}}),
      pairedCitationVerification:async input=>{seen.push(input.canonical);return {canonical:input.canonical,proposed:{status:'verified',reason:'oracle-native-citation-marker'},changed:input.canonical.status==='failed'};}});
    assert.deepEqual(result.verification,{status:'failed',reason:'oracle-original-span-mismatch'});
    assert.equal(result.classification.outcome,'false-placement');
    assert.equal(seen.length,replay&&optIn?1:0);
    if(replay&&optIn){assert.deepEqual(result.calibration.canonical,result.verification);assert.equal(result.calibration.proposed.status,'verified');assert.equal(result.calibration.changed,true);}
    else assert.equal(result.calibration,null);
  }
});
