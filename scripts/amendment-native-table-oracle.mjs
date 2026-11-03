import {XMLParser,XMLValidator} from 'fast-xml-parser';
// Native XML only: no production legal hierarchy or placement evidence.
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
const descendants=(nodes,key)=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,value])=>name===key?[value]:Array.isArray(value)?descendants(value,key):[]));
const attr=(nodes,key)=>{for(const node of nodes){if(node[key])return node[':@']?.['@_w:val'];for(const value of Object.values(node))if(Array.isArray(value)){const found=attr(value,key);if(found!==undefined)return found;}}};
const normal=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
export function safe(nodes){
 for(const node of nodes)for(const [name,value] of Object.entries(node)){
  if(name===':@'||['w:pPr','w:rPr'].includes(name))continue;
  if(['w:r','w:hyperlink'].includes(name)){if(!safe(value))return false;}
  else if(name==='w:t'){if(value.some(part=>Object.keys(part).some(key=>key!=='#text')))return false;}
  else if(!['w:tab','w:br','w:cr','w:noBreakHyphen','w:softHyphen','w:lastRenderedPageBreak','w:bookmarkStart','w:bookmarkEnd','w:proofErr'].includes(name)||value.length)return false;
 }
 return !['w:vanish','w:webHidden','w:del','w:moveFrom','w:fldSimple','w:fldChar','w:instrText','w:footnoteReference','w:endnoteReference','w:drawing','w:pict','w:object'].some(name=>descendants(nodes,name).length);
}
export const literal=nodes=>nodes.map(node=>Object.entries(node).map(([name,value])=>name==='w:t'?value.map(part=>part['#text']??'').join(''):name==='w:tab'?'\t':name==='w:noBreakHyphen'?'\u2011':name==='w:softHyphen'?'\u00ad':['w:br','w:cr'].includes(name)?'\n':['w:r','w:hyperlink'].includes(name)?literal(value):'').join('')).join('');
const only=(nodes,names)=>nodes.every(node=>Object.entries(node).every(([name,value])=>name===':@'||name==='#text'&&String(value).trim()===''||names.includes(name)&&Array.isArray(value)));
function gridProperties(nodes){
 const leaves=['w:tblStyle','w:tblW','w:jc','w:tblLayout','w:tblLook','w:bidiVisual','w:tblInd','w:tblCellSpacing','w:tblOverlap','w:tblHeader','w:cantSplit','w:trHeight','w:gridBefore','w:gridAfter','w:wBefore','w:wAfter','w:tcW','w:gridSpan','w:vAlign','w:textDirection','w:hideMark','w:noWrap','w:shd','w:cnfStyle','w:tblCaption','w:tblDescription'];
 for(const node of nodes)for(const [name,value] of Object.entries(node)){
  if(name===':@'||name==='#text'&&String(value).trim()==='')continue;
  if(['w:gridBefore','w:gridAfter'].includes(name)&&node[':@']?.['@_w:val']!=='0')return false;
  const edges=['w:top','w:left','w:bottom','w:right','w:start','w:end'],allowed=['w:tblBorders','w:tcBorders'].includes(name)?[...edges,'w:insideH','w:insideV','w:tl2br','w:tr2bl']:['w:tblCellMar','w:tcMar'].includes(name)?edges:null;
  if(allowed){if(!only(value,allowed)||value.some(n=>Object.entries(n).some(([key,v])=>key!==':@'&&(!Array.isArray(v)||v.length))))return false;}
  else if(!leaves.includes(name)||!Array.isArray(value)||value.length)return false;
 }
 return true;
}
export function completeGrid(table){
 if(!only(table,['w:tblPr','w:tblGrid','w:tr'])||children(table,'w:tblPr').length>1||children(table,'w:tblGrid').length>1||!children(table,'w:tblPr').every(gridProperties)||children(table,'w:tblGrid').some(grid=>!only(grid,['w:gridCol'])||grid.some(n=>n['w:gridCol']?.length)))return false;
 return children(table,'w:tr').every(row=>only(row,['w:tblPrEx','w:trPr','w:tc'])&&children(row,'w:tblPrEx').length<=1&&children(row,'w:tblPrEx').every(gridProperties)&&children(row,'w:trPr').length<=1&&children(row,'w:trPr').every(gridProperties)&&children(row,'w:tc').every(cell=>only(cell,['w:tcPr','w:p'])&&children(cell,'w:tcPr').length<=1&&children(cell,'w:tcPr').every(gridProperties)));
}
// Prove the first parent counter starts at1. Later parent rows delimit its
// instruction; their displayed ordinals are not inferred across list instances.
// All lower levels and table paragraphs are inspected so another instance or
// a hidden parent-counter competitor cannot disappear from the proof.
export function nativeAnnexInstructionRows(parts,body,first,last){
 const parse=xml=>{if(!xml||/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)throw Error('XML unavailable');return new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml);};
 const styleTree=parse(parts.get('word/styles.xml')),numberTree=parse(parts.get('word/numbering.xml')),styles=children(styleTree,'w:styles')[0],numbering=children(numberTree,'w:numbering')[0],URI='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 if(!styles||!numbering||styleTree.filter(node=>node['w:styles']).length!==1||numberTree.filter(node=>node['w:numbering']).length!==1||styleTree.find(node=>node['w:styles'])[':@']?.['@_xmlns:w']!==URI||numberTree.find(node=>node['w:numbering'])[':@']?.['@_xmlns:w']!==URI)throw Error('Native lists unavailable');
 const definitions=new Map(),instances=new Map(),abstracts=new Map();
 for(const node of styles)if(node['w:style']){const id=node[':@']?.['@_w:styleId'];if(definitions.has(id))throw Error('Duplicate style');definitions.set(id,node['w:style']);}
 for(const node of numbering)for(const [name,map,key] of [['w:num',instances,'numId'],['w:abstractNum',abstracts,'abstractNumId']])if(node[name]){const id=node[':@']?.['@_w:'+key];if(map.has(id))throw Error('Duplicate numbering');map.set(id,node[name]);}
 const styleNumber=(id,seen=new Set())=>{if(!id)return {};if(seen.has(id)||!definitions.has(id))throw Error('Style unavailable');seen.add(id);const nodes=definitions.get(id),own=children(children(nodes,'w:pPr')[0]||[],'w:numPr')[0]||[];return {...styleNumber(attr(nodes,'w:basedOn'),seen),...(attr(own,'w:numId')!==undefined?{id:attr(own,'w:numId')}:{}),...(attr(own,'w:ilvl')!==undefined?{level:attr(own,'w:ilvl')}:{})};};
 const defaultStyle=styles.find(node=>node['w:style']&&node[':@']?.['@_w:type']==='paragraph'&&['1','true','on'].includes(node[':@']?.['@_w:default']))?.[':@']?.['@_w:styleId'];
 const descriptor=nodes=>{if(children(nodes,'w:pPr').length>1)throw Error('Duplicate paragraph properties');const props=children(nodes,'w:pPr')[0]||[];if(children(props,'w:numPr').length>1||children(props,'w:pStyle').length>1)throw Error('Duplicate numbering properties');const style=attr(props,'w:pStyle')??defaultStyle,own=children(props,'w:numPr')[0]||[],inherited=styleNumber(style),id=attr(own,'w:numId')??inherited.id,level=attr(own,'w:ilvl')??inherited.level??'0';if(!id||id==='0')return null;const instance=instances.get(id);if(!instance||children(instance,'w:abstractNumId').length!==1||children(own,'w:numId').length>1||children(own,'w:ilvl').length>1)throw Error('List instance unavailable');return {id,level,style,abstract:attr(instance,'w:abstractNumId')};};
 const native=[];
 for(let index=0;index<body.length;index++){const row=body[index];if(row.kind==='paragraph')native.push({nodes:row.nodes,row,index});else for(const nodes of descendants([row.nodes],'w:p'))native.push({nodes,row:null,index});}
 const scoped=native.filter(p=>p.index>first&&p.index<last),lead=scoped.find(p=>descriptor(p.nodes)?.style==='Point0number'),identity=lead&&descriptor(lead.nodes);if(!identity||identity.level!=='0')throw Error('Parent list unavailable');
 const abstract=abstracts.get(identity.abstract),levels=abstract?.filter(node=>node['w:lvl']&&node[':@']?.['@_w:ilvl']==='0');
 if(!abstract||['w:numStyleLink','w:styleLink'].some(name=>descendants(abstract,name).length)||levels.length!==1||attr(levels[0]['w:lvl'],'w:numFmt')!=='decimal'||attr(levels[0]['w:lvl'],'w:lvlText')!=='(%1)'||attr(levels[0]['w:lvl'],'w:start')!=='1'||![undefined,'0'].includes(attr(levels[0]['w:lvl'],'w:lvlRestart'))||![undefined,'tab'].includes(attr(levels[0]['w:lvl'],'w:suff')))throw Error('Parent ordinal unavailable');
 const start=id=>{const instance=instances.get(id),overrides=instance.filter(node=>node['w:lvlOverride']&&node[':@']?.['@_w:ilvl']==='0');if(overrides.length>1||overrides.length===1&&descendants(overrides[0]['w:lvlOverride'],'w:lvl').length)throw Error('Ambiguous parent restart');if(overrides.length&&children(overrides[0]['w:lvlOverride'],'w:startOverride').length!==1)throw Error('Ambiguous start');const value=overrides.length?attr(overrides[0]['w:lvlOverride'],'w:startOverride'):'1';if(!/^[1-9]\d{0,3}$/u.test(value))throw Error('Parent restart unavailable');return Number(value);};
 if(start(identity.id)!==1||native.some(p=>p.index<=first&&descriptor(p.nodes)?.id===identity.id))throw Error('First parent ordinal unavailable');
 const points=[];
 for(const entry of scoped){
  const ref=descriptor(entry.nodes);if(!ref)continue;
  if(ref.style==='Point0number'&&(ref.abstract!==identity.abstract||ref.level!=='0'))throw Error('Conflicting parent list');
  if(ref.abstract!==identity.abstract)continue;
  if(!/^[0-8]$/u.test(ref.level))throw Error('Unknown list level');if(ref.level!=='0')continue;
  if(!entry.row||entry.row.hidden||!safe(entry.nodes)||ref.style!=='Point0number')throw Error('Opaque parent point');
  start(ref.id);points.push({...entry.row,index:entry.index});
 }
 return points;
}
