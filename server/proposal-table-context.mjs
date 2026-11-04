import {createHash} from 'node:crypto';
import {parseTargetLabel,proposalCandidates} from './proposal-structure.mjs';
const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children)]);
const clean=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
const captionKey=value=>clean(value).replace(/^[‘'"\[]+/u,'').toLowerCase();
const omitted=value=>/^[\s‘’'"\[\]]*(?:…|\.{3})[\s‘’'"\[\]]*$/u.test(value);
export function tableContextPlacement(items,wording,nativeProposalInputs) {
 if(wording.language!=='en'||wording.baseline!=='commission-proposal'||typeof wording.originalText!=='string'||typeof wording.proposedText!=='string'||!wording.proposedText.trim()||!/(?:…|\.{3})/u.test(wording.originalText)||wording.targetPath?.proposal?.length>1)return null;
 const raw=wording.targetPath?.proposal?.[0]?.raw??wording.targetLabel?.split('\n')[0]??'';
 const simple=/^Annex(?: ([IVXLCDM]+))? [–—-] table [–—-] (.+)$/u.exec(raw),instruction=/^Annex ([IVXLCDM]+) [–—-] point (\d+)$/u.exec(raw);
 const under=wording.targetPath?.underlying?.length===1?/^Annex ([IVXLCDM]+) [–—-] point (\d+) [–—-] Table (.+)$/u.exec(wording.targetPath.underlying[0].raw):null;
 if(!simple&&!(instruction&&under)||simple&&wording.targetPath?.underlying?.length)return null;
 const annexId=simple?.[1]??instruction?.[1]??'',caption=simple?.[2]??under[3],lines=wording.originalText.split(/\r?\n/u);
 const captionAt=lines.findIndex(line=>captionKey(line)===captionKey(caption));
 if(captionAt<0||captionAt>1||lines.filter(line=>captionKey(line)===captionKey(caption)).length!==1||instruction&&(captionAt!==1||!new RegExp('^\\('+instruction[2]+'\\)\\s','u').test(lines[0]))||!instruction&&captionAt!==0)return null;
 const captioned=wording.documentReferences?.some(ref=>ref.field==='ComparisonCaption'&&ref.basis==='caption-before-original-heading'&&ref.raw===caption);
 const comparison=[];
 for(const line of lines.slice(captionAt+1)){const cells=line.split('\t').map(clean),prior=comparison.at(-1);if(captioned&&cells.length===1&&cells[0]&&prior?.length===2&&!prior.some(omitted))prior[1]=clean(prior[1]+' '+cells[0]);else comparison.push(cells);}
 if(!comparison.some(row=>row.every(omitted))||comparison.some(row=>row.some(omitted)&&!row.every(omitted)))return null;
 const candidates=[];
 for(const [itemIndex,item] of (items||[]).entries()){
  const proposal=item.proposal,bytes=nativeProposalInputs?.[itemIndex];
  if(item.kind!=='annex')continue;
  if(proposal?.sourceKind!=='docx'||!Buffer.isBuffer(bytes)||createHash('sha256').update(bytes).digest('hex')!==proposal.sourceHash)return null;
  const roots=flat(proposal.units).filter(unit=>unit.kind==='annex'&&unit.scope==='proposal'&&unit.path.length===1&&unit.label.value===annexId);
  if(roots.length!==1||roots[0].pathConflict)continue;
  let container=roots[0];
  if(instruction){
   const parsed=parseTargetLabel(raw,'en'),body=container.children.filter(unit=>unit.kind!=='title');
   let owners=proposalCandidates(proposal,parsed);
   if(!owners.length&&body.length===1&&body[0].kind==='paragraph'&&body[0].implicit)owners=proposalCandidates(proposal,[parsed.segments[0],body[0].label,...parsed.segments.slice(1)]);
   if(owners.length!==1||owners[0].pathConflict)continue;container=owners[0];
   const governing=proposal.paragraphs.slice(roots[0].extent.start+1,container.extent.start).filter(p=>/^Annex [IVXLCDM]+ is amended as follows?:$/u.test(clean(p.text)));
   if(governing.length!==1||!governing[0].complete||governing[0].source?.container!=='body'||!new RegExp('^Annex '+under[1]+' is amended as follows?:$','u').test(clean(governing[0].text)))continue;
   const addressed=/^\(\d+\)\s+in point (\d+), the table [‘'"](.+)[’'"] is replaced by the following:$/u.exec(clean(lines[0]));
   if(!addressed||addressed[1]!==under[2]||captionKey(addressed[2])!==captionKey(under[3]))continue;
  }
  for(const unit of flat([container]).filter(unit=>unit.kind==='table'&&unit.table)){
   const table=unit.table,indices=table.paragraphs,first=Math.min(...indices),last=Math.max(...indices),captionRow=proposal.paragraphs[first-1];
   if(!unit.complete||unit.pathConflict||table.nestedTables?.length||!indices.length||!captionRow?.complete||captionRow.source?.container!=='body'||captionKey(captionRow.text)!==captionKey(caption)||instruction&&clean(proposal.paragraphs[first-2]?.text??'')!==clean(lines[0]))continue;
   if(indices.some(index=>!proposal.paragraphs[index].complete||proposal.paragraphs[index].source?.complete!==true))continue;
   const grid=table.rows.map(row=>row.cells.map(cell=>clean(cell.paragraphs.map(index=>proposal.paragraphs[index].text).join('\n'))));
   let checked=comparison;
   if(comparison[0]?.join('\t')!==grid[0]?.join('\t')&&/^\d{8}$/u.test(grid[0]?.[0]??'')){
    const firstTable=flat([roots[0]]).filter(u=>u.table).sort((a,b)=>a.extent.start-b.extent.start)[0]?.table;
    const header=firstTable?.rows[0]?.cells.map(cell=>clean(cell.paragraphs.map(index=>proposal.paragraphs[index].text).join('\n')));
    if(firstTable&&firstTable.paragraphs[0]<first&&header?.join('\t')===comparison[0]?.join('\t'))checked=comparison.slice(1);
   }
   let prior=-1,retained=0,valid=true;
   for(const expected of checked){
    if(expected.every(omitted)){if(grid.some(row=>row.length!==expected.length))valid=false;continue;}
    const matches=grid.flatMap((row,index)=>row.length===expected.length&&row.every((cell,i)=>cell===expected[i])?[index]:[]);
    if(matches.length!==1||matches[0]<=prior){valid=false;break;}prior=matches[0];retained++;
   }
   if(valid&&retained)candidates.push({itemIndex,first,last,anchor:unit.id});
  }
 }
 if(candidates.length!==1)return null;
 const hit=candidates[0];return {operation:'replace',status:'placed',itemIndex:hit.itemIndex,span:{start:hit.first,end:hit.last},evidence:[{basis:'table-level-elision',anchor:hit.anchor,label:caption}]};
}
