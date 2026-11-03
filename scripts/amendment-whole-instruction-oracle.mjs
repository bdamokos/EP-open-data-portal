import {createHash} from 'node:crypto';
import {quotedWordBody,quotedWordParts} from './amendment-benchmark-quoted-oracle.mjs';
import {safe,literal,completeGrid,nativeAnnexInstructionRows} from './amendment-native-table-oracle.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
const descendants=(nodes,key)=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,value])=>name===key?[value]:Array.isArray(value)?descendants(value,key):[]));
const nativeParagraphs=body=>body.flatMap(row=>row.kind==='paragraph'?[row.nodes]:descendants([row.nodes],'w:p'));
// Uniqueness includes opaque and revised content. Do not use the strict
// payload reader here: it deliberately excludes unsupported inline wrappers.
const uniquenessText=nodes=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key==='w:t'?value.map(part=>part['#text']??''):key==='w:tab'?['\t']:['w:br','w:cr'].includes(key)?['\n']:key==='w:noBreakHyphen'?['\u2011']:key==='w:softHyphen'?['\u00ad']:Array.isArray(value)?[uniquenessText(value)]:[])).join('');
// Stacked comparison sections share a two-column native grid. Full-width
// rows carry the section headings, instruction and caption, never legal cells.
function stackedComparison(body,number){
 const starts=body.flatMap((row,index)=>row.kind==='paragraph'&&row.text.includes('<Amend>')&&row.text.includes('<NumAm>'+number+'</NumAm>')?[index]:[]);if(starts.length!==1)return null;
 const start=starts[0],end=body.findIndex((row,index)=>index>start&&row.kind==='paragraph'&&row.text.includes('</Amend>'));if(end<0)return null;
 const rows=body.slice(start,end+1),paragraphs=rows.filter(row=>row.kind==='paragraph'),tables=rows.filter(row=>row.kind==='other');
 if(paragraphs.some(row=>row.unsafe||!safe(row.nodes))||tables.length!==1||tables[0].hidden||!tables[0].nodes['w:tbl'])return null;
 const numbers=paragraphs.flatMap(row=>[...row.text.matchAll(/<NumAm>([^<]+)<\/NumAm>/gu)].map(match=>match[1]));if(!numbers.length||numbers.some(value=>value!==String(number))||paragraphs.slice(1).some(row=>row.text.includes('<Amend>')))return null;
 const table=tables[0].nodes['w:tbl'];if(!completeGrid(table)||['w:tbl','w:hMerge','w:vMerge'].some(key=>descendants(table,key).length)||children(children(table,'w:tblGrid')[0]||[],'w:gridCol').length!==2)return null;
 let side=null;const sections={original:[],proposed:[]},seen=[];
 for(const row of children(table,'w:tr')){
  const cells=children(row,'w:tc');if(![1,2].includes(cells.length))return null;
  const values=[];for(const cell of cells){const paragraphs=children(cell,'w:p');if(!paragraphs.length||paragraphs.some(p=>!safe(p)))return null;values.push(paragraphs.map(literal).join('\n').trim());}
  const spans=descendants(row,'w:gridSpan');
  if(cells.length===1){
   if(spans.length!==1)return null;
   const spanNode=children(cells[0],'w:tcPr')[0]?.find(node=>node['w:gridSpan']);if(spanNode?.[':@']?.['@_w:val']!=='2')return null;
   if(values[0]==='')continue;
   const heading=values[0]==='Text proposed by the Commission'?'original':values[0]==='Amendment'?'proposed':null;
   if(heading){if(seen.includes(heading)||heading==='proposed'&&side!=='original'||heading==='original'&&side)return null;side=heading;seen.push(heading);continue;}
  }else if(spans.length||values.some(value=>!value))return null;
  if(!side)return null;sections[side].push(values.join('\t'));
 }
 if(seen.join(',')!=='original,proposed')return null;
 const field=name=>{const found=paragraphs.flatMap(row=>[...row.text.matchAll(new RegExp('<'+name+'>([\\s\\S]*?)</'+name+'>','gu'))].map(match=>match[1]));return found.length===1?found[0]:null;};
 return {outer:field('Article'),act:field('DocAmend2'),inner:field('Article2'),language:field('Original'),original:sections.original.join('\n'),proposed:sections.proposed.join('\n')};
}
// A complete replacement of an amending instruction anchors on its lead.
// The elided old-law table is not an original-text passage to be matched.
export function assertWholeAnnexInstruction({items,proposal,wording,placement,nativeQuoted}) {
 const target=wording?.language==='en'&&/^Annex ([IVXLC]+) – paragraph 1 – point ([1-9]\d*) – table\n(Regulation \((?:EU|EC)\) \d{4}\/\d+) — Annex ([IVXLC]+)$/u.exec(wording.targetLabel||'');
 const old=/^in point ([1-9]\d*), the table ‘([^‘’\r\n]+)’ is replaced by the following:$/u.exec(wording?.originalText?.split('\n')[0]||'');
 if(!target||!old)return null;
 const unknown=()=>({status:'unverified',reason:'oracle-whole-annex-instruction-unavailable'});
 if(target[2]!=='1'||wording.baseline!=='commission-proposal'||placement?.operation!=='replace'||items?.length!==2||items.filter(item=>item.kind==='act').length!==1||items.filter(item=>item.kind==='annex'&&item.proposal===proposal).length!==1)return unknown();
 if(wording.targetPath?.language&&wording.targetPath.language!=='en'||wording.targetPath?.proposal?.length&& (wording.targetPath.proposal.length!==1||wording.targetPath.proposal[0].raw!==target[0].split('\n')[0])||wording.targetPath?.underlying?.length&&(wording.targetPath.underlying.length!==1||wording.targetPath.underlying[0].document!==target[3]||wording.targetPath.underlying[0].raw!=='Annex '+target[4]))return unknown();
 const firstNew=`in point ${old[1]}, the following lines are added to the table ‘${old[2]}’:`;
 const oldLines=wording.originalText.split('\n'),newLines=wording.proposedText?.split('\n')||[];
 if(oldLines.length!==4||!/^‘\[[^\t\r\n]+$/u.test(oldLines[1])||oldLines[1].slice(2).toLowerCase()!==old[2].toLowerCase()||oldLines[2]!=='CN code\tGreenhouse gas'||oldLines[3]!=='…\t…'||newLines[0]!==firstNew||newLines[1]!==oldLines[1]||newLines[2]!==oldLines[2]||newLines.length<4||/[\u2026]|\.{3}/u.test(wording.proposedText))return unknown();
 const act=items.find(item=>item.kind==='act').proposal,buffers=nativeQuoted?.proposalBuffers;
 if(!Buffer.isBuffer(nativeQuoted?.proposalBuffer)||hash(nativeQuoted.proposalBuffer)!==proposal.sourceHash||!Buffer.isBuffer(nativeQuoted?.amendmentBuffer)||!Number.isSafeInteger(nativeQuoted.number)||nativeQuoted.number<1||wording.number!==undefined&&wording.number!==nativeQuoted.number||!Array.isArray(buffers))return unknown();
 const actBuffer=buffers.find(bytes=>Buffer.isBuffer(bytes)&&hash(bytes)===act.sourceHash);if(!actBuffer)return unknown();
 try {
  const amendmentBody=quotedWordBody(nativeQuoted.amendmentBuffer),comparison=stackedComparison(amendmentBody,nativeQuoted.number);
  if(!comparison||comparison.language!=='{EN}en'||comparison.outer+'\n'+comparison.act+' — '+comparison.inner!==wording.targetLabel||comparison.original!==wording.originalText||comparison.proposed!==wording.proposedText)return unknown();
  const start=amendmentBody.findIndex(row=>row.kind==='paragraph'&&row.text.includes('<Amend>')&&row.text.includes('<NumAm>'+nativeQuoted.number+'</NumAm>')),end=amendmentBody.findIndex((row,index)=>index>start&&row.kind==='paragraph'&&row.text.includes('</Amend>'));
  if(start<0||end<0)return unknown();const comparisonTables=amendmentBody.slice(start,end+1).filter(row=>row.kind==='other');
  if(comparisonTables.length!==1||comparisonTables[0].hidden||!comparisonTables[0].nodes['w:tbl']||!completeGrid(comparisonTables[0].nodes['w:tbl'])||descendants(comparisonTables[0].nodes['w:tbl'],'w:p').some(p=>!safe(p)))return unknown();
  const actBody=quotedWordBody(actBuffer),actLeads=actBody.filter(row=>row.kind==='paragraph'&&row.text.trim()===target[3]+' is amended as follows:');
  if(nativeParagraphs(actBody).filter(nodes=>uniquenessText(nodes).trim()===target[3]+' is amended as follows:').length!==1)return unknown();
  if(actLeads.length!==1||actLeads[0].hidden||!safe(actLeads[0].nodes))return unknown();
  const raw=quotedWordBody(nativeQuoted.proposalBuffer),heads=raw.filter(row=>row.kind==='paragraph'&&row.text.trim()==='ANNEX '+target[1]);
  if(nativeParagraphs(raw).filter(nodes=>uniquenessText(nodes).trim()==='ANNEX '+target[1]).length!==1||nativeParagraphs(raw).filter(nodes=>uniquenessText(nodes).trim()===oldLines[0]).length!==1)return unknown();
  if(heads.length!==1||heads[0].hidden||!safe(heads[0].nodes))return unknown();const first=raw.indexOf(heads[0]),last=raw.findIndex((row,index)=>index>first&&row.kind==='paragraph'&&/^ANNEX [IVXLC]+$/u.test(row.text.trim()));if(last<0)return unknown();
  const lead=raw[first+1];if(lead?.kind!=='paragraph'||lead.hidden||!safe(lead.nodes)||!['Annex '+target[4]+' is amended as follow:','Annex '+target[4]+' is amended as follows:'].includes(lead.text.trim()))return unknown();
  const points=nativeAnnexInstructionRows(quotedWordParts(nativeQuoted.proposalBuffer),raw,first,last),owner=points[0],next=points[1];
  if(!owner||!next||owner.text.trim()!==oldLines[0]||raw.filter(row=>row.kind==='paragraph'&&row.text.trim()===oldLines[0]).length!==1)return unknown();
  const quote=raw.slice(owner.index+1,next.index);if(quote.length!==3||quote[0].kind!=='paragraph'||quote[0].text.trim()!==oldLines[1]||quote[0].hidden||!safe(quote[0].nodes)||quote[1].kind!=='other'||quote[1].hidden||!quote[1].nodes['w:tbl']||quote[2].kind!=='paragraph'||quote[2].text.trim()!=='’'||quote[2].hidden||!safe(quote[2].nodes))return unknown();
  const table=quote[1].nodes['w:tbl'];if(children(children(table,'w:tblGrid')[0]||[],'w:gridCol').length!==2||!completeGrid(table)||['w:tbl','w:gridSpan','w:hMerge','w:vMerge'].some(name=>descendants(table,name).length))return unknown();
  const tableNumber=raw.slice(0,raw.indexOf(quote[1])+1).filter(row=>row.kind==='other'&&row.nodes['w:tbl']).length,sourceRows=[{...owner,prefix:'('+target[2]+')\t'},quote[0]];
  const trs=children(table,'w:tr');if(trs.length<2)return unknown();
  for(const [r,tr] of trs.entries()){
   const cells=children(tr,'w:tc');if(cells.length!==2)return unknown();
   for(const [c,cell] of cells.entries()){const paragraphs=children(cell,'w:p');if(!paragraphs.length||paragraphs.some(p=>!safe(p)))return unknown();for(const [n,p] of paragraphs.entries())sourceRows.push({path:`/w:document[1]/w:body[1]/w:tbl[${tableNumber}]/w:tr[${r+1}]/w:tc[${c+1}]/w:p[${n+1}]`,text:literal(p)});}
  }
  if(children(children(trs[0],'w:tc')[0],'w:p').length!==1||children(children(trs[0],'w:tc')[1],'w:p').length!==1||literal(children(children(trs[0],'w:tc')[0],'w:p')[0])!=='CN code'||literal(children(children(trs[0],'w:tc')[1],'w:p')[0])!=='Greenhouse gas')return unknown();
  sourceRows.push(quote[2]);
  const mapped=[];for(const row of sourceRows){const found=proposal.paragraphs.filter(p=>p.source?.path===row.path&&p.text===(row.prefix||'')+row.text.trim()&&p.complete&&p.source.complete);if(found.length!==1)return unknown();mapped.push(found[0]);}
  if(mapped.some((p,index)=>index&&(p.index!==mapped[index-1].index+1||p.source.ordinal!==mapped[index-1].source.ordinal+1)))return unknown();
  const from=mapped[0],to=mapped.at(-1),prefix='('+target[2]+')\t';
  if(placement.status!=='placed'||placement.span?.start!==from.index||placement.span.end!==to.index||placement.splice?.start.paragraph!==from.index||placement.splice.start.offset!==prefix.length||placement.splice.end.paragraph!==to.index||placement.splice.end.offset!==to.text.length)return {status:'failed',reason:'oracle-whole-instruction-span-mismatch'};
  return {status:'verified',reason:'oracle-native-whole-annex-instruction',nativeSourceHashes:{proposal:proposal.sourceHash,act:act.sourceHash,amendment:hash(nativeQuoted.amendmentBuffer)}};
 }catch{return unknown();}
}
