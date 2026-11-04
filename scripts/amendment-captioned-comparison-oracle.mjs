import {quotedWordBody,quotedWordParts} from './amendment-benchmark-quoted-oracle.mjs';
import {safe,literal,completeGrid} from './amendment-native-table-oracle.mjs';
import {XMLParser} from 'fast-xml-parser';
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
const all=(nodes,key)=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,value])=>name===key?[node]:Array.isArray(value)?all(value,key):[]));
const clean=value=>value.replace(/\r\n?/gu,'\n').replace(/[ \t]+\n/gu,'\n').trim();
const URI='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// A provenance marker selects this assertion; only native XML proves its wording.
export function assertCaptionedComparison({wording,nativeQuoted}){
 const references=wording?.documentReferences?.filter(ref=>ref.basis==='caption-before-original-heading')??[];
 if(!references.length)return null;
 const unknown=()=>({status:'unverified',reason:'oracle-captioned-comparison-unavailable'});
 const named=/^Annex(?: [IVXLCDM]+)? [–—-] table [–—-] (.+)$/u.exec(wording.targetLabel??'');
 if(wording.language!=='en'||wording.baseline!=='commission-proposal'||references.length!==1||references[0].field!=='ComparisonCaption'||references[0].scope!=='amendment'||!named||references[0].raw!==named[1]||references[0].sourceRaw!==named[1]||!Number.isSafeInteger(wording.number)||wording.number<1||nativeQuoted?.number!==wording.number)return unknown();
 try{
  const body=quotedWordBody(nativeQuoted.amendmentBuffer),parts=quotedWordParts(nativeQuoted.amendmentBuffer),parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
  const bindings=nodes=>nodes.every(node=>Object.entries(node[':@']??{}).every(([key,value])=>key==='@_xmlns:w'?value===URI:!key.startsWith('@_xmlns')||value!==URI)&&Object.values(node).every(value=>!Array.isArray(value)||bindings(value)));
  const tree=parser.parse(parts.get('word/document.xml')),styles=parts.has('word/styles.xml')?parser.parse(parts.get('word/styles.xml')):[];
  if(!bindings(tree)||!bindings(styles))return unknown();
  const amendment=row=>row.kind==='paragraph'&&/^Amendment\s+[1-9]\d*$/u.test(row.text.trim()),starts=body.flatMap((row,i)=>amendment(row)&&Number(row.text.match(/\d+$/u)[0])===wording.number?[i]:[]);
  if(starts.length!==1)return unknown();
  const next=body.findIndex((row,i)=>i>starts[0]&&amendment(row)),block=body.slice(starts[0],next<0?body.length:next),tables=block.filter(row=>row.kind==='other'&&row.nodes['w:tbl']);
  const targets=block.filter(row=>row.kind==='paragraph'&&row.text.trim()===wording.targetLabel),classes=block.filter(row=>row.kind==='paragraph'&&/^Proposal for a (?:regulation|directive|decision)$/u.test(row.text.trim()));
  if(block[0].hidden||block[0].unsafe||targets.length!==1||targets[0].hidden||targets[0].unsafe||classes.length!==1||classes[0].hidden||classes[0].unsafe||tables.length!==1||tables[0].hidden)return unknown();
  const table=tables[0].nodes['w:tbl'];if(!completeGrid(table)||children(table,'w:tblGrid').length!==1||children(children(table,'w:tblGrid')[0],'w:gridCol').length!==2||all(table,'w:numPr').length)return unknown();
  const defs=new Map(all(styles,'w:style').map(node=>[node[':@']?.['@_w:styleId'],node['w:style']]));
  const numbered=(id,seen=new Set())=>{if(!id)return false;if(seen.has(id))return true;seen.add(id);const style=defs.get(id);if(!style)return false;return all(style,'w:numPr').length>0||all(style,'w:basedOn').some(node=>numbered(node[':@']?.['@_w:val'],seen));};
  if(all(table,'w:pStyle').some(node=>numbered(node[':@']?.['@_w:val']))||all(styles,'w:style').some(node=>node[':@']?.['@_w:type']==='paragraph'&&['1','true','on'].includes(node[':@']?.['@_w:default'])&&numbered(node[':@']?.['@_w:styleId'])))return unknown();
  const rows=[];
  for(const row of children(table,'w:tr')){
   const cells=[];
   for(const cell of children(row,'w:tc')){
    const paragraphs=children(cell,'w:p');if(paragraphs.some(p=>!safe(p)))return unknown();
    const spans=all(children(cell,'w:tcPr').flat(),'w:gridSpan');if(spans.length>1)return unknown();
    cells.push({text:clean(paragraphs.map(literal).filter(text=>text.trim()).join('\n')),span:spans.length?Number(spans[0][':@']?.['@_w:val']):1});
   }
   if(!cells.length||cells.some(cell=>!Number.isInteger(cell.span)||cell.span<1)||cells.reduce((sum,cell)=>sum+cell.span,0)!==2)return unknown();
   if(cells.some(cell=>cell.text))rows.push(cells);
  }
  const full=row=>row?.length===1&&row[0].span===2;
  if(!full(rows[0])||rows[0][0].text!==named[1]||!full(rows[1])||rows[1][0].text!=='Text proposed by the Commission')return unknown();
  const headings=rows.flatMap((row,i)=>full(row)&&row[0].text==='Amendment'?[i]:[]),at=headings[0];
  if(headings.length!==1||at<3||!full(rows[at+1])||rows[at+1][0].text!==named[1]||at+2>=rows.length)return unknown();
  const oldRows=rows.slice(2,at),newRows=rows.slice(at+2),data=oldRows.concat(newRows);
  if(data.some(row=>row.length!==2||row.some(cell=>cell.span!==1))||data.some(row=>row.some(cell=>['Text proposed by the Commission','Amendment'].includes(cell.text))))return unknown();
  const column=rows=>[named[1],...rows.map(row=>row.map(cell=>cell.text).join('\t'))].join('\n');
  if(wording.originalText!==column(oldRows)||wording.proposedText!==column(newRows))return {status:'failed',reason:'oracle-captioned-comparison-wording-mismatch'};
  return {status:'verified',reason:'oracle-native-captioned-comparison',originalRows:oldRows.map(row=>row.map(cell=>cell.text))};
 }catch{return unknown();}
}
