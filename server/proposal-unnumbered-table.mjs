const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children??[])]);
export function unnumberedTableInsertion(items,wording) {
 const {language,baseline,originalText,proposedText,targetLabel,targetPath}=wording;
 if(language!=='en'||baseline!=='commission-proposal'||originalText?.trim()||targetPath?.underlying?.length||targetPath?.proposal?.length>1)return null;
 const match=/^Annex – table – ([\p{L}][\p{L} ,&-]*) \(new\)$/u.exec(targetPath?.proposal?.[0]?.raw??targetLabel??'');
 if(!match||proposedText?.split('\n')[0]!==match[1]||!proposedText.includes('\t'))return null;
 const annexes=items.flatMap((item,itemIndex)=>flat(item.proposal.units).filter(unit=>unit.kind==='annex'&&unit.scope==='proposal').map(unit=>({unit,itemIndex,proposal:item.proposal,kind:item.kind})));
 if(annexes.length!==1)return null;
 const {unit,itemIndex,proposal,kind}=annexes[0],rows=proposal.paragraphs.slice(unit.extent.start,unit.extent.end);
 if(kind!=='annex'||unit.label?.value||!unit.complete||unit.pathConflict||proposal.sourceKind!=='docx'||proposal.language!==language||unit.extent.end!==proposal.paragraphs.length||!rows.length||rows.some(row=>!row.complete||row.source?.complete!==true)||proposal.gaps.some(gap=>gap.paragraph>=unit.extent.start))return null;
 return {status:'placed',operation:'insert',itemIndex,insertAfter:unit.extent.end-1,insertBefore:unit.extent.end,evidence:[{basis:'new-unnumbered-table-annex-end',anchor:unit.id}]};
}
