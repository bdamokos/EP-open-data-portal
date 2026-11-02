import {assertMaintainerPrinciple} from './amendment-maintainer-oracle.mjs';
import {assertSimilarPlacement,oracleSimilarity} from './amendment-similarity-oracle.mjs';
import {languageQuotedSibling} from './amendment-language-quoted-oracle.mjs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LANGUAGE_SECTIONS} from './amendment-language-vocabulary.mjs';
import {oracleAddress,oracleFold,oracleOpening,oracleRelative,oracleInstruction} from './amendment-oracle-grammar.mjs';
import {rawProposalAssertion} from './amendment-benchmark-proposal-oracle.mjs';
import {expectedOperation} from './amendment-benchmark-operation-oracle.mjs';
import {expectedLanguageScope,verifyLanguageScope} from './amendment-benchmark-scope-oracle.mjs';

export const rawDocument=buffer=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./amendment-language-raw.py',import.meta.url)),String(buffer.length)],{input:buffer,maxBuffer:32*1024*1024,timeout:30_000}).toString());
// This deliberately does not import production labels, normalizers, segmenters
// or proposal trees. Unsupported addresses remain explicitly unverified.
export const rawNormal=oracleFold;
const strip=value=>String(value).split(/\r?\n/u).map(line=>rawNormal(line).replace(/^["']\s*/u,'').replace(/^(?:\([\p{L}\d]{1,6}\)\s*|\d+[\p{L}]{0,3}[.)]\s*|(?:[\p{Lu}]{1,3}|\p{Ll})[.)]\s+)/u,'').replace(/[.;"'\s]+$/u,'').trim()).join(' ').replace(/\s+/gu,' ').trim();

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
const resolutionHeadings=new Set(vocabulary.flatMap(v=>[v.resolution,...(v.resolutionAliases||[])]).map(sectionKey));
const decisionHeadings=new Set(vocabulary.map(v=>sectionKey(v.decision)));
export function rawExpected(block,language) {
  // Committee comparisons print outer proposal and underlying act headings in
  // the same block. Select the recognized proposal class and the NEXT address;
  // do not accidentally replace it with the final underlying-act address.
  const headers=block.tables?.[0]?.before||[],at=headers.findIndex(h=>proposals.has(sectionKey(h)));
  if(at>=0&&headers[at+1])block={...block,section:headers[at],targetLabel:headers[at+1],underlyingSection:headers[at+2]||null,underlyingTargetLabel:headers[at+3]||null};
  const key=sectionKey(block.section);
  return {...block,language,sectionKind:resolutions.has(key)?'resolution':proposals.has(key)?'commission-proposal':null,
    operation:block.gap?null:expectedOperation({...block,language}),scope:block.gap?null:expectedLanguageScope({...block,language})};
}
// Language-neutral numeric token extraction is only accepted for simple source
// headings. Parent paths, selectors and quoted acts require a separate gold row.
export function rawTargetKind(label,language) {
 const segments=oracleAddress(label,language,{resolution:true});
 return segments?.length===1?segments[0].kind:null;
}

export function simpleAddress(label,language='en') {
 const target=oracleAddress(label,language,{resolution:true});
 if(target?.length!==1||!['paragraph','recital','citation'].includes(target[0].kind))return null;
 return target[0];
}

export function rawSections(raw) {
  const rows=raw.paragraphs.filter(p=>p.body&&p.text);
  let group=0,active=false,kind=null,heading=null,citation=0,provisions=false;
  return rows.map((row,index)=>{
    const key=sectionKey(row.text.replace(/^\d+\.\s*/u,''));
    const sectionHeading=resolutionHeadings.has(key)?'resolution':decisionHeadings.has(key)?'decision':null;
    if(sectionHeading){active=false;kind=sectionHeading;heading=row.path;}
    else if(row.style==='PageHeading'){active=false;kind=null;heading=row.path;}
    const isOpening=oracleOpening.test(rawNormal(row.text));
    if(isOpening){group++;active=true;citation=0;provisions=false;if(!kind&&raw.motionDocument)kind='resolution';}
    let reference=ref(row.text);
    if(active&&!reference&&!provisions&&/^[–—−\-•]\s*\S/u.test(row.text))reference={kind:'citation',value:String(++citation)};
    if(reference&&reference.kind!=='citation')provisions=true;
    return {...row,index,section:active?group:0,sectionKind:active?kind:null,heading,opening:isOpening,ref:reference};
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
export function verifyLanguagePlacement({expected,placement,text,items,rawText,rawItems,nativeQuoted}) {
  if(placement.status==='not-applicable'&&(!expected?.operation||expected.gap))return unknown(expected?.gap||'raw-operation-unavailable');
  const scope=verifyLanguageScope(placement,expected?.scope);
  if(scope)return scope;
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
  const nativeRows=()=>observed.map((p,index)=>{const r=sourceRows.find(row=>row.path===p.path);return {index,text:r?.text??'',properties:{styleId:r?.style},source:{container:r?.body?'body':'table',complete:Boolean(r&&!r.uncertain&&!r.automatic)},complete:Boolean(r&&!r.uncertain&&!r.automatic)};});
  const rawProposal=()=>{
    if(expected.sectionKind!=='commission-proposal')return unknown('raw-proposal-section-unverified');
    const rows=observed.map((p,index)=>{
      const rawRow=sourceRows.find(r=>r.path===p.path);
      return {index,text:rawRow?.text??'',properties:{styleId:rawRow?.style},source:{container:rawRow?.body?'body':'table',complete:Boolean(rawRow&&!rawRow.uncertain&&!rawRow.automatic)},complete:Boolean(rawRow&&!rawRow.uncertain&&!rawRow.automatic)};
    });
    const result=rawProposalAssertion({proposal:{paragraphs:rows,sourceKind:'docx'},wording:expected,placement});
    const target=oracleAddress(expected.targetLabel,expected.language);
    if(result.status==='failed')return result;
    if(result.status!=='verified'){
      const quoted=languageQuotedSibling({expected,proposal,placement,nativeQuoted});
      return quoted.status==='unverified'?result:quoted;
    }
    return {...result,location:{section:'commission-proposal',kind:target.at(-1).kind,value:target.map(s=>s.kind+':'+s.value).join('/'),scope:'proposal'}};
  };
  const span=placement.span;
  if(expected.operation==='insert') {
    if(proposal) {
      if(targetKind!=='recital'){
        const ordinary=rawProposal();if(ordinary.status!=='unverified')return ordinary;
        const custom=assertMaintainerPrinciple({proposal:{paragraphs:nativeRows()},wording:expected,placement});
        return custom.status==='verified'?{...custom,location:{section:'commission-proposal',kind:'point',value:expected.targetLabel,scope:'proposal'}}:ordinary;
      }
      if(expected.sectionKind!=='commission-proposal')return unknown('raw-proposal-section-unverified');
      const address=simpleAddress(expected.targetLabel,expected.language),recitals=proposalRecitals(raw),anchors=recitals.filter(p=>p.value===address?.base);
      if(!address?.suffix||anchors.length!==1)return unknown('raw-proposal-insertion-boundary-unverified');
      const anchor=anchors[0],at=recitals.indexOf(anchor),next=recitals[at+1];
      if(!next)return unknown('raw-proposal-insertion-boundary-unverified');
      if(observed[placement.insertAfter]?.path!==anchor.path||observed[placement.insertBefore]?.path!==next.path)return unknown('raw-proposal-insertion-extent-unverified');
      return {status:'verified',reason:'raw-proposal-recital-boundary',location:{section:'proposal-recitals',kind:'recital',value:address.value,scope:'proposal'}};
    }
    const relative=oracleRelative(expected.targetLabel,expected.language);
    const address=relative||simpleAddress(expected.targetLabel,expected.language);
    if(!relative&&(!address?.suffix||!address.isNew))return unknown('raw-insertion-address-unverified');
    const rows=rawSections(raw),matches=rows.filter(p=>p.ref?.kind===(relative?'paragraph':targetKind)&&p.ref.value===address.base&&p.section>0&&p.sectionKind===expected.sectionKind);
    if(matches.length!==1)return unknown('raw-insertion-section-unverified');
    const anchor=matches[0];
    if(!targetKind&&!relative)return unknown('raw-target-kind-unverified');
    if(anchor.ref.kind!==(relative?'paragraph':targetKind))return failed('raw-target-kind-mismatch',{expected:targetKind,actual:anchor.ref.kind});
    if(!expected.sectionKind)return unknown('raw-section-unverified');
    const next=rows.slice(anchor.index+1).find(p=>p.ref||p.opening||p.style==='PageHeading'||p.bold||/^[°\s]+$/u.test(p.text));
    // Without a source boundary, never turn a last-row insertion into correct.
    if(!next)return unknown('raw-insertion-extent-unverified');
    const between=rows.slice(anchor.index+1,next.index);
    if(between.some(p=>!/[.;:]$/u.test(p.text)||p.uncertain))return unknown('raw-insertion-extent-unverified');
    const last=rows[next.index-1],after=observed[placement.insertAfter],before=observed[placement.insertBefore];
    if(after?.path!==last.path||before?.path!==next.path)return failed('raw-insertion-boundary-mismatch',{expectedAfter:last.path,expectedBefore:next.path,actualAfter:after?.path,actualBefore:before?.path});
    return {status:'verified',reason:'raw-sibling-boundary',location:{section:anchor.sectionKind,kind:relative?'heading':anchor.ref.kind,value:address.value,scope:'body'}};
  }
  if(!span||!Number.isInteger(span.start)||!Number.isInteger(span.end)||span.start<0||span.end<span.start||span.end>=observed.length)return failed('raw-invalid-span');
  let splicedSource;
  if(proposal) {
    const splice=placement.splice,start=splice?.start,end=splice?.end;
    if(!start||!end||start.paragraph!==span.start||end.paragraph!==span.end
      ||!Number.isSafeInteger(start.offset)||!Number.isSafeInteger(end.offset)
      ||start.offset<0||start.offset>observed[span.start].text.length
      ||end.offset<0||end.offset>observed[span.end].text.length
      ||span.start===span.end&&end.offset<start.offset)return failed('raw-invalid-splice');
    splicedSource=observed.slice(span.start,span.end+1).map((row,i,rows)=>row.text.slice(i===0?start.offset:0,i===rows.length-1?end.offset:row.text.length)).join('\n');
  }
  const selected=observed.slice(span.start,span.end+1),rawSelected=selected.map(p=>sourceRows.find(r=>r.path===p.path));
  if(rawSelected.some((p,i)=>!p||p.uncertain||p.automatic||rawNormal(p.text)!==rawNormal(selected[i].text)))return unknown('raw-span-projection-unverified');
  if(proposal) {
    if(targetKind!=='recital'){
      const normalLine=s=>s.normalize('NFC').replace(/[‘’]/gu,"'").replace(/[“”]/gu,'"').replace(/\s+/gu,' ').trim();
      if(span.start===span.end&&expected.originalText.includes('\n')&&oracleInstruction(rawSelected[0].text,expected.language)&&normalLine(rawSelected[0].text)===normalLine(expected.originalText.split('\n')[0])){
        const address=rawProposal();
        if(address.status==='verified'&&address.rawSourceRows?.[1]===span.start)return {...address,reason:'raw-exact-instruction-anchor'};
      }
      if(strip(splicedSource)!==strip(expected.originalText)){
        if(oracleSimilarity(splicedSource,expected.originalText)<.95)return failed('raw-original-splice-mismatch');
        const address=rawProposal();if(address.status!=='verified')return address;
        const rows=observed.map((p,index)=>{const r=sourceRows.find(row=>row.path===p.path);return {index,text:r?.text??''};});
        const similar=assertSimilarPlacement({proposal:{paragraphs:rows},wording:expected,placement,address});
        return similar.status==='verified'?{...similar,location:address.location}:similar;
      }
      return rawProposal();
    }
    if(expected.sectionKind!=='commission-proposal')return unknown('raw-proposal-section-unverified');
    const recitals=proposalRecitals(raw),address=simpleAddress(expected.targetLabel,expected.language),matched=recitals.filter(r=>r.path===rawSelected[0].path);
    if(!address||matched.length!==1||rawSelected.length!==1)return unknown('raw-proposal-scope-unverified');
    if(address.value!==matched[0].value)return failed('raw-proposal-recital-address-mismatch',{expected:address.value,actual:matched[0].value});
    // Supported recital comparisons describe the complete published row. All
    // 77 correct proposal splices in the language sample cover that full row.
    const {start,end}=placement.splice;
    if(start.offset!==0||end.offset!==selected[0].text.length)return failed('raw-proposal-recital-splice-mismatch');
    if(strip(splicedSource)!==strip(expected.originalText))return failed('raw-original-splice-mismatch',{sourcePaths:rawSelected.map(p=>p.path)});
    return {status:'verified',reason:'raw-proposal-recital-span',location:{section:'proposal-recitals',kind:'recital',value:address.value,scope:'proposal'}};
  }
  if(strip(rawSelected.map(p=>p.text).join('\n'))!==strip(expected.originalText))return failed('raw-original-span-mismatch',{sourcePaths:rawSelected.map(p=>p.path)});
  const rows=rawSections(raw),selectedRows=rawSelected.map(p=>rows.find(r=>r.path===p.path));
  if(selectedRows.some(p=>!p||!p.section))return unknown('raw-section-unverified');
  const sections=[...new Set(selectedRows.map(p=>p.section))];
  if(sections.length!==1)return failed('raw-cross-section-span');
  if(expected.sectionKind&&selectedRows.some(p=>p.sectionKind&&p.sectionKind!==expected.sectionKind))return failed('raw-section-mismatch',{expected:expected.sectionKind,actual:selectedRows.map(p=>p.sectionKind)});
  if(!expected.sectionKind||selectedRows.some(p=>!p.sectionKind))return unknown('raw-section-kind-unverified');
  const address=simpleAddress(expected.targetLabel,expected.language),start=selectedRows[0];
  if(!address||!start.ref||!targetKind)return unknown('raw-address-unverified');
  if(start.ref.kind!==targetKind)return failed('raw-target-kind-mismatch',{expected:targetKind,actual:start.ref.kind});
  if(start.ref.value!==address.value)return failed('raw-address-mismatch',{expected:address.value,actual:start.ref.value});
  return {status:'verified',reason:'raw-addressed-span',location:{section:start.sectionKind,kind:start.ref.kind,value:address.value,scope:'body'}};
}
