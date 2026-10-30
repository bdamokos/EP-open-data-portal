import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {citationHarnessSource} from './amendment-benchmark-citation-harness.mjs';

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
});
