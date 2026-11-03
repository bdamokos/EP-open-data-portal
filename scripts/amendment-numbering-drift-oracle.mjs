import {oracleAddress,oracleFold} from './amendment-oracle-grammar.mjs';
import {rawResolutionUnits} from './amendment-benchmark-resolution-oracle.mjs';
import {assertResolutionSimilarity,oracleSimilarity} from './amendment-similarity-oracle.mjs';

// Vote evidence comes from independently indexed public decisions, never from
// returned placement evidence. A differing printed number alone proves nothing.
export function assertResolutionNumberingDrift({text,wording,placement,voteReferences=[]}) {
  if(wording.language!=='en'||!['motion-resolution','unknown'].includes(wording.baseline)
    ||!['replace','delete'].includes(placement.operation)||!placement.span
    ||/\n_{5,}\s*\n/u.test(wording.originalText||''))return null;
  const path=oracleAddress(wording.targetLabel,wording.language)||[],label=path[0];
  if(path.length!==1||label.kind!=='paragraph'||label.isNew||label.suffix||!/^\d+$/u.test(label.value))return null;
  if(!Array.isArray(voteReferences)||!voteReferences.length||voteReferences.length>64)return null;
  const votes=voteReferences.map(value=>typeof value==='string'&&value.length<=1024?/^(?:§|Paragraph)\s*([1-9]\d{0,5})$/iu.exec(oracleFold(value))?.[1]:undefined);
  if(votes.some(value=>!value||value!==votes[0])||Math.abs(Number(votes[0])-Number(label.value))!==1)return null;
  const raw=rawResolutionUnits(text,wording.language);
  if(raw.reason)return null;
  const units=raw.units.filter(unit=>unit.kind==='paragraph'),matches=units.filter(unit=>unit.label===votes[0]);
  if(matches.length!==1||matches[0].complete!==true)return null;
  const selected=matches[0],span=placement.span;
  if(span.start!==selected.start||span.end!==selected.end)return null;
  const fold=value=>oracleFold(value).replace(/^[1-9]\d{0,5}\s*[a-z]{0,3}[.)]\s+/u,'');
  const original=fold(wording.originalText);
  const candidates=[...units,...(raw.incomplete||[]).filter(unit=>unit.kind==='paragraph')]
    .map(unit=>({...unit,text:fold(text.paragraphs.slice(unit.start,unit.end+1).join(' '))}));
  const source=candidates.find(unit=>unit.start===selected.start&&unit.end===selected.end);
  // The numbering exception needs the near-exact criterion. Shared openings
  // with replaced tails alone cannot move a provision to a different label.
  if(original.length<80||original.length>10000||oracleSimilarity(source.text,original)<.95
    ||!assertResolutionSimilarity(candidates,original,span))return null;
  return {status:'verified',reason:'oracle-unique-original-agreeing-vote',location:{kind:'paragraph',value:selected.label,scope:'body'}};
}
