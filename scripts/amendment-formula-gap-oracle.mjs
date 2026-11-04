import {XMLParser} from 'fast-xml-parser';
import {quotedWordBody,quotedWordParts} from './amendment-benchmark-quoted-oracle.mjs';
import {safe,literal,completeGrid} from './amendment-native-table-oracle.mjs';
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
const all=(nodes,key)=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,value])=>name===key?[node]:Array.isArray(value)?all(value,key):[]));
const clean=text=>text.replace(/[ \t]+\n/gu,'\n').trim();
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',M='http://schemas.openxmlformats.org/officeDocument/2006/math';
// The gap selects a native wording assertion, never permission to trust a
// shortened producer column. Location is checked by the separate raw oracle.
export function assertFormulaGap({wording,nativeQuoted}){
 if(!wording?.gaps?.some(gap=>gap.code==='formula-not-shown'))return null;
 const unknown=()=>({status:'unverified',reason:'oracle-formula-wording-unavailable'});
 const label=/^Article ([1-9]\d*) – paragraph ([1-9]\d*) ?([a-z]) \(new\)$/u.exec(wording.targetLabel??'');
 if(wording.language!=='en'||wording.baseline!=='commission-proposal'||!label||wording.originalText!==''||nativeQuoted?.number!==wording.number||!Number.isSafeInteger(wording.number))return unknown();
 try{
  const parts=quotedWordParts(nativeQuoted.amendmentBuffer),body=quotedWordBody(nativeQuoted.amendmentBuffer),parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}),tree=parser.parse(parts.get('word/document.xml'));
  const bindings=nodes=>nodes.every(node=>Object.entries(node[':@']??{}).every(([key,value])=>key==='@_xmlns:w'?value===W:key==='@_xmlns:m'?value===M:!key.startsWith('@_xmlns')||![W,M].includes(value))&&Object.values(node).every(value=>!Array.isArray(value)||bindings(value)));
  if(tree.find(node=>node['w:document'])?.[':@']?.['@_xmlns:m']!==M||!bindings(tree))return unknown();
  const starts=body.flatMap((row,i)=>row.kind==='paragraph'&&row.text.includes('<Amend>')&&row.text.includes('<NumAm>'+wording.number+'</NumAm>')?[i]:[]);
  if(starts.length!==1)return unknown();
  const end=body.findIndex((row,i)=>i>starts[0]&&row.kind==='paragraph'&&row.text.includes('</Amend>'));
  if(end<0)return unknown();
  const block=body.slice(starts[0],end+1),paragraphs=block.filter(row=>row.kind==='paragraph'),field=key=>paragraphs.flatMap(row=>[...row.text.matchAll(new RegExp('<'+key+'>([\\s\\S]*?)</'+key+'>','gu'))].map(match=>match[1]));
  if(paragraphs.slice(1).some(row=>row.text.includes('<Amend>'))||field('Article').length!==1||field('Article')[0]!==wording.targetLabel||field('DocAmend').length!==1||!/^Proposal for a (?:regulation|directive|decision)$/u.test(field('DocAmend')[0])||field('Original').length>1||field('Original').length===1&&field('Original')[0]!=='{EN}en'||['Article2','DocAmend2'].some(key=>field(key).length))return unknown();
  const tables=block.filter(row=>row.kind==='other');if(tables.length!==1||tables[0].hidden||!tables[0].nodes['w:tbl'])return unknown();
  const table=tables[0].nodes['w:tbl'];
  if(!completeGrid(table)||children(table,'w:tblGrid').length!==1||children(children(table,'w:tblGrid')[0],'w:gridCol').length!==2||all(table,'w:numPr').length)return unknown();
  // No automatic numbering, hidden defaults or numbered/hidden inherited
  // styles may change any comparison cell's printed wording.
  const styles=parts.has('word/styles.xml')?parser.parse(parts.get('word/styles.xml')):[];
  if(!bindings(styles))return unknown();
  const definitions=new Map(all(styles,'w:style').map(node=>[node[':@']?.['@_w:styleId'],node['w:style']]));if(definitions.size!==all(styles,'w:style').length)return unknown();
  const styleSafe=(id,seen=new Set())=>{if(!id)return true;if(seen.has(id)||!definitions.has(id))return false;seen.add(id);const nodes=definitions.get(id);return !['w:vanish','w:webHidden','w:numPr'].some(key=>all(nodes,key).length)&&all(nodes,'w:basedOn').every(node=>styleSafe(node[':@']?.['@_w:val'],seen));};
  if(all(styles,'w:docDefaults').some(node=>['w:vanish','w:webHidden','w:numPr'].some(key=>all(node['w:docDefaults'],key).length))||all(styles,'w:style').some(node=>['1','true','on'].includes(node[':@']?.['@_w:default'])&&!styleSafe(node[':@']?.['@_w:styleId']))||['w:pStyle','w:rStyle'].some(key=>all(table,key).some(node=>!styleSafe(node[':@']?.['@_w:val']))))return unknown();
  let count=0;
  const removeMath=nodes=>nodes.flatMap(node=>Object.entries(node).some(([key])=>key==='m:oMathPara'||key==='m:oMath')?(()=>{const key=node['m:oMathPara']?'m:oMathPara':'m:oMath',math=node[key];if(!mathOnly(math)||(key==='m:oMath'?1:all(math,'m:oMath').length)!==1||['w:drawing','w:pict','w:object','w:del','w:moveFrom','w:ins','w:vanish','w:webHidden'].some(key=>all(math,key).length))throw Error('Unsupported formula');count++;return [];})():[Object.fromEntries(Object.entries(node).map(([key,value])=>[key,Array.isArray(value)?removeMath(value):value]))]);
  const rows=[];
  for(const row of children(table,'w:tr')){
   const cells=[];
   for(const cell of children(row,'w:tc')){
    const before=count,plain=removeMath(children(cell,'w:p').flat());if(!safe(plain))return unknown();
    const spans=all(children(cell,'w:tcPr').flat(),'w:gridSpan');if(spans.length>1)return unknown();
    cells.push({text:clean(children(cell,'w:p').map(p=>literal(removeMathWithoutCounting(p))).join('\n')),math:count-before,span:spans.length?Number(spans[0][':@']?.['@_w:val']):1});
   }
   if(cells.length===1&&cells[0].span===2&&cells[0].text===''&&!cells[0].math&&!rows.length)continue;
   if(cells.length!==2||cells.some(cell=>cell.span!==1))return unknown();rows.push(cells);
  }
  if(rows.length<2||rows[0][0].text!=='Text proposed by the Commission'||rows[0][1].text!=='Amendment'||rows[0].some(cell=>cell.math)||count!==1||rows.slice(1).some(row=>row[0].text||row[0].math))return unknown();
  const proposed=clean(rows.slice(1).map(row=>row[1].text).filter(Boolean).join('\n'));
  if(!proposed.startsWith(label[2]+label[3]+'.\t'))return unknown();
  if(proposed!==wording.proposedText)return {status:'failed',reason:'oracle-formula-wording-mismatch'};
  return {status:'verified',reason:'oracle-native-formula-gap'};
 }catch{return unknown();}
}
function removeMathWithoutCounting(nodes){return nodes.flatMap(node=>node['m:oMathPara']||node['m:oMath']?[]:[Object.fromEntries(Object.entries(node).map(([key,value])=>[key,Array.isArray(value)?removeMathWithoutCounting(value):value]))]);}

function mathOnly(nodes){return nodes.every(node=>Object.entries(node).every(([key,value])=>key===':@'||key==='#text'&&typeof value==='string'||Array.isArray(value)&&(key.startsWith('m:')?mathOnly(value):key==='w:rPr'?mathOnly(value):['w:rFonts','w:b','w:bCs','w:i','w:iCs','w:sz','w:szCs','w:lang','w:color'].includes(key)&&!value.length)));}
