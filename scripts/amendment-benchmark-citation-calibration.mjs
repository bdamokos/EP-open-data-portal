import {createHash} from 'node:crypto';
import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';

// Proposed calibration only: canonical scoring does not call this module.
// Native Word establishes ownership before projection rows supply coordinates.
const unknown=reason=>({status:'unverified',reason});
const failed=reason=>({status:'failed',reason});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const children=(nodes,name)=>nodes.flatMap(node=>node[name]?[node[name]]:[]);
const has=(nodes,names)=>nodes.some(node=>Object.entries(node).some(([key,value])=>names.includes(key)||Array.isArray(value)&&has(value,names)));
const rawText=nodes=>nodes.map(node=>Object.entries(node).map(([key,value])=>key==='w:t'?value.map(v=>v['#text']??'').join(''):key==='w:tab'?'\t':['w:br','w:cr'].includes(key)?'\n':key==='w:noBreakHyphen'?'\u2011':key==='w:softHyphen'?'\u00ad':Array.isArray(value)?rawText(value):'').join('')).join('');
const whitespace=value=>value.replace(/\s+/gu,' ').trim();
const field=(rows,name)=>{
  const found=rows.flatMap(row=>[...row.text.matchAll(new RegExp('<'+name+'>([\\s\\S]*?)</'+name+'>','gu'))].map(match=>match[1]));
  return found.length===1?found[0]:null;
};

function nativeComparison(body,number) {
  const starts=body.flatMap((row,index)=>row.kind==='paragraph'&&row.text.includes('<Amend>')&&row.text.includes('<NumAm>'+number+'</NumAm>')?[index]:[]);
  if(starts.length!==1)return null;
  const start=starts[0],end=body.findIndex((row,index)=>index>start&&row.kind==='paragraph'&&row.text.includes('</Amend>'));
  if(end<0)return null;
  const rows=body.slice(start,end+1),paragraphs=rows.filter(row=>row.kind==='paragraph');
  if(paragraphs.some(row=>row.unsafe)||paragraphs.slice(1).some(row=>row.text.includes('<Amend>')))return null;
  const tables=rows.filter(row=>row.kind==='other');
  if(tables.length!==1||!tables[0].nodes['w:tbl']||tables[0].hidden)return null;
  const table=tables[0].nodes['w:tbl'];
  if(has(table,['w:tbl','w:vMerge','w:hMerge','w:del','w:moveFrom','w:vanish','w:webHidden','w:instrText','w:fldChar','w:drawing','w:pict','w:object','m:oMath','w:numPr','w:footnoteReference','w:endnoteReference']))return null;
  const nativeRows=children(table,'w:tr');let layoutOffset=0;
  // The template's first, empty full-width row is layout, never wording.
  if(nativeRows.length&&children(nativeRows[0],'w:tc').length===1&&rawText(nativeRows[0]).trim()===''&&children(children(nativeRows[0],'w:tc')[0],'w:tcPr').some(props=>props.some(node=>node['w:gridSpan']&&node[':@']?.['@_w:val']==='2'))){nativeRows.shift();layoutOffset=1;}
  if(nativeRows.some(row=>has(row,['w:gridSpan'])))return null;
  const grid=nativeRows.map(row=>children(row,'w:tc').map(cell=>children(cell,'w:p').map(rawText).join('\n').trim()));
  if(grid.length<2||grid.some(row=>row.length!==2)||grid[0][0]!=='Motion for a resolution'||grid[0][1]!=='Amendment')return null;
  const tableOrdinal=body.slice(0,body.indexOf(tables[0])+1).filter(row=>row.kind==='other'&&row.nodes['w:tbl']).length;
  const cellPaths=column=>grid.slice(1).map((_,index)=>`/w:document[1]/w:body[1]/w:tbl[${tableOrdinal}]/w:tr[${index+layoutOffset+2}]/w:tc[${column}]`);
  return {target:field(paragraphs,'Article'),baseline:field(paragraphs,'DocAmend'),language:field(paragraphs,'Original'),original:grid.slice(1).map(row=>row[0]).join('\n').trim(),proposed:grid.slice(1).map(row=>row[1]).join('\n').trim(),originalCells:cellPaths(1),proposedCells:cellPaths(2)};
}

export function rawCitationMarkerAssertion({wording,placement,text,nativeCitation}) {
  if(wording?.language!=='en'||wording.baseline!=='motion-resolution'||placement?.status!=='placed'||placement.operation!=='replace'||!nativeCitation||!Number.isSafeInteger(nativeCitation.number)||nativeCitation.number<1||!Array.isArray(text?.paragraphs)||text.paragraphSources?.length!==text.paragraphs.length)return unknown('oracle-citation-input-unavailable');
  let body,comparison;
  try{body=quotedWordBody(nativeCitation.motionBuffer);comparison=nativeComparison(quotedWordBody(nativeCitation.amendmentBuffer),nativeCitation.number);}catch{return unknown('oracle-citation-native-unavailable');}
  if(!comparison||comparison.language!=='{EN}en'||comparison.baseline!=='Motion for a resolution'||comparison.target!==wording.targetLabel||comparison.original!==wording.originalText||comparison.proposed!==wording.proposedText)return unknown('oracle-citation-comparison-unavailable');
  const target=/^Citation ([1-9]\d*)$/u.exec(comparison.target),ordinal=target&&Number(target[1]);
  if(!ordinal||!comparison.original.startsWith(ordinal+'.\t')||!comparison.proposed.startsWith(ordinal+'.\t'))return unknown('oracle-citation-address-unavailable');
  const openings=body.flatMap((row,index)=>row.kind==='paragraph'&&row.text==='The European Parliament,'?[index]:[]);
  if(openings.length!==1)return unknown('oracle-citation-opening-unavailable');
  const opening=body[openings[0]],preamble=[];
  let at=openings[0]+1;
  // Literal English citation markers, a complete uninterrupted preamble, and
  // its first recital establish all ordinals without production segmentation.
  for(;at<body.length;at++) {
    const row=body[at];
    if(row.kind!=='paragraph'||row.hidden||has(row.nodes,['w:numPr','w:del','w:moveFrom','w:vanish','w:webHidden','w:instrText','w:fldChar','w:drawing','w:pict','w:object','m:oMath']))return unknown('oracle-citation-preamble-unavailable');
    if(!row.text.startsWith('–\thaving regard to '))break;
    preamble.push(row);
  }
  const close=body[at],source=preamble[ordinal-1],previous=preamble[ordinal-2],following=preamble[ordinal];
  if(opening.unsafe||opening.hidden||!close||!/^A\.\twhereas \S/u.test(close.text)||!source||!previous||!following||source.unsafe)return unknown('oracle-citation-preamble-unavailable');
  // Only the proven source marker and exact numeric column marker differ.
  // No case, dash, quote, number or internal/terminal punctuation folding.
  if(whitespace(source.text.slice(2))!==whitespace(comparison.original.slice((ordinal+'.\t').length)))return failed('oracle-citation-original-mismatch');
  const prefix=[opening,...preamble.slice(0,ordinal+1)],mapped=[];
  for(const row of prefix) {
    const matches=(text?.paragraphSources??[]).flatMap((source,index)=>source.path===row.path?[{source,index}]:[]);
    if(matches.length!==1)return failed('oracle-citation-native-row-mismatch');
    const match=matches[0];
    // Unchanged note-bearing adjacent citations establish boundaries only;
    // their note rendering is outside this assertion's wording comparison.
    if(match.source.container!=='body'||match.source.complete!==true||typeof text.paragraphs[match.index]!=='string'||whitespace(text.paragraphs[match.index])!==whitespace(row.text))return failed('oracle-citation-native-row-mismatch');
    mapped.push(match);
  }
  if(mapped.some((row,index)=>index&&(row.index!==mapped[index-1].index+1||row.source.containerPath!==mapped[index-1].source.containerPath||row.source.segment!==mapped[index-1].source.segment||row.source.ordinal!==mapped[index-1].source.ordinal+1)))return failed('oracle-citation-native-row-mismatch');
  const index=mapped[ordinal].index;
  const assertion={ordinal,nativeOpening:opening.path,nativePreamble:preamble.map(row=>row.path),nativePreambleEnd:close.path,nativePredecessor:previous.path,nativeSource:source.path,nativeFollowing:following.path,nativeOriginalCells:comparison.originalCells,nativeProposedCells:comparison.proposedCells,expectedSpan:{start:index,end:index},rawOriginal:comparison.original,rawProposed:comparison.proposed,rawSource:source.text,motionSha256:hash(nativeCitation.motionBuffer),amendmentSha256:hash(nativeCitation.amendmentBuffer)};
  if(placement.span?.start!==index||placement.span?.end!==index)return {...failed('oracle-citation-address-span-mismatch'),assertion};
  return {status:'verified',reason:'oracle-native-citation-marker',assertion};
}

// Explicit opt-in for reviewed calibration probes. Preserve every canonical
// result except the exact original-span failure this native assertion proves.
export function verifyPlacementWithCitationCalibration(input) {
  const original=verifyPlacement(input);
  if(original.status!=='failed'||original.reason!=='oracle-original-span-mismatch')return original;
  const proposed=rawCitationMarkerAssertion(input);
  return proposed.status==='verified'?proposed:original;
}
