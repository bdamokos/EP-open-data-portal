import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {docxParts} from './document-text.mjs';
const URI='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const child=(nodes,key)=>nodes.filter(node=>node[key]).map(node=>node[key]);
const find=(nodes,key)=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,value])=>Array.isArray(value)?[...(name===key?[node]:[]),...find(value,key)]:[]));
const rawText=nodes=>nodes.map(node=>Object.entries(node).map(([key,value])=>['w:t','w:delText','w:instrText'].includes(key)?value.map(part=>part['#text']??'').join(''):key==='w:tab'?'\t':['w:br','w:cr'].includes(key)?'\n':key==='w:noBreakHyphen'?'\u2011':key==='w:softHyphen'?'\u00ad':Array.isArray(value)?rawText(value):'').join('')).join('');
const property=(nodes,key)=>find(nodes,key).map(node=>node[':@']?.['@_w:val']);
const trim=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
function nativeTree(xml){
 if(!xml||/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)throw Error('Native XML unavailable');
 const tree=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml),pending=tree.map(node=>({node,namespaces:{}}));
 while(pending.length){
  const {node,namespaces:parent}=pending.pop(),namespaces={...parent},attributes=node[':@']||{};
  for(const [name,value]of Object.entries(attributes))if(name==='@_xmlns'||name.startsWith('@_xmlns:')){
   const prefix=name==='@_xmlns'?'':name.slice(8);namespaces[prefix]=value;
   if(value===URI&&prefix!=='w'||prefix==='w'&&value!==URI)throw Error('Native namespace unavailable');
  }
  const names=[...Object.keys(node),...Object.keys(attributes).map(name=>name.slice(2))];if(names.some(name=>name.startsWith('w:')&&namespaces.w!==URI))throw Error('Native namespace unavailable');
  for(const value of Object.values(node))if(Array.isArray(value))pending.push(...value.map(node=>({node,namespaces})));
 }
 return tree;
}
function nativeContent(nodes,{legal=false,mode='paragraph'}={}) {
 const nested=mode==='paragraph'?{'w:pPr':'paragraph-properties','w:r':'run','w:hyperlink':'paragraph'}:mode==='run'?{'w:rPr':'run-properties'}:mode==='paragraph-properties'?{'w:rPr':'run-properties','w:sectPr':'section','w:tabs':'tabs',...(legal?{'w:numPr':'number'}:{})}:{};
 const permitted=mode==='paragraph'?['w:bookmarkStart','w:bookmarkEnd','w:proofErr']:mode==='run'?['w:lastRenderedPageBreak','w:tab','w:br','w:cr','w:noBreakHyphen','w:softHyphen',...(legal?['w:footnoteReference','w:endnoteReference']:[])]:mode==='paragraph-properties'?['w:pStyle','w:keepNext','w:keepLines','w:widowControl','w:spacing','w:ind','w:jc']:mode==='run-properties'?['w:spacing','w:rStyle','w:noProof','w:b','w:bCs','w:i','w:iCs','w:lang','w:rFonts','w:sz','w:szCs','w:color','w:u','w:highlight','w:shd']:mode==='section'?['w:pgSz','w:pgMar','w:cols','w:docGrid','w:type','w:pgNumType']:mode==='tabs'?['w:tab']:mode==='number'?['w:numId','w:ilvl']:[];
 const seen=new Set();
 for(const node of nodes)for(const [key,value]of Object.entries(node)){
  if(key===':@')continue;
  if((mode.endsWith('properties')||['section','number'].includes(mode)||['w:pPr','w:rPr'].includes(key))&&seen.has(key))return false;seen.add(key);
  if(key==='w:t'){if(mode!=='run'||value.some(part=>Object.keys(part).length!==1||typeof part['#text']!=='string'))return false;continue;}
  if(nested[key]){if(!nativeContent(value,{legal,mode:nested[key]}))return false;}
  else if(!permitted.includes(key)||!Array.isArray(value)||value.length)return false;
 }
 return true;
}
function nativeVisible(parts){
 const tree=nativeTree(parts.get('word/styles.xml')),roots=child(tree,'w:styles');if(roots.length!==1)throw Error('Native styles unavailable');
 const definitions=new Map(),defaults=[];for(const node of roots[0])if(node['w:style']){const id=node[':@']?.['@_w:styleId'];if(definitions.has(id))throw Error('Competing native styles');definitions.set(id,node['w:style']);if(['paragraph','character'].includes(node[':@']?.['@_w:type'])&&['1','true','on'].includes(node[':@']?.['@_w:default']))defaults.push(id);}
 const hidden=nodes=>find(nodes,'w:vanish').length||find(nodes,'w:webHidden').length;
 const styleSafe=(id,seen=new Set())=>{if(!id)return true;if(seen.has(id)||!definitions.has(id))return false;seen.add(id);const nodes=definitions.get(id);return !hidden(nodes)&&property(nodes,'w:basedOn').every(parent=>styleSafe(parent,seen));};
 return nodes=>!hidden(child(roots[0],'w:docDefaults').flat())&&!hidden(nodes)&&[...defaults,...property(nodes,'w:pStyle'),...property(nodes,'w:rStyle')].every(id=>styleSafe(id));
}
// A first annex follows the signed act, before the separate financial statement.
// Require native bytes: a projected absence cannot prove the act has no annex.
export function firstAnnexInsertion(items,wording,nativeProposalInputs) {
 const label=/^Annex(?: (?:1|I))?(?: \(new\))?(?: [–-] ([^\n\t]+))?$/u.exec(wording.targetLabel||'');
 if(!label||wording.originalText!==''||!/^ANNEX\b/u.test(wording.proposedText?.split('\n')[0]||''))return null;
 const unavailable=()=>({reason:'source_structure_unavailable'}),lines=wording.proposedText?.split('\n')||[];
 const classes=(wording.documentReferences||[]).filter(ref=>ref.field==='DocumentClass'&&ref.scope==='amendment');if(classes.length!==1||classes[0].raw!=='Proposal for a regulation')return unavailable();
 if(wording.language!=='en'||wording.baseline!=='commission-proposal'||wording.targetPath?.underlying?.length||wording.targetPath?.proposal?.length&&(wording.targetPath.proposal.length!==1||wording.targetPath.proposal[0].raw!==wording.targetLabel)||items.length!==1||items[0].kind!=='act'||items[0].proposal.sourceKind!=='docx'||lines.length<3||!/^ANNEX(?: (?:1|I))?$/u.test(lines[0])||lines.some(line=>!line.trim())||lines.slice(1).some(line=>/^ANNEX\b/u.test(line))||/[\u2026]|\.{3}|\uFFFC/u.test(wording.proposedText)||label[1]&&trim(label[1]).toUpperCase()!==trim(lines[1]).toUpperCase())return unavailable();
 return annexSignatureBoundary(items,nativeProposalInputs);
}
export function annexSignatureBoundary(items,nativeProposalInputs) {
 const unavailable=()=>({reason:'source_structure_unavailable'});
 if(items?.length!==1||items[0].kind!=='act'||items[0].proposal?.sourceKind!=='docx')return unavailable();
 const proposal=items[0].proposal,buffer=nativeProposalInputs?.[0];
 if(!Buffer.isBuffer(buffer)||buffer.length>8*1024*1024||createHash('sha256').update(buffer).digest('hex')!==proposal.sourceHash)return unavailable();
 try {
  const parts=docxParts(buffer),tree=nativeTree(parts.get('word/document.xml')),documents=child(tree,'w:document');if(documents.length!==1||tree.find(node=>node['w:document'])?.[':@']?.['@_xmlns:w']!==URI)return unavailable();
  const bodies=child(documents[0],'w:body');if(bodies.length!==1)return unavailable();const body=bodies[0],all=find(body,'w:p').map(node=>node['w:p']);
  if(all.some(p=>/^\s*[‘’"']?ANNEX\b/iu.test(rawText(p))||property(child(p,'w:pPr').flat(),'w:pStyle').some(id=>/^Annexe?titre/iu.test(id)))||parts.has('word/numbering.xml')&&property(nativeTree(parts.get('word/numbering.xml')),'w:lvlText').some(text=>/annex/iu.test(text)))return unavailable();
  const expected=[['Done at Brussels,','Fait'],['For the European Parliament\tFor the Council','Institutionquisigne'],['The President\tThe President','Personnequisigne'],['LEGISLATIVE FINANCIAL AND DIGITAL STATEMENT','Fichefinanciretitre']];
  if(expected.some(([text])=>all.filter(p=>rawText(p).trim()===text).length!==1))return unavailable();
  let ordinal=0;const native=body.map((node,index)=>({node,index,path:node['w:p']?`/w:document[1]/w:body[1]/w:p[${++ordinal}]`:null})),at=native.findIndex(row=>row.node['w:p']&&rawText(row.node['w:p']).trim()===expected[0][0]),rows=native.slice(at,at+4),visible=nativeVisible(parts);
  if(at<1||rows.length!==4||rows.some((row,i)=>!row.node['w:p']||rawText(row.node['w:p']).trim()!==expected[i][0]||!nativeContent(row.node['w:p'])||!visible(row.node['w:p'])||property(child(row.node['w:p'],'w:pPr').flat(),'w:pStyle').join()!==expected[i][1]))return unavailable();
  if(!native[at-1].node['w:p']||rawText(native[at-1].node['w:p']).trim()!=='This Regulation shall be binding in its entirety and directly applicable in all Member States.')return unavailable();
  const adopted=native.filter(row=>row.node['w:p']&&rawText(row.node['w:p']).trim()==='HAVE ADOPTED THIS REGULATION:');if(adopted.length!==1||adopted[0].index>=at)return unavailable();
  for(const row of native.slice(adopted[0].index,at+4)){if(row.node['w:p']){if(!nativeContent(row.node['w:p'],{legal:true})||!visible(row.node['w:p']))return unavailable();}else if(!Object.entries(row.node).every(([key,value])=>key===':@'||['w:bookmarkStart','w:bookmarkEnd','w:proofErr'].includes(key)&&Array.isArray(value)&&!value.length))return unavailable();}
  const mapped=rows.map(row=>proposal.paragraphs.filter(p=>p.source?.path===row.path&&p.text===rawText(row.node['w:p']).trim()&&p.complete&&p.source.complete&&p.source.container==='body'&&!p.properties?.numberingLabel));
  if(mapped.some(matches=>matches.length!==1))return unavailable();const coordinates=mapped.map(matches=>matches[0]);
  if(coordinates.some((row,i)=>i&&(row.index!==coordinates[i-1].index+1||row.source.ordinal!==coordinates[i-1].source.ordinal+1)))return unavailable();
  return {operation:'insert',status:'placed',itemIndex:0,insertAfter:coordinates[2].index,insertBefore:coordinates[3].index,evidence:[{basis:'first-annex-before-financial-statement',anchor:rows[2].path}]};
 }catch{return unavailable();}
}

export function sequentialAnnexInsertion(items,wording,nativeProposalInputs) {
 const refs=wording.documentReferences?.filter(ref=>ref.field==='PrecedingAnnex')??[];
 if(!refs.length)return null;
 const unavailable=()=>({reason:'source_structure_unavailable'}),classes=wording.documentReferences?.filter(ref=>ref.field==='DocumentClass'&&ref.scope==='amendment')??[],range=wording.listId?.match(/-AM-(\d+)-(\d+)$/u),lines=wording.proposedText?.split('\n')??[];
 if(wording.language!=='en'||wording.baseline!=='commission-proposal'||wording.originalText!==''||!/^Annex (?:2|II)(?: \(new\))?(?: [–-] [^\n\t]+)?$/u.test(wording.targetLabel??'')||classes.length!==1||classes[0].raw!=='Proposal for a regulation'||!Number.isSafeInteger(wording.number)||wording.number<2||refs.length!==1||refs[0].scope!=='amendment'||refs[0].basis!=='native-annex-order'||refs[0].raw!==String(wording.number-1)||!/^Annex(?: (?:1|I))?(?: \(new\))?(?: [–-] [^\n\t]+)?$/u.test(refs[0].sourceRaw??'')||!range||Number(range[1])>wording.number-1||Number(range[2])<wording.number||wording.targetPath?.underlying?.length||wording.targetPath?.proposal?.length&&(wording.targetPath.proposal.length!==1||wording.targetPath.proposal[0].raw!==wording.targetLabel)||lines.length<4||!/^ANNEX(?: (?:2|II))?$/u.test(lines[0])||!/[.:]$/u.test(lines[1])||/[\u2026]|\.{3}|\uFFFC/u.test(wording.proposedText))return unavailable();
 const rows=lines.slice(2).map(line=>line.split('\t')),count=rows[0].length;
 if(count<2||count>20||rows[0].some(cell=>!cell.trim())||rows.some(row=>row.length!==count||!row.some(cell=>cell.trim())))return unavailable();
 const boundary=annexSignatureBoundary(items,nativeProposalInputs);
 return boundary.status==='placed'?{...boundary,evidence:[...boundary.evidence,{basis:'sequential-new-annex',reference:String(wording.number-1),label:refs[0].sourceRaw}]}:boundary;
}
