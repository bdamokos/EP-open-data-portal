// Independent native Word note reader; no application extraction imports.
import {inflateRawSync} from 'node:zlib';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
const all=(nodes,name)=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key===name?[node]:Array.isArray(value)?all(value,name):[]));
const attr=(nodes,name)=>all(nodes,name)[0]?.[':@']?.['@_w:val'];
const hidden=nodes=>['w:vanish','w:webHidden'].some(name=>all(nodes,name).some(n=>!['0','false','off'].includes(n[':@']?.['@_w:val'])));
const unsupported=nodes=>['w:del','w:moveFrom','w:instrText','w:fldChar','w:drawing','w:pict','w:object','m:oMath','w:endnoteReference','w:numPr'].some(name=>all(nodes,name).length);
function readParts(bytes) {
 if(!Buffer.isBuffer(bytes)||bytes.length>8*1024*1024)throw Error('package');
 let end=bytes.length-22;for(;end>=Math.max(0,bytes.length-65557)&&bytes.readUInt32LE(end)!==0x06054b50;end--);
 if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))throw Error('zip');
 let cursor=bytes.readUInt32LE(end+16);const parts=new Map();
 for(let n=0;n<bytes.readUInt16LE(end+10);n++){
  if(cursor+46>bytes.length||bytes.readUInt32LE(cursor)!==0x02014b50)throw Error('directory');
  const length=bytes.readUInt16LE(cursor+28),name=bytes.subarray(cursor+46,cursor+46+length).toString();
  if(['word/document.xml','word/styles.xml','word/footnotes.xml','word/settings.xml'].includes(name)){
   const packedSize=bytes.readUInt32LE(cursor+20),size=bytes.readUInt32LE(cursor+24),local=bytes.readUInt32LE(cursor+42),method=bytes.readUInt16LE(cursor+10);
   if(parts.has(name)||size>12*1024*1024||bytes.readUInt16LE(cursor+8)&1||bytes.readUInt32LE(local)!==0x04034b50)throw Error('entry');
   const offset=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),packed=bytes.subarray(offset,offset+packedSize),raw=method===0?packed:method===8?inflateRawSync(packed,{maxOutputLength:12*1024*1024}):null;
   if(!raw||raw.length!==size)throw Error('size');
   const xml=raw.toString();if(/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)throw Error('xml');
   parts.set(name,new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml));
  }
  cursor+=46+length+bytes.readUInt16LE(cursor+30)+bytes.readUInt16LE(cursor+32);
 }
 return parts;
}
function words(nodes,refs=[]) {
 let value='';
 function visit(nodes){for(const node of nodes)for(const [name,children] of Object.entries(node)){
  if(name==='w:t')value+=children.map(n=>n['#text']??'').join('');
  else if(name==='w:tab')value+='\t';else if(['w:br','w:cr'].includes(name))value+='\n';
  else if(name==='w:noBreakHyphen')value+='\u2011';else if(name==='w:softHyphen')value+='\u00ad';
  else if(name==='w:footnoteReference'){if(node[':@']?.['@_w:customMarkFollows'])throw Error('custom note');refs.push({id:node[':@']?.['@_w:id'],offset:value.length});}
  else if(Array.isArray(children))visit(children);
 }}visit(nodes);return value;
}
export function nativeNoteRows(bytes) {
 const parts=readParts(bytes),styles=parts.get('word/styles.xml')||[],definitions=new Map(all(styles,'w:style').map(n=>[n[':@']?.['@_w:styleId'],n['w:style']]));
 const inherited=(id,seen=new Set())=>{if(seen.has(id))return true;seen.add(id);const s=definitions.get(id);return !!s&&(hidden(s)||!!attr(s,'w:basedOn')&&inherited(attr(s,'w:basedOn'),seen));};
 const hiddenUse=nodes=>hidden(nodes)||all(styles,'w:docDefaults').some(n=>hidden(n['w:docDefaults']))||['w:pStyle','w:rStyle'].some(name=>all(nodes,name).some(n=>inherited(n[':@']?.['@_w:val'])));
 const document=parts.get('word/document.xml'),settings=parts.get('word/settings.xml')||[];
 if(!document||all([...document,...settings],'w:footnotePr').some(n=>![undefined,'continuous','eachSect'].includes(attr(n['w:footnotePr'],'w:numRestart'))||![undefined,'1'].includes(attr(n['w:footnotePr'],'w:numStart'))||![undefined,'decimal'].includes(attr(n['w:footnotePr'],'w:numFmt'))))throw Error('numbering');
 const definitionsById=new Map();
 for(const node of all(parts.get('word/footnotes.xml')||[],'w:footnote')){
  const id=node[':@']?.['@_w:id'];if(['separator','continuationSeparator'].includes(node[':@']?.['@_w:type']))continue;
  if(definitionsById.has(id))throw Error('duplicate note');
  const nodes=node['w:footnote'],paragraphs=nodes.filter(n=>n['w:p']);
  definitionsById.set(id,{id,text:paragraphs.map(n=>words(n['w:p'])).join('\n').trim(),safe:paragraphs.length===nodes.length&&!unsupported(nodes)&&!hiddenUse(nodes)});
 }
 const body=quotedWordBody(bytes);
 if(body.some(row=>row.hidden&&all(Array.isArray(row.nodes)?row.nodes:[row.nodes],'w:footnoteReference').length))throw Error('unreadable numbering context');
 let counter=0;const seen=new Set(),result=[];let sectionStart=0;
 for(let end=0;end<body.length;end++){
  const section=all(Array.isArray(body[end].nodes)?body[end].nodes:[body[end].nodes],'w:sectPr');
  if(!section.length&&end<body.length-1)continue;
  const restart=attr(section,'w:numRestart')??attr(settings,'w:numRestart');
  if(restart==='eachSect')counter=0;
  for(const row of body.slice(sectionStart,end+1)){
  const refs=[];words(Array.isArray(row.nodes)?row.nodes:[row.nodes],refs);
  for(const ref of refs){if(!ref.id||seen.has(ref.id))throw Error('ambiguous note');seen.add(ref.id);ref.label=String(++counter);ref.note=definitionsById.get(ref.id);}
  if(row.kind==='paragraph')result.push({...row,nativeIndex:body.indexOf(row),refs,safe:!row.hidden&&!row.numbered&&!unsupported(row.nodes)});
  }sectionStart=end+1;
 }return result;
}
