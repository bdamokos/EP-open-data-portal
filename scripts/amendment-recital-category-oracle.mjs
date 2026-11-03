import {rawResolutionUnits} from './amendment-benchmark-resolution-oracle.mjs';

// The comparison itself must contradict its citation category explicitly.
// This reader deliberately does not use the runtime's reference repair.
export function assertRecitalCategoryRepair({text,wording,placement}) {
  const unknown=()=>({status:'unverified',reason:'oracle-recital-category-unavailable'});
  const grammar={
    en:{header:/^Citation ([A-Z])\s*a \(new\)$/u, proposed:/^([A-Z])\s*(a)[.)]\s+whereas\b/u, recital:/^([A-Z])[.)]\s+whereas\b/u,citation:/^[–—−\-•]\s*having regard to\b/iu,opening:'The European Parliament,'},
    fr:{header:/^Visa ([A-Z])\s+bis \(nouveau\)$/u,proposed:/^([A-Z])\s*(bis)[.)]\s+considérant\b/u,recital:/^([A-Z])[.)]\s+considérant\b/u,citation:/^[–—−\-•]\s*vu\b/iu,opening:'Le Parlement européen,'},
    cs:{header:/^Právní východisko ([A-Z])\s*a \(nové\)$/u,proposed:/^([A-Z])\s*(a)[.)]\s+vzhledem k tomu, že\b/u,recital:/^([A-Z])[.)]\s+vzhledem k tomu, že\b/u,citation:/^[–—−\-•]\s*s ohledem na\b/iu,opening:'Evropský parlament,'},
  }[wording?.language];
  if(!grammar||wording.baseline!=='motion-resolution'||wording.baselineSource?.conflicted||String(wording.originalText??'').trim()||wording.referenceText?.trim()||placement.operation!=='insert')return unknown();
  const fold=value=>String(value??'').normalize('NFC').replace(/\s+/gu,' ').trim();
  const header=grammar.header.exec(fold(wording.targetLabel)),proposed=grammar.proposed.exec(fold(wording.proposedText));
  if(!header||!proposed||header[1]!==proposed[1]||/[\r\n]/u.test(wording.targetLabel))return unknown();
  const paragraphs=text?.paragraphs??[],sources=text?.paragraphSources??[];
  if(text?.textLanguage&&text.textLanguage!==wording.language||paragraphs.filter(p=>fold(p)===grammar.opening).length!==1)return unknown();
  const opening=paragraphs.findIndex(p=>fold(p)===grammar.opening),raw=rawResolutionUnits(text,wording.language);
  const operative=raw.units.find(u=>u.kind==='paragraph');
  if(raw.reason||!operative||operative.label!=='1'||opening<0)return unknown();
  // A missing preamble row could conceal a citation or a duplicate label.
  for(let i=opening;i<=operative.start;i++) {
    const s=sources[i],previous=sources[i-1];
    if(s?.complete!==true||s.container!=='body'||paragraphs[i].includes('\uFFFC')||i>opening&&(s.containerPath!==previous.containerPath||s.segment!==previous.segment||s.ordinal!==previous.ordinal+1))return unknown();
  }
  const preamble=raw.units.filter(u=>u.start>opening&&u.start<operative.start),recitals=preamble.filter(u=>u.kind==='recital');
  if(!recitals.length||preamble.some(u=>!['citation','recital'].includes(u.kind)||!u.complete||!(u.kind==='citation'?grammar.citation:grammar.recital).test(fold(paragraphs[u.start]))))return unknown();
  // Every preamble row belongs to one of the independently delimited units.
  if(Array.from({length:operative.start-opening-1},(_,i)=>i+opening+1).some(i=>!preamble.some(u=>i>=u.start&&i<=u.end)))return unknown();
  if(recitals.some((u,i)=>u.label!==String.fromCharCode(65+i)))return unknown();
  const anchor=recitals.filter(u=>u.label===header[1]),next=recitals.filter(u=>u.label===String.fromCharCode(header[1].charCodeAt(0)+1));
  if(anchor.length!==1||next.length!==1||anchor[0].end+1!==next[0].start||preamble.some(u=>u.kind==='citation'&&u.label===header[1]))return unknown();
  if([...(text.noteAnchors||[]),...(text.anchors||[])].some(a=>a.paragraph>=anchor[0].start&&a.paragraph<=next[0].end))return unknown();
  if(raw.units.filter(u=>u.kind==='recital'&&u.label===header[1]).length!==1||raw.units.some(u=>u.kind==='recital'&&u.label===header[1]+proposed[2]))return unknown();
  if(placement.insertAfter!==anchor[0].end||placement.insertBefore!==next[0].start)return {status:'failed',reason:'oracle-recital-category-boundary-mismatch'};
  return {status:'verified',reason:'oracle-independent-recital-category-repair'};
}
