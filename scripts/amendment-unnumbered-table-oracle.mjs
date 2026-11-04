import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {completeGrid,safe,literal} from './amendment-native-table-oracle.mjs';
const unknown=()=>({status:'unverified',reason:'oracle-unnumbered-table-unavailable'});
// This independent grammar deliberately accepts no stated position.
export function unnumberedTableAddress(wording) {
 if(wording.language!=='en'||wording.baseline!=='commission-proposal'||wording.originalText?.trim())return null;
 const raw=wording.targetPath?.proposal?.length===1?wording.targetPath.proposal[0].raw:wording.targetLabel;
 const match=/^Annex – table – ([\p{L}][\p{L} ,&-]*) \(new\)$/u.exec(raw??'');
 if(!match||wording.proposedText?.split('\n')[0]!==match[1]||!wording.proposedText.includes('\t'))return null;
 return {raw,caption:match[1]};
}
export function assertUnnumberedTable({proposal,wording,placement,nativeQuoted,voteReferences=[]}) {
 if(!unnumberedTableAddress(wording)||placement.operation!=='insert'||!nativeQuoted||!proposal||voteReferences.some(ref=>/\b(?:before|after|following|preceding|point|paragraph)\b|\btable\s+\d/iu.test(ref)))return unknown();
 let body;try{body=quotedWordBody(nativeQuoted.proposalBuffer);}catch{return unknown();}
 const headings=body.filter(row=>row.kind==='paragraph'&&row.text.trim()==='ANNEX');
 if(headings.length!==1)return unknown();
 const native=[];let tableNumber=body.slice(0,body.indexOf(headings[0])+1).filter(row=>row.nodes?.['w:tbl']).length;
 for(const row of body.slice(body.indexOf(headings[0])+1)) {
  if(row.hidden)return unknown();
  if(row.kind==='paragraph') {if(row.unsafe||!safe(row.nodes))return unknown();if(row.text.trim())native.push({path:row.path,text:row.text.trim()});continue;}
  if(row.nodes['w:sectPr'])continue;
  const table=row.nodes['w:tbl'];if(!table||!completeGrid(table))return unknown();tableNumber++;
  let valid=true;
  const walk=(nodes,path)=>{const counts=new Map();for(const node of nodes)for(const [key,value] of Object.entries(node)){
   if(key===':@'||key==='#text')continue;
   const n=(counts.get(key)||0)+1;counts.set(key,n);const own=path+'/'+key+'['+n+']';
   if(key==='w:p'){if(!safe(value))valid=false;const text=literal(value).trim();if(text)native.push({path:own,text});}
   else if(['w:tr','w:tc'].includes(key))walk(value,own);
  }};
  walk(table,`/w:document[1]/w:body[1]/w:tbl[${tableNumber}]`);if(!valid)return unknown();
 }
 if(!native.length)return unknown();
 const projected=native.map(row=>proposal.paragraphs.filter(p=>p.source?.path===row.path&&p.text===row.text));
 if(projected.some(rows=>rows.length!==1)||projected.some((rows,i)=>i&&rows[0].index!==projected[i-1][0].index+1))return unknown();
 const before=projected.at(-1)[0].index+1;
 if(before!==proposal.paragraphs.length)return unknown();
 return placement.insertBefore===before&&placement.insertAfter===before-1?{status:'verified',reason:'oracle-native-unnumbered-table-end'}:{status:'failed',reason:'oracle-unnumbered-table-boundary-mismatch',expectedBefore:before};
}
