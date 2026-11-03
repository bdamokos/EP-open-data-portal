import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {docxParts} from './document-text.mjs';
import {proposalNumberingLabels} from './proposal-numbering.mjs';
import {nativeInlineRowsComplete} from './proposal-inline-guard.mjs';
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
const value=(nodes,key)=>nodes.find(node=>node[key])?.[':@']?.['@_w:val'];
const normal=text=>text.normalize('NFC').replace(/\s+/gu,' ').trim();
const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children)]);
// Runtime validates a deliberately small native numbering profile. The oracle
// has a separate list reader and never imports this production metadata reader.
function parentProfile(buffer,proposal,root,parents){
 try{
  const parts=docxParts(buffer),parse=xml=>{if(!xml||/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)throw Error('XML unavailable');return new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml);};
  const numbered=proposalNumberingLabels(parts.get('word/numbering.xml'),parts.get('word/styles.xml'),{add(){}}),identity=parents[0]?.properties?.numbering;
  if(!identity||identity.level!==0||identity.format!=='decimal'||parents.some((row,index)=>row.properties.styleId!=='Point0number'||row.properties.numberingLabel!=='('+(index+1)+')'||JSON.stringify(row.properties.numbering)!==JSON.stringify(identity)))return false;
  const numbers=parse(parts.get('word/numbering.xml')),styles=parse(parts.get('word/styles.xml')),URI='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  if(numbers.filter(node=>node['w:numbering']).length!==1||styles.filter(node=>node['w:styles']).length!==1||numbers.find(node=>node['w:numbering'])[':@']?.['@_xmlns:w']!==URI||styles.find(node=>node['w:styles'])[':@']?.['@_xmlns:w']!==URI)return false;
  const numbering=children(numbers,'w:numbering')[0],styleRows=children(styles,'w:styles')[0],definitions=new Map();
  for(const node of styleRows)if(node['w:style']){const id=node[':@']?.['@_w:styleId'];if(definitions.has(id))return false;definitions.set(id,node['w:style']);}
  for(const name of ['w:num','w:abstractNum']){const ids=numbering.filter(node=>node[name]).map(node=>node[':@']?.['@_w:'+(name==='w:num'?'numId':'abstractNumId')]);if(new Set(ids).size!==ids.length)return false;}
  const instance=numbering.filter(node=>node['w:num']&&node[':@']?.['@_w:numId']===identity.id),abstract=numbering.filter(node=>node['w:abstractNum']&&node[':@']?.['@_w:abstractNumId']===identity.abstractId);
  if(instance.length!==1||abstract.length!==1)return false;
  const level=abstract[0]['w:abstractNum'].filter(node=>node['w:lvl']&&node[':@']?.['@_w:ilvl']==='0'),override=instance[0]['w:num'].filter(node=>node['w:lvlOverride']&&node[':@']?.['@_w:ilvl']==='0');
  if(level.length!==1||override.length!==1||children(override[0]['w:lvlOverride'],'w:lvl').length||value(override[0]['w:lvlOverride'],'w:startOverride')!=='1'||value(level[0]['w:lvl'],'w:numFmt')!=='decimal'||value(level[0]['w:lvl'],'w:lvlText')!=='(%1)'||value(level[0]['w:lvl'],'w:start')!=='1'||![undefined,'0'].includes(value(level[0]['w:lvl'],'w:lvlRestart'))||![undefined,'tab'].includes(value(level[0]['w:lvl'],'w:suff')))return false;
  if(abstract[0]['w:abstractNum'].some(node=>node['w:numStyleLink']||node['w:styleLink']))return false;
  const body=children(children(parse(parts.get('word/document.xml')),'w:document')[0]||[],'w:body')[0];if(!body)return false;
  const start=proposal.paragraphs[root.extent.start].source.path,end=proposal.paragraphs[root.extent.end]?.source?.path;if(!end)return false;
  const seen=[],paths=new Set(parents.map(row=>row.source.path));let ordinal=0,active=false,finished=false;
  const defaultStyle=styleRows.find(node=>node['w:style']&&node[':@']?.['@_w:type']==='paragraph'&&['1','true','on'].includes(node[':@']?.['@_w:default']))?.[':@']?.['@_w:styleId'];
  const visit=(nodes,path)=>{
   const props=children(nodes,'w:pPr')[0]||[],ref=numbered.metadata(props);
   let style=value(props,'w:pStyle')??defaultStyle;const visited=new Set();while(style){if(visited.has(style)||!definitions.has(style))throw Error('Unknown native style');visited.add(style);style=value(definitions.get(style),'w:basedOn');}
   if(!ref)return;
   if(!active&&!finished&&ref.id===identity.id)throw Error('List already started');
   if(!active)return;
   if(value(props,'w:pStyle')==='Point0number'&&(ref.abstractId!==identity.abstractId||ref.level!==0))throw Error('Conflicting parent list');
   if(ref.abstractId===identity.abstractId&&ref.level===0){if(ref.id!==identity.id||!paths.has(path))throw Error('Unmapped parent counter');seen.push(path);}
  };
  const nested=nodes=>{for(const node of nodes)for(const [name,content] of Object.entries(node)){if(name==='w:p')visit(content,null);else if(Array.isArray(content))nested(content);}};
  for(const node of body){if(node['w:p']){ordinal++;const path=`/w:document[1]/w:body[1]/w:p[${ordinal}]`;if(path===end){active=false;finished=true;}visit(node['w:p'],path);if(path===start)active=true;}else nested([node]);}
  return finished&&seen.length===parents.length&&seen.every((path,index)=>path===parents[index].source.path);
 }catch{return false;}
}
export function quotedSectionPointInsertion(selected,wording,nativeBuffer){
 const {proposal,unit:owner,itemIndex}=selected;
 const target=wording.language==='en'&&/^Annex ([IVXLCDM]+) – paragraph 1 – point ([1-9]\d*)\n(Regulation \((?:EC|EU)\) No \d+\/\d+)\nAnnex ([IVXLCDM]+) – section (\d+(?:\.\d+)+) – point \(([a-z]) a\) new$/u.exec(wording.targetLabel||'');
 if(!target||wording.baseline!=='commission-proposal'||wording.originalText!==''||!wording.proposedText.startsWith('('+target[6]+' a)\t')||!wording.proposedText.endsWith('’;')||wording.targetPath?.proposal?.length||wording.targetPath?.underlying?.length||proposal.language!=='en'||proposal.sourceKind!=='docx')return null;
 if(owner.scope!=='proposal'||owner.kind!=='point'||!owner.complete||owner.pathConflict||owner.path.map(segment=>segment.kind+':'+segment.value).join('/')!==`annex:${target[1]}/paragraph:1/point:${target[2]}`)return null;
 const roots=flat(proposal.units).filter(unit=>unit.scope==='proposal'&&unit.kind==='annex'&&unit.label?.value===target[1]);if(roots.length!==1||!roots[0].complete||roots[0].pathConflict)return null;const root=roots[0];
 const rows=proposal.paragraphs.slice(owner.extent.start,owner.extent.end),next=proposal.paragraphs[owner.extent.end],lead=proposal.paragraphs[root.extent.start+1],scope=/^Annexes ([IVXLCDM]+) and ([IVXLCDM]+) to (.+) are amended as follows:$/u.exec(normal(lead?.text||''));
 if(!scope||![scope[1],scope[2]].includes(target[4])||scope[3]!==target[3]||normal(rows[0]?.text||'')!==`(${target[2]}) in Annex ${target[4]}, section ${target[5]} is replaced by the following:`||!next?.text.startsWith('('+(Number(target[2])+1)+')\t'))return null;
 const quote=rows.slice(1);
 if(quote.length!==target[6].charCodeAt(0)-96+1||quote[0].properties?.styleId!=='Text1'||!quote[0].text.startsWith('‘'+target[5]+'. ')||quote.slice(1).some((row,index)=>row.properties?.styleId!=='Text2'||!row.text.startsWith('('+String.fromCharCode(97+index)+') '))||!quote.at(-1).text.endsWith('’;'))return null;
 const content=quote.map(row=>row.text).join('\n');if(content.split('‘').length!==2||content.split('’').length!==2)return null;
 const complete=[...rows,next];if(complete.some((row,index)=>!row.complete||row.source?.complete!==true||row.source.container!=='body'||row.text.includes('\uFFFC')||index&&(row.source.ordinal!==complete[index-1].source.ordinal+1||row.source.segment!==complete[index-1].source.segment)))return null;
 const parents=proposal.paragraphs.slice(root.extent.start,root.extent.end).filter(row=>row.properties?.numbering?.level===0);
 if(!parents.includes(rows[0])||!parents.includes(next)||!parentProfile(nativeBuffer,proposal,root,parents)||!nativeInlineRowsComplete(nativeBuffer,proposal.sourceHash,[proposal.paragraphs[root.extent.start],lead,...parents,...quote]))return null;
 return {itemIndex,insertBefore:next.index,evidence:[{basis:'whole-quoted-section-point',owner:owner.id,section:target[5],label:target[6]+'a'}]};
}
