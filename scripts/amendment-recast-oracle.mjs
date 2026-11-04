import {inflateRawSync} from 'node:zlib';
import {XMLParser,XMLValidator} from 'fast-xml-parser';

// Commission recast sources print deleted wording of the codified act with
// struck-through CR character styles, and editorial glyphs and source
// references with CR Marker and CR Reference. This oracle reads the native
// Word package on its own and recomputes that legal reading for every source
// row a placement touches; parsed units and placement evidence are ignored.
function wordParts(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length>8*1024*1024)throw new Error('Word package unavailable');
  let end=bytes.length-22;
  for(;end>=Math.max(0,bytes.length-65557)&&bytes.readUInt32LE(end)!==0x06054b50;end--);
  if(end<0)throw new Error('Unsupported ZIP');
  let cursor=bytes.readUInt32LE(end+16);const parts=new Map();
  for(let i=0;i<bytes.readUInt16LE(end+10);i++) {
    if(cursor+46>bytes.length||bytes.readUInt32LE(cursor)!==0x02014b50)throw new Error('Invalid ZIP directory');
    const size=bytes.readUInt32LE(cursor+20),full=bytes.readUInt32LE(cursor+24),nameLength=bytes.readUInt16LE(cursor+28),name=bytes.subarray(cursor+46,cursor+46+nameLength).toString();
    if(['word/document.xml','word/styles.xml'].includes(name)) {
      const local=bytes.readUInt32LE(cursor+42),method=bytes.readUInt16LE(cursor+10);
      if(bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(cursor+8)&1)throw new Error('Invalid local ZIP entry');
      const offset=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),packed=bytes.subarray(offset,offset+size);
      const raw=method===0?packed:method===8?inflateRawSync(packed,{maxOutputLength:16*1024*1024}):null;
      if(!raw||raw.length!==full)throw new Error('Incomplete Word XML');
      parts.set(name,raw.toString('utf8'));
    }
    cursor+=46+nameLength+bytes.readUInt16LE(cursor+30)+bytes.readUInt16LE(cursor+32);
  }
  const parse=xml=>{if(!xml||/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('Word XML unavailable');return new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml);};
  return {document:parse(parts.get('word/document.xml')),styles:parts.has('word/styles.xml')?parse(parts.get('word/styles.xml')):[]};
}
const entries=(nodes,name)=>(nodes||[]).filter(node=>Object.hasOwn(node,name));
const value=(nodes,name)=>entries(nodes,name)[0]?.[':@']?.['@_w:val'];
const on=(nodes,name)=>entries(nodes,name).some(node=>!['0','false','off'].includes(String(node[':@']?.['@_w:val']??'1')));

function recastStyleIds(styles) {
  const removed=new Set(),references=new Set();
  const visit=nodes=>{for(const node of nodes||[])for(const [key,body] of Object.entries(node)){
    if(key==='w:style'){
      const id=node[':@']?.['@_w:styleId'],type=node[':@']?.['@_w:type'],name=value(body,'w:name'),rPr=entries(body,'w:rPr')[0]?.['w:rPr'];
      if(type==='character'&&name==='CR Marker')removed.add(id);
      if(type==='character'&&['CR Deleted','CR Refonte Deleted','CR Minor Change Deleted'].includes(name)&&(on(rPr,'w:strike')||on(rPr,'w:dstrike')))removed.add(id);
      if(type==='paragraph'&&name==='CR Reference')references.add(id);
    }else if(key!==':@'&&Array.isArray(body))visit(body);
  }};
  visit(styles);
  return {removed,references};
}

// Text of one native paragraph in its recast reading: final-revision runs only,
// no field instructions, no deleted or marker runs, no reference rows.
function readingOf(paragraph,ids,refs=[]) {
  const style=value(entries(paragraph,'w:pPr')[0]?.['w:pPr'],'w:pStyle');
  if(ids.references.has(style))return '';
  let text='';
  const walk=nodes=>{for(const node of nodes||[])for(const [key,body] of Object.entries(node)){
    if(key===':@'||['w:pPr','w:del','w:moveFrom','w:instrText','w:delText','w:rPr'].includes(key))continue;
    if(key==='w:r'){
      const rPr=entries(body,'w:rPr')[0]?.['w:rPr'];
      if(ids.removed.has(value(rPr,'w:rStyle'))||on(rPr,'w:vanish'))continue;
      walk(body);continue;
    }
    if(key==='w:footnoteReference')refs.push({id:node[':@']?.['@_w:id'],offset:text.length});
    if(key==='w:t')text+=(body||[]).map(item=>item['#text']??'').join('');
    else if(key==='w:tab')text+='\t';
    else if(key==='w:br'||key==='w:cr')text+='\n';
    else if(key==='w:noBreakHyphen')text+='‑';
    else if(Array.isArray(body))walk(body);
  }};
  walk(paragraph);
  return text;
}

function nativeParagraphs(tree) {
  const byPath=new Map();
  const visit=(nodes,path)=>{const counts=new Map();for(const node of nodes||[])for(const [key,body] of Object.entries(node)){
    if(key===':@'||!Array.isArray(body))continue;
    const n=(counts.get(key)??0)+1;counts.set(key,n);
    const here=`${path}/${key}[${n}]`;
    if(key==='w:p')byPath.set(here,body);else visit(body,here);
  }};
  visit(tree,'');
  return byPath;
}

const sources=new WeakMap();
function nativeSource(buffer) {
  if(!sources.has(buffer)){
    let source=null;
    try{const parts=wordParts(buffer),ids=recastStyleIds(parts.styles);if([...ids.removed].some(id=>id!=='CRMarker'))source={ids,native:nativeParagraphs(parts.document)};}catch{source=null;}
    sources.set(buffer,source);
  }
  return sources.get(buffer);
}
const squash=text=>text.normalize('NFC').replace(/\s+/gu,' ').trim();

export function assertRecastReading({proposal,placement,nativeQuoted}) {
  if(!nativeQuoted?.proposalBuffer||!proposal)return null;
  const source=nativeSource(nativeQuoted.proposalBuffer);
  if(!source)return null;
  const {ids,native}=source;
  const rows=placement.operation==='insert'?[placement.insertAfter,placement.insertBefore]:[placement.span?.start,placement.span?.end];
  if(!rows.every(row=>Number.isInteger(row)))return {status:'unverified',reason:'oracle-recast-reading-unavailable'};
  for(let row=Math.max(0,rows[0]);row<=Math.min(rows[1],proposal.paragraphs.length-1);row++){
    const paragraph=proposal.paragraphs[row],node=native.get(paragraph?.source?.path);
    if(!node)return {status:'unverified',reason:'oracle-recast-reading-unavailable'};
    const label=paragraph.properties?.numberingLabel,projected=label&&paragraph.text.startsWith(label+'\t')?paragraph.text.slice(label.length+1):paragraph.text;
    if(squash(projected)!==squash(readingOf(node,ids)))return {status:'failed',reason:'oracle-recast-reading-mismatch',paragraph:row};
  }
  return {status:'verified',reason:'oracle-recast-reading'};
}

export function nativeRecastNoteReading(buffer,path){
 const source=nativeSource(buffer),node=source?.native.get(path);if(!node)return null;
 const refs=[],text=readingOf(node,source.ids,refs);return {text,refs};
}
