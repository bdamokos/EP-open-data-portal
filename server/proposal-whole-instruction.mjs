import {nativeInstructionRowsComplete} from './proposal-instruction-guard.mjs';
import {parseTargetLabel,proposalCandidates} from './proposal-structure.mjs';
const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children)]);
// First native annex instruction only. Preserve its printed point label and
// replace the complete instruction/quotation, never infer its elided old cells.
export function wholeAnnexInstructionPlacement(items,wording,unresolved,nativeProposalInputs){
 const header=wording.language==='en'&&/^Annex ([IVXLC]+) – paragraph 1 – point 1 – table\n(Regulation \((?:EU|EC)\) \d{4}\/\d+) — Annex ([IVXLC]+)$/u.exec(wording.targetLabel||'');
 const original=String(wording.originalText??'').split('\n'),lead=/^in point ([1-9]\d*), the table ‘([^‘’\r\n]+)’ is replaced by the following:$/u.exec(original[0]||'');
 if(!header||!lead||original.length!==4||original[3]!=='…\t…')return null;
 const reject=()=>unresolved('source_structure_unavailable');
 if(wording.operation!=='replace'||wording.baseline!=='commission-proposal'||items.length!==2||items.filter(item=>item.kind==='act').length!==1||items.filter(item=>item.kind==='annex').length!==1)return reject();
 const path=wording.targetPath;
 if(path?.language&&path.language!=='en'||path?.proposal?.length&&(path.proposal.length!==1||path.proposal[0].raw!==header[0].split('\n')[0])||path?.underlying?.length&&(path.underlying.length!==1||path.underlying[0].document!==header[2]||path.underlying[0].raw!=='Annex '+header[3]))return reject();
 for(const [field,expected] of [['Article',header[0].split('\n')[0]],['DocAmend2',header[2]],['Article2','Annex '+header[3]]]){
  const references=(wording.documentReferences||[]).filter(ref=>ref.field===field&&ref.scope==='amendment');if(references.length!==1||references[0].raw!==expected||references[0].basis)return reject();
 }
 if(!/^‘\[[^\t\r\n]+$/u.test(original[1])||original[1].slice(2).toLowerCase()!==lead[2].toLowerCase()||original[2]!=='CN code\tGreenhouse gas')return reject();
 const proposed=wording.proposedText.split('\n');
 if(proposed[0]!==`in point ${lead[1]}, the following lines are added to the table ‘${lead[2]}’:`||proposed[1]!==original[1]||proposed[2]!==original[2]||proposed.length<4||/[\u2026]|\.{3}/u.test(wording.proposedText))return reject();
 let pending='',count=0;
 for(const line of proposed.slice(3)){
  if(!line)return reject();const cells=line.split('\t');
  if(cells.length===1){pending+=(pending?'\n':'')+line;continue;}
  if(cells.length!==2||!cells[0]||!cells[1])return reject();
  const code=(pending?pending+'\n':'')+cells[0];pending='';
  if(!/^\d{2}[\d ]* [-–] \S/u.test(code)||/[\t\r\n]/u.test(cells[1]))return reject();count++;
 }
 if(pending||!count)return reject();
 const act=items.find(item=>item.kind==='act').proposal,actLeads=act.paragraphs.filter(p=>p.text===header[2]+' is amended as follows:');
 if(actLeads.length!==1||!actLeads[0].complete||actLeads[0].source?.complete!==true||actLeads[0].source.container!=='body')return reject();
 const itemIndex=items.findIndex(item=>item.kind==='annex'),proposal=items[itemIndex].proposal;
 if(proposal.sourceKind!=='docx')return reject();
 const parsed=parseTargetLabel(header[0].split('\n')[0].replace(/ – table$/u,''),'en'),owners=proposalCandidates(proposal,parsed),roots=proposalCandidates(proposal,{...parsed,segments:parsed.segments.slice(0,1)});
 if(owners.length!==1||roots.length!==1||owners[0].pathConflict||roots[0].pathConflict||!owners[0].complete)return reject();
 const owner=owners[0],root=roots[0],scope=proposal.paragraphs.slice(root.extent.start,root.extent.end),rootLead=scope[1];
 if(!rootLead||!['Annex '+header[3]+' is amended as follow:','Annex '+header[3]+' is amended as follows:'].includes(rootLead.text)||!rootLead.complete||rootLead.source?.complete!==true||scope[0].text!=='ANNEX '+header[1]||!scope[0].complete)return reject();
 const parents=scope.filter(p=>p.properties?.styleId==='Point0number'),first=parents[0],next=parents[1],counter=first?.properties?.numbering;
 if(!first||!next||first.index!==owner.extent.start||owner.extent.end!==next.index||first.properties.numberingLabel!=='(1)'||!counter||counter.level!==0||counter.format!=='decimal'||first.text!=='(1)\t'+original[0])return reject();
 for(const p of scope){const n=p.properties?.numbering;if(p.properties?.styleId==='Point0number'||n?.abstractId===counter.abstractId&&n.level===0){if(p.source?.container!=='body'||!p.complete||p.source.complete!==true||p.properties.numberingComplete!==true||!n||n.abstractId!==counter.abstractId||n.level!==0||n.format!=='decimal')return reject();}}
 if(proposal.paragraphs.slice(0,root.extent.start).some(p=>p.properties?.numbering?.id===counter.id)||proposal.paragraphs.filter(p=>p.text.replace(/^\([1-9]\d*\)\t/u,'')===original[0]).length!==1)return reject();
 const rows=proposal.paragraphs.slice(first.index,next.index),last=rows.at(-1),middle=rows.slice(2,-1);
 if(rows.length<7||rows[1].text!==original[1]||rows[1].source?.container!=='body'||last.text!=='’'||last.source?.container!=='body'||rows.some((p,index)=>!p.complete||p.source?.complete!==true||index&&(p.index!==rows[index-1].index+1||p.source.ordinal!==rows[index-1].source.ordinal+1))||middle.some(p=>p.source?.container!=='table-cell'))return reject();
 const tables=flat(proposal.units).filter(unit=>unit.table).flatMap(unit=>[unit.table,...(unit.table.nestedTables||[])]),indexes=middle.map(p=>p.index),matches=tables.filter(table=>JSON.stringify(table.paragraphs)===JSON.stringify(indexes));
 if(matches.length!==1||!matches[0].complete||matches[0].nestedTables?.length||matches[0].rows.some(row=>row.cells.length!==2||row.cells.some(cell=>(cell.colSpan??1)!==1||cell.horizontalMerge||cell.verticalMerge||!cell.paragraphs?.length))||middle[0]?.text!=='CN code'||middle[1]?.text!=='Greenhouse gas')return reject();
 if(!nativeInstructionRowsComplete(nativeProposalInputs?.[itemIndex],proposal.sourceHash,[scope[0],rootLead,...rows],{firstPoint:first,nextPoint:next,uniqueBodyText:[scope[0].text,original[0]]})||!nativeInstructionRowsComplete(nativeProposalInputs?.[items.findIndex(item=>item.kind==='act')],act.sourceHash,actLeads,{uniqueBodyText:[header[2]+' is amended as follows:']}))return reject();
 return {status:'placed',operation:'replace',itemIndex,span:{start:first.index,end:last.index},splice:{start:{paragraph:first.index,offset:4},end:{paragraph:last.index,offset:last.text.length}},originalText:[first.text.slice(4),...rows.slice(1).map(p=>p.text)].join('\n'),evidence:[{basis:'whole-annex-instruction',anchor:owner.id}]};
}
