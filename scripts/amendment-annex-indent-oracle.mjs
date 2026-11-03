import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {quotedWordBody,quotedWordParts} from './amendment-benchmark-quoted-oracle.mjs';
const children=(nodes,key)=>nodes.flatMap(n=>n[key]?[n[key]]:[]);
const attrs=(nodes,key)=>nodes.flatMap(n=>Object.entries(n).flatMap(([k,v])=>k===key?[n[':@']||{}]:Array.isArray(v)?attrs(v,key):[]));
const has=(nodes,key)=>nodes.some(n=>Object.entries(n).some(([k,v])=>k===key||Array.isArray(v)&&has(v,key)));
const val=(nodes,key)=>attrs(nodes,key)[0]?.['@_w:val'];
const hash=b=>createHash('sha256').update(b).digest('hex');
function knownInline(nodes){
 const containers=new Set(['w:r','w:hyperlink']),literal=new Set(['w:tab','w:br','w:cr','w:noBreakHyphen','w:softHyphen','w:lastRenderedPageBreak','w:bookmarkStart','w:bookmarkEnd','w:proofErr']);
 for(const node of nodes)for(const [name,value] of Object.entries(node)){
  if(name===':@'||name==='w:pPr'||name==='w:rPr')continue;
  if(containers.has(name)){if(!knownInline(value))return false;}
  else if(name==='w:t'){if(value.some(n=>Object.keys(n).some(k=>k!=='#text')))return false;}
  else if(!literal.has(name)||!Array.isArray(value)||value.length)return false;
 }
 return true;
}
const unsafe=r=>r.hidden||!knownInline(r.nodes)||['w:del','w:moveFrom','w:vanish','w:webHidden','w:instrText','w:fldChar','w:fldSimple','w:drawing','w:pict','w:object','m:oMath','w:footnoteReference','w:endnoteReference'].some(k=>has(r.nodes,k));
const parse=xml=>{if(!xml||/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)throw Error('Native XML unavailable');return new XMLParser({preserveOrder:true,ignoreAttributes:false,trimValues:false,parseTagValue:false}).parse(xml);};
// This reader supports only the level-zero decimal points and native bullets
// needed for an interior indent address. It neither imports nor calls the
// production numbering engine. Restarting instances reset their abstract list;
// unoverridden instances, including style defaults, continue that list.
function listReader(parts){
 const numberTree=parse(parts.get('word/numbering.xml')),styleTree=parse(parts.get('word/styles.xml'));
 if(attrs(numberTree,'w:numbering')[0]?.['@_xmlns:w']!=='http://schemas.openxmlformats.org/wordprocessingml/2006/main'||attrs(styleTree,'w:styles')[0]?.['@_xmlns:w']!=='http://schemas.openxmlformats.org/wordprocessingml/2006/main')throw Error('List namespace unavailable');
 const numbering=children(numberTree,'w:numbering')[0],styles=children(styleTree,'w:styles')[0];
 const definitions=new Map(),lists=new Map(),abstracts=new Map();
 for(const n of styles){if(n['w:style']){const id=n[':@']?.['@_w:styleId'];if(definitions.has(id))throw Error('Duplicate style');definitions.set(id,n['w:style']);}}
 for(const n of numbering){for(const [key,map,id] of [['w:num',lists,'numId'],['w:abstractNum',abstracts,'abstractNumId']])if(n[key]){const value=n[':@']?.['@_w:'+id];if(map.has(value))throw Error('Duplicate list');map.set(value,n[key]);}}
 const styleNum=(id,seen=new Set())=>{if(!id)return {};if(seen.has(id))throw Error('Style cycle');seen.add(id);const s=definitions.get(id);if(!s)throw Error('Style unavailable');const own=children(children(s,'w:pPr')[0]||[],'w:numPr')[0]||[];return {...styleNum(val(s,'w:basedOn'),seen),...(val(own,'w:numId')!==undefined?{id:val(own,'w:numId')}:{ }),...(val(own,'w:ilvl')!==undefined?{level:val(own,'w:ilvl')}:{})};};
 const counters=new Map(),started=new Set();
 return row=>{
  const props=children(row.nodes,'w:pPr')[0]||[],style=val(props,'w:pStyle'),own=children(props,'w:numPr')[0]||[],inherited=styleNum(style),id=val(own,'w:numId')??inherited.id,level=val(own,'w:ilvl')??inherited.level??'0';
  if(!id||id==='0')return null;if(level!=='0')throw Error('Nested list unavailable');
  const num=lists.get(id),abstractId=val(num||[],'w:abstractNumId'),abstract=abstracts.get(abstractId);
  if(!num||!abstract||has(abstract,'w:numStyleLink')||has(abstract,'w:styleLink'))throw Error('List unavailable');
  const levels=abstract.filter(n=>n['w:lvl']&&n[':@']?.['@_w:ilvl']==='0');if(levels.length!==1)throw Error('List level unavailable');const def=levels[0]['w:lvl'];
  const overrides=num.filter(n=>n['w:lvlOverride']&&n[':@']?.['@_w:ilvl']==='0');if(overrides.length>1||overrides.some(n=>has(n['w:lvlOverride'],'w:lvl')))throw Error('Override unavailable');
  const restart=overrides.length?val(overrides[0]['w:lvlOverride'],'w:startOverride'):undefined;
  if(restart!==undefined&&restart!=='1'||val(def,'w:start')!=='1'||![undefined,'tab'].includes(val(def,'w:suff')))throw Error('List start unavailable');
  const fmt=val(def,'w:numFmt'),pattern=val(def,'w:lvlText');
  if(fmt==='decimal'&&pattern!=='(%1)'||fmt==='bullet'&&!['•','\uf0b7'].includes(pattern)||!['decimal','bullet'].includes(fmt)||pattern==='\uf0b7'&&!attrs(def,'w:rFonts').some(a=>a['@_w:ascii']==='Symbol'))throw Error('List format unavailable');
  if(restart&&!started.has(id))counters.set(abstractId,0);started.add(id);const value=(counters.get(abstractId)||0)+1;counters.set(abstractId,value);
  return {id,abstractId,style,kind:fmt,value,prefix:fmt==='decimal'?`(${value})\t`:'•\t'};
 };
}
// Shared independent native source proof; no runtime tree or label resolver.
export function nativeBareAnnexList({items,proposal,itemIndex,nativeQuoted}){
 if(!proposal||items?.length!==2||items.filter(i=>i.kind==='act').length!==1||items.filter(i=>i.kind==='annex').length!==1||items[itemIndex]?.kind!=='annex')return null;
 if(!Buffer.isBuffer(nativeQuoted?.proposalBuffer)||!nativeQuoted?.proposalBuffers?.every(Buffer.isBuffer)||nativeQuoted.proposalBuffers.length!==items.length||nativeQuoted.proposalBuffers.some((b,i)=>hash(b)!==items[i].proposal.sourceHash)||hash(nativeQuoted.proposalBuffer)!==proposal.sourceHash)return null;
 let body,act,read;try{body=quotedWordBody(nativeQuoted.proposalBuffer);const other=items.findIndex(i=>i.kind==='act');if(other<0)return null;act=quotedWordBody(nativeQuoted.proposalBuffers[other]);read=listReader(quotedWordParts(nativeQuoted.proposalBuffer));}catch{return null;}
 const headings=body.filter(r=>r.kind==='paragraph'&&val(r.nodes,'w:pStyle')==='Annexetitre');
 if(body.filter(r=>r.kind==='paragraph'&&/^ANNEX(?:\s+[IVXLCDM\d]+)?$/u.test(r.text.trim())).length!==1||headings.length!==1||headings[0].text.trim()!=='ANNEX'||unsafe(headings[0])||!act.some(r=>r.kind==='paragraph'&&!unsafe(r)&&!r.unsafe&&/\bthe Annex\b/u.test(r.text))||act.some(r=>r.kind==='paragraph'&&/\bAnnex\s+(?:[IVXLCDM]+|\d+)\b/u.test(r.text)))return null;
 if(proposal.paragraphs.filter(p=>p.source?.path===headings[0].path&&p.text==='ANNEX'&&p.complete&&p.source.complete===true).length!==1)return null;
 const raw=body.slice(body.indexOf(headings[0])+1),points=[];let point=null;
 try{for(const row of raw){
  if(row.kind!=='paragraph'){if(['w:bookmarkStart','w:bookmarkEnd'].some(k=>Array.isArray(row.nodes?.[k])&&row.nodes[k].length===0&&Object.keys(row.nodes).every(name=>name===k||name===':@')))continue;if(row.nodes?.['w:sectPr']||Object.keys(row.nodes||{}).every(k=>k==='#text')&&String(row.nodes?.['#text']??'').trim()==='')continue;return null;}
  if(unsafe(row))return null;const list=read(row);
  if(!row.text.trim()){if(list)return null;continue;}
  if(!list){if(point)return null;continue;}
  if(list.kind==='decimal'&&list.style==='Point0number'){
   if(list.value!==points.length+1)return null;point={row,list,indents:[]};points.push(point);
  }else if(list.kind==='bullet'&&list.style==='Bullet0'&&point){point.indents.push({row,list});}else return null;
 }}catch{return null;}
 return {heading:headings[0],points};
}
export function nativeBareAnnexPointRows(proof,proposal,number){
 const selected=proof?.points[Number(number)-1];if(!selected)return null;
 const rows=[{row:selected.row,list:selected.list},...selected.indents],mapped=[];
 for(const {row,list} of rows){const text=list.prefix+row.text.trim(),matches=proposal.paragraphs.filter(p=>p.source?.path===row.path&&p.text===text&&p.complete&&p.source.complete===true&&p.source.container==='body');if(matches.length!==1)return null;mapped.push(matches[0]);}
 if(mapped.some((p,i)=>i&&(p.index!==mapped[i-1].index+1||p.source.ordinal!==mapped[i-1].source.ordinal+1||p.source.segment!==mapped[i-1].source.segment)))return null;
 return mapped;
}
export function assertBareAnnexIndent({items,proposal,wording,placement,nativeQuoted}){
 const unknown=()=>({status:'unverified',reason:'oracle-bare-annex-indent-unavailable'}),failed=()=>({status:'failed',reason:'oracle-bare-annex-indent-boundary-mismatch'});
 const target=wording?.language==='en'&&/^Annex I – point (\d+) – indent (\d+) a \(new\)$/u.exec(wording.targetLabel||'');
 if(!target||!proposal||wording.baseline!=='commission-proposal'||wording.originalText!==''||!/^[-–—•]\s+\S/u.test(wording.proposedText||'')||placement.operation!=='insert')return unknown();
 const proof=nativeBareAnnexList({items,proposal,itemIndex:placement.itemIndex,nativeQuoted}),selected=proof?.points[Number(target[1])-1],base=Number(target[2]);
 if(!selected||base<1||base>=selected.indents.length)return unknown();
 const mapped=nativeBareAnnexPointRows(proof,proposal,target[1]);if(!mapped)return unknown();
 const before=mapped[base+1].index;if(placement.status!=='placed'||placement.insertBefore!==before||placement.insertAfter!==before-1)return failed();
 return {status:'verified',reason:'oracle-native-bare-annex-indent',rawSourceRows:[proof.heading.path,selected.row.path,selected.indents[base-1].row.path,selected.indents[base].row.path]};
}
