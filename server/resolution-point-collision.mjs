// Resolve a new two-letter point against an existing alphabetic serial run.
// The spelling stays published; Bulgarian's mixed-script a is a local label typo.
export function resolutionPointCollision(text,rows,structure,options,operation,ref) {
 if(operation!=='insert'||options.baseline!=='motion-resolution'||options.originalText?.trim()||options.referenceText||!ref?.isNew||ref.kind!=='point'||ref.parents?.length!==1||ref.parents[0].kind!=='paragraph')return null;
 const normalize=value=>options.language==='bg'?value.replace(/a/gu,'а'):value;
 const alphabet=options.language==='bg'?'абвгдежзийклмнопрстуфхцчшщ':'abcdefghijklmnopqrstuvwxyz',wanted=normalize(ref.label);
 if(wanted.length!==2||[...wanted].some(c=>!alphabet.includes(c)))return null;
 const printed=/^\(?([\p{Ll}]\s*[\p{Ll}])\)\s/u.exec(options.proposedText.trim());
 if(!printed||normalize(printed[1].replace(/\s/gu,''))!==wanted)return null;
 const parents=structure.units.filter(u=>u.kind==='paragraph'&&u.label===ref.parents[0].label);
 if(parents.length!==1)return null;
 const family=structure.units.filter(u=>u.kind==='point'&&u.parent===parents[0].start).sort((a,b)=>a.start-b.start),labels=family.map(u=>normalize(u.label)),at=labels.indexOf(wanted);
 if(at<alphabet.length||labels.filter(label=>label===wanted).length!==1)return null;
 for(let i=0;i<=at;i++){
  const expected=i<alphabet.length?alphabet[i]:alphabet[Math.floor((i-alphabet.length)/alphabet.length)]+alphabet[(i-alphabet.length)%alphabet.length],unit=family[i],row=rows[unit.start],previous=i?rows[family[i-1].end]:rows[parents[0].start];
  if(labels[i]!==expected||unit.start!==unit.end||structure.invalid.has(unit.start)||structure.uncertain.has(unit.start)||!row?.complete||row.source?.container!=='body'||!previous?.complete||previous.source.container!=='body'||row.source.ordinal!==previous.source.ordinal+1||row.source.segment!==previous.source.segment||row.source.containerPath!==previous.source.containerPath)return null;
 }
 const anchor=family[alphabet.indexOf(wanted[0])],following=family[alphabet.indexOf(wanted[0])+1];
 if(!anchor||!following||normalize(following.label).length!==1||following.start!==anchor.end+1)return null;
 return {operation:'insert',status:'placed',insertAfter:anchor.end,insertBefore:following.start,evidence:[{basis:'colliding-new-point',label:ref.label,anchor:anchor.label}]};
}
