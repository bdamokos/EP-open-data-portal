import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {assertCouncilDraftArticleText,councilPrintedText} from './amendment-council-article-oracle.mjs';
import {councilNativeSuperscripts} from './amendment-council-superscript-oracle.mjs';
import {councilNoteStructure,councilNoteGeometry,inspectCouncilPdfNoteScope} from './amendment-council-note-oracle.mjs';
import {inspectCouncilOuterInsertion} from './amendment-council-outer-oracle.mjs';
const cached=new Map();
const fold=s=>String(s??'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const unknown=reason=>({status:'unverified',reason});
// Native Poppler text is read independently. No producer, parser or placer code.
export function assertCouncilDraftPlacement({placement,wording,items,nativeQuoted}) {
 if(placement?.status!=='placed')return {status:'not-applicable',reason:'not-placed'};
 const buffer=nativeQuoted?.proposalBuffer;if(!Buffer.isBuffer(buffer))return unknown('oracle-council-pdf-native-unavailable');
 const key=createHash('sha256').update(buffer).digest('hex'),detached=/\n_{3,}[ \t]*\n/u.test(wording.originalText??'');
 if((detached||placement.originalDifference)&&items?.[placement.itemIndex]?.proposal?.nativeSourceHash!==key)return {status:'failed',reason:'oracle-council-pdf-note-source-hash-mismatch'};
 let native=cached.get(key);
 if(native===undefined){
  const text=spawnSync('pdftotext',['-layout','-','-'],{input:buffer,encoding:'utf8',timeout:25000,maxBuffer:4*1024*1024});
  const bbox=text.status===0?spawnSync('pdftotext',['-bbox-layout','-','-'],{input:buffer,encoding:'utf8',timeout:25000,maxBuffer:4*1024*1024}):null;
  native={raw:text.status===0?text.stdout:null,bbox:bbox?.status===0?bbox.stdout:null};
  if(native.raw&&native.bbox)native.raw=councilNativeSuperscripts(native.raw,native.bbox);
  cached.set(key,native);if(cached.size>4)cached.delete(cached.keys().next().value);
 }
 if(detached){
  if(placement.noteScope?.kind!=='pdf-footnotes')return {status:'failed',reason:'oracle-council-pdf-note-scope-missing'};
  native.structure??=councilNoteStructure(buffer);
  const proof=inspectCouncilPdfNoteScope({bbox:native.bbox,structure:native.structure,placement,wording,items});if(proof.status!=='verified')return proof;
  const body=assertCouncilDraftNativeText(native.raw,{placement,wording:proof.bodyWording,items});return body.status==='verified'?{status:'verified',reason:proof.reason}:body;
 }
 if(placement.operation==='insert'&&/\bpunto\s+-1\s*$/u.test(String(wording.targetLabel??'').split('\n')[0])){
  if(items?.[placement.itemIndex]?.proposal?.nativeSourceHash!==key)return {status:'failed',reason:'oracle-council-pdf-outer-source-hash-mismatch'};
  native.structure??=councilNoteStructure(buffer);
  return inspectCouncilOuterInsertion({geometry:councilNoteGeometry(native.bbox),structure:native.structure,placement,wording,items});
 }
 return assertCouncilDraftNativeText(native.raw,{placement,wording,items,nativeBodyWords:items?.[placement.itemIndex]?.proposal?.nativeSourceHash===key?councilNoteGeometry(native.bbox)?.words:undefined});
}
// Independent spelling of the maintainer's bounded rule: exactly one complete
// alphabetic word is replaced. All surrounding characters, including digits
// and punctuation, must agree; URLs and identifier fragments are not words.
function nativeWordDifference(left,right) {
 const clean=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim(),a=clean(left),b=clean(right),words=[...a.matchAll(/\p{L}+/gu)];
 if(a===b)return false;
 return words.some(m=>{
  const start=m.index,end=start+m[0].length,tail=a.slice(end),prefix=a.slice(0,start);
  if(start&&!/[\s(“‘«„"]$/u.test(prefix)||tail&&!/^(?:\s|[).,;!?…”’»"](?:\s|$))/u.test(tail))return false;
  if(!b.startsWith(prefix)||!b.endsWith(tail))return false;
  const replacement=b.slice(prefix.length,b.length-tail.length);
  return replacement!==m[0]&&/^\p{L}+$/u.test(replacement);
 });
}
// Separate entry point for coordinate regression tests; the runtime oracle supplies
// only independently extracted native text.
export function assertCouncilDraftNativeText(raw,{placement,wording,items,nativeBodyWords}) {
 if(!raw)return unknown('oracle-council-pdf-text-unavailable');
 const target=/^(?:Recital|Bod odůvodnění|Betragtning|Considerando)\s+(\d+)\s*([a-z]?)\s*(?:\([^)]*\))?$/iu.exec(wording.targetLabel??'');
 if(!target)return assertCouncilDraftArticleText(raw,{placement,wording,items,nativeBodyWords});
 if(target[2]&&placement.operation!=='insert')raw=councilPrintedText(raw);
 const heading=/^\s*(?:Article|Článek|Artikel|Artículo)\s+1\s*$/imu.exec(raw);if(!heading)return unknown('oracle-council-pdf-recital-boundary-unavailable');
 const preamble=raw.slice(0,heading.index),labels=[...preamble.matchAll(/^\s*\((\d+)\s*([a-z]?)\)\s+/gmu)],number=Number(target[1]),suffix=placement.operation==='insert'?'':target[2].toLowerCase(),found=labels.filter(m=>Number(m[1])===number&&m[2].toLowerCase()===suffix);
 if(found.length!==1)return unknown('oracle-council-pdf-recital-not-unique');
 const i=labels.indexOf(found[0]),end=labels[i+1]?.index??preamble.length,unit=preamble.slice(found[0].index,end),proposal=items?.[placement.itemIndex]?.proposal;
 if(!proposal)return unknown('oracle-council-pdf-projection-unavailable');
 if(placement.operation==='insert'&&target[2]){
  if(labels.some(m=>Number(m[1])===number&&m[2].toLowerCase()===target[2].toLowerCase()))return unknown('oracle-council-pdf-recital-already-exists');
  if(!labels[i+1]||Number(labels[i+1][1])!==number+1)return unknown('oracle-council-pdf-next-recital-unavailable');
  const before=proposal.paragraphs[placement.insertBefore]?.text,after=proposal.paragraphs[placement.insertAfter]?.text;
  const afterFold=fold(after);if(!afterFold||!fold(unit).includes(afterFold)||!new RegExp('^\\s*\\('+ (number+1)+'\\)').test(before??''))return {status:'failed',reason:'oracle-council-pdf-insertion-mismatch'};
  if(placement.insertBefore!==placement.insertAfter+1)return {status:'failed',reason:'oracle-council-pdf-boundary-gap'};
  return {status:'verified',reason:'native-council-pdf-recital-boundaries'};
 }
 if(!['replace','delete'].includes(placement.operation))return unknown('oracle-council-pdf-operation-unavailable');
 const span=placement.span,splice=placement.splice;
 const fail=()=>({status:'failed',reason:'oracle-council-pdf-splice-mismatch'});
 if(!span||!splice||![span.start,span.end,splice.start?.paragraph,splice.end?.paragraph,splice.start?.offset,splice.end?.offset].every(Number.isSafeInteger))return fail();
 if(span.start<0||span.end<span.start||span.end>=proposal.paragraphs.length||splice.start.paragraph!==span.start||splice.end.paragraph!==span.end)return fail();
 const endText=proposal.paragraphs[span.end].text;
 // This bounded oracle proves whole-recital replacements only. Even a shifted
 // punctuation or whitespace boundary must fail rather than disappear in fold().
 if(splice.start.offset!==0||splice.end.offset!==endText.length)return fail();
 const rendered=proposal.paragraphs.slice(span.start,span.end+1).map((p,j)=>p.text.slice(j===0?splice.start.offset:0,j===span.end-span.start?splice.end.offset:p.text.length)).join(' ');
 if(placement.originalDifference==='one-word'){
  if(placement.operation!=='replace'||span.start!==span.end||!proposal.paragraphs[span.start].complete||!nativeBodyWords)return unknown('oracle-council-pdf-word-owner-unproved');
  const heads=nativeBodyWords.flatMap((w,index)=>/^\(\d+[a-z]?\)$/u.test(w.text)?[{word:w,index}]:[]),selected=heads.filter(h=>h.word.text==='('+number+suffix+')'),first=heads.filter(h=>h.word.text==='(1)');
  if(selected.length!==1||first.length!==1)return unknown('oracle-council-pdf-word-owner-unproved');
  const end=heads[heads.indexOf(selected[0])+1]?.index;if(end===undefined||first[0].index>selected[0].index)return unknown('oracle-council-pdf-word-owner-unproved');
  const text=words=>words.filter(w=>!w.reference).map(w=>w.text).join(' '),literal=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim(),body=text(nativeBodyWords.slice(selected[0].index,end));
  if(literal(body)!==literal(rendered)||!nativeWordDifference(body,wording.originalText))return fail();
  const compact=s=>s.normalize('NFC').replace(/\s/gu,''),frame=compact(text(nativeBodyWords.slice(first[0].index,end))),projected=proposal.paragraphs.map(p=>compact(p.text)).join(''),at=projected.indexOf(frame),actualEnd=proposal.paragraphs.slice(0,span.end+1).reduce((n,p)=>n+compact(p.text).length,0);
  if(at<0||projected.lastIndexOf(frame)!==at||actualEnd!==at+frame.length)return fail();
  return {status:'verified',reason:'native-council-pdf-one-word-disagreement'};
 }
 if(fold(rendered)!==fold(wording.originalText))return fail();
 const original=fold(wording.originalText),actual=fold(proposal.paragraphs.slice(placement.span?.start,placement.span?.end+1).map(p=>p.text).join(' '));
 if(!original||fold(raw).split(original).length!==2||!fold(unit).includes(original))return unknown('oracle-council-pdf-original-unverified');
 if(actual!==original)return {status:'failed',reason:'oracle-council-pdf-span-mismatch'};
 if(suffix){
  const bases=labels.filter(m=>Number(m[1])===number&&!m[2]);if(bases.length!==1||bases[0].index>=found[0].index||fold(unit)!==original)return unknown('oracle-council-pdf-existing-recital-boundary-unproved');
  let frame=fold(preamble.slice(bases[0].index,end));
  if(nativeBodyWords){
   const starts=nativeBodyWords.flatMap((word,index)=>/^\(\d+[a-z]?\)$/u.test(word.text)?[{word,index}]:[]),base=starts.filter(s=>s.word.text==='('+number+')'),selected=starts.filter(s=>s.word.text==='('+number+suffix+')');
   if(base.length!==1||selected.length!==1)return unknown('oracle-council-pdf-existing-recital-geometry-unproved');
   const next=starts[starts.indexOf(selected[0])+1];if(!next||base[0].index>=selected[0].index)return unknown('oracle-council-pdf-existing-recital-geometry-unproved');
   frame=fold(nativeBodyWords.slice(base[0].index,next.index).filter(w=>!w.reference).map(w=>w.text).join(' '));
  }
  const projected=proposal.paragraphs.map(p=>fold(p.text)).join(''),at=projected.indexOf(frame),actualEnd=proposal.paragraphs.slice(0,span.end+1).reduce((n,p)=>n+fold(p.text).length,0);
  if(at<0||projected.lastIndexOf(frame)!==at||actualEnd!==at+frame.length)return fail();
 }
 return {status:'verified',reason:'native-council-pdf-original-and-address'};
}
