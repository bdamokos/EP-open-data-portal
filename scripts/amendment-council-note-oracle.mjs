// Independent native PDF evidence: qpdf structure and Poppler word geometry.
// No producer, normalizer, parser or placer imports.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const key=s=>String(s??'').normalize('NFC').replace(/\s/gu,'');
const unknown=()=>({status:'unverified',reason:'oracle-council-pdf-note-proof-unavailable'});
const fail=()=>({status:'failed',reason:'oracle-council-pdf-note-proof-mismatch'});
export function councilNoteStructure(buffer) {
 if(!Buffer.isBuffer(buffer)||buffer.length>8*1024*1024)return null;
 let directory;
 try{
  directory=mkdtempSync(path.join(tmpdir(),'ep-council-native-'));
  const file=path.join(directory,'source.pdf');writeFileSync(file,buffer);
  const result=spawnSync('qpdf',['--json',file],{encoding:'utf8',timeout:25000,maxBuffer:32*1024*1024});
  if(result.status!==0)return null;
  const doc=JSON.parse(result.stdout),objects=doc.qpdf[1],pages=new Map(doc.pages.map((p,i)=>[p.object,i+1]));
  if(pages.size>100)return null;
  const lookup=v=>typeof v==='string'&&v.endsWith(' R')?objects['obj:'+v].value:v;
  const catalog=Object.values(objects).find(o=>o.value?.['/Type']==='/Catalog').value,tree=lookup(catalog['/StructTreeRoot']),roles=lookup(tree['/RoleMap']??{}),paragraphs=[],seen=new Set();let count=0;
  function walk(value,page=null,note=false){
   if(++count>100000)throw Error('native-limit');
   if(Array.isArray(value))return value.flatMap(v=>walk(v,page,note));
   if(Number.isSafeInteger(value)){if(value<0||!pages.has(page))throw Error('native-page');return [{page:pages.get(page),mcid:value}];}
   const ref=typeof value==='string'?value:null;if(ref){if(seen.has(ref))throw Error('native-cycle');seen.add(ref);}
   const node=lookup(value);if(!node||typeof node!=='object')throw Error('native-node');page=node['/Pg']??page;
   if(node['/Type']==='/MCR'){if(node['/Stm'])throw Error('native-form');return walk(node['/MCID'],page,note);}
   if(node['/Type']==='/OBJR')return [];
   const role=roles[node['/S']]??node['/S'],content=walk(node['/K']??[],page,note||role==='/Note');
   if(role==='/P')paragraphs.push({ref,note,pages:[...new Set(content.map(c=>c.page))],mcids:content});
   return content;
  }
  walk(tree['/K']);return paragraphs;
 }catch{return null;}finally{if(directory)rmSync(directory,{recursive:true,force:true});}
}
const decode=s=>s.replace(/&#(x[0-9a-f]+|\d+);/giu,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&lt;/gu,'<').replace(/&gt;/gu,'>').replace(/&quot;/gu,'"').replace(/&apos;/gu,"'").replace(/&amp;/gu,'&');
export function councilNoteGeometry(bbox) {
 try{
  if(typeof bbox!=='string'||bbox.length>4*1024*1024)return null;
  const pages=[...bbox.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/gu)];if(!pages.length||pages.length>100)return null;
  const words=[],notes=[];let total=0;
  const attribute=(s,name)=>Number(new RegExp('\\b'+name+'="([\\d.]+)"','u').exec(s)?.[1]);
  for(const [index,page] of pages.entries()){
   const local=[...page[2].matchAll(/<word\b([^>]*)>([^<]*)<\/word>/gu)].map(m=>({text:decode(m[2]),x:attribute(m[1],'xMin'),right:attribute(m[1],'xMax'),top:attribute(m[1],'yMin'),bottom:attribute(m[1],'yMax'),page:index+1}));
   if((total+=local.length)>250000||local.some(w=>![w.x,w.right,w.top,w.bottom].every(Number.isFinite)))return null;
   const heights=local.map(w=>w.bottom-w.top).filter(h=>h>0).sort((a,b)=>a-b),height=heights[Math.floor(heights.length/2)],left=Math.min(...local.map(w=>w.x)),pageHeight=attribute(page[1],'height');
   if(!height||!pageHeight)return null;
   const footers=local.filter(w=>/^\d{3,5}\/\d{2}$/u.test(w.text)&&w.top>pageHeight*.9&&Math.abs(w.x-left)<1);if(footers.length!==1)return null;
   const bottom=footers[0].top,small=w=>/^\d{1,3}$/u.test(w.text)&&w.bottom-w.top<height*.8;
   const labels=local.filter(w=>small(w)&&Math.abs(w.x-left)<1&&w.top>pageHeight*2/3&&w.top<bottom).sort((a,b)=>a.top-b.top);
   for(const [i,label] of labels.entries()){
    const end=labels[i+1]?.top??bottom,payload=local.filter(w=>w!==label&&w.top>=label.top-.5&&w.top<end-.5);
    notes.push({page:index+1,label:label.text,text:payload.map(w=>w.text).join(' ')});
   }
   const body=local.filter(w=>w.top<(labels[0]?.top??bottom)-.5);
   for(const [i,mark] of body.entries()){
    if(!small(mark)||mark.x-left<=1||labels.filter(n=>n.text===mark.text).length!==1)continue;
    const previous=body[i-1],next=body[i+1];
    if(previous&&next&&previous.bottom-previous.top>=height*.9&&mark.bottom<previous.bottom-1&&Math.abs(mark.top-previous.top)<=height&&mark.x-previous.right>=-.2&&mark.x-previous.right<=3)mark.reference=mark.text;
   }
   words.push(...body);
  }
  const references=new Map();for(const word of words)if(word.reference)references.set(word.reference,(references.get(word.reference)??0)+1);
  if(new Set(notes.map(n=>n.label)).size!==notes.length||notes.some(n=>!n.text||references.get(n.label)!==1))return null;
  return {words,notes};
 }catch{return null;}
}
function column(text,formatting=[]) {
 if(typeof text!=='string'||text.length>64*1024)return null;
 const dividers=[...text.matchAll(/\n_{3,}[ \t]*\n/gu)];if(dividers.length!==1)return null;
 const end=dividers[0].index,body=text.slice(0,end),lines=text.slice(end+dividers[0][0].length).split('\n').filter(line=>line.trim());
 const first=/^\s*([1-9]\d*)\.?\s+(.+)$/u.exec(lines[0]??'');if(!first||lines.slice(1).some(line=>/^\s*\d+\.?\s/u.test(line)))return null;
 const marks=formatting.filter(m=>m.kind==='superscript'&&m.start<body.length);
 if(marks.length!==1)return null;
 const mark=marks[0];if(![mark.start,mark.end].every(Number.isSafeInteger)||mark.start<0||mark.end<=mark.start||mark.end>body.length||body.slice(mark.start,mark.end)!==first[1])return null;
 const prefix=body.slice(0,mark.start),clean=prefix+body.slice(mark.end);
 return {end,body,clean,prefix,label:first[1],note:[first[2],...lines.slice(1)].join('\n')};
}
// One punctuation typo outside an unchanged URI; words, identifiers, digits,
// signs and URL punctuation are never removed to make a citation agree.
function sameCitation(a,b) {
 const urls=s=>s.match(/https?:\/\/[^\s)]+/giu)??[];
 if(JSON.stringify(urls(a))!==JSON.stringify(urls(b)))return false;
 const x=key(a.replace(/https?:\/\/[^\s)]+/giu,'§')),y=key(b.replace(/https?:\/\/[^\s)]+/giu,'§'));if(x===y)return true;
 const longer=x.length>y.length?x:y,shorter=x.length>y.length?y:x;
 if(longer.length!==shorter.length+1)return false;
 for(let i=0;i<longer.length;i++)if(/[.,;]/u.test(longer[i])&&longer.slice(0,i)+longer.slice(i+1)===shorter&&!(/\d/u.test(longer[i-1]??'')&&/\d/u.test(longer[i+1]??'')))return true;
 return false;
}
// A whole institutional reference may be absent only from the owned note,
// while the exact same reference is retained once in its native body. All
// other note characters and the literal URI must agree; no typo composition.
function nativeOmittedReference(note,reported,body) {
 const references=text=>[...text.matchAll(/(?<![\p{L}\p{N}])([A-Z]{1,4})\s*\(\s*(\d{4})\s*\)\s*(\d{1,6})(?![\p{L}\p{N}])/gu)];
 const urls=text=>text.match(/https?:\/\/[^\s)]+/giu)??[];
 if(JSON.stringify(urls(note))!==JSON.stringify(urls(reported)))return false;
 const bodyRefs=references(body),ids=references(note);if(ids.length>8)return false;
 const matches=ids.filter(ref=>bodyRefs.filter(candidate=>key(candidate[0])===key(ref[0])).length===1&&key(note.slice(0,ref.index)+note.slice(ref.index+ref[0].length))===key(reported));
 return matches.length===1;
}
export function inspectCouncilPdfNoteScope({bbox,structure,placement,wording,items}) {
 const native=councilNoteGeometry(bbox),old=column(wording.originalText,wording.originalFormatting),next=column(wording.proposedText,wording.proposedFormatting),proposal=items?.[placement.itemIndex]?.proposal;
 const target=/^(?:Recital|Bod odůvodnění|Betragtning|Considerando)\s+(\d+)$/iu.exec(wording.targetLabel??'');
 if(!native||!Array.isArray(structure)||!old||!next||!target||old.label!==next.label||proposal?.sourceKind!=='pdf'||placement.operation!=='replace')return unknown();
 const {span,splice}=placement;if(!span||!splice||!Number.isSafeInteger(span.start)||span.start!==span.end||span.start<0||splice.start?.paragraph!==span.start||splice.end?.paragraph!==span.start||splice.start?.offset!==0)return fail();
 const row=proposal.paragraphs[span.start];if(!row?.complete||row.source?.complete!==true||splice.end.offset!==row.text.length)return fail();
 const labels=native.words.flatMap((w,i)=>/^\(\d+[a-z]?\)$/u.test(w.text)?[{text:w.text,index:i}]:[]),found=labels.filter(l=>l.text==='('+target[1]+')'),first=labels.find(l=>l.text==='(1)');
 if(found.length!==1||!first)return unknown();
 const index=labels.indexOf(found[0]),end=labels[index+1]?.index;if(end===undefined||first.index>found[0].index)return unknown();
 const unit=native.words.slice(found[0].index,end),refs=unit.filter(w=>w.reference),body=unit.filter(w=>!w.reference).map(w=>w.text).join(' '),pages=[...new Set(unit.map(w=>w.page))];
 if(pages.length!==1||refs.length!==1||refs[0].reference!==old.label||key(body)!==key(old.clean)||key(row.text)!==key(body))return fail();
 const prefix=key(native.words.slice(first.index,end).filter(w=>!w.reference).map(w=>w.text).join(' ')),joined=proposal.paragraphs.map(p=>key(p.text)).join(''),start=joined.indexOf(prefix);
 const actualEnd=proposal.paragraphs.slice(0,span.start+1).reduce((n,p)=>n+key(p.text).length,0);
 if(start<0||joined.lastIndexOf(prefix)!==start||actualEnd!==start+prefix.length)return fail();
 const source=structure.find(p=>p.ref===row.source.path&&!p.note),notes=structure.filter(p=>p.note&&p.pages.includes(pages[0])),printed=native.notes.filter(n=>n.page===pages[0]);
 if(!source||JSON.stringify(source.pages)!==JSON.stringify(pages)||JSON.stringify(source.mcids)!==JSON.stringify(row.source.mcids)||notes.length!==1||printed.length!==1||printed[0].label!==old.label)return unknown();
 const anchors=(proposal.anchors??[]).filter(a=>a.paragraph===span.start),note=(proposal.notes??[]).filter(n=>n.label===old.label);
 if(anchors.length!==1||note.length!==1||!note[0].complete||note[0].source?.path!==notes[0].ref||anchors[0].label!==old.label||anchors[0].note!==note[0].id||!Number.isSafeInteger(anchors[0].offset)||anchors[0].offset<0||anchors[0].offset>row.text.length)return fail();
 const nativePrefix=unit.slice(0,unit.indexOf(refs[0])).filter(w=>!w.reference).map(w=>w.text).join(' ');
 if(row.text.slice(0,anchors[0].offset).trimEnd().length!==anchors[0].offset||key(row.text.slice(0,anchors[0].offset))!==key(nativePrefix)||key(old.prefix)!==key(nativePrefix)||key(note[0].text)!==key(printed[0].text))return fail();
 const omitted=!sameCitation(printed[0].text,old.note);
 if(omitted&&!nativeOmittedReference(printed[0].text,old.note,body)||placement.originalDifference!==(omitted?'omitted-citation-identifier':undefined))return fail();
 const noteScope={kind:'pdf-footnotes',originalBodyEnd:old.end,proposedBodyEnd:next.end,sourceNotes:[{id:note[0].id,label:old.label}],proposedLabels:[next.label],unreferencedLabels:[]};
 if(placement.noteScope&&(Object.keys(placement.noteScope).length!==Object.keys(noteScope).length||Object.entries(noteScope).some(([name,value])=>JSON.stringify(placement.noteScope[name])!==JSON.stringify(value))))return fail();
 return {status:'verified',reason:omitted?'native-council-pdf-omitted-citation-identifier':'native-council-pdf-body-and-owned-note',noteScope,bodyWording:{...wording,originalText:old.clean,originalFormatting:[],proposedText:next.body,proposedFormatting:(wording.proposedFormatting??[]).filter(m=>m.end<=next.end)}};
}
