import {createHash} from 'node:crypto';
import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {safe} from './amendment-native-table-oracle.mjs';
import {oracleAddress,oracleFold} from './amendment-oracle-grammar.mjs';
const style=row=>row.nodes?.find(n=>n['w:pPr'])?.['w:pPr'].find(n=>n['w:pStyle'])?.[':@']?.['@_w:val'];
export function assertNegativeInstruction({items,wording,placement,nativeQuoted}){
 const path=oracleAddress(wording?.targetLabel??'',wording?.language);
 if(wording?.baseline!=='commission-proposal'||wording.originalText!==''||path?.length!==4||path[0].kind!=='article'||path[1].kind!=='paragraph'||path[1].value!=='1'||path[2].kind!=='point'||path[2].isNew||path[3].kind!=='point'||path[3].value!=='-a'||!path[3].isNew||!['cs','en'].includes(wording.language))return null;
 const unknown=()=>({status:'unverified',reason:'oracle-negative-instruction-unavailable'});
 if(!/^(?:\(-a\)|-a\))\s/u.test(wording.proposedText??'')||placement.operation!=='insert')return unknown();
 const proposal=items?.[placement.itemIndex]?.proposal,buffer=nativeQuoted?.proposalBuffer;
 if(!buffer||proposal?.sourceKind!=='docx'||createHash('sha256').update(buffer).digest('hex')!==proposal.sourceHash)return unknown();
 try{
  const body=quotedWordBody(buffer),root=row=>row.kind==='paragraph'&&style(row)==='Titrearticle'&&!/^[‘„“"']/u.test(row.text.trim())&&oracleAddress(row.text,wording.language)?.[0];
  const heads=body.flatMap((row,i)=>root(row)?.kind==='article'&&root(row).value===path[0].value?[i]:[]);if(heads.length!==1)return unknown();
  const end=body.findIndex((row,i)=>i>heads[0]&&root(row)?.kind==='article');if(end<0)return unknown();const rows=body.slice(heads[0],end);
  if(rows.some(row=>row.kind!=='paragraph'||row.hidden||row.unsafe||row.numbered||!safe(row.nodes)))return unknown();
  const outer=rows.filter(row=>style(row)==='Point0'),parents=outer.filter(row=>new RegExp('^\\(?'+path[2].value+'\\)\\s','u').test(row.text));if(parents.length!==1)return unknown();
  const lead=parents[0],next=rows[rows.indexOf(lead)+1],text=oracleFold(lead.text);
  const instruction=wording.language==='cs'?/^\(?\d+\) článek (\d+) se mění takto:$/u:/^\(?\d+\) Article (\d+) is amended as follows:$/u;
  const match=instruction.exec(text),inner=wording.documentReferences?.filter(r=>r.field==='Article2').map(r=>oracleAddress(r.raw.split(/[–—]/u).slice(0,2).join(' – ').trim(),wording.language));
  if(!match||inner?.length!==1||inner[0]?.[0]?.kind!=='article'||inner[0][0].value!==match[1]||style(next)!=='Point1'||!/^\(?a\)\s/u.test(next.text))return unknown();
  const printed=(wording.language==='cs'?/^(?:\(-a\)|-a\))\s+odstavec (\d+) se nahrazuje/u:/^(?:\(-a\)|-a\))\s+paragraph (\d+) is replaced/u).exec(wording.proposedText.trim());
  if(!printed||inner[0]?.[1]?.kind!=='paragraph'||inner[0][1].value===printed[1])return unknown();
  const mapped=[lead,next].map(native=>proposal.paragraphs.filter(row=>row.source?.path===native.path&&row.source.complete&&row.complete&&oracleFold(row.text)===oracleFold(native.text)));
  if(mapped.some(rows=>rows.length!==1)||mapped[1][0].index!==mapped[0][0].index+1)return unknown();
  const before=mapped[1][0].index;return placement.insertBefore===before&&placement.insertAfter===before-1?{status:'verified',reason:'oracle-native-negative-instruction-boundary'}:{status:'failed',reason:'oracle-negative-instruction-boundary-mismatch'};
 }catch{return unknown();}
}
