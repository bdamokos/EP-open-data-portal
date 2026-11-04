import {repeatedPageDecoration} from './council-draft-decoration.mjs';
import {ownCouncilPageContent} from './council-draft-page-ownership.mjs';
import {councilPdfLines,councilPdfListOwnership} from './council-draft-list-ownership.mjs';
import {createHash} from 'node:crypto';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';

export const COUNCIL_DRAFT_PDF_LIMITS=Object.freeze({bytes:8*1024*1024,pages:100,nodes:100000,items:250000,textBytes:2*1024*1024});
const requireProof=(ok,reason)=>{if(!ok)throw Object.assign(new Error(reason),{code:reason});};
const clean=value=>value.replace(/\s+/gu,' ').trim();
const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const plain=v=>ArrayBuffer.isView(v)?Array.from(v,plain):Array.isArray(v)?v.map(plain):v;

// Persistent structure object references, not page-local PDF.js tree positions,
// own every paragraph. Never infer cross-page joins from visual proximity.
async function extractCouncilDraftPdfNative(buffer,{number,year,procedure,sourceUrl,signal}={}) {
 requireProof(Buffer.isBuffer(buffer)&&buffer.length<=COUNCIL_DRAFT_PDF_LIMITS.bytes&&buffer.subarray(0,5).toString()==='%PDF-','council-pdf-byte-limit');
 signal?.throwIfAborted();
 const {PDFDocument,PDFDict,PDFArray,PDFName,PDFNumber,PDFRef,decodePDFRawStream}=await import('pdf-lib');
 const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const paintOps=new Set(Object.entries(OPS).filter(([name])=>name.startsWith('paint')).map(([,value])=>value));
 const name=value=>value instanceof PDFName?value.asString():null;
 const list=value=>value instanceof PDFArray?value.asArray():value==null?[]:[value];
 const raw=await PDFDocument.load(buffer,{updateMetadata:false});
 requireProof(!raw.isEncrypted,'council-pdf-encrypted');
 const pages=raw.getPages();requireProof(pages.length<=COUNCIL_DRAFT_PDF_LIMITS.pages,'council-pdf-page-limit');
 const pageByRef=new Map(pages.map((p,i)=>[p.ref.toString(),i+1])),context=raw.context;
 const lookup=value=>value instanceof PDFRef?context.lookup(value):value;
 const get=(dict,key)=>lookup(dict.get(PDFName.of(key)));
 const nativeAnnotations=new Map();
 for(const page of pages)for(const ref of list(get(page.node,'Annots'))){
  const dict=lookup(ref);if(!(ref instanceof PDFRef)||!(dict instanceof PDFDict))continue;
  const keys=allowed=>value=>value instanceof PDFDict&&value.keys().every(key=>allowed.includes(key.asString()));
  const action=get(dict,'A'),ap=get(dict,'AP'),normal=ap instanceof PDFDict?get(ap,'N'):null;
  let appearanceEmpty=!ap;
  if(ap instanceof PDFDict&&ap.keys().length===1&&normal?.dict){
   try{const bytes=decodePDFRawStream(normal).decode();appearanceEmpty=bytes.length<=4096&&/^[\x00\t\n\f\r ]*q[\x00\t\n\f\r ]+Q[\x00\t\n\f\r ]*$/u.test(Buffer.from(bytes).toString('latin1'));}catch{appearanceEmpty=false;}
  }
  const url=get(action instanceof PDFDict?action:dict,'URI')?.decodeText?.();
  const safe=keys(['/Type','/Subtype','/Rect','/A','/AP','/BS','/F','/StructParent'])(dict)&&name(get(dict,'Subtype'))==='/Link'&&keys(['/S','/Type','/URI'])(action)&&name(get(action,'S'))==='/URI'&&[0,4].includes(get(dict,'F')?.asNumber?.()??0)&&appearanceEmpty&&typeof url==='string';
  nativeAnnotations.set(ref.objectNumber+'R'+(ref.generationNumber||''),{ref:ref.toString(),url,safe});
 }
 const tree=get(raw.catalog,'StructTreeRoot');requireProof(tree instanceof PDFDict,'council-pdf-tags-unavailable');
 const roleMap=get(tree,'RoleMap'),records=[],seen=new Set();let nodes=0;
 function walk(value,inheritedPage=null,parents=[]) {
  requireProof(++nodes<=COUNCIL_DRAFT_PDF_LIMITS.nodes,'council-pdf-node-limit');
  const ref=value instanceof PDFRef?value.toString():null;
  if(ref){requireProof(!seen.has(ref),'council-pdf-structure-cycle');seen.add(ref);}
  const node=lookup(value);
  if(node instanceof PDFNumber){requireProof(pageByRef.has(inheritedPage),'council-pdf-content-page');return [{page:pageByRef.get(inheritedPage),mcid:node.asNumber()}];}
  if(node instanceof PDFArray)return node.asArray().flatMap(kid=>walk(kid,inheritedPage,parents));
  requireProof(node instanceof PDFDict,'council-pdf-structure-kid');
  const pg=node.get(PDFName.of('Pg')),page=pg?.toString()??inheritedPage,type=name(get(node,'Type'));
  if(type==='/MCR'){requireProof(!node.has(PDFName.of('Stm')),'council-pdf-form-content');return walk(get(node,'MCID'),page,parents);}
  if(type==='/OBJR')return [{page:pageByRef.get(page),object:node.get(PDFName.of('Obj'))?.toString()}];
  let role=name(get(node,'S'));if(roleMap instanceof PDFDict)role=name(get(roleMap,role?.slice(1)))??role;
  const record={ref,role,parents,content:[]};
  if(['/P','/LBody','/Note','/Figure','/Table'].includes(role)){requireProof(ref,'council-pdf-anonymous-block');records.push(record);}
  const kids=node.get(PDFName.of('K'));
  record.content=list(lookup(kids)).flatMap(kid=>walk(kid,page,[...parents,{ref,role}]));
  return record.content;
 }
 walk(tree.get(PDFName.of('K')));
 const task=getDocument({data:new Uint8Array(buffer),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,verbosity:0});
 const content=new Map(),pageProofs=[];let itemCount=0,textBytes=0;
 try {
  const document=await task.promise;
  for(let n=1;n<=pages.length;n++) {
   signal?.throwIfAborted();const page=await document.getPage(n),text=await page.getTextContent({includeMarkedContent:true}),ops=await page.getOperatorList();
   const stack=[];const untagged=[];
   for(const item of text.items){requireProof(++itemCount<=COUNCIL_DRAFT_PDF_LIMITS.items,'council-pdf-item-limit');
    if(item.type?.startsWith('beginMarkedContent'))stack.push({id:item.id,tag:item.tag});
    else if(item.type==='endMarkedContent')stack.pop();
    else if(item.str?.trim()){
     textBytes+=Buffer.byteLength(item.str);requireProof(textBytes<=COUNCIL_DRAFT_PDF_LIMITS.textBytes,'council-pdf-text-limit');
     const mark=stack.findLast(mark=>mark.id),artifact=stack.some(mark=>mark.tag==='Artifact');
     if(mark){const mcid=Number(mark.id.match(/_mc(\d+)$/u)?.[1]);requireProof(Number.isSafeInteger(mcid),'council-pdf-mcid');const key=n+':'+mcid;const entries=content.get(key)??[],style=text.styles[item.fontName];entries.push({...item,page:n,ascent:style?.ascent,descent:style?.descent});content.set(key,entries);}
     else if(!artifact)untagged.push(item.str);
    }
   }
   // A page with any non-text paint is unproved until its geometry has been
   // classified. An Artifact tag alone does not prove that a graphic is harmless.
   const marked=[],paint=[],matrices=[];let matrix=[1,0,0,1,0,0];
   for(let i=0;i<ops.fnArray.length;i++){
    const op=ops.fnArray[i],args=ops.argsArray[i];
    if(op===OPS.beginMarkedContent||op===OPS.beginMarkedContentProps)marked.push(args);
    else if(op===OPS.endMarkedContent)marked.pop();
    else if(op===OPS.save)matrices.push(matrix.slice());
    else if(op===OPS.restore)matrix=matrices.pop()??[];
    else if(op===OPS.transform)matrix=multiply(matrix,args);
    else if(op===OPS.paintFormXObjectBegin){matrices.push(matrix.slice());if(args[0])matrix=multiply(matrix,args[0]);}
    else if(op===OPS.paintFormXObjectEnd)matrix=matrices.pop()??[];
    else if(paintOps.has(op)||op===OPS.shadingFill||op===OPS.constructPath&&args[0]!==OPS.endPath)
     paint.push({operation:Object.keys(OPS).find(k=>OPS[k]===op),index:i,args:plain(args),matrix:matrix.slice(),marked:structuredClone(marked)});
   }

   const annotations=await page.getAnnotations({intent:'display'});
   pageProofs.push({page:n,untagged,paint,annotations:annotations.map(a=>{const native=nativeAnnotations.get(a.id);return {subtype:a.subtype,annotationType:a.annotationType,rect:a.rect,ref:native?.ref,url:a.url,nativeSafe:!!native?.safe&&native.url===a.url&&a.borderStyle?.width===0};})});page.cleanup();
  }
 }finally{await task.destroy();}
 const decoration=repeatedPageDecoration(pageProofs);
 for(const page of pageProofs){page.decorationHash=decoration.hash;page.paint=decoration.pages.find(p=>p.page===page.page).remaining;}
 function entries(block,page=null){return block.content.flatMap(c=>Number.isInteger(c.mcid)&&(page===null||c.page===page)?content.get(c.page+':'+c.mcid)??[]:[]);}
 function text(items){let output='',last;for(const item of items){const space=last&&(Math.abs(last.transform[5]-item.transform[5])>1||item.transform[4]-last.transform[4]-last.width>1)?' ':'';output+=space+item.str;last=item;}return clean(output);}
 const full=records.filter(r=>r.role==='/P').map(r=>text(entries(r))).join('\n');
 requireProof(new RegExp('(?<!\\d)'+Number(number)+'/'+String(year).slice(-2)+'(?!\\d)','u').test(full),'council-pdf-st-mismatch');
 requireProof(full.replace(/\s/gu,'').includes(String(procedure).replace(/\s/gu,'')),'council-pdf-procedure-mismatch');
 const noteBlocks=records.filter(r=>r.role==='/Note');
 const notes=[],ownershipGaps=[],noteLabels=new Map();
 for(const record of records.filter(r=>r.role==='/P'&&r.parents.some(p=>p.role==='/Note'))){
  const value=text(entries(record)),match=/^(\d{1,3})\s+(.+)$/u.exec(value);
  if(!match){ownershipGaps.push({code:'council-pdf-note-label-unproved',ref:record.ref});continue;}
  const label=match[1],note={id:'pdf-note:'+record.ref,label,text:match[2],links:[],complete:true,source:{part:'pdf',path:record.ref,pages:[...new Set(record.content.map(c=>c.page))]},objects:[]};
  if(noteLabels.has(label))ownershipGaps.push({code:'council-pdf-note-label-ambiguous',label});
  noteLabels.set(label,note);notes.push(note);
 }
 // Some native list bodies own their MCID directly, without a child P. Retain
 // that persistent object as a paragraph; never duplicate an LBody's child P.
 const paragraphRecords=records.filter(r=>r.role==='/P'||r.role==='/LBody'&&!records.some(p=>p.role==='/P'&&p.parents.some(parent=>parent.ref===r.ref)));
 const ownership=ownCouncilPageContent(pageProofs,{paragraphs:paragraphRecords,noteBlocks,entries});
 for(const link of ownership.links){const note=notes.find(n=>n.source.path===link.owner);if(note){const start=note.text.indexOf(link.url);if(start<0||note.text.lastIndexOf(link.url)!==start){note.complete=false;continue;}note.links.push(link.url);(note.linkSpans??=[]).push({start,end:start+link.url.length,url:link.url});}}
 const owners=new Map(),bodyRecords=paragraphRecords.filter(r=>!r.parents.some(p=>p.role==='/Note'));
 const covered=new Map();for(const record of paragraphRecords.filter(r=>r.role==='/P'||!r.parents.some(p=>p.role==='/Note')))for(const c of record.content.filter(c=>Number.isInteger(c.mcid))){const key=c.page+':'+c.mcid;covered.set(key,(covered.get(key)??0)+1);}
 for(const page of pageProofs)page.unownedMarkedText=[...content].filter(([key])=>key.startsWith(page.page+':')&&covered.get(key)!==1).map(([key,items])=>({mcid:Number(key.split(':')[1]),text:text(items)}));
 for(const note of notes)note.complete=note.complete&&note.source.pages.length>0&&note.source.pages.every(n=>{const p=pageProofs[n-1];return p&&!p.untagged.length&&!p.unownedMarkedText.length&&!p.paint.length&&!p.annotations.length;});
 for(const record of bodyRecords){
  const items=entries(record),heights=items.filter(i=>i.str.trim()&&i.height>0).map(i=>i.height).sort((a,b)=>a-b),median=heights[Math.floor(heights.length/2)];
  for(let i=1;i<items.length;i++){
   const item=items[i],prior=items[i-1],label=item.str.trim();
   if(!/^\d{1,3}$/u.test(label)||!median||item.height>=median*.85||item.transform[5]<=prior.transform[5]+1)continue;
   if(!noteLabels.has(label)){ownershipGaps.push({code:'council-pdf-note-reference-unbound',ref:record.ref,label});continue;}
   const found=owners.get(label)??[];found.push({record,item});owners.set(label,found);
  }
 }
 for(const note of notes)if(owners.get(note.label)?.length!==1)ownershipGaps.push({code:'council-pdf-note-owner-unproved',label:note.label,owners:owners.get(note.label)?.length??0});
 const paintGaps=pageProofs.flatMap(p=>p.paint.length?[{code:'council-pdf-visible-paint-unproved',page:p.page,operations:p.paint.length}]:[]);
 const paragraphs=[],paragraphSources=[],paragraphProperties=[],anchors=[],links=[],paragraphLines=[];
 for(const record of bodyRecords){
  const originalItems=entries(record),bound=[...owners.entries()].filter(([label,owners])=>owners.length===1&&owners[0].record===record).map(([label,owners])=>({note:noteLabels.get(label),item:owners[0].item}));
  const items=originalItems.filter(i=>!bound.some(b=>b.item===i)),value=text(items);if(!value)continue;
  const pageNumbers=[...new Set(record.content.map(c=>c.page))],proofs=pageNumbers.map(n=>pageProofs[n-1]);
  const complete=proofs.every(p=>p&&!p.untagged.length&&!p.unownedMarkedText.length&&!p.paint.length&&!p.annotations.length)&&!record.content.some(c=>c.object&&!ownership.annotationObjects.has(c.object));
  for(const link of ownership.links.filter(l=>l.owner===record.ref)){const start=value.indexOf(link.url);if(start>=0&&value.lastIndexOf(link.url)===start)links.push({paragraph:paragraphs.length,start,end:start+link.url.length,url:link.url});}
  for(const boundNote of bound){const before=originalItems.slice(0,originalItems.indexOf(boundNote.item)).filter(i=>!bound.some(b=>b.item===i));anchors.push({note:boundNote.note.id,label:boundNote.note.label,paragraph:paragraphs.length,offset:text(before).length});}
  const first=items.find(i=>i.str.trim()),firstLine=first&&clean(items.filter(i=>Math.abs(i.transform[5]-first.transform[5])<1).map(i=>i.str).join(' '));
  const articleHeading=/^[„“‘«»"]?(?:Article|Článek|Artikel|Artículo)\s+\d+[a-z]?$/u.test(firstLine??'');
  paragraphLines.push(councilPdfLines(items));
  paragraphs.push(value);paragraphSources.push({part:'pdf',path:record.ref,role:record.role,pages:pageNumbers,mcids:record.content,complete});paragraphProperties.push({notesComplete:ownershipGaps.length===0,annotationsComplete:complete,...(articleHeading?{styleId:'Titrearticle',headingBasis:'native-first-line'}:{})});
 }
 const paragraphFormats=paragraphs.map(()=>({})),listOwnership=councilPdfListOwnership(paragraphs.map((text,i)=>({text,source:paragraphSources[i],complete:paragraphSources[i].complete&&paragraphProperties[i].notesComplete&&paragraphProperties[i].annotationsComplete,lines:paragraphLines[i],attached:anchors.some(a=>a.paragraph===i)||links.some(l=>l.paragraph===i)})));
 for(const proof of listOwnership){paragraphProperties[proof.start].pdfListOwnership=proof;for(const i of proof.points)paragraphFormats[i].indent=proof.pointIndent;for(const i of proof.continuations)paragraphFormats[i].indent=proof.bodyIndent;}
 return {sourceKind:'pdf',structureStatus:'extracted',sourceUrl,sourceHash:createHash('sha256').update(buffer).digest('hex'),paragraphs,paragraphSources,paragraphProperties,paragraphFormats,notes,anchors,links,proof:{paragraphIdentity:'native-structure-object-reference',noteBlocks:noteBlocks.map(r=>r.ref),notes,ownershipGaps,decoration,pageProofs,listOwnership},extractionGaps:[...ownershipGaps,...paintGaps]};
}

let active=false;
export async function extractCouncilDraftPdf(buffer,options={}) {
 const {signal,...identity}=options;
 requireProof(Buffer.isBuffer(buffer)&&buffer.length<=COUNCIL_DRAFT_PDF_LIMITS.bytes&&buffer.subarray(0,5).toString()==='%PDF-','council-pdf-byte-limit');
 signal?.throwIfAborted();requireProof(!active,'council-pdf-parser-busy');active=true;
 let worker;
 try {
  worker=new Worker(new URL(import.meta.url),{workerData:{kind:'council-draft-pdf',buffer,identity},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:192}});
  return await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('council-pdf-parser-timeout')),25000);
   const abort=()=>reject(signal.reason??new Error('council-pdf-parser-aborted'));
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
   signal?.addEventListener('abort',abort,{once:true});
   worker.once('message',result=>{cleanup();result.error?reject(Object.assign(new Error(result.error),{code:result.error})):resolve(result.value);});
   worker.once('error',error=>{cleanup();reject(error);});
   worker.once('exit',code=>{cleanup();reject(new Error('council-pdf-parser-exit:'+code));});
   if(signal?.aborted)abort();
  });
 }finally{if(worker)await worker.terminate();active=false;}
}
if(!isMainThread&&workerData?.kind==='council-draft-pdf')void extractCouncilDraftPdfNative(Buffer.from(workerData.buffer),workerData.identity).then(value=>parentPort.postMessage({value}),error=>parentPort.postMessage({error:String(error.code??error.message).slice(0,250)}));
