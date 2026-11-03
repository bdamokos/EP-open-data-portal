import {nativeBareAnnexList,nativeBareAnnexPointRows} from './amendment-annex-indent-oracle.mjs';
const normal=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
export function assertBareAnnexReplacement({items,proposal,wording,placement,nativeQuoted}){
 const unknown=()=>({status:'unverified',reason:'oracle-bare-annex-replacement-unavailable'});
 const target=wording?.language==='en'&&/^Annex I – point ([1-9]\d*) – (introductory part|indent ([1-9]\d*))$/u.exec(wording.targetLabel||'');
 if(!target||wording.baseline!=='commission-proposal'||placement.operation!=='replace'||!wording.originalText||!wording.proposedText||!proposal)return unknown();
 if(wording.targetPath?.underlying?.length||(wording.targetPath?.language??wording.language)!==wording.language||wording.targetPath?.proposal?.length>1||wording.targetPath?.proposal?.length===1&&normal(wording.targetPath.proposal[0].raw||'')!==normal(wording.targetLabel))return unknown();
 const proof=nativeBareAnnexList({items,proposal,itemIndex:placement.itemIndex,nativeQuoted}),rows=nativeBareAnnexPointRows(proof,proposal,target[1]);
 if(!rows||rows.length<2)return unknown();const index=target[3]?Number(target[3]):0,row=rows[index];if(!row)return unknown();
 if(index===0){
  const prefix=new RegExp('^\\('+target[1]+'\\)\\s+','u');
  if(!prefix.test(wording.originalText)||!prefix.test(wording.proposedText)||normal(wording.originalText)!==normal(row.text)||!/:\s*$/u.test(row.text)||!/:\s*$/u.test(wording.proposedText))return unknown();
 }else{
  const bullet=/^[-–—•]\s+\S/u,strip=value=>normal(value.replace(/^[-–—•]\s+/u,''));
  if(!row.text.startsWith('•\t')||!bullet.test(wording.originalText)||!bullet.test(wording.proposedText)||strip(row.text)!==strip(wording.originalText))return unknown();
 }
 if(placement.status!=='placed'||placement.span?.start!==row.index||placement.span?.end!==row.index||placement.splice?.start?.paragraph!==row.index||placement.splice?.end?.paragraph!==row.index||placement.splice.start.offset!==0||placement.splice.end.offset!==row.text.length)return {status:'failed',reason:'oracle-bare-annex-replacement-boundary-mismatch'};
 return {status:'verified',reason:'oracle-native-bare-annex-replacement',rawSourceRows:[proof.heading.path,proof.points[Number(target[1])-1].row.path,row.source.path]};
}
