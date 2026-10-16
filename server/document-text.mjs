import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFile,mkdir,writeFile,rename } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { XMLParser,XMLValidator } from 'fast-xml-parser';
import { boundedUpstream } from './odp.mjs';
import { documentFiles,array,tail } from './activity-index-model.mjs';
import { languageCode } from './ep-links.mjs';
import {numberingLabels} from './docx-numbering.mjs';

const MAX_FILE=8*1024*1024,MAX_XML=4*1024*1024,DAY=86400000;
// 5: automatic numbering, endnotes and completeness gaps, retaining v4 citation spans.
const EXTRACTION_VERSION=5;
const NOTE_LIMITS=Object.freeze({notes:500,text:4000,links:10,documentLinks:500});
const memory=new Map(),pending=new Map(),failures=new Map();
const DOCX_PARTS=['word/document.xml','word/styles.xml','word/numbering.xml','word/_rels/document.xml.rels','word/footnotes.xml','word/_rels/footnotes.xml.rels','word/endnotes.xml','word/_rels/endnotes.xml.rels'];
// Read only standard text, style, numbering, note and relationship parts. No archive paths are written to disk.
function docxParts(buffer) {
  if(buffer.length>MAX_FILE || buffer.length<22)throw new Error('DOCX size is unsupported.');
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('Invalid DOCX archive.');
  if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))throw new Error('Multipart DOCX is unsupported.');
  const count=buffer.readUInt16LE(end+10);let cursor=buffer.readUInt32LE(end+16),total=0;
  const parts=new Map();
  if(count>2000)throw new Error('DOCX contains too many entries.');
  for(let i=0;i<count;i++) {
    if(cursor+46>buffer.length || buffer.readUInt32LE(cursor)!==0x02014b50)throw new Error('Invalid DOCX directory.');
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),compressed=buffer.readUInt32LE(cursor+20),size=buffer.readUInt32LE(cursor+24);
    const nameLength=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32),offset=buffer.readUInt32LE(cursor+42);
    const name=buffer.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    cursor+=46+nameLength+extra+comment;
    if(!DOCX_PARTS.includes(name))continue;
    total+=size;
    if(parts.has(name) || flags&1 || total>MAX_XML || compressed>MAX_FILE || offset+30>buffer.length || buffer.readUInt32LE(offset)!==0x04034b50)throw new Error('Unsupported DOCX document entry.');
    const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28);
    if(start+compressed>buffer.length)throw new Error('Truncated DOCX entry.');
    const bytes=buffer.subarray(start,start+compressed);
    const decoded=method===0?bytes:method===8?inflateRawSync(bytes,{maxOutputLength:MAX_XML}):null;
    if(!decoded || decoded.length!==size)throw new Error('Invalid DOCX compression.');
    const xml=decoded.toString('utf8');
    if(!xml || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true)throw new Error('Invalid DOCX document XML.');
    parts.set(name,xml);
  }
  if(!parts.has('word/document.xml'))throw new Error('Invalid DOCX document XML.');
  return parts;
}
const child=(nodes,key)=>nodes?.find(node=>Object.hasOwn(node,key));
const children=(nodes,key)=>child(nodes,key)?.[key];
const attribute=(node,key)=>node?.[':@']?.['@_w:'+key];
const rawAttribute=(node,name)=>node?.[':@']?.['@_'+name];
const property=(nodes,key)=>attribute(child(nodes,key),'val');
function hiddenValue(properties) {
  const node=child(properties,'w:vanish');
  return node ? !['0','false','off'].includes(String(attribute(node,'val')).toLowerCase()) : undefined;
}
const parser=()=>new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
const noteMarks=['w:footnoteReference','w:footnoteRef','w:endnoteReference','w:endnoteRef'];
function externalLinks(xml) {
  const links=new Map();if(!xml)return links;
  for(const node of children(parser().parse(xml),'Relationships')||[])if(node.Relationship) {
    const id=rawAttribute(node,'Id'),target=rawAttribute(node,'Target');
    if(rawAttribute(node,'TargetMode')==='External'&&typeof target==='string'&&target.length<=500&&/^https?:\/\//i.test(target))links.set(id,target);
  }
  return links;
}
function styleVisibility(stylesXml) {
  const styles=children(stylesXml?parser().parse(stylesXml):[],'w:styles') || [];
  const byId=new Map(styles.filter(node=>node['w:style']).map(node=>[attribute(node,'styleId'),{
    parent:property(node['w:style'],'w:basedOn'),toggle:hiddenValue(children(node['w:style'],'w:rPr'))===true,
  }]));
  const defaultStyle=type=>attribute(styles.find(node=>node['w:style'] && attribute(node,'type')===type && ['1','true','on'].includes(String(attribute(node,'default')))),'styleId');
  const defaultParagraph=defaultStyle('paragraph'),defaultCharacter=defaultStyle('character'),styleToggles=new Map();
  const defaults=hiddenValue(children(children(children(styles,'w:docDefaults'),'w:rPrDefault'),'w:rPr')) ?? false;
  function styledHidden(id,inherited) {
    if(styleToggles.has(id))return inherited!==styleToggles.get(id);
    if(!byId.has(id))return inherited;
    const chain=[],seen=new Set();
    while(byId.has(id) && !styleToggles.has(id)) {
      if(seen.has(id))throw new Error('Cyclic DOCX style inheritance is unsupported.');
      seen.add(id);chain.push(id);id=byId.get(id).parent;
    }
    // In styles, an enabled vanish toggles the inherited value; direct run
    // formatting below is absolute, including an explicit w:val="0".
    let toggle=styleToggles.get(id) ?? false;
    for(const styleId of chain.reverse()) {toggle=toggle!==byId.get(styleId).toggle;styleToggles.set(styleId,toggle);}
    return inherited!==toggle;
  }
  return {styledHidden,defaultParagraph,defaultCharacter,defaults};
}
// Footnote markers are recorded at their position instead of gluing their number to the text;
// hyperlinks keep the exact span they cover, so the document itself identifies what a link names.
function inline(nodes,hidden,out,context) {
  for(const node of nodes || [])for(const [key,value] of Object.entries(node)) {
    if(key===':@')continue;
    if(key==='w:r') {
      const properties=children(value,'w:rPr');
      if(hiddenValue(properties) ?? context.style.styledHidden(property(properties,'w:rStyle') || context.style.defaultCharacter,hidden))continue;
      if(!value.some(item=>noteMarks.some(mark=>mark in item))){inline(value,false,out,context);continue;}
      // Children keep their order. Only the text that immediately follows a custom-marked reference is its label.
      let pending=null;
      for(const item of value) {
        const kind=noteMarks.find(name=>name in item);
        if(kind){pending={kind,id:String(attribute(item,'id')??''),label:'',custom:['1','true','on'].includes(String(attribute(item,'customMarkFollows'))),offset:out.text.length};out.marks.push(pending);if(!pending.custom)pending=null;continue;}
        if(pending&&'w:t' in item){const label={text:'',marks:[],spans:[]};inline([item],false,label,context);pending.label=label.text.trim();pending=null;continue;}
        inline([item],false,out,context);
      }
    }
    else if(key==='#text')out.text+=String(value);
    else if(key==='w:tab')out.text+='\t';
    else if(key==='w:br'||key==='w:cr')out.text+='\n';
    else if(key==='w:noBreakHyphen')out.text+='‑';
    else if(key==='w:softHyphen')out.text+='­';
    else if(key==='w:hyperlink'&&Array.isArray(value)){const target=context.links.get(rawAttribute(node,'r:id')),start=out.text.length;inline(value,hidden,out,context);if(target&&out.text.length>start)out.spans.push({start,end:out.text.length,url:target});}
    else if(!['w:del','w:instrText','w:pPr','w:rPr'].includes(key) && Array.isArray(value))inline(value,hidden,out,context);
  }
}
function paragraphsOf(nodes,context,result=[]) {
  for(const node of nodes || [])for(const [key,value] of Object.entries(node)) {
    if(key==='w:p'){
      const out={text:'',marks:[],spans:[]};
      inline(value,context.style.styledHidden(property(children(value,'w:pPr'),'w:pStyle') || context.style.defaultParagraph,context.style.defaults),out,context);
      const label=out.text.trim()?context.numberLabel?.(children(value,'w:pPr')):null;
      if(label){const prefix=label+'\t';out.text=prefix+out.text;for(const mark of out.marks)mark.offset+=prefix.length;for(const span of out.spans){span.start+=prefix.length;span.end+=prefix.length;}}
      const text=out.text.trim(),lead=out.text.length-out.text.trimStart().length,at=offset=>Math.max(0,Math.min(text.length,offset-lead));
      if(text)result.push({text,marks:out.marks.map(mark=>({...mark,offset:at(mark.offset)})),spans:out.spans.map(span=>({start:at(span.start),end:at(span.end),url:span.url})).filter(span=>span.end>span.start)});
    }
    else if(key!==':@'&&Array.isArray(value))paragraphsOf(value,context,result);
  }
  return result;
}
// Paragraphs stay plain strings. Footnotes and links are returned separately with exact positions.
export function docxContent(buffer) {
  const parts=docxParts(buffer),style=styleVisibility(parts.get('word/styles.xml')),warnings=new Set();
  const numberLabel=numberingLabels(parts.get('word/numbering.xml'),parts.get('word/styles.xml'),warnings);
  const body=paragraphsOf(parser().parse(parts.get('word/document.xml')),{style,numberLabel,links:externalLinks(parts.get('word/_rels/document.xml.rels'))});
  if(!body.length || body.length>20000 || body.map(p=>p.text).join('\n').length>2*1024*1024)throw new Error('DOCX text is empty or exceeds the supported size.');
  const supplied=new Map();
  for(const kind of ['footnote','endnote'])if(parts.has('word/'+kind+'s.xml')) {
    const context={style,numberLabel,links:externalLinks(parts.get('word/_rels/'+kind+'s.xml.rels'))};
    for(const node of children(parser().parse(parts.get('word/'+kind+'s.xml')),'w:'+kind+'s')||[]) {
      if(!node['w:'+kind]||!['normal',undefined].includes(attribute(node,'type')))continue;
      const paragraphs=paragraphsOf(node['w:'+kind],context),spans=[];let offset=0;
      for(const part of paragraphs){spans.push(...part.spans.map(span=>({...span,start:span.start+offset,end:span.end+offset})));offset+=part.text.length+1;}
      const text=paragraphs.map(p=>p.text).join('\n').slice(0,NOTE_LIMITS.text);
      const key=(kind==='endnote'?'endnote:':'')+String(attribute(node,'id'));
      supplied.set(key,{text,truncated:offset-1>NOTE_LIMITS.text,spans:spans.filter(span=>span.end<=text.length).slice(0,NOTE_LIMITS.links)});
    }
  }
  const notes=[],anchors=[];
  body.forEach((paragraph,index)=>{for(const mark of paragraph.marks) {
    if(!['w:footnoteReference','w:endnoteReference'].includes(mark.kind))continue;
    const id=(mark.kind==='w:endnoteReference'?'endnote:':'')+mark.id;
    if(!supplied.has(id)){warnings.add('A referenced footnote or endnote is missing.');continue;}
    let note=notes.find(n=>n.id===id);
    if(!note){
      if(notes.length>=NOTE_LIMITS.notes){warnings.add('The referenced notes exceed the supported note count.');continue;}
      const label=mark.label||String(notes.length+1),source=supplied.get(id);
      if(source.truncated)warnings.add('A referenced note exceeds the supported text size.');
      if(!source.text)warnings.add('A referenced footnote or endnote is empty.');
      // A custom mark repeats its label as ordinary footnote text; automatic numbering does not.
      const text=mark.custom&&mark.label&&source.text.startsWith(label)&&/^[\s.)]/.test(source.text.slice(label.length))?source.text.slice(label.length).replace(/^[\s.)]+/,''):source.text,removed=source.text.length-text.length;
      const linkSpans=source.spans.map(span=>({...span,start:span.start-removed,end:span.end-removed})).filter(span=>span.start>=0);
      note={id,label,text,links:[...new Set(source.spans.map(span=>span.url))],linkSpans};notes.push(note);
    }
    anchors.push({paragraph:index,offset:mark.offset,note:note.id,label:note.label});
  }});
  const links=body.flatMap((paragraph,index)=>paragraph.spans.map(span=>({paragraph:index,...span}))).slice(0,NOTE_LIMITS.documentLinks);
  return {paragraphs:body.map(p=>p.text),notes,anchors,links,extractionWarnings:[...warnings]};
}
export const docxParagraphs=buffer=>docxContent(buffer).paragraphs;

export function allowedDownload(value) {
  try {const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && !u.port && !u.hash && !u.search &&
    ((u.hostname==='data.europarl.europa.eu' && u.pathname.startsWith('/distribution/')) || (u.hostname==='redmapl3.europarl.europa.eu' && u.pathname.startsWith('/RedmapFront/media/')))
    && u.pathname.endsWith('.docx');}catch{return false;}
}
export async function downloadDocx(sourceUrl) {
  let url=sourceUrl;
  for(let hop=0;hop<4;hop++) {
    if(!allowedDownload(url))throw new Error('Unapproved official document download URL.');
    // This published distribution route returns 500 to Node fetch but a normal
    // 302 to Node HTTPS/Python. Use standard HTTPS without browser impersonation.
    const response=await new Promise((resolve,reject)=>https.get(url,{headers:{Accept:'*/*','User-Agent':'EP-Exhibition-PoC/0.1'},signal:AbortSignal.timeout(25000)},resolve).on('error',reject));
    if([301,302,303,307,308].includes(response.statusCode)){const target=response.headers.location;response.resume();if(!target)throw new Error('Invalid document redirect.');url=new URL(target,url).href;continue;}
    if(response.statusCode!==200){response.resume();throw new Error(`Official document download unavailable (${response.statusCode}).`);}
    if(!/(?:officedocument.wordprocessingml|octet-stream)/i.test(response.headers['content-type'] || '')){response.destroy();throw new Error('Unexpected document download format.');}
    const chunks=[];let size=0;
    for await(const chunk of response){size+=chunk.length;if(size>MAX_FILE){response.destroy();throw new Error('Official document exceeds 8 MiB.');}chunks.push(chunk);}
    return {...docxContent(Buffer.concat(chunks)),resolvedSourceUrl:url};
  }
  throw new Error('Too many document download redirects.');
}

const validSpan=(span,text)=>Number.isInteger(span?.start)&&Number.isInteger(span.end)&&span.start>=0&&span.end>span.start&&span.end<=text.length&&typeof span.url==='string'&&/^https?:\/\//i.test(span.url);
export function documentNotes(record) {
  const paragraphs=record?.paragraphs||[];
  const valid=Array.isArray(record?.notes)&&Array.isArray(record.anchors)&&Array.isArray(record.links)
    &&record.notes.every(n=>typeof n?.id==='string'&&typeof n.label==='string'&&typeof n.text==='string'&&Array.isArray(n.links)&&Array.isArray(n.linkSpans)&&n.linkSpans.every(span=>validSpan(span,n.text)))
    &&record.anchors.every(a=>Number.isInteger(a?.paragraph)&&a.paragraph>=0&&a.paragraph<paragraphs.length&&Number.isInteger(a.offset)&&a.offset>=0&&a.offset<=paragraphs[a.paragraph].length&&record.notes.some(n=>n.id===a.note))
    &&record.links.every(link=>Number.isInteger(link?.paragraph)&&link.paragraph>=0&&link.paragraph<paragraphs.length&&validSpan(link,paragraphs[link.paragraph]));
  return valid?{notesStatus:'extracted',notes:record.notes,noteAnchors:record.anchors,documentLinks:record.links}:{notesStatus:'not-extracted',notes:[],noteAnchors:[],documentLinks:[]};
}
export async function documentText(work,language,{directory=process.env.ODP_CACHE_DIR,download=downloadDocx,clock=Date.now}={}) {
  const files=documentFiles(work).filter(f=>f.format==='DOCX' && allowedDownload(f.url));
  const languages=[...new Set(files.map(f=>f.language).filter(Boolean))];
  const originals=array(work.originalLanguage).map(languageCode);
  const chosen=files.find(f=>f.language===language) || files.find(f=>originals.includes(f.language)) || files.find(f=>f.language==='en') || files[0];
  const base={status:'unavailable',paragraphs:[],extractionWarnings:[],notesStatus:'not-extracted',notes:[],noteAnchors:[],documentLinks:[],textLanguage:chosen?.language || null,requestedLanguage:language,availableTextLanguages:languages,translationType:chosen?originals.includes(chosen.language)?'original':'unspecified':null,sourceFormat:chosen?'DOCX':null,sourceUrl:chosen?.url || null,fetchedAt:null,stale:false,refreshInProgress:false,refreshError:null,nextRetryAt:null,reason:null,extraction:chosen?'official-docx-paragraphs':null};
  if(!chosen)return {...base,reason:'No supported DOCX text file is supplied for this publication.'};
  const key=chosen.url,file=directory && path.join(directory,'document-text-v1',createHash('sha256').update(key).digest('hex')+'.json');
  let saved=memory.get(key);
  if(!saved && file)try{const record=JSON.parse(await readFile(file,'utf8'));if(record.schemaVersion===1 && record.extractionVersion===EXTRACTION_VERSION && record.sourceUrl===key && Number.isFinite(Date.parse(record.fetchedAt)) && Array.isArray(record.paragraphs) && record.paragraphs.every(p=>typeof p==='string')){saved=record;memory.set(key,record);}}catch{}
  const refresh=priority=> {
    if(pending.has(key))return pending.get(key);
    const job=boundedUpstream(async()=>{
      const result=await download(key),record={schemaVersion:1,extractionVersion:EXTRACTION_VERSION,sourceId:work.identifier || tail(work.id),sourceUrl:key,fetchedAt:new Date(clock()).toISOString(),...result};
      if(file){await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';await writeFile(temp,JSON.stringify(record));await rename(temp,file);}
      memory.set(key,record);if(memory.size>100)memory.delete(memory.keys().next().value);failures.delete(key);return record;
    },{priority}).catch(error=>{failures.set(key,{retryAt:clock()+30000,message:String(error.message).slice(0,250)});throw error;}).finally(()=>pending.delete(key));
    pending.set(key,job);return job;
  };
  const failure=failures.get(key);
  const present=record=>({...base,status:'available',paragraphs:record.paragraphs,...documentNotes(record),extractionWarnings:record.extractionWarnings || [],fetchedAt:record.fetchedAt});
  if(saved){const stale=clock()-Date.parse(saved.fetchedAt)>=DAY;if(stale && (!failure || failure.retryAt<=clock()))void refresh('background').catch(()=>{});return {...present(saved),stale,refreshInProgress:pending.has(key),refreshError:failure?.message || null};}
  if(failure?.retryAt>clock())return {...base,status:'error',reason:failure.message,refreshError:failure.message,nextRetryAt:new Date(failure.retryAt).toISOString()};
  try {const record=await refresh('interactive');return present(record);}
  catch(error){return {...base,status:'error',reason:String(error.message).slice(0,250),refreshError:String(error.message).slice(0,250),nextRetryAt:new Date(failures.get(key).retryAt).toISOString()};}
}
