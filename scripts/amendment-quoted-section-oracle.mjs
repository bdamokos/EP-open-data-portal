import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {quotedWordBody,quotedWordParts} from './amendment-benchmark-quoted-oracle.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
const descendants=(nodes,key)=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,value])=>name===key?[value]:Array.isArray(value)?descendants(value,key):[]));
const attr=(nodes,key)=>{for(const node of nodes){if(node[key])return node[':@']?.['@_w:val'];for(const value of Object.values(node))if(Array.isArray(value)){const found=attr(value,key);if(found!==undefined)return found;}}};
const normal=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
function safe(nodes){
 for(const node of nodes)for(const [name,value] of Object.entries(node)){
  if(name===':@'||['w:pPr','w:rPr'].includes(name))continue;
  if(['w:r','w:hyperlink'].includes(name)){if(!safe(value))return false;}
  else if(name==='w:t'){if(value.some(part=>Object.keys(part).some(key=>key!=='#text')))return false;}
  else if(!['w:tab','w:br','w:cr','w:noBreakHyphen','w:softHyphen','w:lastRenderedPageBreak','w:bookmarkStart','w:bookmarkEnd','w:proofErr'].includes(name)||value.length)return false;
 }
 return !['w:vanish','w:webHidden','w:del','w:moveFrom','w:fldSimple','w:fldChar','w:instrText','w:footnoteReference','w:endnoteReference','w:drawing','w:pict','w:object'].some(name=>descendants(nodes,name).length);
}
const literal=nodes=>nodes.map(node=>Object.entries(node).map(([name,value])=>name==='w:t'?value.map(part=>part['#text']??'').join(''):name==='w:tab'?'\t':['w:br','w:cr'].includes(name)?'\n':['w:r','w:hyperlink'].includes(name)?literal(value):'').join('')).join('');
const only=(nodes,names)=>nodes.every(node=>Object.entries(node).every(([name,value])=>name===':@'||name==='#text'&&String(value).trim()===''||names.includes(name)&&Array.isArray(value)));
function gridProperties(nodes){
 const leaves=['w:tblStyle','w:tblW','w:jc','w:tblLayout','w:tblLook','w:bidiVisual','w:tblInd','w:tblCellSpacing','w:tblOverlap','w:tblHeader','w:cantSplit','w:trHeight','w:gridBefore','w:gridAfter','w:wBefore','w:wAfter','w:tcW','w:gridSpan','w:vAlign','w:textDirection','w:hideMark','w:noWrap','w:shd','w:cnfStyle','w:tblCaption','w:tblDescription'];
 for(const node of nodes)for(const [name,value] of Object.entries(node)){
  if(name===':@'||name==='#text'&&String(value).trim()==='')continue;
  const edges=['w:top','w:left','w:bottom','w:right','w:start','w:end'],allowed=['w:tblBorders','w:tcBorders'].includes(name)?[...edges,'w:insideH','w:insideV','w:tl2br','w:tr2bl']:['w:tblCellMar','w:tcMar'].includes(name)?edges:null;
  if(allowed){if(!only(value,allowed)||value.some(n=>Object.entries(n).some(([key,v])=>key!==':@'&&(!Array.isArray(v)||v.length))))return false;}
  else if(!leaves.includes(name)||!Array.isArray(value)||value.length)return false;
 }
 return true;
}
function completeGrid(table){
 if(!only(table,['w:tblPr','w:tblGrid','w:tr'])||children(table,'w:tblPr').length>1||children(table,'w:tblGrid').length>1||!children(table,'w:tblPr').every(gridProperties)||children(table,'w:tblGrid').some(grid=>!only(grid,['w:gridCol'])||grid.some(n=>n['w:gridCol']?.length)))return false;
 return children(table,'w:tr').every(row=>only(row,['w:trPr','w:tc'])&&children(row,'w:trPr').length<=1&&children(row,'w:trPr').every(gridProperties)&&children(row,'w:tc').every(cell=>only(cell,['w:tcPr','w:p'])&&children(cell,'w:tcPr').length<=1&&children(cell,'w:tcPr').every(gridProperties)));
}
function reportComparison(body,number){
 const starts=body.flatMap((row,index)=>row.kind==='paragraph'&&normal(row.text)==='Amendment '+number?[index]:[]);if(starts.length!==1)return null;
 const rows=body.slice(starts[0],starts[0]+6);
 if(rows.length!==6||rows.slice(0,5).some(row=>row.kind!=='paragraph'||row.hidden||!safe(row.nodes))||rows[1].text!=='Proposal for a regulation'||rows[5].kind!=='other'||rows[5].hidden||!rows[5].nodes['w:tbl'])return null;
 const tail=body.slice(starts[0]+6),boundary=tail.findIndex(row=>row.kind==='paragraph'&&/^Amendment \d+$/u.test(normal(row.text))),trailing=boundary<0?tail:tail.slice(0,boundary);
 if(trailing.some(row=>row.kind==='paragraph'?row.hidden||!safe(row.nodes)||row.text.trim()!=='':!row.nodes?.['w:sectPr']))return null;
 if(boundary>=0&&(tail[boundary].hidden||!safe(tail[boundary].nodes)))return null;
 const table=rows[5].nodes['w:tbl'];
 if(!completeGrid(table))return null;
 if(['w:tbl','w:vMerge','w:hMerge'].some(name=>descendants(table,name).length))return null;
 const tableRows=children(table,'w:tr'),layout=tableRows[0],cells=layout&&children(layout,'w:tc');
 if(cells?.length===1&&descendants(layout,'w:gridSpan').length===1&&attr(layout,'w:gridSpan')==='2'&&children(cells[0],'w:p').length&&children(cells[0],'w:p').every(p=>safe(p)&&literal(p)===''))tableRows.shift();
 if(tableRows.some(row=>descendants(row,'w:gridSpan').length))return null;
 const grid=tableRows.map(row=>children(row,'w:tc').map(cell=>{
  const paragraphs=children(cell,'w:p');if(!paragraphs.length||paragraphs.some(p=>!safe(p)))return null;return paragraphs.map(literal).join('\n').trim();
 }));
 if(grid.length!==2||grid.some(row=>row.length!==2||row.includes(null))||grid[0][0]!=='Text proposed by the Commission'||grid[0][1]!=='Amendment')return null;
 return {outer:rows[2].text,act:rows[3].text,inner:rows[4].text,original:grid[1][0],proposed:grid[1][1]};
}
// Count only level zero of one explicitly restarted native multilevel list.
// All lower levels and table paragraphs are inspected so another instance or
// a hidden parent-counter competitor cannot disappear from the proof.
function outerPoints(parts,body,first,last){
 const parse=xml=>{if(!xml||/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)throw Error('XML unavailable');return new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml);};
 const styleTree=parse(parts.get('word/styles.xml')),numberTree=parse(parts.get('word/numbering.xml')),styles=children(styleTree,'w:styles')[0],numbering=children(numberTree,'w:numbering')[0],URI='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 if(!styles||!numbering||styleTree.filter(node=>node['w:styles']).length!==1||numberTree.filter(node=>node['w:numbering']).length!==1||styleTree.find(node=>node['w:styles'])[':@']?.['@_xmlns:w']!==URI||numberTree.find(node=>node['w:numbering'])[':@']?.['@_xmlns:w']!==URI)throw Error('Native lists unavailable');
 const definitions=new Map(),instances=new Map(),abstracts=new Map();
 for(const node of styles)if(node['w:style']){const id=node[':@']?.['@_w:styleId'];if(definitions.has(id))throw Error('Duplicate style');definitions.set(id,node['w:style']);}
 for(const node of numbering)for(const [name,map,key] of [['w:num',instances,'numId'],['w:abstractNum',abstracts,'abstractNumId']])if(node[name]){const id=node[':@']?.['@_w:'+key];if(map.has(id))throw Error('Duplicate numbering');map.set(id,node[name]);}
 const styleNumber=(id,seen=new Set())=>{if(!id)return {};if(seen.has(id)||!definitions.has(id))throw Error('Style unavailable');seen.add(id);const nodes=definitions.get(id),own=children(children(nodes,'w:pPr')[0]||[],'w:numPr')[0]||[];return {...styleNumber(attr(nodes,'w:basedOn'),seen),...(attr(own,'w:numId')!==undefined?{id:attr(own,'w:numId')}:{}),...(attr(own,'w:ilvl')!==undefined?{level:attr(own,'w:ilvl')}:{})};};
 const defaultStyle=styles.find(node=>node['w:style']&&node[':@']?.['@_w:type']==='paragraph'&&['1','true','on'].includes(node[':@']?.['@_w:default']))?.[':@']?.['@_w:styleId'];
 const descriptor=nodes=>{const props=children(nodes,'w:pPr')[0]||[],style=attr(props,'w:pStyle')??defaultStyle,own=children(props,'w:numPr')[0]||[],inherited=styleNumber(style),id=attr(own,'w:numId')??inherited.id,level=attr(own,'w:ilvl')??inherited.level??'0';if(!id||id==='0')return null;const instance=instances.get(id);if(!instance)throw Error('List instance unavailable');return {id,level,style,abstract:attr(instance,'w:abstractNumId')};};
 const native=[];
 for(let index=0;index<body.length;index++){const row=body[index];if(row.kind==='paragraph')native.push({nodes:row.nodes,row,index});else for(const nodes of descendants([row.nodes],'w:p'))native.push({nodes,row:null,index});}
 const scoped=native.filter(p=>p.index>first&&p.index<last),lead=scoped.find(p=>descriptor(p.nodes)?.style==='Point0number'),identity=lead&&descriptor(lead.nodes);if(!identity||identity.level!=='0')throw Error('Parent list unavailable');
 const instance=instances.get(identity.id),abstract=abstracts.get(identity.abstract),levels=abstract?.filter(node=>node['w:lvl']&&node[':@']?.['@_w:ilvl']==='0');
 const overrides=instance.filter(node=>node['w:lvlOverride']&&node[':@']?.['@_w:ilvl']==='0');
 if(!abstract||['w:numStyleLink','w:styleLink'].some(name=>descendants(abstract,name).length)||levels.length!==1||attr(levels[0]['w:lvl'],'w:numFmt')!=='decimal'||attr(levels[0]['w:lvl'],'w:lvlText')!=='(%1)'||attr(levels[0]['w:lvl'],'w:start')!=='1'||![undefined,'0'].includes(attr(levels[0]['w:lvl'],'w:lvlRestart'))||![undefined,'tab'].includes(attr(levels[0]['w:lvl'],'w:suff'))||overrides.length!==1||descendants(overrides[0]['w:lvlOverride'],'w:lvl').length||attr(overrides[0]['w:lvlOverride'],'w:startOverride')!=='1')throw Error('Parent ordinal unavailable');
 if(native.some(p=>p.index<=first&&descriptor(p.nodes)?.id===identity.id))throw Error('List started outside annex');
 const points=[];
 for(const entry of scoped){const ref=descriptor(entry.nodes);if(!ref)continue;if(ref.style==='Point0number'&&(ref.abstract!==identity.abstract||ref.level!=='0'))throw Error('Conflicting parent list');if(ref.abstract!==identity.abstract)continue;if(!/^[0-8]$/u.test(ref.level))throw Error('Unknown list level');if(ref.level==='0'){if(ref.id!==identity.id)throw Error('Competing list instance');if(!entry.row||entry.row.hidden||!safe(entry.nodes)||ref.style!=='Point0number')throw Error('Opaque parent point');points.push({...entry.row,index:entry.index,value:points.length+1});}}
 return points;
}
export function assertQuotedSectionPoint({proposal,wording,placement,nativeQuoted}){
 const unknown=()=>({status:'unverified',reason:'oracle-quoted-section-point-unavailable'});
 const target=wording?.language==='en'&&/^Annex ([IVXLCDM]+) – paragraph 1 – point ([1-9]\d*)\n(Regulation \((?:EC|EU)\) No \d+\/\d+)\nAnnex ([IVXLCDM]+) – section (\d+(?:\.\d+)+) – point \(([a-z]) a\) new$/u.exec(wording.targetLabel||'');
 if(!target||wording.baseline!=='commission-proposal'||wording.originalText!==''||placement.operation!=='insert'||!proposal||!Buffer.isBuffer(nativeQuoted?.proposalBuffer)||!Buffer.isBuffer(nativeQuoted?.amendmentBuffer)||hash(nativeQuoted.proposalBuffer)!==proposal.sourceHash||!Number.isSafeInteger(nativeQuoted.number)||nativeQuoted.number<1||wording.number!==undefined&&wording.number!==nativeQuoted.number||!wording.proposedText.startsWith('('+target[6]+' a)\t')||!wording.proposedText.endsWith('’;'))return unknown();
 let raw,comparison,points;
 try{
  raw=quotedWordBody(nativeQuoted.proposalBuffer);comparison=reportComparison(quotedWordBody(nativeQuoted.amendmentBuffer),nativeQuoted.number);
  if(!comparison||[comparison.outer,comparison.act,comparison.inner].join('\n')!==wording.targetLabel||comparison.original!==wording.originalText||comparison.proposed!==wording.proposedText)return unknown();
  const heads=raw.filter(row=>row.kind==='paragraph'&&row.text.trim()==='ANNEX '+target[1]);if(heads.length!==1||heads[0].hidden||!safe(heads[0].nodes))return unknown();const first=raw.indexOf(heads[0]),last=raw.findIndex((row,index)=>index>first&&row.kind==='paragraph'&&/^ANNEX [IVXLCDM]+$/u.test(row.text.trim()));if(last<0)return unknown();
  const lead=raw[first+1],scope=lead?.kind==='paragraph'&&/^Annexes ([IVXLCDM]+) and ([IVXLCDM]+) to (.+) are amended as follows:$/u.exec(normal(lead.text));
  if(!scope||![scope[1],scope[2]].includes(target[4])||scope[3]!==target[3]||lead.hidden||!safe(lead.nodes))return unknown();
  points=outerPoints(quotedWordParts(nativeQuoted.proposalBuffer),raw,first,last);
  const owner=points.find(row=>row.value===Number(target[2])),next=points.find(row=>row.value===Number(target[2])+1);
  if(!owner||!next||normal(owner.text)!==`in Annex ${target[4]}, section ${target[5]} is replaced by the following:`)return unknown();
  const quote=raw.slice(owner.index+1,next.index);
  if(quote.length!==target[6].charCodeAt(0)-96+1||quote.some(row=>row.kind!=='paragraph'||row.hidden||!safe(row.nodes)))return unknown();
  if(!quote[0].text.startsWith('‘'+target[5]+'. ')||quote.slice(1).some((row,index)=>!row.text.startsWith('('+String.fromCharCode(97+index)+') '))||!quote.at(-1).text.endsWith('’;'))return unknown();
  const content=quote.map(row=>row.text).join('\n');if(content.split('‘').length!==2||content.split('’').length!==2)return unknown();
  const mapped=[];
  for(const row of [owner,...quote,next]){const prefix=row.value?'('+row.value+')\t':'',found=proposal.paragraphs.filter(p=>p.source?.path===row.path&&p.text===prefix+row.text.trim()&&p.complete&&p.source.complete&&p.source.container==='body');if(found.length!==1)return unknown();mapped.push(found[0]);}
  if(mapped.some((p,index)=>index&&(p.index!==mapped[index-1].index+1||p.source.ordinal!==mapped[index-1].source.ordinal+1||p.source.segment!==mapped[index-1].source.segment)))return unknown();
  const before=mapped.at(-1).index;
  return placement.status==='placed'&&placement.insertBefore===before&&placement.insertAfter===before-1?{status:'verified',reason:'oracle-native-quoted-section-point',nativeSourceHashes:{proposal:proposal.sourceHash,amendment:hash(nativeQuoted.amendmentBuffer)}}:{status:'failed',reason:'oracle-quoted-section-point-boundary-mismatch'};
 }catch{return unknown();}
}
