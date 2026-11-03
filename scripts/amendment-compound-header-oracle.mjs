import {createHash} from 'node:crypto';
import {quotedWordBody,quotedWordParts} from './amendment-benchmark-quoted-oracle.mjs';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {oracleAddress} from './amendment-oracle-grammar.mjs';

// This certifies recovered metadata only. The ordinary, independent source
// assertion must still prove the placement and its complete boundary.
export function assertCompoundHeader({wording,nativeQuoted}) {
 const references=(wording?.documentReferences||[]).filter(ref=>ref.basis==='native-line-break');
 if(!references.length)return null;
 const unavailable=()=>({status:'unverified',reason:'oracle-compound-header-unavailable'});
 if(wording.language!=='en'||wording.baseline!=='commission-proposal'||references.length!==2||!Number.isSafeInteger(nativeQuoted?.number)||nativeQuoted.number!==wording.number)return unavailable();
 const address=oracleAddress(wording.targetLabel,'en',{resolution:false});
 if(!address?.length)return unavailable();
 try {
  const parts=quotedWordParts(nativeQuoted.amendmentBuffer),parse=xml=>new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml);
  const bindings=nodes=>nodes.every(node=>(node[':@']?.['@_xmlns:w']===undefined||node[':@']['@_xmlns:w']==='http://schemas.openxmlformats.org/wordprocessingml/2006/main')&&Object.values(node).every(value=>!Array.isArray(value)||bindings(value)));
  if(!bindings(parse(parts.get('word/document.xml'))))return unavailable();
  const body=quotedWordBody(nativeQuoted.amendmentBuffer);
  const heading=row=>row.kind==='paragraph'&&/^Amendment\s+[1-9]\d*$/u.test(row.text.trim());
  const starts=body.flatMap((row,index)=>heading(row)&&Number(row.text.match(/\d+$/u)[0])===nativeQuoted.number?[index]:[]);
  if(starts.length!==1)return unavailable();
  const start=starts[0],end=body.findIndex((row,index)=>index>start&&heading(row));
  const block=body.slice(start,end<0?body.length:end),tableAt=block.findIndex(row=>row.kind!=='paragraph');
  const header=block.slice(1,tableAt).filter(row=>row.text.trim());
  if(tableAt<0||header.length!==1||!block[tableAt].nodes['w:tbl']||block[0].hidden||block[0].unsafe)return unavailable();
  const row=header[0],lines=row.text.trim().split('\n').map(line=>line.trim());
  if(row.hidden||row.unsafe||row.numbered||lines.length!==2||!/^Proposal for a (?:regulation|directive|decision)$/u.test(lines[0])||lines[1]!==wording.targetLabel)return unavailable();
  const stylesXml=parts.get('word/styles.xml');
  if(stylesXml){
   if(/<!DOCTYPE|<!ENTITY/u.test(stylesXml)||XMLValidator.validate(stylesXml)!==true)return unavailable();
   const styles=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(stylesXml),find=(nodes,name)=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key===name?[node]:Array.isArray(value)?find(value,name):[]));
   if(!bindings(styles))return unavailable();
   const defs=new Map();for(const node of find(styles,'w:style')){const id=node[':@']?.['@_w:styleId'];if(defs.has(id))return unavailable();defs.set(id,node['w:style']);}
   const opaque=nodes=>['w:vanish','w:webHidden'].some(name=>find(nodes,name).some(node=>!['0','false','off'].includes(node[':@']?.['@_w:val'])));
   if(find(styles,'w:docDefaults').some(node=>opaque(node['w:docDefaults'])))return unavailable();
   const hiddenStyle=(id,seen=new Set())=>{if(!id)return false;if(seen.has(id)||!defs.has(id))return true;seen.add(id);const nodes=defs.get(id);return opaque(nodes)||find(nodes,'w:basedOn').some(node=>hiddenStyle(node[':@']?.['@_w:val'],seen));};
   const ids=[...find(row.nodes,'w:pStyle'),...find(row.nodes,'w:rStyle')].map(node=>node[':@']?.['@_w:val']);
   for(const node of find(styles,'w:style'))if(['paragraph','character'].includes(node[':@']?.['@_w:type'])&&['1','true','on'].includes(node[':@']?.['@_w:default']))ids.push(node[':@']?.['@_w:styleId']);
   if(ids.some(id=>hiddenStyle(id)))return unavailable();
  }
  let breaks=0;
  const properties=nodes=>nodes.every(node=>Object.entries(node).every(([key,value])=>key===':@'||key==='w:rPr'&&properties(value)||['w:pStyle','w:rStyle','w:keepNext','w:keepLines','w:widowControl','w:spacing','w:ind','w:jc','w:b','w:bCs','w:i','w:iCs','w:lang','w:rFonts','w:sz','w:szCs','w:color','w:u','w:highlight'].includes(key)&&Array.isArray(value)&&value.length===0));
  const inline=nodes=>nodes.every(node=>Object.entries(node).every(([key,value])=>{
   if(key===':@')return true;
   if(key==='w:r')return inline(value);
   if(['w:pPr','w:rPr'].includes(key))return properties(value);
   if(key==='w:t')return value.every(part=>Object.keys(part).length===1&&typeof part['#text']==='string'&&!/[\r\n]/u.test(part['#text']));
   if(['w:br','w:cr'].includes(key)){breaks++;return value.length===0&&[undefined,'textWrapping'].includes(node[':@']?.['@_w:type']);}
   return false;
  }));
  for(const other of block.slice(1,tableAt).filter(other=>other!==row)){breaks=0;if(other.hidden||other.unsafe||other.numbered||!inline(other.nodes)||breaks)return unavailable();}
  breaks=0;if(!inline(row.nodes)||breaks!==1)return unavailable();
  for(const [field,raw] of [['DocumentClass',lines[0]],['Article',lines[1]]]) {
   const matches=(wording.documentReferences||[]).filter(ref=>ref.field===field&&ref.scope==='amendment');
   if(matches.length!==1||matches[0].basis!=='native-line-break'||matches[0].raw!==raw||matches[0].sourceRaw!==row.text.trim())return unavailable();
  }
  return {status:'verified',reason:'oracle-native-compound-header',assertion:{nativeHeader:row.path,rawClass:lines[0],rawTarget:lines[1],amendmentSha256:createHash('sha256').update(nativeQuoted.amendmentBuffer).digest('hex')}};
 }catch{return unavailable();}
}
