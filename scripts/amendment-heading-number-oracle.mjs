import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {safe,literal,completeGrid} from './amendment-native-table-oracle.mjs';
import {rawResolutionUnits} from './amendment-benchmark-resolution-oracle.mjs';
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
const clean=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
export function assertHeadingNumber({wording,text,placement,voteReferences=[],nativeQuoted}){
 const refs=wording?.documentReferences?.filter(r=>r.basis==='published-heading-number-candidate')??[];
 if(!refs.length)return null;
 const unknown=()=>({status:'unverified',reason:'oracle-heading-number-unavailable'});
 const stampRefs=wording.documentReferences.filter(r=>r.basis==='conflicting-stamp-number');
 const target=/^Paragraph ([1-9]\d*)$/u.exec(wording.targetLabel??'');
 if(refs.length!==1||refs[0].field!=='HeadingNumber'||refs[0].raw!==String(wording.number)||stampRefs.length!==1||stampRefs[0].field!=='StampNumber'||wording.language!=='en'||wording.baseline!=='motion-resolution'||!target||!voteReferences.length||voteReferences.some(v=>/^(?:§|Paragraph)\s*([1-9]\d*)$/u.exec(clean(v))?.[1]!==target[1])||nativeQuoted?.number!==wording.number)return unknown();
 try{
  const body=quotedWordBody(nativeQuoted.amendmentBuffer),starts=body.flatMap((row,i)=>row.kind==='paragraph'&&row.text.includes('<Amend>')?[i]:[]),blocks=starts.map((at,i)=>body.slice(at,starts[i+1]??body.length));
  const headings=block=>block.filter(row=>row.kind==='paragraph'&&new RegExp('^Amendment\\s*<NumAm>'+wording.number+'<\\/NumAm>$','u').test(row.text.trim()));
  const blocksWithHeading=blocks.filter(block=>headings(block).length);if(blocksWithHeading.length!==1)return unknown();const block=blocksWithHeading[0];
  const raw=block.filter(row=>row.kind==='paragraph').map(row=>row.text).join('\n'),numbers=[...raw.matchAll(/<NumAm>(\d+)<\/NumAm>/gu)].map(m=>m[1]),stamps=numbers.filter(n=>n!==String(wording.number));
  if(headings(block).length!==1||headings(block)[0].unsafe||numbers.length!==2||stamps.length!==1||stamps[0]!==stampRefs[0].raw||!raw.includes('<Article>'+wording.targetLabel+'</Article>'))return unknown();
  const tables=block.filter(row=>row.nodes?.['w:tbl']);if(tables.length!==1||tables[0].hidden)return unknown();const table=tables[0].nodes['w:tbl'];if(!completeGrid(table))return unknown();const rows=[];
  for(const row of children(table,'w:tr')){const cells=children(row,'w:tc'),values=[];for(const cell of cells){const ps=children(cell,'w:p');if(!ps.every(safe))return unknown();values.push(ps.map(literal).filter(s=>s.trim()).join('\n').trim());}if(!values.some(Boolean))continue;if(cells.length!==2||cells.some(cell=>children(cell,'w:tcPr').flat().some(node=>Object.hasOwn(node,'w:gridSpan')&&node[':@']?.['@_w:val']!=='1')))return unknown();rows.push(values);}
  const nonempty=rows.filter(row=>row.some(Boolean));if(nonempty[0]?.[0]!=='Motion for a resolution'||nonempty[0]?.[1]!=='Amendment')return unknown();
  const original=nonempty.slice(1).map(row=>row[0]).filter(Boolean).join('\n'),proposed=nonempty.slice(1).map(row=>row[1]).filter(Boolean).join('\n');
  if(original!==wording.originalText||proposed!==wording.proposedText)return {status:'failed',reason:'oracle-heading-number-wording-mismatch'};
  const motion=rawResolutionUnits(text,'en'),units=motion.units.filter(u=>u.kind==='paragraph'&&u.label===target[1]);
  if(motion.reason||units.length!==1||!units[0].complete||clean(text.paragraphs.slice(units[0].start,units[0].end+1).join('\n'))!==clean(original))return unknown();
  return placement.status==='placed'&&placement.operation==='replace'&&placement.span?.start===units[0].start&&placement.span?.end===units[0].end?{status:'verified',reason:'oracle-native-heading-vote-and-exact-text'}:{status:'failed',reason:'oracle-heading-number-boundary-mismatch'};
 }catch{return unknown();}
}
