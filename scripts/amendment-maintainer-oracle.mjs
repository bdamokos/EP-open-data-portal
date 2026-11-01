import {assertSimilarityRows} from './amendment-similarity-oracle.mjs';
// Independent raw-row checks for the maintainer's drafting principles. No
// production parser, units, normaliser or returned evidence is consulted.
const unknown=()=>({status:'unverified',reason:'oracle-maintainer-grammar-unavailable'});
const instruction=s=>/^\((\d+|[a-z]+)\)\s+.*\b(?:is|are) (?:amended|replaced|inserted|added|deleted)\b/u.exec(s.replace(/\s+/gu,' '));
export function assertMaintainerPrinciple({proposal,wording,placement}) {
 if(!proposal||wording.language!=='en'||placement.status!=='placed')return unknown();
 const target=/^Article (\d+) [–-] paragraph 1((?: [–-] point (?:\d+|[a-z]+))+)( [–-] introductory part)?$/u.exec(wording.targetLabel.split('\n')[0]);
 if(!target)return unknown();
 const rows=proposal.paragraphs,roots=rows.filter(r=>r.text.trim()===`Article ${target[1]}`&&/^(?:Titrearticle|ArticleTitle)$/iu.test(r.properties?.styleId??''));
 if(roots.length!==1)return unknown();
 let start=roots[0].index+1,end=rows.find(r=>r.index>start&&/^Article \d+$/u.test(r.text.trim())&&!/^[‘'”]/u.test(r.text))?.index??rows.length;
 const points=[...target[2].matchAll(/point (\d+|[a-z]+)/gu)].map(m=>m[1]);
 for(const value of points){
  const owners=rows.slice(start,end).filter(r=>instruction(r.text)?.[1]===value);
  if(owners.length!==1)return unknown();
  start=owners[0].index;
  const family=v=>/^\d+$/u.test(v)?0:/^[ivx]+$/u.test(v)?2:1;
  end=rows.slice(start+1,end).find(r=>{const m=instruction(r.text);return m&&family(m[1])<=family(value);})?.index??end;
 }
 if(rows.slice(start,end).some(r=>!r.complete||r.source?.complete!==true))return unknown();
 const lead=rows[start].text.replace(/\s+/gu,' '),proposed=wording.proposedText.trim();let before,principle;
 if(/^[-−]1(?:a)?\.\s/u.test(proposed)) {before=start+1;principle='P2';}
 else if(placement.operation==='insert') {
  const numbered=/^[‘']?\(?(\d+)\s*([ab])\)?\.?(?:\s|\t)/u.exec(proposed);
  if(numbered){
   const n=numbered[1];
   const anchors=rows.slice(start+1,end).filter(r=>new RegExp(`^[‘']?${n}\\.\\s`,'u').test(r.text));
   if(anchors.length===1){before=rows.slice(anchors[0].index+1,end).find(r=>/^[‘']?\d+\.\s/u.test(r.text))?.index??end;principle=/subparagraph/u.test(lead)?'P4':'P1';}
   else if(n==='1'&&/Article \d+ is replaced by the following:/u.test(lead)&&rows.slice(start+1,end).filter(r=>/^[‘']?\s*Article\s+\d+/u.test(r.text.trim())).length===1){before=end;principle='P1';}
   else if(points.length>1&&/^[a-z]$/u.test(points.at(-1))){before=end;principle='P5';}
  } else if(/^The first subparagraph shall not apply\b/u.test(proposed)&&/Article \d+ is replaced by the following:/u.test(lead)){
   const first=rows.slice(start+1,end).filter(r=>/^1\.\s/u.test(r.text));if(first.length===1){before=rows.slice(first[0].index+1,end).find(r=>/^2\.\s/u.test(r.text))?.index;principle='P3';}
  }
 } else {
  const {splice,span}=placement;if(!splice||!span||span.start<start||span.end>=end)return unknown();
  const source=rows.slice(span.start,span.end+1).map((r,i,a)=>r.text.slice(i===0?splice.start.offset:0,i===a.length-1?splice.end.offset:r.text.length)).join('\n');
  if(span.start===start&&span.end===start&&source.normalize('NFC').replace(/\s+/gu,' ').trim()===wording.originalText.split('\n')[0].normalize('NFC').replace(/\s+/gu,' ').trim())principle='P7';
  else if(source.normalize('NFC').replace(/\s+/gu,' ').trim()!==wording.originalText.normalize('NFC').replace(/\s+/gu,' ').trim()&&splice.start.offset===0&&splice.end.offset===rows[span.end].text.length&&assertSimilarityRows(rows.slice(start,end),wording.originalText,span))principle='P6';
  if(principle)return {status:'verified',reason:'oracle-maintainer-'+principle};return unknown();
 }
 if(before===undefined)return unknown();
 return placement.insertBefore===before&&placement.insertAfter===before-1?{status:'verified',reason:'oracle-maintainer-'+principle}:{status:'failed',reason:'oracle-maintainer-boundary-mismatch',expectedBefore:before};
}
