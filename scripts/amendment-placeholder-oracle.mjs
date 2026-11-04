import {oracleAddress} from './amendment-oracle-grammar.mjs';
import {rawResolutionUnits,rawResolutionPointUnits} from './amendment-benchmark-resolution-oracle.mjs';

// D5: the address, never the amount, identifies the deleted budget unit.
export function assertPlaceholderDeletion({text,wording,placement}) {
  const unknown={status:'unverified',reason:'oracle-placeholder-unavailable'};
  if(wording?.language!=='en'||wording.baseline!=='motion-resolution'||placement.operation!=='delete'||! /\bEUR\s+XXX\b/u.test(wording.originalText||''))return unknown;
  const address=oracleAddress(wording.targetLabel,'en');
  if(!address||address.length<2||address[0].kind!=='paragraph'||address.slice(1).some(x=>x.kind!=='point'||x.isNew))return unknown;
  const motion=rawResolutionUnits(text,'en');if(motion.reason)return unknown;
  const parents=motion.units.filter(u=>u.kind==='paragraph'&&u.label===address[0].value);
  if(parents.length!==1)return unknown;
  const points=rawResolutionPointUnits(text).units;
  const units=points.filter(u=>u.group===parents[0].start&&JSON.stringify(u.path)===JSON.stringify(address.map(({kind,value})=>({kind,value}))));
  if(units.length!==1||!units[0].complete)return unknown;
  const unit=units[0],source=text.paragraphs.slice(unit.start,unit.end+1).join('\n');
  const tokens=value=>value.normalize('NFC').toLowerCase().replace(/\beur\s+(?:xxx|\d+(?:[\s\u00a0]\d{3})*(?:[.,]\d+)?)\b/gu,'eur amount').replace(/(?:^|[\s,;])(?:\([a-z]+\)|[a-z]+[.)])\s+/gu,' ').replace(/\bincluding\b|\bthe\b/gu,' ').replace(/[–—]/gu,'-').replace(/[.;,]/gu,' ').replace(/\s+/gu,' ').trim();
  if(source.includes('\uFFFC')||! /\bbudget line\b/u.test(source)||! /\bEUR\s+\d/u.test(source)||tokens(source)!==tokens(wording.originalText))return unknown;
  if(placement.status!=='placed'||placement.span?.start!==unit.start||placement.span?.end!==unit.end)return {status:'failed',reason:'oracle-placeholder-boundary-mismatch'};
  return {status:'verified',reason:'oracle-addressed-placeholder-deletion'};
}
