import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LANGUAGE_SECTIONS} from './amendment-language-vocabulary.mjs';
import {expectedOperation} from './amendment-benchmark-operation-oracle.mjs';

export const rawDocument=buffer=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./amendment-language-raw.py',import.meta.url)),String(buffer.length)],{input:buffer,maxBuffer:32*1024*1024,timeout:30_000}).toString());
// This deliberately does not import production labels, normalizers, segmenters
// or proposal trees. Unsupported addresses remain explicitly unverified.
export const rawNormal=value=>String(value).normalize('NFC').replace(/\u00ad/gu,'').replace(/[‘’]/gu,"'").replace(/[“”„«»]/gu,'"').replace(/[–—]/gu,'-').replace(/\s+/gu,' ').trim();
const strip=value=>rawNormal(value).replace(/^(?:\(\d+[\p{L}]{0,3}\)\s*|\d+[\p{L}]{0,3}[.)]\s*|[\p{Lu}]{1,3}[.)]\s+)/u,'').replace(/[.;]+$/u,'').trim();
const opening=/^(?:The European Parliament|Европейският парламент|Evropský parlament|Europa-Parlamentet|Das Europäische Parlament|Το Ευρωπαϊκό Κοινοβούλιο|El Parlamento Europeo|Euroopa Parlament|Euroopan parlamentti(?:, joka)?|Le Parlement européen|(?:Tá )?Parlaimint na hEorpa|Europski parlament|Az Európai Parlament|Il Parlamento europeo|Europos Parlamentas|Eiropas Parlaments|Il-Parlament Ewropew|Het Europees Parlement|Parlament Europejski|O Parlamento Europeu|Parlamentul European|Európsky parlament|Evropski parlament|Europaparlamentet(?: utfärdar denna resolution)?)[,;:]?$/iu;
const ref=value=>{
  let m=/^(\d+[\p{Ll}]{0,3})[.)]\s*/u.exec(value);
  if(m)return {kind:'paragraph',value:m[1]};
  m=/^([\p{Lu}]{1,3}[\p{Ll}]{0,3})[.)]\s+/u.exec(value);
  if(m)return {kind:'recital',value:m[1]};
  m=/^\((\d+)\)\s*/u.exec(value);
  return m?{kind:'recital',value:m[1]}:null;
};
const sectionKey=value=>rawNormal(value||'').toLowerCase().replace(/[,;:]$/u,'');
const vocabulary=Object.values(LANGUAGE_SECTIONS);
const resolutions=new Set(vocabulary.flatMap(v=>v.classes).map(sectionKey));
const proposals=new Set(vocabulary.map(v=>sectionKey(v.proposalClass)));
const resolutionHeadings=new Set(vocabulary.map(v=>sectionKey(v.resolution)));
const decisionHeadings=new Set(vocabulary.map(v=>sectionKey(v.decision)));
export function rawExpected(block,language) {
  const key=sectionKey(block.section);
  return {...block,language,sectionKind:resolutions.has(key)?'resolution':proposals.has(key)?'commission-proposal':null,operation:block.gap?null:expectedOperation(block)};
}
// Language-neutral numeric token extraction is only accepted for simple source
// headings. Parent paths, selectors and quoted acts require a separate gold row.
export function rawTargetKind(label,language) {
  const examples=LANGUAGE_SECTIONS[language]?.references;
  if(!examples)return null;
  const key=sectionKey(label);
  for(const [kind,example] of Object.entries(examples)) {
    const words=sectionKey(example).match(/\p{L}+/gu)||[];
    if(words.length&&words.every(word=>key.includes(word)))return kind;
  }
  return null;
}
export function simpleAddress(label) {
  if(!label||/[\r\n]/u.test(label)||/[–—]/u.test(label))return null;
  const m=[...label.matchAll(/(?<![\p{L}\d])(-?\d+|\p{Lu})(?:\s+([\p{Ll}]{1,3}))?(?![\p{L}\d])/gu)];
  if(m.length!==1)return null;
  return {base:m[0][1],suffix:m[0][2]||'',value:m[0][1]+(m[0][2]||'')};
}
export function rawSections(raw) {
  const rows=raw.paragraphs.filter(p=>p.body&&p.text);
  let group=0,active=false,kind=null,heading=null;
  return rows.map((row,index)=>{
    const key=sectionKey(row.text.replace(/^\d+\.\s*/u,''));
    const sectionHeading=resolutionHeadings.has(key)?'resolution':decisionHeadings.has(key)?'decision':null;
    if(sectionHeading){active=false;kind=sectionHeading;heading=row.path;}
    else if(row.style==='PageHeading'){active=false;kind=null;heading=row.path;}
    const isOpening=opening.test(rawNormal(row.text));
    if(isOpening){group++;active=true;if(!kind&&raw.motionDocument)kind='resolution';}
    return {...row,index,section:active?group:0,sectionKind:active?kind:null,heading,opening:isOpening,ref:ref(row.text)};
  });
}
function proposalRecitals(raw) {
  const rows=raw.paragraphs.filter(p=>p.body&&p.text);
  const institution=rows.findIndex(p=>p.style==='Institutionquiagit');
  const article=rows.findIndex((p,i)=>i>institution&&p.style==='Titrearticle');
  if(institution<0||article<0)return [];
  return rows.slice(institution+1,article).filter(p=>p.style==='ManualConsidrant'&&/^\(\d+\)/u.test(p.text)).map(p=>({...p,value:/^\((\d+)\)/u.exec(p.text)[1]}));
}
const unknown=reason=>({status:'unverified',reason});
const failed=(reason,details={})=>({status:'failed',reason,...details});
export function verifyLanguagePlacement({expected,placement,text,items,rawText,rawItems}) {
  if(placement.status!=='placed')return {status:'not-applicable',reason:'not-placed'};
  if(!expected?.operation)return unknown(expected?.gap||'raw-operation-unavailable');
  if(placement.operation!==expected.operation)return failed('raw-operation-mismatch',{expectedOperation:expected.operation,actualOperation:placement.operation});
  const targetKind=rawTargetKind(expected.targetLabel,expected.language);
  const proposal=items?.[placement.itemIndex]?.proposal;
  const raw=proposal?rawItems?.[placement.itemIndex]:rawText;
  if(!raw)return unknown('raw-baseline-unavailable');
  const observed=proposal?proposal.paragraphs.map(p=>({text:p.text,path:p.source?.path||p.sourcePath})):text.paragraphs.map((value,i)=>({text:value,path:text.paragraphSources?.[i]?.path}));
  const sourceRows=raw.paragraphs.filter(p=>p.text);
  // Map by original XML path only; never by wording similarity. Proposal rows
  // expose source through the production source projection, not unit ownership.
  if(proposal)for(let i=0;i<observed.length;i++)observed[i].path ||= proposal.paragraphSources?.[i]?.path;
  const span=placement.span;
  if(expected.operation==='insert') {
    if(proposal) {
      if(targetKind!=='recital')return unknown('raw-proposal-target-kind-unverified');
      if(expected.sectionKind!=='commission-proposal')return unknown('raw-proposal-section-unverified');
      const address=simpleAddress(expected.targetLabel),recitals=proposalRecitals(raw),anchors=recitals.filter(p=>p.value===address?.base);
      if(!address?.suffix||anchors.length!==1)return unknown('raw-proposal-insertion-boundary-unverified');
      const anchor=anchors[0],at=recitals.indexOf(anchor),next=recitals[at+1];
      if(!next)return unknown('raw-proposal-insertion-boundary-unverified');
      if(observed[placement.insertAfter]?.path!==anchor.path||observed[placement.insertBefore]?.path!==next.path)return unknown('raw-proposal-insertion-extent-unverified');
      return {status:'verified',reason:'raw-proposal-recital-boundary',location:{section:'proposal-recitals',kind:'recital',value:address.value,scope:'proposal'}};
    }
    const address=simpleAddress(expected.targetLabel);
    if(!address?.suffix)return unknown('raw-insertion-address-unverified');
    const rows=rawSections(raw),matches=rows.filter(p=>p.ref?.value===address.base&&p.section>0&&p.sectionKind===expected.sectionKind);
    if(matches.length!==1)return unknown('raw-insertion-section-unverified');
    const anchor=matches[0];
    if(!targetKind)return unknown('raw-target-kind-unverified');
    if(anchor.ref.kind!==targetKind)return failed('raw-target-kind-mismatch',{expected:targetKind,actual:anchor.ref.kind});
    if(!expected.sectionKind)return unknown('raw-section-unverified');
    const next=rows.slice(anchor.index+1).find(p=>p.ref||p.opening||/^[°\s]+$/u.test(p.text));
    // Without a source boundary, never turn a last-row insertion into correct.
    if(!next)return unknown('raw-insertion-extent-unverified');
    const between=rows.slice(anchor.index+1,next.index);
    if(between.some(p=>!/[.;:]$/u.test(p.text)||p.uncertain))return unknown('raw-insertion-extent-unverified');
    const last=rows[next.index-1],after=observed[placement.insertAfter],before=observed[placement.insertBefore];
    if(after?.path!==last.path||before?.path!==next.path)return failed('raw-insertion-boundary-mismatch',{expectedAfter:last.path,expectedBefore:next.path,actualAfter:after?.path,actualBefore:before?.path});
    return {status:'verified',reason:'raw-sibling-boundary',location:{section:anchor.sectionKind,kind:anchor.ref.kind,value:address.value,scope:'body'}};
  }
  if(!span||!Number.isInteger(span.start)||!Number.isInteger(span.end)||span.start<0||span.end<span.start||span.end>=observed.length)return failed('raw-invalid-span');
  const selected=observed.slice(span.start,span.end+1),rawSelected=selected.map(p=>sourceRows.find(r=>r.path===p.path));
  if(rawSelected.some((p,i)=>!p||p.uncertain||p.automatic||rawNormal(p.text)!==rawNormal(selected[i].text)))return unknown('raw-span-projection-unverified');
  if(proposal) {
    if(targetKind!=='recital')return unknown('raw-proposal-target-kind-unverified');
    if(expected.sectionKind!=='commission-proposal')return unknown('raw-proposal-section-unverified');
    const recitals=proposalRecitals(raw),address=simpleAddress(expected.targetLabel),matched=recitals.filter(r=>r.path===rawSelected[0].path);
    if(!address||matched.length!==1||rawSelected.length!==1)return unknown('raw-proposal-scope-unverified');
    if(address.value!==matched[0].value)return failed('raw-proposal-recital-address-mismatch',{expected:address.value,actual:matched[0].value});
    if(strip(rawSelected[0].text)!==strip(expected.originalText))return failed('raw-original-span-mismatch',{sourcePaths:rawSelected.map(p=>p.path)});
    return {status:'verified',reason:'raw-proposal-recital-span',location:{section:'proposal-recitals',kind:'recital',value:address.value,scope:'proposal'}};
  }
  if(strip(rawSelected.map(p=>p.text).join('\n'))!==strip(expected.originalText))return failed('raw-original-span-mismatch',{sourcePaths:rawSelected.map(p=>p.path)});
  const rows=rawSections(raw),selectedRows=rawSelected.map(p=>rows.find(r=>r.path===p.path));
  if(selectedRows.some(p=>!p||!p.section))return unknown('raw-section-unverified');
  const sections=[...new Set(selectedRows.map(p=>p.section))];
  if(sections.length!==1)return failed('raw-cross-section-span');
  if(expected.sectionKind&&selectedRows.some(p=>p.sectionKind&&p.sectionKind!==expected.sectionKind))return failed('raw-section-mismatch',{expected:expected.sectionKind,actual:selectedRows.map(p=>p.sectionKind)});
  if(!expected.sectionKind||selectedRows.some(p=>!p.sectionKind))return unknown('raw-section-kind-unverified');
  const address=simpleAddress(expected.targetLabel),start=selectedRows[0];
  if(!address||!start.ref||!targetKind)return unknown('raw-address-unverified');
  if(start.ref.kind!==targetKind)return failed('raw-target-kind-mismatch',{expected:targetKind,actual:start.ref.kind});
  if(start.ref.value!==address.value)return failed('raw-address-mismatch',{expected:address.value,actual:start.ref.value});
  return {status:'verified',reason:'raw-addressed-span',location:{section:start.sectionKind,kind:start.ref.kind,value:address.value,scope:'body'}};
}
