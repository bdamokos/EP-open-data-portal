import {XMLParser} from 'fast-xml-parser';
import {docxContent,docxParts} from './document-text.mjs';
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

// Reuse final-revision visibility, numbering, notes and source paths from the
// shared extractor. Inspect the same bounded XML only for objects and tables;
// never independently flatten hidden/deleted runs into the proposal text.
export function proposalDocx(buffer,{sourceUrl=null}={}) {
  let numbering;
  const content=docxContent(buffer,{includeParagraphProperties:true,numbering:(...args)=>(numbering=proposalNumberingLabels(...args))});
  const parts=docxParts(buffer),document=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(parts.get('word/document.xml'));
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
  }
  content.documentObjects=content.documentObjects.map(object=>object.kind==='math'?{...object,...ommlToMathML(byPath.get(object.path),{sourceUrl})}:{...object,complete:object.status==='mapped',sourceUrl:officialDocumentUrl(sourceUrl)});
  return {...content,tables,sourceKind:'docx',numberingMode:'proposal-abstract-continuation'};
}
