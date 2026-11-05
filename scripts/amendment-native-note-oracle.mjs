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
function words(nodes,refs=[],allowCustom=false) {
 let value='';
 function visit(nodes){for(const node of nodes)for(const [name,children] of Object.entries(node)){
  if(name==='w:r'&&allowCustom&&all(children,'w:footnoteReference').some(n=>['1','true','on'].includes(n[':@']?.['@_w:customMarkFollows']))){
   const at=children.findIndex(n=>n['w:footnoteReference']);const ref=children[at],label=children[at+1]?.['w:t']?.map(n=>n['#text']??'').join('');
   if(at<0||!/^\d+$/u.test(label??'')||children.slice(at+2).some(n=>!n[':@']))throw Error('custom label');
   visit(children.slice(0,at));refs.push({id:ref[':@']?.['@_w:id'],offset:value.length,custom:true,label});
  }
  else if(name==='w:t')value+=children.map(n=>n['#text']??'').join('');
  else if(name==='w:tab')value+='\t';else if(['w:br','w:cr'].includes(name))value+='\n';
  else if(name==='w:noBreakHyphen')value+='\u2011';else if(name==='w:softHyphen')value+='\u00ad';
  else if(name==='w:footnoteReference'){if(node[':@']?.['@_w:customMarkFollows'])throw Error('custom note');refs.push({id:node[':@']?.['@_w:id'],offset:value.length});}
  else if(Array.isArray(children))visit(children);
 }}visit(nodes);return value;
}
export function nativeNoteRows(bytes,{comparison=false}={}) {
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
  const refs=[];const nativeText=words(Array.isArray(row.nodes)?row.nodes:[row.nodes],refs,comparison);
  for(const ref of refs){if(!ref.id||seen.has(ref.id))throw Error('ambiguous note');seen.add(ref.id);if(!ref.custom)ref.label=String(++counter);ref.note=definitionsById.get(ref.id);}
  if(row.kind==='paragraph'||comparison)result.push({...row,nativeIndex:body.indexOf(row),nativeText,refs,safe:!row.hidden&&!row.numbered&&!unsupported(Array.isArray(row.nodes)?row.nodes:[row.nodes])});
  }sectionStart=end+1;
 }return result;
}

// Read both comparison columns and their notes without application extraction.
export function nativeSplitComparison(bytes,number) {
 const rows=nativeNoteRows(bytes,{comparison:true});
 const start=rows.findIndex(r=>r.kind==='paragraph'&&r.text.includes('<NumAm>'+number+'</NumAm>'));
 if(start<0)throw Error('amendment');
 const stop=rows.findIndex((r,i)=>i>start&&r.kind==='paragraph'&&r.text.includes('</Amend>'));
 if(stop<0)throw Error('amendment end');
 const group=rows.slice(start,stop+1),tables=group.filter(r=>r.nodes?.['w:tbl']);
 if(tables.length!==2||tables.some(r=>r.hidden))throw Error('split tables');
 const header=tables[0].nodes['w:tbl'],body=tables[1].nodes['w:tbl'];
 if(['w:vMerge','w:hMerge','w:del','w:moveFrom'].some(n=>all([...header,...body],n).length))throw Error('grid');
 const tableRows=all(body,'w:tr');if(tableRows.length!==1)throw Error('body rows');
 const cells=tableRows[0]['w:tr'].filter(n=>n['w:tc']);if(cells.length!==2)throw Error('columns');
 return cells.map(cell=>{
  const refs=[],text=words(cell['w:tc'],refs,true).trim();
  const notes=refs.map(ref=>{
   const matches=tables[1].refs.filter(r=>r.id===ref.id);if(matches.length!==1)throw Error('note identity');
   const resolved=matches[0];if(!resolved.note?.safe||!resolved.note.text||!/^\d+$/u.test(resolved.label))throw Error('note unavailable');
   let payload=resolved.note.text;
   if(resolved.custom){if(!payload.startsWith(resolved.label)||!/^\s/u.test(payload.slice(resolved.label.length)))throw Error('custom payload');payload=payload.slice(resolved.label.length).trim();}
   return {...ref,label:resolved.label,payload};
  });
  return {text,notes};
 });
}
