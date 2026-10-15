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
// Read only the standard document entry. No archive paths are written to disk.
export function docxParagraphs(buffer) {
  if(buffer.length>MAX_FILE || buffer.length<22)throw new Error('DOCX size is unsupported.');
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('Invalid DOCX archive.');
  if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))throw new Error('Multipart DOCX is unsupported.');
  const count=buffer.readUInt16LE(end+10);let cursor=buffer.readUInt32LE(end+16),xml=null;
  if(count>2000)throw new Error('DOCX contains too many entries.');
  for(let i=0;i<count;i++) {
    if(cursor+46>buffer.length || buffer.readUInt32LE(cursor)!==0x02014b50)throw new Error('Invalid DOCX directory.');
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),compressed=buffer.readUInt32LE(cursor+20),size=buffer.readUInt32LE(cursor+24);
    const nameLength=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32),offset=buffer.readUInt32LE(cursor+42);
    const name=buffer.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    cursor+=46+nameLength+extra+comment;
    if(name!=='word/document.xml')continue;
    if(xml!==null || flags&1 || size>MAX_XML || compressed>MAX_FILE || offset+30>buffer.length || buffer.readUInt32LE(offset)!==0x04034b50)throw new Error('Unsupported DOCX document entry.');
    const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28);
    if(start+compressed>buffer.length)throw new Error('Truncated DOCX entry.');
    const bytes=buffer.subarray(start,start+compressed);
    const decoded=method===0?bytes:method===8?inflateRawSync(bytes,{maxOutputLength:MAX_XML}):null;
    if(!decoded || decoded.length!==size)throw new Error('Invalid DOCX compression.');
    xml=decoded.toString('utf8');
  }
  if(!xml || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true)throw new Error('Invalid DOCX document XML.');
  const tree=new XMLParser({preserveOrder:true,ignoreAttributes:true,parseTagValue:false,trimValues:false}).parse(xml);
  const paragraphs=[];
  function inline(nodes) {
    let text='';
    for(const node of nodes || [])for(const [key,value] of Object.entries(node)) {
      if(key==='#text')text+=String(value);
      else if(key==='w:tab')text+='\t';
      else if(key==='w:br'||key==='w:cr')text+='\n';
      else if(!['w:del','w:instrText','w:pPr','w:rPr'].includes(key) && Array.isArray(value))text+=inline(value);
    }
    return text;
  }
  function walk(nodes) {
    for(const node of nodes || [])for(const [key,value] of Object.entries(node)) {
      if(key==='w:p'){const p=inline(value).trim();if(p)paragraphs.push(p);}
      else if(Array.isArray(value))walk(value);
    }
  }
  walk(tree);
  if(!paragraphs.length || paragraphs.length>20000 || paragraphs.join('\n').length>2*1024*1024)throw new Error('DOCX text is empty or exceeds the supported size.');
  return paragraphs;
}

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
    return {paragraphs:docxParagraphs(Buffer.concat(chunks)),resolvedSourceUrl:url};
  }
  throw new Error('Too many document download redirects.');
}

export async function documentText(work,language,{directory=process.env.ODP_CACHE_DIR,download=downloadDocx,clock=Date.now}={}) {
  const files=documentFiles(work).filter(f=>f.format==='DOCX' && allowedDownload(f.url));
  const languages=[...new Set(files.map(f=>f.language).filter(Boolean))];
  const originals=array(work.originalLanguage).map(languageCode);
  const chosen=files.find(f=>f.language===language) || files.find(f=>originals.includes(f.language)) || files.find(f=>f.language==='en') || files[0];
  const base={status:'unavailable',paragraphs:[],textLanguage:chosen?.language || null,requestedLanguage:language,availableTextLanguages:languages,translationType:chosen?originals.includes(chosen.language)?'original':'unspecified':null,sourceFormat:chosen?'DOCX':null,sourceUrl:chosen?.url || null,fetchedAt:null,stale:false,refreshInProgress:false,refreshError:null,nextRetryAt:null,reason:null,extraction:chosen?'official-docx-paragraphs':null};
  if(!chosen)return {...base,reason:'No supported DOCX text file is supplied for this publication.'};
  const key=chosen.url,file=directory && path.join(directory,'document-text-v1',createHash('sha256').update(key).digest('hex')+'.json');
  let saved=memory.get(key);
  if(!saved && file)try{const record=JSON.parse(await readFile(file,'utf8'));if(record.schemaVersion===1 && record.sourceUrl===key && Number.isFinite(Date.parse(record.fetchedAt)) && Array.isArray(record.paragraphs) && record.paragraphs.every(p=>typeof p==='string')){saved=record;memory.set(key,record);}}catch{}
  const refresh=priority=> {
    if(pending.has(key))return pending.get(key);
    const job=boundedUpstream(async()=>{
      const result=await download(key),record={schemaVersion:1,sourceId:work.identifier || tail(work.id),sourceUrl:key,fetchedAt:new Date(clock()).toISOString(),...result};
      if(file){await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';await writeFile(temp,JSON.stringify(record));await rename(temp,file);}
      memory.set(key,record);if(memory.size>100)memory.delete(memory.keys().next().value);failures.delete(key);return record;
    },{priority}).catch(error=>{failures.set(key,{retryAt:clock()+30000,message:String(error.message).slice(0,250)});throw error;}).finally(()=>pending.delete(key));
    pending.set(key,job);return job;
  };
  const failure=failures.get(key);
  if(saved){const stale=clock()-Date.parse(saved.fetchedAt)>=DAY;if(stale && (!failure || failure.retryAt<=clock()))void refresh('background').catch(()=>{});return {...base,status:'available',paragraphs:saved.paragraphs,fetchedAt:saved.fetchedAt,stale,refreshInProgress:pending.has(key),refreshError:failure?.message || null};}
  if(failure?.retryAt>clock())return {...base,status:'error',reason:failure.message,refreshError:failure.message,nextRetryAt:new Date(failure.retryAt).toISOString()};
  try {const record=await refresh('interactive');return {...base,status:'available',paragraphs:record.paragraphs,fetchedAt:record.fetchedAt};}
  catch(error){return {...base,status:'error',reason:String(error.message).slice(0,250),refreshError:String(error.message).slice(0,250),nextRetryAt:new Date(failures.get(key).retryAt).toISOString()};}
}
