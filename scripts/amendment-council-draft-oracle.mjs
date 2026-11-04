import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {assertCouncilDraftArticleText} from './amendment-council-article-oracle.mjs';
import {councilNativeSuperscripts} from './amendment-council-superscript-oracle.mjs';
import {councilNoteStructure,inspectCouncilPdfNoteScope} from './amendment-council-note-oracle.mjs';
const cached=new Map();
const fold=s=>String(s??'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const unknown=reason=>({status:'unverified',reason});
// Native Poppler text is read independently. No producer, parser or placer code.
export function assertCouncilDraftPlacement({placement,wording,items,nativeQuoted}) {
 if(placement?.status!=='placed')return {status:'not-applicable',reason:'not-placed'};
 const buffer=nativeQuoted?.proposalBuffer;if(!Buffer.isBuffer(buffer))return unknown('oracle-council-pdf-native-unavailable');
 const key=createHash('sha256').update(buffer).digest('hex');let native=cached.get(key);
 if(native===undefined){
  const text=spawnSync('pdftotext',['-layout','-','-'],{input:buffer,encoding:'utf8',timeout:25000,maxBuffer:4*1024*1024});
  const bbox=text.status===0?spawnSync('pdftotext',['-bbox-layout','-','-'],{input:buffer,encoding:'utf8',timeout:25000,maxBuffer:4*1024*1024}):null;
  native={raw:text.status===0?text.stdout:null,bbox:bbox?.status===0?bbox.stdout:null};
  if(native.raw&&native.bbox)native.raw=councilNativeSuperscripts(native.raw,native.bbox);
  cached.set(key,native);if(cached.size>4)cached.delete(cached.keys().next().value);
 }
 if(/\n_{3,}[ \t]*\n/u.test(wording.originalText??'')){
  if(placement.noteScope?.kind!=='pdf-footnotes')return {status:'failed',reason:'oracle-council-pdf-note-scope-missing'};
  native.structure??=councilNoteStructure(buffer);
  const proof=inspectCouncilPdfNoteScope({bbox:native.bbox,structure:native.structure,placement,wording,items});if(proof.status!=='verified')return proof;
  const body=assertCouncilDraftNativeText(native.raw,{placement,wording:proof.bodyWording,items});return body.status==='verified'?{status:'verified',reason:proof.reason}:body;
 }
 return assertCouncilDraftNativeText(native.raw,{placement,wording,items});
}
// Separate entry point for coordinate regression tests; the runtime oracle supplies
// only independently extracted native text.
export function assertCouncilDraftNativeText(raw,{placement,wording,items}) {
 if(!raw)return unknown('oracle-council-pdf-text-unavailable');
 const target=/^(?:Recital|Bod odůvodnění|Betragtning|Considerando)\s+(\d+)\s*([a-z]?)\s*(?:\([^)]*\))?$/iu.exec(wording.targetLabel??'');
 if(!target)return assertCouncilDraftArticleText(raw,{placement,wording,items});
 const heading=/^\s*(?:Article|Článek|Artikel|Artículo)\s+1\s*$/imu.exec(raw);if(!heading)return unknown('oracle-council-pdf-recital-boundary-unavailable');
 const preamble=raw.slice(0,heading.index),labels=[...preamble.matchAll(/^\s*\((\d+)\)\s+/gmu)],number=Number(target[1]),found=labels.filter(m=>Number(m[1])===number);
 if(found.length!==1)return unknown('oracle-council-pdf-recital-not-unique');
 const i=labels.indexOf(found[0]),end=labels[i+1]?.index??preamble.length,unit=preamble.slice(found[0].index,end),proposal=items?.[placement.itemIndex]?.proposal;
 if(!proposal)return unknown('oracle-council-pdf-projection-unavailable');
 if(placement.operation==='insert'&&target[2]){
  if(!labels[i+1]||Number(labels[i+1][1])!==number+1)return unknown('oracle-council-pdf-next-recital-unavailable');
  const before=proposal.paragraphs[placement.insertBefore]?.text,after=proposal.paragraphs[placement.insertAfter]?.text;
  const afterFold=fold(after);if(!afterFold||!fold(unit).includes(afterFold)||!new RegExp('^\\s*\\('+ (number+1)+'\\)').test(before??''))return {status:'failed',reason:'oracle-council-pdf-insertion-mismatch'};
  if(placement.insertBefore!==placement.insertAfter+1)return {status:'failed',reason:'oracle-council-pdf-boundary-gap'};
  return {status:'verified',reason:'native-council-pdf-recital-boundaries'};
 }
 if(target[2]||!['replace','delete'].includes(placement.operation))return unknown('oracle-council-pdf-operation-unavailable');
 const span=placement.span,splice=placement.splice;
 const fail=()=>({status:'failed',reason:'oracle-council-pdf-splice-mismatch'});
 if(!span||!splice||![span.start,span.end,splice.start?.paragraph,splice.end?.paragraph,splice.start?.offset,splice.end?.offset].every(Number.isSafeInteger))return fail();
 if(span.start<0||span.end<span.start||span.end>=proposal.paragraphs.length||splice.start.paragraph!==span.start||splice.end.paragraph!==span.end)return fail();
 const endText=proposal.paragraphs[span.end].text;
 // This bounded oracle proves whole-recital replacements only. Even a shifted
 // punctuation or whitespace boundary must fail rather than disappear in fold().
 if(splice.start.offset!==0||splice.end.offset!==endText.length)return fail();
 const rendered=proposal.paragraphs.slice(span.start,span.end+1).map((p,j)=>p.text.slice(j===0?splice.start.offset:0,j===span.end-span.start?splice.end.offset:p.text.length)).join(' ');
 if(fold(rendered)!==fold(wording.originalText))return fail();
 const original=fold(wording.originalText),actual=fold(proposal.paragraphs.slice(placement.span?.start,placement.span?.end+1).map(p=>p.text).join(' '));
 if(!original||fold(raw).split(original).length!==2||!fold(unit).includes(original))return unknown('oracle-council-pdf-original-unverified');
 if(actual!==original)return {status:'failed',reason:'oracle-council-pdf-span-mismatch'};
 return {status:'verified',reason:'native-council-pdf-original-and-address'};
}
