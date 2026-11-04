import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const cached=new Map();
const fold=s=>String(s??'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const unknown=reason=>({status:'unverified',reason});
// Native Poppler text is read independently. No producer, parser or placer code.
export function assertCouncilDraftPlacement({placement,wording,items,nativeQuoted}) {
 if(placement?.status!=='placed')return {status:'not-applicable',reason:'not-placed'};
 const buffer=nativeQuoted?.proposalBuffer;if(!Buffer.isBuffer(buffer))return unknown('oracle-council-pdf-native-unavailable');
 const key=createHash('sha256').update(buffer).digest('hex');let raw=cached.get(key);
 if(raw===undefined){const result=spawnSync('pdftotext',['-layout','-','-'],{input:buffer,encoding:'utf8',timeout:25000,maxBuffer:4*1024*1024});raw=result.status===0?result.stdout:null;cached.set(key,raw);if(cached.size>4)cached.delete(cached.keys().next().value);}
 if(!raw)return unknown('oracle-council-pdf-text-unavailable');
 const target=/^(?:Recital|Bod odůvodnění|Betragtning|Considerando)\s+(\d+)\s*([a-z]?)\s*(?:\([^)]*\))?$/iu.exec(wording.targetLabel??'');
 if(!target)return unknown('oracle-council-pdf-address-unavailable');
 const heading=/^\s*(?:Article|Článek|Artikel|Artículo)\s+1\s*$/imu.exec(raw);if(!heading)return unknown('oracle-council-pdf-recital-boundary-unavailable');
 const preamble=raw.slice(0,heading.index),labels=[...preamble.matchAll(/^\s*\((\d+)\)\s+/gmu)],number=Number(target[1]),found=labels.filter(m=>Number(m[1])===number);
 if(found.length!==1)return unknown('oracle-council-pdf-recital-not-unique');
 const i=labels.indexOf(found[0]),end=labels[i+1]?.index??preamble.length,unit=preamble.slice(found[0].index,end),proposal=items?.[placement.itemIndex]?.proposal;
 if(!proposal)return unknown('oracle-council-pdf-projection-unavailable');
 if(placement.operation==='insert'&&target[2]){
  if(!labels[i+1]||Number(labels[i+1][1])!==number+1)return unknown('oracle-council-pdf-next-recital-unavailable');
  const before=proposal.paragraphs[placement.insertBefore]?.text,after=proposal.paragraphs[placement.insertAfter]?.text;
  const afterFold=fold(after);if(!afterFold||!fold(unit).includes(afterFold)||!new RegExp('^\\s*\\('+ (number+1)+'\\)').test(before??''))return {status:'failed',reason:'oracle-council-pdf-insertion-mismatch'};
  if(placement.insertBefore!==placement.insertAfter+1)return {status:'failed',reason:'oracle-council-pdf-boundary-gap'};
  return {status:'verified',reason:'native-council-pdf-recital-boundaries'};
 }
 if(target[2]||!['replace','delete'].includes(placement.operation))return unknown('oracle-council-pdf-operation-unavailable');
 const original=fold(wording.originalText),actual=fold(proposal.paragraphs.slice(placement.span?.start,placement.span?.end+1).map(p=>p.text).join(' '));
 if(!original||fold(raw).split(original).length!==2||!fold(unit).includes(original))return unknown('oracle-council-pdf-original-unverified');
 if(actual!==original)return {status:'failed',reason:'oracle-council-pdf-span-mismatch'};
 return {status:'verified',reason:'native-council-pdf-original-and-address'};
}
