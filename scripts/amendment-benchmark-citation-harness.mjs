// Build a private supplied-byte experimental harness. Callers retain the
// original file and this exact patch; no canonical source is written in place.
export function citationHarnessSource(canonical) {
  const replaceOnce=(source,before,after)=>{
    if(source.split(before).length!==2)throw new Error('Citation harness requires exactly one canonical hook: '+before.slice(0,80));
    return source.replace(before,after);
  };
  let source="import {pairedCitationVerification,CITATION_CALIBRATION_MODE} from './amendment-benchmark-citation-bindings.mjs';\n"+canonical;
  // Keep the Node shebang at the start of the generated file.
  source=source.replace(/^(import[^\n]+\n)(#![^\n]+\n)/u,'$2$1');
  source=replaceOnce(source,'let target=null;','let target=null,citationCalibration=null;');
  const hook='        // Keep coordinates and assertions, not a growing corpus of source text.';
  source=replaceOnce(source,hook,"        if(replay&&process.env.EP_CITATION_CALIBRATION_MODE===CITATION_CALIBRATION_MODE)\n          citationCalibration=await pairedCitationVerification({mode:CITATION_CALIBRATION_MODE,canonical:stages.S6,cache,row,variant,fetched,text,wording,placement:stages.S5,target});\n"+hook);
  source=replaceOnce(source,'results.push({key:row.id,','results.push({...(citationCalibration?{citationCalibration}:{}),key:row.id,');
  source=replaceOnce(source,"const files=['scripts/amendment-benchmark.mjs'","const files=['scripts/amendment-benchmark-citation-bindings.mjs','scripts/amendment-benchmark-citation-calibration.mjs','scripts/amendment-benchmark-citation-harness.mjs','scripts/amendment-benchmark.mjs'");
  return source;
}
