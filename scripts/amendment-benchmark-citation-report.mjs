import {createHash} from 'node:crypto';
import {classify,metrics,compareBaseline} from './amendment-benchmark-model.mjs';
import {compareLanguages} from './amendment-language-benchmark.mjs';
import {CITATION_CALIBRATION_MODE} from './amendment-benchmark-citation-bindings.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const immutableOracle='91593643527f146a68da6da0b01efb4124b2fed74328126c5823df5900609575';
const placement=row=>row.stages?.S5??row.placement;
const verification=row=>row.stages?.S6??row.verification;
const source=row=>({language:row.language,listId:row.listId,wordingSource:row.wordingSource,wordingHashes:row.stages?.S2,sourceUrl:row.stages?.S4?.sourceUrl,projection:row.stages?.S4?.projection,expected:row.expected});

export function proposedCitationReport(canonical,{cohort,mode}) {
  if(mode!==CITATION_CALIBRATION_MODE)throw new Error('Explicit proposed citation mode required.');
  const frozen=cohort==='holdout'||cohort==='languages';
  if(cohort==='languages'&&canonical.oracleFingerprint!==immutableOracle)throw new Error('Canonical language oracle fingerprint changed.');
  if(frozen&&canonical.rows.some(row=>row.citationCalibration))throw new Error('Frozen hold-out/language rows cannot contain citation calibration.');
  if(frozen)return canonical;
  const rows=canonical.rows.map(row=>{
    const pair=row.citationCalibration;
    if(!pair)return row;
    if(pair.mode!==mode||pair.accepted!==false||!equal(pair.canonical,row.stages.S6))throw new Error('Canonical citation assertion was replaced or mislabelled.');
    if(!pair.changed){if(!equal(pair.proposed,pair.canonical))throw new Error('Unrecorded citation assertion change.');return row;}
    if(pair.canonical.status!=='failed'||pair.canonical.reason!=='oracle-original-span-mismatch'||pair.proposed.status!=='verified'||pair.native?.status!=='verified'||pair.bindingStatus!=='bound'||!pair.binding||!equal(pair.proposed,pair.native))throw new Error('Proposed correction lacks its native bound proof.');
    if(pair.binding.motion.at(-1).sha256!==pair.native.assertion.motionSha256||pair.binding.amendment.at(-1).sha256!==pair.native.assertion.amendmentSha256)throw new Error('Native assertion/source binding hashes differ.');
    const stages={...row.stages,S6:pair.proposed};
    return {...row,stages,...(row.outcome==='not-placeable'?{outcome:row.outcome,reason:row.reason}:classify(stages))};
  });
  return {...canonical,rows,...(cohort==='languages'?{}:{metrics:metrics(rows)})};
}

export function citationCalibrationMatrix(canonical,options) {
  const proposed=proposedCitationReport(canonical,options),after=new Map(proposed.rows.map(row=>[row.key,row]));
  const rows=canonical.rows.map(row=>{
    const next=after.get(row.key),beforeVerification=verification(row),afterVerification=verification(next);
    return {key:row.key,id:row.id??row.key,language:row.language,canonical:{outcome:row.outcome,reason:row.reason,verification:beforeVerification},proposed:{outcome:next.outcome,reason:next.reason,verification:afterVerification},placementSha256:digest(placement(row)),sourceSha256:digest(source(row)),rawRowSha256:digest(row),changed:!equal(beforeVerification,afterVerification)||row.outcome!==next.outcome||row.reason!==next.reason,...(row.citationCalibration?{nativeBinding:row.citationCalibration.binding,rawComparison:row.citationCalibration.rawComparison}:{} )};
  });
  return {mode:options.mode,accepted:false,cohort:options.cohort,canonicalMetrics:canonical.metrics,proposedMetrics:proposed.metrics,rows,changed:rows.filter(row=>row.changed).map(row=>row.key)};
}

// Direct final pairing is separate from extraction. Historical reports may be
// used only for a labelled provisional preservation check, never as a newly
// calibrated current-main measurement.
export function compareCitationPair(current,baseline,{cohort,mode,provisional=false,currentHarness,baselineHarness}={}) {
  if(!provisional&&(!currentHarness||currentHarness!==baselineHarness))throw new Error('Final citation pairing requires the same frozen supplied-byte harness.');
  const proposed=proposedCitationReport(current,{cohort,mode}),before=proposedCitationReport(baseline,{cohort,mode});
  const unique=rows=>{const map=new Map();for(const row of rows){if(map.has(row.key))throw new Error('Duplicate calibration observation: '+row.key);map.set(row.key,row);}return map;};
  const now=unique(proposed.rows),old=unique(before.rows);
  const missing=[...old.keys()].filter(key=>!now.has(key)),extra=[...now.keys()].filter(key=>!old.has(key));
  const placementDrift=[],sourceDrift=[],assertionDrift=[],noChangeDrift=[];
  for(const [key,row]of old){
    const next=now.get(key);if(!next)continue;
    if(placement(row)?.status==='placed'){
      if(!equal(placement(row),placement(next)))placementDrift.push(key);
      if(!equal(source(row),source(next)))sourceDrift.push(key);
    }
    if(cohort==='languages'&&(!equal(row.expected,next.expected)||!equal(row.verification,next.verification)))assertionDrift.push(key);
    if(row.outcome==='not-applicable'&&!equal(row,next))noChangeDrift.push(key);
  }
  const newPlacements=proposed.rows.filter(row=>placement(row)?.status==='placed'&&placement(old.get(row.key)??{})?.status!=='placed');
  const missingNativeProof=newPlacements.filter(row=>row.citationCalibration?.native?.status!=='verified'||row.citationCalibration?.bindingStatus!=='bound').map(row=>row.key);
  const canonicalComparison=cohort==='languages'?compareLanguages(current,baseline):compareBaseline(current,baseline);
  const proposedComparison=cohort==='languages'?compareLanguages(proposed,before):compareBaseline(proposed,before);
  const changedAssertions=citationCalibrationMatrix(current,{cohort,mode}).rows.filter(row=>row.changed);
  return {mode,accepted:false,provisional,baselineHead:baseline.code.head,currentHead:current.code.head,currentHarness,baselineHarness,canonicalComparison,proposedComparison,missing,extra,placementDrift,sourceDrift,assertionDrift,noChangeDrift,newPlacements:newPlacements.map(row=>row.key),missingNativeProof,changedAssertions,priorPlaced:[...old.values()].filter(row=>placement(row)?.status==='placed').length,noChangeBefore:[...old.values()].filter(row=>row.outcome==='not-applicable').length,noChangeAfter:proposed.rows.filter(row=>row.outcome==='not-applicable').length,failed:Boolean(proposedComparison.failed||missing.length||extra.length||placementDrift.length||sourceDrift.length||assertionDrift.length||noChangeDrift.length||missingNativeProof.length)};
}
