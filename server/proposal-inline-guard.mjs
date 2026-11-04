import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {docxParts,styleVisibility} from './document-text.mjs';
const URI='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const children=(nodes,key)=>nodes.flatMap(n=>n[key]?[n[key]]:[]);
// Scoped to the new interior-indent rule. Raw bytes stay request-local and are
// never added to the public proposal projection. Unknown inline constructs,
// including simple fields, cannot establish a newly placed insertion.
function inline(nodes){
 for(const node of nodes)for(const [key,value] of Object.entries(node)){
  if(key===':@')continue;
  if(['w:pPr','w:rPr'].includes(key))continue;
  if(key==='w:r'||key==='w:hyperlink'){if(!Array.isArray(value)||!inline(value))return false;continue;}
  if(key==='w:t'){if(!Array.isArray(value)||value.some(v=>Object.keys(v).some(k=>k!=='#text')))return false;continue;}
  if(['w:tab','w:br','w:cr','w:noBreakHyphen','w:softHyphen','w:lastRenderedPageBreak','w:bookmarkStart','w:bookmarkEnd','w:proofErr'].includes(key)&&Array.isArray(value)&&value.length===0)continue;
  return false;
 }
 return true;
}
export function nativeInlineRowsComplete(buffer,sourceHash,rows,{wholeBodyAfter=false,annexHeadings=null,onlyBlankAfter=false}={}){
 if(!Buffer.isBuffer(buffer)||buffer.length>8*1024*1024||createHash('sha256').update(buffer).digest('hex')!==sourceHash)return false;
 try{
  const parts=docxParts(buffer),xml=parts.get('word/document.xml'),visibility=styleVisibility(parts.get('word/styles.xml')); if(!xml||/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)return false;
  const tree=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml),documents=tree.filter(n=>n['w:document']);
  if(documents.length!==1||documents[0][':@']?.['@_xmlns:w']!==URI)return false;
  const bodies=children(documents[0]['w:document'],'w:body');if(bodies.length!==1)return false;
  const paragraphs=children(bodies[0],'w:p');
  const hidden=state=>state.vanish||state.webHidden;
  const hiddenOrField=nodes=>nodes.some(node=>Object.entries(node).some(([key,value])=>['w:fldSimple','w:fldChar','w:instrText','w:vanish','w:webHidden','w:del','w:moveFrom'].includes(key)||['w:pStyle','w:rStyle'].includes(key)&&hidden(visibility.styledHidden(node[':@']?.['@_w:val'],visibility.defaults))||Array.isArray(value)&&hiddenOrField(value)));
  const safe=p=>!hidden(visibility.defaults)&&!hidden(visibility.styledHidden(visibility.defaultParagraph,visibility.defaults))&&!hidden(visibility.styledHidden(visibility.defaultCharacter,visibility.defaults))&&!hiddenOrField(p)&&inline(p);
  const visibleText=nodes=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key==='w:t'?value.map(v=>v['#text']??''):Array.isArray(value)?[visibleText(value)]:[])).join('');
  if(annexHeadings){
   if(bodies[0].some(node=>!node['w:p']&&!node['w:tbl']&&!node['w:sectPr']))return false;
   const styles=p=>children(p,'w:pPr').flat().filter(node=>node['w:pStyle']).map(node=>node[':@']?.['@_w:val']);
   // Count nested headings too; a table must not hide another outer boundary.
   const all=nodes=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>Array.isArray(value)?[...(key==='w:p'?[value]:[]),...all(value)]:[]));
   const found=all(bodies[0]).filter(p=>styles(p).includes('Annexetitre'));
   const text=nodes=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key==='w:t'?value.map(v=>v['#text']??''):Array.isArray(value)?[text(value)]:[])).join('');
   if(found.length!==annexHeadings.length||found.some((p,i)=>{const expected=annexHeadings[i],ordinal=paragraphs.indexOf(p)+1;return !ordinal||!safe(p)||expected.source.path!==`/w:document[1]/w:body[1]/w:p[${ordinal}]`||text(p).trim()!==expected.text.trim();}))return false;
  }
  if(wholeBodyAfter){const first=Math.min(...rows.map(p=>Number(/^\/w:document\[1\]\/w:body\[1\]\/w:p\[(\d+)\]$/u.exec(p.source?.path||'')?.[1]||Infinity)));if(!Number.isFinite(first))return false;let ordinal=0;for(const node of bodies[0]){if(node['w:p']){ordinal++;if(ordinal>=first&&!safe(node['w:p'])||onlyBlankAfter&&ordinal>first&&visibleText(node['w:p']).trim())return false;}else if(ordinal>=first&&!node['w:sectPr']&&!['w:bookmarkStart','w:bookmarkEnd'].some(k=>Array.isArray(node[k])&&!node[k].length)&&!(Object.keys(node).every(k=>k==='#text')&&String(node['#text']??'').trim()===''))return false;}}
  return rows.every(p=>{const path=/^\/w:document\[1\]\/w:body\[1\]\/w:p\[(\d+)\]$/u.exec(p.source?.path||'');return path&&paragraphs[Number(path[1])-1]&&safe(paragraphs[Number(path[1])-1]);});
 }catch{return false;}
}
