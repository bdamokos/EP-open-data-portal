// A citation header can be a drafter's category slip only when the amendment
// explicitly prints the same suffixed letter as a recital and the complete
// tabled preamble has no lettered citation candidate.
export function recitalCategoryPlacement(text,rows,structure,wording,operation) {
  const profile={
    en:{target:/^Citation ([A-Z])\s*a \(new\)$/u,body:/^([A-Z])\s*a[.)]\s+whereas\b/u,recital:/^[A-Z][.)]\s+whereas\b/u,citation:/^[–—−\-•]\s*having regard to\b/iu,opening:'The European Parliament,',suffix:'a'},
    fr:{target:/^Visa ([A-Z])\s+bis \(nouveau\)$/u,body:/^([A-Z])\s*bis[.)]\s+considérant\b/u,recital:/^[A-Z][.)]\s+considérant\b/u,citation:/^[–—−\-•]\s*vu\b/iu,opening:'Le Parlement européen,',suffix:'bis'},
    cs:{target:/^Právní východisko ([A-Z])\s*a \(nové\)$/u,body:/^([A-Z])\s*a[.)]\s+vzhledem k tomu, že\b/u,recital:/^[A-Z][.)]\s+vzhledem k tomu, že\b/u,citation:/^[–—−\-•]\s*s ohledem na\b/iu,opening:'Evropský parlament,',suffix:'a'},
  }[wording.language];
  if(!profile||operation!=='insert'||wording.baseline!=='motion-resolution'||String(wording.originalText??'').trim()||wording.referenceText?.trim()||/[\r\n]/u.test(wording.targetLabel??''))return null;
  const normal=value=>String(value??'').normalize('NFC').replace(/\s+/gu,' ').trim();
  const target=profile.target.exec(normal(wording.targetLabel)),proposed=profile.body.exec(normal(wording.proposedText));
  if(!target||!proposed||target[1]!==proposed[1])return null;
  const {units,start}=structure,operative=units.find(unit=>unit.kind==='paragraph');
  if(!operative||operative.label!=='1'||rows.filter(row=>normal(row.value)===profile.opening).length!==1||normal(rows[start]?.value)!==profile.opening)return null;
  const preamble=units.filter(unit=>unit.start>start&&unit.start<operative.start),recitals=preamble.filter(unit=>unit.kind==='recital');
  if(!recitals.length||preamble.some(unit=>!['citation','recital'].includes(unit.kind)||structure.invalid.has(unit.start)||structure.uncertain.has(unit.start)||!(unit.kind==='citation'?profile.citation:profile.recital).test(normal(rows[unit.start]?.value))))return null;
  for(let index=start;index<=operative.start;index++) {
    const row=rows[index],source=row?.source,previous=rows[index-1]?.source;
    if(!row?.complete||source.container!=='body'||row.value.includes('\uFFFC')||index>start&&(source.containerPath!==previous.containerPath||source.segment!==previous.segment||source.ordinal!==previous.ordinal+1))return null;
    if(index>start&&index<operative.start&&!preamble.some(unit=>index>=unit.start&&index<=unit.end))return null;
  }
  if(recitals.some((unit,index)=>unit.label!==String.fromCharCode(65+index)))return null;
  const anchor=units.filter(unit=>unit.kind==='recital'&&unit.label===target[1]),successor=recitals.find(unit=>unit.label===String.fromCharCode(target[1].charCodeAt(0)+1));
  if(anchor.length!==1||!successor||!recitals.includes(anchor[0])||anchor[0].end+1!==successor.start||units.some(unit=>unit.kind==='recital'&&unit.label===target[1]+profile.suffix))return null;
  if([...(text.noteAnchors||[]),...(text.anchors||[])].some(note=>note.paragraph>=anchor[0].start&&note.paragraph<=successor.end))return null;
  return {status:'placed',operation,insertAfter:anchor[0].end,insertBefore:successor.start,evidence:[{basis:'published-category-repair',publishedCategory:'citation',proposedCategory:'recital',label:target[1]+profile.suffix,anchor:target[1]}]};
}
