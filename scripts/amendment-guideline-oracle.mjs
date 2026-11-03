import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
// Native Word rows only: no production units, label parser or placement evidence.
export function assertGuidelineAnnex({proposal,wording,placement,nativeQuoted}) {
  const unknown=()=>({status:'unverified',reason:'oracle-guideline-annex-unavailable'});
  if(proposal?.item!=='annex'||wording.language!=='en'||!nativeQuoted?.proposalBuffer)return unknown();
  const target=/^Annex I\s+[–-]\s+(paragraph|subheading) (\d+)(?:\s*([a-z]+) \(new\))?$/u.exec(wording.targetLabel||'');
  if(!target)return unknown();
  let raw;try{raw=quotedWordBody(nativeQuoted.proposalBuffer);}catch{return unknown();}
  const passive=row=>row.kind==='other'&&!row.hidden&&Object.keys(row.nodes||{}).every(key=>['w:sectPr','w:bookmarkStart','w:bookmarkEnd','w:proofErr',':@'].includes(key));
  const rows=raw.filter(row=>row.kind==='paragraph'&&row.text.trim());
  const header=row=>/^Guideline (\d+):\s+\S/u.exec(row.text.trim());
  const start=rows.findIndex(header);if(start<0)return unknown();
  const before=raw.slice(0,raw.indexOf(rows[start]));
  if(before.some(row=>row.kind!=='paragraph'&&!passive(row)||row.kind==='paragraph'&&row.text.trim()))return unknown();
  const content=rows.slice(start),headings=content.filter(header);
  if(headings.length<2||headings.some((row,i)=>Number(header(row)[1])!==Number(header(headings[0])[1])+i))return unknown();
  if(content.some(row=>row.unsafe||row.hidden||row.numbered)||raw.slice(raw.indexOf(rows[start])).some(row=>row.kind==='paragraph'&&(row.unsafe||row.hidden||row.numbered)||row.kind==='other'&&!passive(row)))return unknown();
  const body=content.filter(row=>!header(row));
  if(headings.some(row=>!body.some(p=>raw.indexOf(p)>raw.indexOf(row)&&(!headings[headings.indexOf(row)+1]||raw.indexOf(p)<raw.indexOf(headings[headings.indexOf(row)+1])))))return unknown();
  const normal=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
  const projected=body.map(row=>proposal.paragraphs.find(p=>p.source?.path===row.path));
  if(projected.some((p,i)=>!p?.complete||p.source?.complete!==true||normal(p.text)!==normal(body[i].text)))return unknown();
  const fail=()=>({status:'failed',reason:'oracle-guideline-annex-address-mismatch'}),n=Number(target[2]),row=target[1]==='subheading'?proposal.paragraphs.find(p=>p.source?.path===headings[n-1]?.path):projected[n-1];
  if(!row?.complete||row.source?.complete!==true)return unknown();
  if(placement.operation==='insert') {
    if(target[1]!=='paragraph'||target[3]!=='a'||n!==body.length||wording.originalText.trim())return unknown();
    const end=proposal.paragraphs.at(-1).index+1;
    return placement.insertBefore===end&&placement.insertAfter===row.index?{status:'verified',reason:'oracle-native-guideline-annex-end'}:fail();
  }
  if(target[3]||!['replace','delete'].includes(placement.operation))return unknown();
  if(normal(wording.originalText)!==normal(row.text))return fail();
  return placement.span?.start===row.index&&placement.span?.end===row.index&&placement.splice?.start.paragraph===row.index&&placement.splice?.end.paragraph===row.index&&placement.splice?.start.offset===0&&placement.splice?.end.offset===row.text.length
    ?{status:'verified',reason:'oracle-native-guideline-paragraph',rawSourceRows:[row.source.path]}:fail();
}
