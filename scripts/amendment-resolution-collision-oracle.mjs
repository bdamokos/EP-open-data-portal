import {oracleAddress} from './amendment-oracle-grammar.mjs';
import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
const unknown=()=>({status:'unverified',reason:'oracle-resolution-collision-unavailable'});
// The Bulgarian publication mixes Latin a with Cyrillic а in both the target
// and serial label. This local typo equivalence never rewrites source wording.
const spelling=(value,language)=>language==='bg'?value.replace(/a/gu,'а'):value;
export function assertResolutionCollision({text,wording,placement}) {
 if(placement.operation!=='insert'||wording.baseline!=='motion-resolution'||wording.originalText?.trim())return unknown();
 const address=oracleAddress(wording.targetLabel,wording.language,{resolution:true});
 if(address?.length!==2||address[0].kind!=='paragraph'||address[1].kind!=='point'||!address[1].isNew)return unknown();
 const wanted=spelling(address[1].value,wording.language),alphabet=wording.language==='bg'?'абвгдежзийклмнопрстуфхцчшщ':'abcdefghijklmnopqrstuvwxyz';
 if(wanted.length!==2||[...wanted].some(c=>!alphabet.includes(c)))return unknown();
 const printed=/^\(?([\p{Ll}](?:\s*[\p{Ll}]))\)\s/u.exec(wording.proposedText?.trim()??'');
 if(!printed||spelling(printed[1].replace(/\s/gu,''),wording.language)!==wanted)return unknown();
 let body;try{body=quotedWordBody(text?.nativeBuffer);}catch{return unknown();}
 const start=body.filter(r=>r.kind==='paragraph'&&new RegExp('^'+address[0].value+'[.)]\\s','u').test(r.text.trim()));
 if(start.length!==1)return unknown();
 let rows=body.slice(body.indexOf(start[0])+1),stop=rows.findIndex(r=>r.kind==='paragraph'&&/^\d+[.)]\s/u.test(r.text.trim()));
 if(stop>=0)rows=rows.slice(0,stop);
 const points=[];
 for(const row of rows){
  if(row.kind!=='paragraph')break;
  const match=/^\(?([\p{Ll}]{1,2})\)\s/u.exec(row.text.trim());
  if(!match)break; // A heading/continuation cannot establish this serial run.
  points.push({row,label:spelling(match[1],wording.language)});
 }
 const collision=points.findIndex(p=>p.label===wanted);
 if(collision<alphabet.length||points.filter(p=>p.label===wanted).length!==1)return unknown();
 for(let i=0;i<=collision;i++){
  const expected=i<alphabet.length?alphabet[i]:alphabet[Math.floor((i-alphabet.length)/alphabet.length)]+alphabet[(i-alphabet.length)%alphabet.length];
  if(points[i].label!==expected||points[i].row.hidden||points[i].row.unsafe)return unknown();
 }
 const base=points[alphabet.indexOf(wanted[0])],next=points[alphabet.indexOf(wanted[0])+1];
 if(!base||!next||next.label.length!==1)return unknown();
 const map=row=>text.paragraphSources.flatMap((source,i)=>source.path===row.path&&text.paragraphs[i]===row.text.trim()?[i]:[]);
 const a=map(base.row),b=map(next.row);
 if(a.length!==1||b.length!==1||b[0]!==a[0]+1)return unknown();
 return placement.insertAfter===a[0]&&placement.insertBefore===b[0]?{status:'verified',reason:'oracle-native-resolution-collision'}:{status:'failed',reason:'oracle-resolution-collision-boundary-mismatch',expectedBefore:b[0]};
}
