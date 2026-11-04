import {oracleAddress} from './amendment-oracle-grammar.mjs';
import {rawResolutionUnits,rawResolutionPointUnits} from './amendment-benchmark-resolution-oracle.mjs';
import {assertResolutionSimilarity} from './amendment-similarity-oracle.mjs';
const marker=/^\s*(?:\(([a-z]{1,4})\)|([a-z]{1,4})\)|([ivxlcdm]+)\.)\s+/u;
const label=s=>{const m=marker.exec(s);return m&&(m[1]||m[2]||m[3]);};
const same=(a,b)=>JSON.stringify(a.map(({kind,value})=>[kind,value]))===JSON.stringify(b.map(({kind,value})=>[kind,value]));
const clean=(s,labels)=>s.split(/\r?\n/u).map(line=>labels.includes(label(line))?line.replace(marker,''):line).join(' ').normalize('NFC').replace(/\u00ad/gu,'').replace(/[‘’‚‛ʻʼ]/gu,"'").replace(/[“”„‟«»]/gu,'"').replace(/[‐‑‒–—]/gu,'-').replace(/\s+/gu,' ').trim();
export function assertResolutionPointSimilarity({text,wording,placement}){
 const unknown=()=>({status:'unverified',reason:'oracle-point-near-match-unavailable'});
 const decision=wording?.baseline==='unknown'&&wording.documentReferences?.some(r=>r.field==='DocAmend'&&r.raw==='Proposal for a decision')&&wording.baselineSource?.headings?.length>0&&wording.baselineSource.headings.every(h=>h.left?.raw==='Proposal for a decision'&&h.right?.raw==='Amendment');
 if(wording?.language!=='en'||!(wording.baseline==='motion-resolution'||decision)||!['replace','delete'].includes(placement.operation)||/\n_{5,}\s*\n/u.test(wording.originalText||''))return unknown();
 const path=oracleAddress(wording.targetLabel||'','en');
 if(!path||path.length!==2||path[0].kind!=='paragraph'||path.slice(1).some(p=>p.kind!=='point'||p.isNew)||label(wording.originalText)!==path.at(-1).value||placement.operation==='replace'&&label(wording.proposedText)!==path.at(-1).value)return unknown();
 const motion=rawResolutionUnits(text,'en');if(motion.reason||!motion.units.length)return unknown();
 const parents=motion.units.filter(u=>u.kind==='paragraph'&&u.label===path[0].value);if(parents.length!==1)return unknown();
 const end=Math.max(...motion.units.map(u=>u.end)),points=rawResolutionPointUnits(text).units.filter(u=>u.start>=motion.start&&u.end<=end),wanted=points.filter(u=>same(u.path,path)&&u.group===parents[0].start);
 if(wanted.length!==1||!wanted[0].complete)return unknown();const own=wanted[0];if(points.some(p=>p!==own&&p.start>own.start&&p.end<=own.end))return unknown();
 const labels=u=>points.filter(p=>p.start>=u.start&&p.end<=u.end).map(p=>p.label),ownLabels=labels(own),original=clean(wording.originalText,ownLabels),source=clean(text.paragraphs.slice(own.start,own.end+1).join('\n'),ownLabels);
 if(source.includes('\uFFFC')||[...(text.noteAnchors||[]),...(text.anchors||[])].some(a=>a.paragraph>=own.start&&a.paragraph<=own.end)||(wording.originalFormatting||[]).some(m=>m.kind==='superscript'))return unknown();
 if(original===source)return unknown();
 if(placement.status!=='placed'||placement.span?.start!==own.start||placement.span?.end!==own.end)return {status:'failed',reason:'oracle-point-near-match-boundary-mismatch'};
 const candidates=points.map(u=>({...u,text:clean(text.paragraphs.slice(u.start,u.end+1).join('\n'),labels(u))}));
 // Damaged or unaddressable point starts still compete. Their surviving native
 // wording must not disappear merely because they cannot receive a placement.
 for(let start=motion.start;start<=end;start++){
  if(!label(text.paragraphs[start]||'')||points.some(u=>u.start===start&&u.complete))continue;
  let stop=start;for(let i=start+1;i<=end&&i<start+30;i++){if(label(text.paragraphs[i])||/^\s*\d+[.)]\s/u.test(text.paragraphs[i])||text.paragraphFormats?.[i]?.heading||motion.units.some(u=>u.kind==='heading'&&u.start===i))break;stop=i;}
  for(let prefixEnd=start;prefixEnd<=stop;prefixEnd++)candidates.push({start,end:prefixEnd,complete:false,text:clean(text.paragraphs.slice(start,prefixEnd+1).join('\n'),[label(text.paragraphs[start])])});
 }
 return assertResolutionSimilarity(candidates,original,placement.span)?{status:'verified',reason:'oracle-independent-point-near-match'}:unknown();
}
