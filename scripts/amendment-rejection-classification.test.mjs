import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRow} from './amendment-benchmark-model.mjs';

const stages=(S5,S3={status:'blocked',reason:'target-label-unparsed'})=>({S1:{status:'passed'},S2:{status:'passed'},S3,S4:{status:'passed'},S5,S6:{status:'not-applicable',reason:'not-placed'}});
const rejection={operation:'reject',status:'document-operation',scope:'commission-proposal',reason:'rejects_proposal'};

test('a source-attested whole-document rejection is not placeable', () => {
  assert.deepEqual(classifyRow(stages(rejection),{status:'verified',reason:'source-attested-rejection',scope:'commission-proposal'}),{outcome:'not-placeable',reason:'whole-document-rejection'});
});

test('unattested rejection wording keeps its ordinary classification', () => {
  assert.deepEqual(classifyRow(stages(rejection),{status:'unverified',reason:'rejection-source-not-calibrated'}),{outcome:'withheld-pipeline',reason:'target-label-unparsed'});
  assert.deepEqual(classifyRow(stages(rejection),undefined),{outcome:'withheld-pipeline',reason:'target-label-unparsed'});
  // The attestation alone never reclassifies an ordinary placement.
  assert.deepEqual(classifyRow(stages({status:'unresolved',reason:'target_not_found'}),{status:'verified',reason:'source-attested-rejection'}),{outcome:'withheld-pipeline',reason:'target-label-unparsed'});
});
