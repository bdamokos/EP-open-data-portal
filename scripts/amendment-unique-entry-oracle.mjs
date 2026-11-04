import {createHash} from 'node:crypto';
import {quotedWordBody,quotedWordComparison,quotedWordParts} from './amendment-benchmark-quoted-oracle.mjs';
import {safe,literal,completeGrid,nativeAnnexInstructionRows} from './amendment-native-table-oracle.mjs';
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
const descendants=(nodes,key)=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,value])=>name===key?[value]:Array.isArray(value)?descendants(value,key):[]));
const rawText=nodes=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,value])=>name==='w:t'?value.map(p=>p['#text']??''):name==='w:tab'?['\t']:['w:br','w:cr'].includes(name)?['\n']:Array.isArray(value)?[rawText(value)]:[])).join('');
const fold=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim(),hash=b=>createHash('sha256').update(b).digest('hex');
// Conflicting point/caption labels cannot defeat a unique complete native table
// entry in the same annex. Count opaque and hidden competitors independently.
export function assertUniqueEntry({items,wording,placement,nativeQuoted}){
 const label=/^Annex ([IVXLC]+) – point ([1-9]\d*)\n(Regulation \(EU\) \d{4}\/\d+) — Annex ([IVXLC]+) – point ([1-9]\d*) – table titled ‘[^’\n]+’$/u.exec(wording.targetLabel??'');
 if(wording.language!=='en'||wording.baseline!=='commission-proposal'||!label||label[1]!==label[4]||label[2]===label[5]||wording.proposedText!=='deleted')return null;
 const unknown=()=>({status:'unverified',reason:'oracle-unique-entry-unavailable'}),original=wording.originalText;
 if(placement.operation!=='delete'||typeof original!=='string'||original.length<30||/[\n\t\u2026\uFFFC]|\.{3}/u.test(original)||wording.targetPath?.proposal?.length>1||wording.targetPath?.underlying?.length>1)return unknown();
 try{
  const comparison=quotedWordComparison(quotedWordBody(nativeQuoted.amendmentBuffer),nativeQuoted.number);
  if(!comparison||comparison.language!=='{EN}en'||comparison.outer+'\n'+comparison.act+' — '+comparison.inner!==wording.targetLabel||comparison.original!==original||comparison.proposed!==wording.proposedText)return unknown();
  if(wording.targetPath?.proposal?.length===1&&wording.targetPath.proposal[0].raw!==comparison.outer||wording.targetPath?.underlying?.length===1&&(wording.targetPath.underlying[0].raw!==comparison.inner||wording.targetPath.underlying[0].document!==comparison.act))return unknown();
  const buffers=nativeQuoted.proposalBuffers,acts=(items??[]).map((item,index)=>({item,index})).filter(({item})=>item.kind==='act');
  if(acts.length!==1||!buffers?.[acts[0].index]||hash(buffers[acts[0].index])!==acts[0].item.proposal.sourceHash)return unknown();
  const act=quotedWordBody(buffers[acts[0].index]),lead=label[3]+' is amended as follows:';
  const allParagraphs=body=>body.flatMap(row=>row.kind==='paragraph'?[row.nodes]:descendants([row.nodes],'w:p'));
  if(allParagraphs(act).filter(p=>fold(rawText(p))===lead).length!==1||!act.some(p=>p.kind==='paragraph'&&!p.hidden&&safe(p.nodes)&&fold(p.text)===lead))return unknown();
  const found=[];
  for(const [itemIndex,item] of (items??[]).entries()){
   const proposal=item.proposal,buffer=buffers?.[itemIndex];if(item.kind!=='annex'||proposal.sourceKind!=='docx'||!buffer||hash(buffer)!==proposal.sourceHash)continue;
   const body=quotedWordBody(buffer),head='ANNEX '+label[1],all=allParagraphs(body);
   if(all.filter(p=>fold(rawText(p))===head).length!==1||all.filter(p=>fold(rawText(p))===fold(original)).length!==1)continue;
   const first=body.findIndex(p=>p.kind==='paragraph'&&fold(p.text)===head&&!p.hidden&&safe(p.nodes));
   const last=body.findIndex((p,index)=>index>first&&p.kind==='paragraph'&&/^ANNEX [IVXLC]+$/u.test(p.text.trim()));
   if(first<0||last<0)continue;
   const points=nativeAnnexInstructionRows(quotedWordParts(buffer),body,first,last),ordinal=Number(label[5]),owner=points[ordinal-1],next=points[ordinal]??{index:last};
   // Beyond the first explicit restart, support only uninterrupted inherited
   // parent numbering. An override or another list instance cannot prove M.
   if(ordinal<2||!owner||points.slice(1,ordinal).some(p=>descendants(p.nodes,'w:numPr').length)||fold(owner.text)!=='the following table is added:')continue;

   const cells=body.flatMap(p=>p.kind==='other'?descendants([p.nodes],'w:tc'):[]);
   if(cells.filter(c=>fold(descendants(c,'w:p').map(rawText).join('\n'))===fold(original)).length!==1)continue;
   let tableNumber=0;
   for(const [at,entry] of body.entries()){
    if(entry.kind==='paragraph'||!entry.nodes['w:tbl'])continue;tableNumber++;
    if(at<=owner.index||at>=next.index||entry.hidden)continue;
    const table=entry.nodes['w:tbl'];if(!completeGrid(table)||descendants(table,'w:tbl').length||['w:vMerge','w:hMerge','w:gridSpan','w:numPr'].some(key=>descendants(table,key).length)||descendants(table,'w:p').some(p=>!safe(p)))continue;
    for(const [tr,row] of children(table,'w:tr').entries())for(const [tc,cell] of children(row,'w:tc').entries()){
     const ps=children(cell,'w:p');if(ps.length!==1||fold(literal(ps[0]))!==fold(original))continue;
     const path=`/w:document[1]/w:body[1]/w:tbl[${tableNumber}]/w:tr[${tr+1}]/w:tc[${tc+1}]/w:p[1]`,matches=proposal.paragraphs.filter(p=>p.source?.path===path&&p.source.container==='table-cell'&&p.complete&&p.source.complete===true&&fold(p.text)===fold(original));
     if(matches.length!==1||proposal.paragraphs.filter(p=>p.source.path.startsWith(path.replace(/w:p\[1\]$/u,''))).length!==1)continue;
     found.push({itemIndex,row:matches[0],path});
    }
   }
  }
  if(found.length!==1)return unknown();
  const {itemIndex,row,path}=found[0],{span,splice}=placement;
  return placement.itemIndex===itemIndex&&span?.start===row.index&&span.end===row.index&&splice?.start.paragraph===row.index&&splice.end.paragraph===row.index&&splice.start.offset===0&&splice.end.offset===row.text.length
   ?{status:'verified',reason:'oracle-unique-native-annex-entry',assertion:{itemIndex,nativePath:path,paragraph:row.index}}
   :{status:'failed',reason:'oracle-unique-entry-span-mismatch'};
 }catch{return unknown();}
}
