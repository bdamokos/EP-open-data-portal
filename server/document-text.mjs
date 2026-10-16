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
const EXTRACTION_VERSION=4;
const memory=new Map(),pending=new Map(),failures=new Map();
// Read only the standard text, style, numbering and note parts. No archive paths are written to disk.
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
    if(!['word/document.xml','word/styles.xml','word/numbering.xml','word/footnotes.xml','word/endnotes.xml'].includes(name))continue;
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
const property=(nodes,key)=>attribute(child(nodes,key),'val');
function hiddenValue(properties) {
  const node=child(properties,'w:vanish');
  return node ? !['0','false','off'].includes(String(attribute(node,'val')).toLowerCase()) : undefined;
}
export function docxContent(buffer) {
  const parts=docxParts(buffer);
  const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
  const tree=parser.parse(parts.get('word/document.xml'));
  const styles=children(parts.has('word/styles.xml')?parser.parse(parts.get('word/styles.xml')):[],'w:styles') || [];
  const byId=new Map(styles.filter(node=>node['w:style']).map(node=>[attribute(node,'styleId'),{
    parent:property(node['w:style'],'w:basedOn'),toggle:hiddenValue(children(node['w:style'],'w:rPr'))===true,
    numbering:children(children(node['w:style'],'w:pPr'),'w:numPr'),
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
  const warnings=new Set(),paragraphs=[],footnotes=[],noteReferences=new Map();
  const numbering=children(parts.has('word/numbering.xml')?parser.parse(parts.get('word/numbering.xml')):[],'w:numbering') || [];
  const abstracts=new Map(numbering.filter(n=>n['w:abstractNum']).map(n=>[attribute(n,'abstractNumId'),n['w:abstractNum']]));
  const lists=new Map(numbering.filter(n=>n['w:num']).map(n=>[attribute(n,'numId'),n['w:num']]));
  const counters=new Map();
  const notes=new Map();
  for(const kind of ['footnote','endnote']) {
    const nodes=children(parts.has('word/'+kind+'s.xml')?parser.parse(parts.get('word/'+kind+'s.xml')):[],'w:'+kind+'s') || [];
    for(const node of nodes.filter(n=>n['w:'+kind]))if(!attribute(node,'type'))notes.set(kind+':'+attribute(node,'id'),node['w:'+kind]);
  }
  function paragraphNumbering(properties) {
    const direct=children(properties,'w:numPr');
    let inherited,id=property(properties,'w:pStyle') || defaultParagraph;const seen=new Set();
    while(byId.has(id)) {
      if(seen.has(id))throw new Error('Cyclic DOCX style inheritance is unsupported.');
      seen.add(id);const style=byId.get(id);
      inherited ??= style.numbering;id=style.parent;
    }
    return direct || inherited ? {id:property(direct,'w:numId') ?? property(inherited,'w:numId'),level:property(direct,'w:ilvl') ?? property(inherited,'w:ilvl') ?? '0'} : null;
  }
  function listLabel(properties) {
    const number=paragraphNumbering(properties);
    if(!number || number.id==='0')return '';
    const list=lists.get(number.id),abstract=abstracts.get(property(list,'w:abstractNumId')),level=Number(number.level);
    const definition=index=>{
      const override=list?.find(n=>n['w:lvlOverride'] && attribute(n,'ilvl')===String(index))?.['w:lvlOverride'];
      const base=children(override,'w:lvl') || abstract?.find(n=>n['w:lvl'] && attribute(n,'ilvl')===String(index))?.['w:lvl'];
      return base ? {format:property(base,'w:numFmt'),pattern:property(base,'w:lvlText'),start:Number(property(override,'w:startOverride') ?? property(base,'w:start') ?? 1),restart:property(base,'w:lvlRestart')} : null;
    };
    const def=definition(level);
    if(!Number.isInteger(level) || level<0 || level>8 || !def || !Number.isSafeInteger(def.start) || def.start<0) {warnings.add('Some automatic paragraph numbering could not be read.');return '';}
    const state=counters.get(number.id) || [];
    state[level]=(state[level] ?? def.start-1)+1;
    for(let i=level+1;i<state.length;i++)if(definition(i)?.restart!=='0')state[i]=undefined;
    counters.set(number.id,state);
    const format=(value,kind)=>{
      if(kind==='decimal')return String(value);
      if(kind==='decimalZero')return String(value).padStart(2,'0');
      if(['upperLetter','lowerLetter'].includes(kind) && value>0) {
        let result='';for(let n=value;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;
        return kind==='lowerLetter'?result.toLowerCase():result;
      }
      if(['upperRoman','lowerRoman'].includes(kind) && value>0 && value<4000) {
        let result='',n=value;
        for(const [size,digits] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']])while(n>=size){result+=digits;n-=size;}
        return kind==='lowerRoman'?result.toLowerCase():result;
      }
      warnings.add('Some automatic paragraph numbering uses an unsupported format.');return '';
    };
    if(def.format==='bullet')return '•';
    if(!['decimal','decimalZero','upperLetter','lowerLetter','upperRoman','lowerRoman'].includes(def.format))warnings.add('Some automatic paragraph numbering uses an unsupported format.');
    if(typeof def.pattern!=='string'){warnings.add('Some automatic paragraph numbering could not be read.');return '';}
    return def.pattern.replace(/%([1-9])/g,(_,digit)=>{const i=Number(digit)-1,d=definition(i);if(!d){warnings.add('Some automatic paragraph numbering could not be read.');return '';}return format(state[i] ?? d.start,d.format);});
  }
  function inline(nodes,hidden) {
    let text='';
    for(const node of nodes || [])for(const [key,value] of Object.entries(node)) {
      if(key==='w:r') {
        const properties=children(value,'w:rPr');
        const runHidden=hiddenValue(properties) ?? styledHidden(property(properties,'w:rStyle') || defaultCharacter,hidden);
        if(!runHidden)text+=inline(value,false);
      }
      else if(key==='#text')text+=String(value);
      else if(key==='w:tab')text+='\t';
      else if(key==='w:br'||key==='w:cr')text+='\n';
      else if(key==='w:noBreakHyphen')text+='\u2011';
      else if(key==='w:softHyphen')text+='\u00ad';
      else if(key==='w:footnoteReference' || key==='w:endnoteReference') {
        const kind=key==='w:footnoteReference'?'footnote':'endnote',id=attribute(node,'id'),keyId=kind+':'+id;
        if(attribute(node,'customMarkFollows'))warnings.add('Custom note markers are not supported.');
        if(!noteReferences.has(keyId))noteReferences.set(keyId,String(noteReferences.size+1));
        text+='['+noteReferences.get(keyId)+']';
      }
      else if(!['w:del','w:instrText','w:pPr','w:rPr'].includes(key) && Array.isArray(value))text+=inline(value,hidden);
    }
    return text;
  }
  function walk(nodes) {
    for(const node of nodes || [])for(const [key,value] of Object.entries(node)) {
      if(key==='w:p'){
        const properties=children(value,'w:pPr'),hidden=styledHidden(property(properties,'w:pStyle') || defaultParagraph,defaults),p=inline(value,hidden).trim();
        if(p){const label=listLabel(properties);paragraphs.push((label?label+'\t':'')+p);}
      }
      else if(Array.isArray(value))walk(value);
    }
  }
  walk(tree);
  for(const [key,reference] of noteReferences) {
    const node=notes.get(key);
    if(!node){warnings.add('A referenced footnote or endnote is missing.');continue;}
    const noteParagraphs=[];
    function readNote(nodes) {
      for(const item of nodes)for(const [name,value] of Object.entries(item)) {
        if(name==='w:p') {
          const hidden=styledHidden(property(children(value,'w:pPr'),'w:pStyle') || defaultParagraph,defaults),p=inline(value,hidden).trim();
          if(p)noteParagraphs.push(p);
        } else if(Array.isArray(value))readNote(value);
      }
    }
    readNote(node);const text=noteParagraphs.join('\n');
    if(text)footnotes.push({reference,text});else warnings.add('A referenced footnote or endnote is empty.');
  }
  if(!paragraphs.length || paragraphs.length+footnotes.length>20000 || paragraphs.join('\n').length+footnotes.map(n=>n.text).join('\n').length>2*1024*1024)throw new Error('DOCX text is empty or exceeds the supported size.');
  return {paragraphs,footnotes,extractionWarnings:[...warnings]};
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

export async function documentText(work,language,{directory=process.env.ODP_CACHE_DIR,download=downloadDocx,clock=Date.now}={}) {
  const files=documentFiles(work).filter(f=>f.format==='DOCX' && allowedDownload(f.url));
  const languages=[...new Set(files.map(f=>f.language).filter(Boolean))];
  const originals=array(work.originalLanguage).map(languageCode);
  const chosen=files.find(f=>f.language===language) || files.find(f=>originals.includes(f.language)) || files.find(f=>f.language==='en') || files[0];
  const base={status:'unavailable',paragraphs:[],footnotes:[],extractionWarnings:[],textLanguage:chosen?.language || null,requestedLanguage:language,availableTextLanguages:languages,translationType:chosen?originals.includes(chosen.language)?'original':'unspecified':null,sourceFormat:chosen?'DOCX':null,sourceUrl:chosen?.url || null,fetchedAt:null,stale:false,refreshInProgress:false,refreshError:null,nextRetryAt:null,reason:null,extraction:chosen?'official-docx-paragraphs':null};
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
  const present=record=>({...base,status:'available',paragraphs:record.paragraphs,footnotes:record.footnotes || [],extractionWarnings:record.extractionWarnings || [],fetchedAt:record.fetchedAt});
  if(saved){const stale=clock()-Date.parse(saved.fetchedAt)>=DAY;if(stale && (!failure || failure.retryAt<=clock()))void refresh('background').catch(()=>{});return {...present(saved),stale,refreshInProgress:pending.has(key),refreshError:failure?.message || null};}
  if(failure?.retryAt>clock())return {...base,status:'error',reason:failure.message,refreshError:failure.message,nextRetryAt:new Date(failure.retryAt).toISOString()};
  try {const record=await refresh('interactive');return present(record);}
  catch(error){return {...base,status:'error',reason:String(error.message).slice(0,250),refreshError:String(error.message).slice(0,250),nextRetryAt:new Date(failures.get(key).retryAt).toISOString()};}
}
