import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFile,mkdir,writeFile,rename } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { XMLParser,XMLValidator } from 'fast-xml-parser';
import { boundedUpstream } from './odp.mjs';
import { documentFiles,array,tail } from './activity-index-model.mjs';
import { languageCode } from './ep-links.mjs';

const MAX_FILE=8*1024*1024,MAX_XML=4*1024*1024,DAY=86400000;
const memory=new Map(),pending=new Map(),failures=new Map();
const NOTE_LIMITS=Object.freeze({notes:500,text:4000,links:10,documentLinks:500});
// Read only standard Word entries. No archive paths are written to disk.
function archiveEntries(buffer,wanted) {
  if(buffer.length>MAX_FILE || buffer.length<22)throw new Error('DOCX size is unsupported.');
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('Invalid DOCX archive.');
  if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))throw new Error('Multipart DOCX is unsupported.');
  const count=buffer.readUInt16LE(end+10),entries=new Map();let cursor=buffer.readUInt32LE(end+16);
  if(count>2000)throw new Error('DOCX contains too many entries.');
  for(let i=0;i<count;i++) {
    if(cursor+46>buffer.length || buffer.readUInt32LE(cursor)!==0x02014b50)throw new Error('Invalid DOCX directory.');
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),compressed=buffer.readUInt32LE(cursor+20),size=buffer.readUInt32LE(cursor+24);
    const nameLength=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32),offset=buffer.readUInt32LE(cursor+42);
    const name=buffer.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    cursor+=46+nameLength+extra+comment;
    if(!wanted.includes(name))continue;
    if(entries.has(name) || flags&1 || size>MAX_XML || compressed>MAX_FILE || offset+30>buffer.length || buffer.readUInt32LE(offset)!==0x04034b50)throw new Error('Unsupported DOCX document entry.');
    const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28);
    if(start+compressed>buffer.length)throw new Error('Truncated DOCX entry.');
    const bytes=buffer.subarray(start,start+compressed);
    const decoded=method===0?bytes:method===8?inflateRawSync(bytes,{maxOutputLength:MAX_XML}):null;
    if(!decoded || decoded.length!==size)throw new Error('Invalid DOCX compression.');
    entries.set(name,decoded.toString('utf8'));
  }
  return entries;
}
function parseXml(xml) {
  if(/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true)throw new Error('Invalid DOCX document XML.');
  return new XMLParser({preserveOrder:true,ignoreAttributes:false,attributeNamePrefix:'',parseTagValue:false,trimValues:false}).parse(xml);
}
const attribute=(node,name)=>node[':@']?.[name];
const noteMarks=['w:footnoteReference','w:footnoteRef','w:endnoteReference','w:endnoteRef'];
// A footnote run carries the marker only. Record its position instead of gluing its number to the text.
function inline(nodes,out,links) {
  for(const node of nodes || [])for(const [key,value] of Object.entries(node)) {
    if(key===':@')continue;
    if(key==='#text')out.text+=String(value);
    else if(key==='w:tab')out.text+='\t';
    else if(key==='w:br'||key==='w:cr')out.text+='\n';
    else if(key==='w:r'&&Array.isArray(value)&&value.some(child=>noteMarks.some(mark=>mark in child))) {
      // Children keep their order. Only the text that immediately follows a custom-marked reference is its label.
      let pending=null;
      for(const child of value) {
        const kind=noteMarks.find(name=>name in child);
        if(kind){pending={kind,id:String(attribute(child,'w:id')??''),label:'',custom:['1','true','on'].includes(String(attribute(child,'w:customMarkFollows'))),offset:out.text.length};out.marks.push(pending);if(!pending.custom)pending=null;continue;}
        if(pending&&'w:t' in child){const label={text:''};inline([child],label,null);pending.label=label.text.trim();pending=null;continue;}
        inline([child],out,links);
      }
    }
    // The linked text span is kept with its target, so the document itself identifies what a link names.
    else if(key==='w:hyperlink'&&links&&Array.isArray(value)){const target=links.get(attribute(node,'r:id')),start=out.text.length;inline(value,out,links);if(target&&out.text.length>start)out.spans.push({start,end:out.text.length,url:target});}
    else if(!['w:del','w:instrText','w:pPr','w:rPr'].includes(key) && Array.isArray(value))inline(value,out,links);
  }
}
function paragraphsOf(nodes,links,result=[]) {
  for(const node of nodes || [])for(const [key,value] of Object.entries(node)) {
    if(key==='w:p'){
      const out={text:'',marks:[],spans:[]};inline(value,out,links);
      const text=out.text.trim(),lead=out.text.length-out.text.trimStart().length,at=offset=>Math.max(0,Math.min(text.length,offset-lead));
      if(text)result.push({text,marks:out.marks.map(mark=>({...mark,offset:at(mark.offset)})),spans:out.spans.map(span=>({start:at(span.start),end:at(span.end),url:span.url})).filter(span=>span.end>span.start)});
    }
    else if(key!==':@'&&Array.isArray(value))paragraphsOf(value,links,result);
  }
  return result;
}
function externalLinks(xml) {
  const links=new Map();if(!xml)return links;
  for(const node of parseXml(xml).flatMap(root=>root.Relationships||[]))if(node.Relationship) {
    const id=attribute(node,'Id'),target=attribute(node,'Target');
    if(attribute(node,'TargetMode')==='External'&&typeof target==='string'&&target.length<=500&&/^https?:\/\//i.test(target))links.set(id,target);
  }
  return links;
}
// Paragraphs stay plain strings. Footnotes are returned separately with exact marker positions.
export function docxContent(buffer) {
  const entries=archiveEntries(buffer,['word/document.xml','word/_rels/document.xml.rels','word/footnotes.xml','word/_rels/footnotes.xml.rels']),xml=entries.get('word/document.xml');
  if(!xml)throw new Error('Invalid DOCX document XML.');
  const body=paragraphsOf(parseXml(xml),externalLinks(entries.get('word/_rels/document.xml.rels')));
  if(!body.length || body.length>20000 || body.map(p=>p.text).join('\n').length>2*1024*1024)throw new Error('DOCX text is empty or exceeds the supported size.');
  const supplied=new Map();
  if(entries.has('word/footnotes.xml')) {
    const links=externalLinks(entries.get('word/_rels/footnotes.xml.rels'));
    for(const root of parseXml(entries.get('word/footnotes.xml')))for(const node of root['w:footnotes']||[]) {
      if(!node['w:footnote']||attribute(node,'w:type'))continue;
      const parts=paragraphsOf(node['w:footnote'],links),spans=[];let offset=0;
      for(const part of parts){spans.push(...part.spans.map(span=>({...span,start:span.start+offset,end:span.end+offset})));offset+=part.text.length+1;}
      const text=parts.map(p=>p.text).join('\n').slice(0,NOTE_LIMITS.text);
      supplied.set(String(attribute(node,'w:id')),{text,spans:spans.filter(span=>span.end<=text.length).slice(0,NOTE_LIMITS.links)});
    }
  }
  const notes=[],anchors=[];
  body.forEach((paragraph,index)=>{for(const mark of paragraph.marks) {
    if(mark.kind!=='w:footnoteReference'||!supplied.has(mark.id))continue;
    let note=notes.find(n=>n.id===mark.id);
    if(!note){
      if(notes.length>=NOTE_LIMITS.notes)continue;
      const label=mark.label||String(notes.length+1),source=supplied.get(mark.id);
      // A custom mark repeats its label as ordinary footnote text; automatic numbering does not.
      const text=mark.custom&&mark.label&&source.text.startsWith(label)&&/^[\s.)]/.test(source.text.slice(label.length))?source.text.slice(label.length).replace(/^[\s.)]+/,''):source.text,removed=source.text.length-text.length;
      const linkSpans=source.spans.map(span=>({...span,start:span.start-removed,end:span.end-removed})).filter(span=>span.start>=0);
      note={id:mark.id,label,text,links:[...new Set(source.spans.map(span=>span.url))],linkSpans};notes.push(note);
    }
    anchors.push({paragraph:index,offset:mark.offset,note:note.id,label:note.label});
  }});
  const links=body.flatMap((paragraph,index)=>paragraph.spans.map(span=>({paragraph:index,...span}))).slice(0,NOTE_LIMITS.documentLinks);
  return {paragraphs:body.map(p=>p.text),notes,anchors,links};
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

// Records saved before footnote and hyperlink extraction keep serving text; their notes are reported as not extracted.
const EXTRACTION_VERSION=3;
const validSpan=(span,text)=>Number.isInteger(span?.start)&&Number.isInteger(span.end)&&span.start>=0&&span.end>span.start&&span.end<=text.length&&typeof span.url==='string'&&/^https?:\/\//i.test(span.url);
export function documentNotes(record) {
  const paragraphs=record?.paragraphs||[];
  const valid=record?.extractionVersion===EXTRACTION_VERSION&&Array.isArray(record.notes)&&Array.isArray(record.anchors)&&Array.isArray(record.links)
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
  const base={status:'unavailable',paragraphs:[],notesStatus:'not-extracted',notes:[],noteAnchors:[],documentLinks:[],textLanguage:chosen?.language || null,requestedLanguage:language,availableTextLanguages:languages,translationType:chosen?originals.includes(chosen.language)?'original':'unspecified':null,sourceFormat:chosen?'DOCX':null,sourceUrl:chosen?.url || null,fetchedAt:null,stale:false,refreshInProgress:false,refreshError:null,nextRetryAt:null,reason:null,extraction:chosen?'official-docx-paragraphs':null};
  if(!chosen)return {...base,reason:'No supported DOCX text file is supplied for this publication.'};
  const key=chosen.url,file=directory && path.join(directory,'document-text-v1',createHash('sha256').update(key).digest('hex')+'.json');
  let saved=memory.get(key);
  if(!saved && file)try{const record=JSON.parse(await readFile(file,'utf8'));if(record.schemaVersion===1 && record.sourceUrl===key && Number.isFinite(Date.parse(record.fetchedAt)) && Array.isArray(record.paragraphs) && record.paragraphs.every(p=>typeof p==='string')){saved=record;memory.set(key,record);}}catch{}
  const refresh=priority=> {
    if(pending.has(key))return pending.get(key);
    const job=boundedUpstream(async()=>{
      const result=await download(key),record={schemaVersion:1,...(Array.isArray(result.notes)?{extractionVersion:EXTRACTION_VERSION}:{}),sourceId:work.identifier || tail(work.id),sourceUrl:key,fetchedAt:new Date(clock()).toISOString(),...result};
      if(file){await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';await writeFile(temp,JSON.stringify(record));await rename(temp,file);}
      memory.set(key,record);if(memory.size>100)memory.delete(memory.keys().next().value);failures.delete(key);return record;
    },{priority}).catch(error=>{failures.set(key,{retryAt:clock()+30000,message:String(error.message).slice(0,250)});throw error;}).finally(()=>pending.delete(key));
    pending.set(key,job);return job;
  };
  const failure=failures.get(key);
  if(saved){const stale=clock()-Date.parse(saved.fetchedAt)>=DAY,notes=documentNotes(saved);if((stale||notes.notesStatus!=='extracted') && (!failure || failure.retryAt<=clock()))void refresh('background').catch(()=>{});return {...base,status:'available',paragraphs:saved.paragraphs,...notes,fetchedAt:saved.fetchedAt,stale,refreshInProgress:pending.has(key),refreshError:failure?.message || null};}
  if(failure?.retryAt>clock())return {...base,status:'error',reason:failure.message,refreshError:failure.message,nextRetryAt:new Date(failure.retryAt).toISOString()};
  try {const record=await refresh('interactive');return {...base,status:'available',paragraphs:record.paragraphs,...documentNotes(record),fetchedAt:record.fetchedAt};}
  catch(error){return {...base,status:'error',reason:String(error.message).slice(0,250),refreshError:String(error.message).slice(0,250),nextRetryAt:new Date(failures.get(key).retryAt).toISOString()};}
}
