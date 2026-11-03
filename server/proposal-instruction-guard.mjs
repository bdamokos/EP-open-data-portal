import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {docxParts,styleVisibility} from './document-text.mjs';
const URI='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const child=(nodes,key)=>nodes.filter(node=>node[key]).map(node=>node[key]);
const descendants=(nodes,key)=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,value])=>name===key?[value]:Array.isArray(value)?descendants(value,key):[]));
const nativeText=nodes=>nodes.map(node=>Object.entries(node).map(([key,value])=>key==='w:t'?value.map(part=>part['#text']??'').join(''):key==='w:tab'?'\t':['w:br','w:cr'].includes(key)?'\n':key==='w:noBreakHyphen'?'\u2011':key==='w:softHyphen'?'\u00ad':Array.isArray(value)?nativeText(value):'').join('')).join('');
const val=(nodes,key)=>nodes.find(node=>node[key])?.[':@']?.['@_w:val'];
function knownInline(nodes){
 for(const node of nodes)for(const [key,value] of Object.entries(node)){
  if(key===':@'||['w:pPr','w:rPr'].includes(key))continue;
  if(['w:r','w:hyperlink'].includes(key)){if(!knownInline(value))return false;}
  else if(key==='w:t'){if(value.some(part=>Object.keys(part).some(key=>key!=='#text')))return false;}
  else if(!['w:tab','w:br','w:cr','w:noBreakHyphen','w:softHyphen','w:lastRenderedPageBreak','w:bookmarkStart','w:bookmarkEnd','w:proofErr'].includes(key)||value.length)return false;
 }
 return true;
}
const only=(nodes,keys)=>nodes.every(node=>Object.entries(node).every(([key,value])=>key===':@'||key==='#text'&&String(value).trim()===''||keys.includes(key)&&Array.isArray(value)));
function properties(nodes){
 const leaves=['w:tblStyle','w:tblW','w:jc','w:tblLayout','w:tblLook','w:bidiVisual','w:tblInd','w:tblCellSpacing','w:tblOverlap','w:tblHeader','w:cantSplit','w:trHeight','w:gridBefore','w:gridAfter','w:wBefore','w:wAfter','w:tcW','w:vAlign','w:textDirection','w:hideMark','w:noWrap','w:shd','w:cnfStyle','w:tblCaption','w:tblDescription'];
 for(const node of nodes)for(const [key,value] of Object.entries(node)){
  if(key===':@'||key==='#text'&&String(value).trim()==='')continue;
  if(['w:gridBefore','w:gridAfter'].includes(key)&&node[':@']?.['@_w:val']!=='0')return false;
  const edges=['w:top','w:left','w:bottom','w:right','w:start','w:end'],allowed=['w:tblBorders','w:tcBorders'].includes(key)?[...edges,'w:insideH','w:insideV','w:tl2br','w:tr2bl']:['w:tblCellMar','w:tcMar'].includes(key)?edges:null;
  if(allowed){if(!only(value,allowed)||value.some(n=>Object.entries(n).some(([k,v])=>k!==':@'&&(!Array.isArray(v)||v.length))))return false;}
  else if(!leaves.includes(key)||!Array.isArray(value)||value.length)return false;
 }
 return true;
}
// Request-local native bytes guard the newly placed frame; nothing is added to
// the public projection. The independent oracle has its own ZIP/XML reader.
export function nativeInstructionRowsComplete(buffer,sourceHash,rows,{firstPoint,nextPoint,uniqueBodyText=[]}={}){
 if(!Buffer.isBuffer(buffer)||buffer.length>8*1024*1024||createHash('sha256').update(buffer).digest('hex')!==sourceHash||!rows.length)return false;
 try{
  const parts=docxParts(buffer),parse=xml=>{if(!xml||/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)throw Error('XML unavailable');return new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml);},tree=parse(parts.get('word/document.xml')),documents=tree.filter(node=>node['w:document']);
  if(documents.length!==1||documents[0][':@']?.['@_xmlns:w']!==URI)return false;const bodies=child(documents[0]['w:document'],'w:body');if(bodies.length!==1)return false;
  const visibility=styleVisibility(parts.get('word/styles.xml')),hidden=state=>state.vanish||state.webHidden;
  const opaque=nodes=>nodes.some(node=>Object.entries(node).some(([key,value])=>['w:fldSimple','w:fldChar','w:instrText','w:vanish','w:webHidden','w:del','w:moveFrom'].includes(key)||['w:pStyle','w:rStyle'].includes(key)&&hidden(visibility.styledHidden(node[':@']?.['@_w:val'],visibility.defaults))||Array.isArray(value)&&opaque(value)));
  const safe=p=>!hidden(visibility.defaults)&&!hidden(visibility.styledHidden(visibility.defaultParagraph,visibility.defaults))&&!hidden(visibility.styledHidden(visibility.defaultCharacter,visibility.defaults))&&!opaque(p)&&knownInline(p);
  const body=bodies[0],records=[];let pCount=0,tCount=0,active=false,done=false;
  const entries=body.map((node,index)=>({node,index,path:node['w:p']?`/w:document[1]/w:body[1]/w:p[${++pCount}]`:node['w:tbl']?`/w:document[1]/w:body[1]/w:tbl[${++tCount}]`:null}));
  if(uniqueBodyText.some(text=>descendants(body,'w:p').filter(nodes=>nativeText(nodes).trim()===text).length!==1))return false;
  for(const {node,path} of entries){
   if(path===rows[0].source?.path)active=true;if(!active||done)continue;
   if(node['w:p']){if(!safe(node['w:p']))return false;records.push({path,nodes:node['w:p']});if(path===rows.at(-1).source?.path)done=true;}
   else if(node['w:tbl']){
    const table=node['w:tbl'];if(!only(table,['w:tblPr','w:tblGrid','w:tr'])||child(table,'w:tblPr').length>1||!child(table,'w:tblPr').every(properties)||child(table,'w:tblGrid').length!==1||!only(child(table,'w:tblGrid')[0],['w:gridCol'])||child(child(table,'w:tblGrid')[0],'w:gridCol').length!==2||child(table,'w:tblGrid')[0].some(col=>col['w:gridCol']?.length))return false;
    for(const [r,row] of child(table,'w:tr').entries()){
     if(!only(row,['w:tblPrEx','w:trPr','w:tc'])||child(row,'w:tblPrEx').length>1||child(row,'w:trPr').length>1||!child(row,'w:tblPrEx').every(properties)||!child(row,'w:trPr').every(properties)||child(row,'w:tc').length!==2)return false;
     for(const [c,cell] of child(row,'w:tc').entries()){
      if(!only(cell,['w:tcPr','w:p'])||child(cell,'w:tcPr').length>1||!child(cell,'w:tcPr').every(properties)||!child(cell,'w:p').length)return false;
      for(const [n,p] of child(cell,'w:p').entries()){if(!safe(p))return false;records.push({path:`${path}/w:tr[${r+1}]/w:tc[${c+1}]/w:p[${n+1}]`,nodes:p});}
     }
    }
   }else if(!(Object.keys(node).every(key=>key==='#text')&&String(node['#text']??'').trim()===''))return false;
  }
  if(!done||JSON.stringify(records.map(record=>record.path))!==JSON.stringify(rows.map(row=>row.source?.path)))return false;
  if(firstPoint){
   const point=records.find(record=>record.path===firstPoint.source.path),props=point&&child(point.nodes,'w:pPr')[0],number=props&&child(props,'w:numPr')[0],id=number&&val(number,'w:numId');
   if(!point||child(point.nodes,'w:pPr').length!==1||child(props,'w:numPr').length!==1||child(props,'w:pStyle').length!==1||child(number,'w:numId').length!==1||child(number,'w:ilvl').length!==1||val(number,'w:ilvl')!=='0'||id!==firstPoint.properties?.numbering?.id||val(props,'w:pStyle')!=='Point0number')return false;
   const numberingTree=parse(parts.get('word/numbering.xml')),roots=numberingTree.filter(node=>node['w:numbering']);if(roots.length!==1||roots[0][':@']?.['@_xmlns:w']!==URI)return false;
   const instances=roots[0]['w:numbering'].filter(node=>node['w:num']&&node[':@']?.['@_w:numId']===id);if(instances.length!==1)return false;const instance=instances[0]['w:num'],abstract=val(instance,'w:abstractNumId'),definitions=roots[0]['w:numbering'].filter(node=>node['w:abstractNum']&&node[':@']?.['@_w:abstractNumId']===abstract);if(definitions.length!==1||definitions[0]['w:abstractNum'].some(node=>node['w:numStyleLink']||node['w:styleLink']))return false;
   const levels=definitions[0]['w:abstractNum'].filter(node=>node['w:lvl']&&node[':@']?.['@_w:ilvl']==='0');if(levels.length!==1)return false;const level=levels[0]['w:lvl'];if(val(level,'w:start')!=='1'||val(level,'w:numFmt')!=='decimal'||val(level,'w:lvlText')!=='(%1)'||![undefined,'0'].includes(val(level,'w:lvlRestart'))||![undefined,'tab'].includes(val(level,'w:suff')))return false;
   const overrides=instance.filter(node=>node['w:lvlOverride']&&node[':@']?.['@_w:ilvl']==='0');if(overrides.length>1||overrides.length===1&&(child(overrides[0]['w:lvlOverride'],'w:lvl').length||val(overrides[0]['w:lvlOverride'],'w:startOverride')!=='1'))return false;
   // Projection filtering cannot remove a hidden or incomplete competitor.
   // Read every native paragraph before/inside this annex, including tables.
   const styleTree=parse(parts.get('word/styles.xml')),styleRoots=styleTree.filter(node=>node['w:styles']);if(styleRoots.length!==1||styleRoots[0][':@']?.['@_xmlns:w']!==URI)return false;
   const styleDefinitions=new Map();for(const node of styleRoots[0]['w:styles'])if(node['w:style']){const key=node[':@']?.['@_w:styleId'];if(styleDefinitions.has(key))return false;styleDefinitions.set(key,node['w:style']);}
   const styleNumber=(key,seen=new Set())=>{if(!key)return {};if(seen.has(key)||!styleDefinitions.has(key))throw Error('Unbound native style');seen.add(key);const nodes=styleDefinitions.get(key),props=child(nodes,'w:pPr')[0]||[],num=child(props,'w:numPr')[0]||[];return {...styleNumber(val(nodes,'w:basedOn'),seen),...(val(num,'w:numId')!==undefined?{id:val(num,'w:numId')}:{}),...(val(num,'w:ilvl')!==undefined?{level:val(num,'w:ilvl')}:{})};};
   const descriptor=nodes=>{if(child(nodes,'w:pPr').length>1)throw Error('Ambiguous native paragraph');const props=child(nodes,'w:pPr')[0]||[];if(child(props,'w:numPr').length>1||child(props,'w:pStyle').length>1)throw Error('Ambiguous native numbering');const style=val(props,'w:pStyle')??visibility.defaultParagraph,num=child(props,'w:numPr')[0]||[],inherited=styleNumber(style),id=val(num,'w:numId')??inherited.id,level=val(num,'w:ilvl')??inherited.level??'0';if(!id||id==='0')return null;const found=roots[0]['w:numbering'].filter(node=>node['w:num']&&node[':@']?.['@_w:numId']===id);if(found.length!==1||child(found[0]['w:num'],'w:abstractNumId').length!==1||child(num,'w:numId').length>1||child(num,'w:ilvl').length>1)throw Error('Unbound native list');return {id,level,style,abstract:val(found[0]['w:num'],'w:abstractNumId')};};
   const scopeStart=entries.findIndex(entry=>entry.path===rows[0].source.path),scopeEnd=entries.findIndex((entry,index)=>index>scopeStart&&entry.node['w:p']&&/^ANNEX [IVXLC]+$/u.test(nativeText(entry.node['w:p']).trim()));if(scopeStart<0||scopeEnd<0||!nextPoint)return false;
   const native=entries.flatMap(entry=>entry.node['w:p']?[{...entry,nodes:entry.node['w:p'],body:true}]:descendants([entry.node],'w:p').map(nodes=>({...entry,nodes,body:false})));
   if(native.some(entry=>entry.index<=scopeStart&&descriptor(entry.nodes)?.id===id))return false;
   const parents=[];
   for(const entry of native.filter(entry=>entry.index>scopeStart&&entry.index<scopeEnd)){
    const ref=descriptor(entry.nodes);if(!ref)continue;
    if(ref.style==='Point0number'&&(ref.abstract!==abstract||ref.level!=='0'))return false;
    if(ref.abstract!==abstract)continue;if(!/^[0-8]$/u.test(ref.level))return false;if(ref.level!=='0')continue;
    if(!entry.body||!safe(entry.nodes)||ref.style!=='Point0number')return false;parents.push(entry);
   }
   if(parents.length<2||parents[0].path!==firstPoint.source.path||parents[1].path!==nextPoint.source.path)return false;
   const quote=entries.slice(parents[0].index+1,parents[1].index);if(quote.length!==3||!quote[0].node['w:p']||!quote[1].node['w:tbl']||!quote[2].node['w:p']||quote[2].path!==rows.at(-1).source.path)return false;

  }
  return true;
 }catch{return false;}
}
