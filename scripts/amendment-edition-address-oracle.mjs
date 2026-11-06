import {oracleAddress} from './amendment-oracle-grammar.mjs';
import {rawResolutionPointUnits} from './amendment-benchmark-resolution-oracle.mjs';

// Reviewed correspondence for the held Bulgarian/Latin labels: Bulgarian л
// and Latin l are the twelfth list letters; а/a is the first inserted suffix.
// This is an explicit correspondence, not transliteration or text translation.
export function editionAddress(wording) {
  let raw=wording.targetLabel||'';
  if(wording.language==='bg')raw=raw.replace(/буква л а(?= \()/u,'буква l a');
  const path=oracleAddress(raw.split('\n')[0],wording.language,{resolution:['motion-resolution','unknown'].includes(wording.baseline)});
  return path?.map(p=>({...p,suffix:p.suffix==='bis'?'a':p.suffix,value:p.suffix==='bis'?p.base+'a':p.value}));
}
export function oracleEditionTarget({text,wording,placement}) {
  const path=editionAddress(wording);
  if(!path||path.length!==2||path[0].kind!=='paragraph'||path[1].kind!=='point')return null;
  const points=rawResolutionPointUnits(text).units.filter(u=>u.path.length===2&&u.path[0].value===path[0].value);
  const part=path[1];
  if(!/^\d+$/u.test(String(part.base))||!points.length)return null;
  const unknown={status:'unverified',reason:'oracle-edition-address-disagreement'};
  const editions=wording.addressEditions||[];
  if(!editions.length)return {assertion:unknown};
  const others=editions.filter(e=>e.language!==wording.language);
  const paths=others.map(editionAddress);
  if(!others.length||paths.some(p=>!p||p.length!==2||p[0].kind!=='paragraph'||p[1].kind!=='point'))return {assertion:unknown};
  const key=p=>JSON.stringify(p.map(s=>[s.kind,s.base,s.suffix,s.isNew]));
  if(new Set(paths.map(key)).size!==1)return {assertion:unknown};
  const chosen=paths[0],anchors=points.filter(p=>p.label===chosen[1].base);
  if(chosen[0].value!==path[0].value||!chosen[1].isNew||anchors.length!==1||!anchors[0].complete)return {assertion:unknown};
  const anchor=anchors[0];
  if(placement.status==='placed'&&(placement.insertAfter!==anchor.end||placement.insertBefore!==anchor.end+1))return {assertion:{status:'failed',reason:'oracle-edition-address-boundary-mismatch'}};
  return {target:{raw:wording.targetLabel,language:wording.language,complete:true,segments:chosen}};
}
