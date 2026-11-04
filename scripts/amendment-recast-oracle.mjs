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

// Every complex marker field must contain only its own styled glyph result.
function safeTitleFields(paragraph) {
 let state='outside', instruction='', result='', styled=true;
 for(const node of paragraph) {
  if(node['w:pPr'])continue;
  if(node['w:smartTag']&&state==='outside'){if(!safeTitleFields(node['w:smartTag']))return false;continue;}
  if(!node['w:r'])return false;
  const run=node['w:r'],style=value(entries(run,'w:rPr')[0]?.['w:rPr'],'w:rStyle');
  for(const child of run) {
   if(child['w:rPr'])continue;
   if(child['w:fldChar']) {
    const type=child[':@']?.['@_w:fldCharType'];
    if(type==='begin'&&state==='outside'){state='instruction';instruction='';result='';styled=true;}
    else if(type==='separate'&&state==='instruction')state='result';
    else if(type==='end'&&state==='result'){
     const match=/^\s*QUOTE\s*"([ðï])"\s*$/u.exec(instruction);
     if(!match||!styled||result!==match[1])return false;
     state='outside';
    }else return false;
   } else if(child['w:instrText']) {
    if(state!=='instruction')return false;
    instruction+=child['w:instrText'].map(x=>x['#text']??'').join('');
   } else if(child['w:t']) {
    if(state==='instruction')return false;
    if(state==='result'){result+=child['w:t'].map(x=>x['#text']??'').join('');styled&&=style==='CRMarker';}
   } else if(state!=='outside')return false;
  }
 }
 return state==='outside';
}

// The native title, its procedure reference and the institution opening bind
// the otherwise ambiguous published address "Title 1" to three body rows.
export function assertNativeProposalTitle({proposal,wording,placement,nativeQuoted}) {
 const unknown={status:'unverified',reason:'oracle-proposal-title-unavailable'};
 if(wording?.language!=='en'||wording.baseline!=='commission-proposal'||wording.targetLabel!=='Title 1'||placement?.operation!=='replace'||!Array.isArray(proposal?.paragraphs)||!Buffer.isBuffer(nativeQuoted?.proposalBuffer))return unknown;
 const source=nativeSource(nativeQuoted?.proposalBuffer);if(!source)return unknown;
 const lines=String(wording.originalText||'').split('\n');if(lines.length!==3||lines[0]!=='Proposal for a'||lines[1]!=='COUNCIL DIRECTIVE')return unknown;
 const direct=[...source.native].filter(([path])=>/^\/w:document\[1\]\/w:body\[1\]\/w:p\[\d+\]$/u.test(path));
 const candidates=[];
 for(let i=1;i+3<direct.length;i++) {
  const group=direct.slice(i-1,i+4),read=group.map(([,node])=>squash(readingOf(node,source.ids)));
  const all=(nodes,key)=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,body])=>name===key?[node]:Array.isArray(body)?all(body,key):[]));
  if(group.some(([,node])=>!safeTitleFields(node)))continue;
  if(group.some(([,node])=>['w:drawing','w:pict','w:object','m:oMath','w:fldSimple','w:footnoteReference','w:endnoteReference','w:vanish','w:webHidden'].some(name=>all(node,name).length)))continue;
  const instruction=group.flatMap(([,node])=>all(node,'w:instrText')).map(node=>(node['w:instrText']||[]).map(part=>part['#text']??'').join('')).join('');
  const fields=group.flatMap(([,node])=>all(node,'w:fldChar')).map(node=>node[':@']?.['@_w:fldCharType']);
  if(fields.length%3||!/^(?:\s*QUOTE\s*"[ðï]"\s*)*$/u.test(instruction)||(instruction.match(/QUOTE/gu)||[]).length!==fields.length/3||fields.join('|')!==Array(fields.length/3).fill('begin|separate|end').join('|'))continue;
  if(!/^\d{4}\/\d+ \(CNS\)$/u.test(read[0])||read[1]!==lines[0]||read[2]!==lines[1]||read[3]!==squash(lines[2])||read[4]!=='THE COUNCIL OF THE EUROPEAN UNION,')continue;
  const styles=group.slice(1,4).map(([,node])=>value(entries(node,'w:pPr')[0]?.['w:pPr'],'w:pStyle'));
  if(styles.join('|')!=='Statut|Typedudocument|Titreobjet')continue;
  candidates.push(group);
 }
 if(candidates.length!==1)return unknown;
 const group=candidates[0],paths=group.map(([path])=>path),projected=paths.map(path=>proposal.paragraphs.filter(p=>p.source?.path===path));
 if(projected.some(rows=>rows.length!==1))return unknown;
 const rows=projected.map(matches=>matches[0]);
 if(rows.some((row,i)=>!row.complete||!row.source?.complete||row.source.container!=='body'||i&&(row.source.ordinal!==rows[i-1].source.ordinal+1||row.source.segment!==rows[i-1].source.segment||row.source.containerPath!==rows[i-1].source.containerPath)))return unknown;
 const start=rows[1].index,end=rows[3].index,splice=placement.splice;
 if(placement.span?.start!==start||placement.span?.end!==end||splice?.start?.paragraph!==start||splice.start.offset!==0||splice?.end?.paragraph!==end||splice.end.offset!==rows[3].text.length)return {status:'failed',reason:'oracle-proposal-title-boundary-mismatch'};
 return {status:'verified',reason:'oracle-native-proposal-title'};
}
