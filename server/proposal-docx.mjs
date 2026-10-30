import {XMLParser} from 'fast-xml-parser';
import {docxContent,docxParts,styleVisibility,hiddenValue} from './document-text.mjs';
import {sourceIndex} from './docx-source-structure.mjs';
import {ommlToMathML,officialDocumentUrl} from './proposal-math.mjs';
import {proposalNumberingLabels} from './proposal-numbering.mjs';
const child=(nodes,key)=>nodes?.find(node=>Object.hasOwn(node,key));
const children=(nodes,key)=>child(nodes,key)?.[key]??[];
const property=(nodes,key)=>child(nodes,key)?.[':@']?.['@_w:val'];
const wrappers=new Set(['w:ins','w:moveTo','w:sdt','w:sdtContent','w:customXml','w:smartTag']);
function wrappedChildren(nodes,key) {
  const result=[];
  for(const node of nodes??[])for(const [name,value] of Object.entries(node))if(name===key)result.push(node);else if(wrappers.has(name))result.push(...wrappedChildren(value,key));
  return result;
}

// Commission recasts use a styled QUOTE field before a visible subdivision.
// Keep that field in the wording; it supplies only a source-bound label prefix.
function recastLabelPrefix(node,text,visibility,index) {
  const paragraph=children(node?.['w:p'],'w:pPr');
  const inherited=visibility.styledHidden(property(paragraph,'w:pStyle')||visibility.defaultParagraph,visibility.defaults);
  let state='start',code='',result='',resultPath;
  for(const entry of node?.['w:p']??[]) {
    if(Object.entries(entry).every(([key,value])=>key==='#text'&&/^\s*$/u.test(value)))continue;
    if(entry['w:pPr'])continue;
    if(!entry['w:r'])return null;
    const run=entry['w:r'],properties=children(run,'w:rPr'),style=property(properties,'w:rStyle');
    const hidden=visibility.styledHidden(style||visibility.defaultCharacter,inherited);
    if((hiddenValue(properties)??hidden.vanish)||(hiddenValue(properties,'webHidden')??hidden.webHidden))return null;
    for(const part of run)for(const [name,value] of Object.entries(part)) {
      if(name===':@'||name==='w:rPr')continue;
      if(name==='#text'&&/^\s*$/u.test(value))continue;
      if(name==='w:fldChar') {
        const type=part[':@']?.['@_w:fldCharType'];
        if(type==='begin'&&state==='start'){state='code';continue;}
        if(type==='separate'&&state==='code'){state='result';continue;}
        if(type==='end'&&state==='result') {
          const match=/^\s*QUOTE\s+"(Ö)"\s*$/u.exec(code);
          return match&&result===match[1]&&text.startsWith(result)&&/^\s+\d+\.\s/u.test(text.slice(result.length))
            ?{text:result,paragraphPath:index.get(node).path,sourcePath:resultPath}:null;
        }
        return null;
      }
      if(name==='w:instrText'&&state==='code'){code+=value.map(x=>x['#text']??'').join('');continue;}
      if(name==='w:t'&&state==='result'&&style==='CRMarker') {
        result+=value.map(x=>x['#text']??'').join('');resultPath??=index.get(entry).path;continue;
      }
      return null;
    }
  }
  return null;
}

// Reuse final-revision visibility, numbering, notes and source paths from the
// shared extractor. Inspect the same bounded XML only for objects and tables;
// never independently flatten hidden/deleted runs into the proposal text.
export function proposalDocx(buffer,{sourceUrl=null}={}) {
  let numbering;
  const content=docxContent(buffer,{includeParagraphProperties:true,includeNoteObjects:true,numbering:(...args)=>(numbering=proposalNumberingLabels(...args))});
  const parts=docxParts(buffer),document=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(parts.get('word/document.xml'));
  const visibility=styleVisibility(parts.get('word/styles.xml'));
  const index=sourceIndex(document),byPath=new Map(),tables=[];
  const paragraphByPath=new Map(content.paragraphSources.map((source,i)=>[source.path,i]));
  function indices(nodes) {
    const result=[];
    function visit(nodes){for(const entry of nodes??[])for(const [key,value] of Object.entries(entry)){if(key==='w:p'){const i=paragraphByPath.get(index.get(entry).path);if(i!==undefined)result.push(i);}else if(key!==':@'&&Array.isArray(value))visit(value);}}
    visit(nodes);return result;
  }
  function visit(nodes) {
    for(const entry of nodes??[])for(const [key,value] of Object.entries(entry)) {
      if(key===':@')continue;
      if(index.has(entry))byPath.set(index.get(entry).path,entry);
      if(key==='w:tbl') {
        const path=index.get(entry).path;
        const rows=wrappedChildren(value,'w:tr').map(row=>({cells:wrappedChildren(row['w:tr'],'w:tc').map(cell=>{
          const properties=children(cell['w:tc'],'w:tcPr'),merge=child(properties,'w:vMerge'),horizontal=child(properties,'w:hMerge');
          const rawSpan=property(properties,'w:gridSpan'),colSpan=rawSpan===undefined?1:Number(rawSpan);
          return {sourcePath:index.get(cell).path,paragraphs:indices(cell['w:tc']),colSpan:Number.isInteger(colSpan)&&colSpan>0&&colSpan<=100?colSpan:1,
            verticalMerge:merge?(merge[':@']?.['@_w:val']==='restart'?'start':'continue'):null,
            horizontalMerge:horizontal?(horizontal[':@']?.['@_w:val']==='restart'?'start':'continue'):null,
            complete:rawSpan===undefined||Number.isInteger(colSpan)&&colSpan>0&&colSpan<=100};
        })}));
        const paragraphs=indices(value),rawOrdinals=[];
        function ordinals(nodes){for(const node of nodes??[])for(const [key,value] of Object.entries(node))if(key==='w:p')rawOrdinals.push(index.get(node).ordinal);else if(key!==':@'&&Array.isArray(value))ordinals(value);}
        ordinals(value);const firstOrdinal=rawOrdinals.length?Math.min(...rawOrdinals):Infinity,following=content.paragraphSources.findIndex(source=>source.ordinal>=firstOrdinal);
        const covered=new Set(rows.flatMap(row=>row.cells.flatMap(cell=>cell.paragraphs)));
        tables.push({sourcePath:path,rows,paragraphs,anchor:following<0?content.paragraphs.length:following,complete:rows.every(row=>row.cells.every(cell=>cell.complete))&&paragraphs.every(index=>covered.has(index))});
      }
      if(Array.isArray(value))visit(value);
    }
  }
  visit(document);
  for(let i=0;i<content.paragraphs.length;i++){
    const node=byPath.get(content.paragraphSources[i].path);
    const metadata=numbering.metadata(children(node?.['w:p'],'w:pPr'));
    if(metadata)content.paragraphProperties[i].numbering=metadata;
    const prefix=recastLabelPrefix(node,content.paragraphs[i],visibility,index);
    if(prefix)content.paragraphProperties[i].recastLabelPrefix=prefix;
  }
  function convert(object,nodes){
    return object.kind==='math'?{...object,...ommlToMathML(nodes.get(object.path),{sourceUrl})}:
      {...object,complete:object.status==='mapped',sourceUrl:officialDocumentUrl(sourceUrl)};
  }
  content.documentObjects=content.documentObjects.map(object=>convert({...object,sourcePart:'word/document.xml'},byPath));
  const noteParts=new Map();
  for(const note of content.notes){
    const part=note.source.part;
    if(!noteParts.has(part)){
      const document=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(parts.get(part)),index=sourceIndex(document),nodes=new Map();
      function collect(entries){for(const entry of entries??[])for(const [key,value] of Object.entries(entry)){if(index.has(entry))nodes.set(index.get(entry).path,entry);if(key!==':@'&&Array.isArray(value))collect(value);}}
      collect(document);noteParts.set(part,nodes);
    }
    note.objects=note.objects.map(object=>convert(object,noteParts.get(part)));
    note.complete=note.extractionComplete&&note.objects.every(object=>object.complete);
  }
  return {...content,tables,sourceKind:'docx',numberingMode:'proposal-abstract-continuation'};
}
