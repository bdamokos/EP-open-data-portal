import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {quotedWordBody,quotedWordParts} from './amendment-benchmark-quoted-oracle.mjs';
import {completeGrid,literal} from './amendment-native-grid-oracle.mjs';
const URI='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
const descendants=(nodes,key)=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,value])=>Array.isArray(value)?[...(name===key?[value]:[]),...descendants(value,key)]:[]));
const values=(nodes,key)=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,value])=>name===key?[node[':@']?.['@_w:val']]:Array.isArray(value)?values(value,key):[]));
const text=nodes=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>['w:t','w:delText','w:instrText'].includes(key)?value.map(part=>part['#text']??''):key==='w:tab'?['\t']:['w:br','w:cr'].includes(key)?['\n']:key==='w:noBreakHyphen'?['\u2011']:key==='w:softHyphen'?['\u00ad']:Array.isArray(value)?[text(value)]:[])).join('');
function parse(xml){
 if(!xml||/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)throw Error('Native XML unavailable');
 const tree=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml);
 const inspect=(nodes,inherited={})=>{for(const node of nodes){
  const bindings={...inherited},attributes=node[':@']||{};
  for(const [key,value]of Object.entries(attributes))if(key==='@_xmlns'||key.startsWith('@_xmlns:')){
   const prefix=key==='@_xmlns'?'':key.slice(8);bindings[prefix]=value;
   if(prefix==='w'&&value!==URI||value===URI&&prefix!=='w')throw Error('Native namespace unavailable');
  }
  for(const key of [...Object.keys(node),...Object.keys(attributes).map(key=>key.slice(2))])if(key.startsWith('w:')&&bindings.w!==URI)throw Error('Native namespace unavailable');
  for(const value of Object.values(node))if(Array.isArray(value))inspect(value,bindings);
 }};inspect(tree);return tree;
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const clean=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
const format=['w:spacing','w:noProof','w:b','w:bCs','w:i','w:iCs','w:lang','w:rFonts','w:sz','w:szCs','w:color','w:u','w:highlight','w:shd'];
function known(nodes,{legal=false,context='paragraph',typography=false}={}) {
 const nesting={paragraph:{'w:pPr':'paragraph-properties','w:r':'run','w:hyperlink':'paragraph'},run:{'w:rPr':'run-properties'},'paragraph-properties':{'w:rPr':'run-properties','w:sectPr':'section','w:tabs':'tabs',...(legal?{'w:numPr':'number'}:{})}};
 const leaves={paragraph:['w:bookmarkStart','w:bookmarkEnd','w:proofErr'],run:['w:lastRenderedPageBreak','w:tab','w:br','w:cr','w:noBreakHyphen','w:softHyphen',...(legal?['w:footnoteReference','w:endnoteReference']:[])],'paragraph-properties':['w:pStyle','w:keepNext','w:keepLines','w:widowControl','w:spacing','w:ind','w:jc'],'run-properties':['w:rStyle',...format,...(typography?['w:kern','w14:ligatures']:[])],section:['w:pgSz','w:pgMar','w:cols','w:docGrid','w:type','w:pgNumType'],tabs:['w:tab'],number:['w:numId','w:ilvl']};
 const counts=new Map();
 return nodes.every(node=>Object.entries(node).every(([key,value])=>{
  if(key===':@')return true;
  const count=(counts.get(key)||0)+1;counts.set(key,count);
  if((context.endsWith('properties')||['section','number'].includes(context)||['w:pPr','w:rPr'].includes(key))&&count>1)return false;
  if(key==='w:t')return context==='run'&&value.every(part=>Object.keys(part).length===1&&typeof part['#text']==='string');
  const next=nesting[context]?.[key];if(next)return known(value,{legal,context:next,typography});
  return leaves[context]?.includes(key)&&Array.isArray(value)&&!value.length;
 }));
}
function visible(parts,nodes) {
 const xml=parts.get('word/styles.xml');if(!xml)return false;
 const tree=parse(xml),roots=children(tree,'w:styles');if(roots.length!==1)return false;
 const styles=new Map(),defaults=[];
 for(const node of roots[0])if(node['w:style']){const id=node[':@']?.['@_w:styleId'];if(styles.has(id))return false;styles.set(id,node['w:style']);if(['paragraph','character'].includes(node[':@']?.['@_w:type'])&&['1','true','on'].includes(node[':@']?.['@_w:default']))defaults.push(id);}
 const hidden=nodes=>['w:vanish','w:webHidden'].some(key=>descendants(nodes,key).length);
 const safeStyle=(id,seen=new Set())=>{if(!id)return true;if(seen.has(id)||!styles.has(id))return false;seen.add(id);const style=styles.get(id);return !hidden(style)&&values(style,'w:basedOn').every(parent=>safeStyle(parent,seen));};
 return !hidden(children(roots[0],'w:docDefaults').flat())&&!hidden(nodes)&&[...defaults,...values(nodes,'w:pStyle'),...values(nodes,'w:rStyle')].every(id=>safeStyle(id));
}
const frame=[['Done at Brussels,','Fait'],['For the European Parliament\tFor the Council','Institutionquisigne'],['The President\tThe President','Personnequisigne'],['LEGISLATIVE FINANCIAL AND DIGITAL STATEMENT','Fichefinanciretitre']];
function annexPayload(wording) {
 const label=/^Annex(?: (?:1|I))?(?: \(new\))?(?: [–-] ([^\n\t]+))?$/u.exec(wording.targetLabel||'');
 const lines=wording.proposedText?.split('\n')||[];
 return label&&wording.language==='en'&&wording.baseline==='commission-proposal'&&wording.originalText===''&&lines.length>=3&&/^ANNEX(?: (?:1|I))?$/u.test(lines[0])&&lines.every(line=>line.trim())&&!/[\u2026]|\.{3}|\uFFFC/u.test(wording.proposedText)&&!lines.slice(1).some(line=>/^ANNEX\b/u.test(line))&&(!label[1]||clean(label[1]).toUpperCase()===clean(lines[1]).toUpperCase());
}
function comparison(bytes,wording,number) {
 const parts=quotedWordParts(bytes),tree=parse(parts.get('word/document.xml'));if(children(tree,'w:document').length!==1)return false;
 const nativeHeadings=descendants(tree,'w:p').map(p=>/^Amendment\s*(\d+)$/iu.exec(text(p).trim())).filter(match=>match&&Number(match[1])===number);if(nativeHeadings.length!==1)return false;
 const body=quotedWordBody(bytes),head=row=>row.kind==='paragraph'&&/^Amendment\s*[1-9]\d*$/iu.test(row.text.trim()),starts=body.flatMap((row,index)=>head(row)&&Number(row.text.match(/\d+$/u)[0])===number?[index]:[]);if(starts.length!==1)return false;
 const start=starts[0],end=body.findIndex((row,index)=>index>start&&head(row)),block=body.slice(start,end<0?body.length:end),tables=block.filter(row=>row.kind==='other');
 if(tables.length!==1||!tables[0].nodes['w:tbl']||tables[0].hidden||!visible(parts,block.flatMap(row=>row.kind==='paragraph'?row.nodes:[row.nodes])))return false;
 const header=block.filter(row=>row.kind==='paragraph'),printed=header.filter(row=>row.text.trim());if(header.some(row=>row.hidden||row.unsafe||row.numbered||!known(row.nodes))||!head(printed[0])||printed.slice(1).map(row=>row.text.trim()).join('\n')!==`Proposal for a regulation\n${wording.targetLabel}`)return false;
 const table=tables[0].nodes['w:tbl'];if(!completeGrid(table)||children(table,'w:tblGrid').length!==1||children(children(table,'w:tblGrid')[0],'w:gridCol').length!==2)return false;
 const rows=children(table,'w:tr');if(rows.length!==3)return false;
 const cells=rows.map(row=>children(row,'w:tc'));
 const span=cell=>values(children(cell,'w:tcPr').flat(),'w:gridSpan');
 if(cells[0].length!==1||span(cells[0][0]).join()!=='2'||cells.slice(1).some(row=>row.length!==2||row.some(cell=>span(cell).length)))return false;
 const column=cell=>{const paragraphs=children(cell,'w:p');return paragraphs.length&&paragraphs.every(p=>known(p)&&visible(parts,p))?paragraphs.map(p=>literal(p).trim()).filter(Boolean).join('\n'):null;};
 return column(cells[0][0])===''&&column(cells[1][0])==='Text proposed by the Commission'&&column(cells[1][1])==='Amendment'&&column(cells[2][0])===''&&column(cells[2][1])===wording.proposedText;
}
// First annexes belong after the legislative signature, before its separate
// financial statement. No adopted-text data or production hierarchy is read.
export function assertFirstAnnex({proposal,items,wording,placement,nativeQuoted}) {
 if(!/^Annex(?: (?:1|I))?(?: \(new\))?(?: [–-] [^\n\t]+)?$/u.test(wording?.targetLabel||'')||wording.originalText!==''||!/^ANNEX\b/u.test(wording.proposedText?.split('\n')[0]||''))return null;
 const unknown=()=>({status:'unverified',reason:'oracle-first-annex-unavailable'});
 const classes=(wording.documentReferences||[]).filter(ref=>ref.field==='DocumentClass'&&ref.scope==='amendment');if(classes.length!==1||classes[0].raw!=='Proposal for a regulation')return unknown();
 if(!annexPayload(wording)||wording.targetPath?.underlying?.length||wording.targetPath?.proposal?.length&&(wording.targetPath.proposal.length!==1||wording.targetPath.proposal[0].raw!==wording.targetLabel)||items?.length!==1||items[0].kind!=='act'||proposal!==items[0].proposal||placement?.operation!=='insert'||!Buffer.isBuffer(nativeQuoted?.proposalBuffer)||hash(nativeQuoted.proposalBuffer)!==proposal.sourceHash||!Buffer.isBuffer(nativeQuoted.amendmentBuffer)||nativeQuoted.number!==wording.number)return unknown();
 try {
  if(!comparison(nativeQuoted.amendmentBuffer,wording,nativeQuoted.number))return unknown();
  return assertAnnexSignatureBoundary({proposal,items,placement,nativeQuoted});
 }catch{return unknown();}
}
export function assertAnnexSignatureBoundary({proposal,items,placement,nativeQuoted}) {
 const unknown=()=>({status:'unverified',reason:'oracle-first-annex-unavailable'});
 if(items?.length!==1||items[0].kind!=='act'||proposal!==items[0].proposal||!Buffer.isBuffer(nativeQuoted?.proposalBuffer)||hash(nativeQuoted.proposalBuffer)!==proposal.sourceHash||!Buffer.isBuffer(nativeQuoted.amendmentBuffer))return unknown();
 try {
  const parts=quotedWordParts(nativeQuoted.proposalBuffer),tree=parse(parts.get('word/document.xml')),documents=children(tree,'w:document');if(documents.length!==1||tree.find(node=>node['w:document'])?.[':@']?.['@_xmlns:w']!==URI)return unknown();
  const bodies=children(documents[0],'w:body');if(bodies.length!==1)return unknown();const all=descendants(bodies[0],'w:p'),body=quotedWordBody(nativeQuoted.proposalBuffer);
  if(parts.has('word/numbering.xml')&&values(parse(parts.get('word/numbering.xml')),'w:lvlText').some(value=>/annex/iu.test(value)))return unknown();
  if(all.some(p=>/^\s*[‘’"']?ANNEX\b/iu.test(text(p))||values(children(p,'w:pPr').flat(),'w:pStyle').some(id=>/^Annexe?titre/iu.test(id))))return unknown();
  for(const [value]of frame)if(all.filter(p=>text(p).trim()===value).length!==1)return unknown();
  const start=body.findIndex(row=>row.kind==='paragraph'&&row.text.trim()===frame[0][0]),rows=body.slice(start,start+4);if(start<1||rows.length!==4||rows.some((row,index)=>row.kind!=='paragraph'||row.text.trim()!==frame[index][0]||row.hidden||row.unsafe||row.numbered||!known(row.nodes)||values(children(row.nodes,'w:pPr').flat(),'w:pStyle').join()!==frame[index][1]||!visible(parts,row.nodes)))return unknown();
  if(body[start-1]?.kind!=='paragraph'||body[start-1].text.trim()!=='This Regulation shall be binding in its entirety and directly applicable in all Member States.')return unknown();
  const adopted=body.flatMap((row,index)=>row.kind==='paragraph'&&row.text.trim()==='HAVE ADOPTED THIS REGULATION:'?[index]:[]);if(adopted.length!==1||adopted[0]>=start)return unknown();
  if(body.slice(adopted[0],start+4).some(row=>row.kind!=='paragraph'&&!Object.entries(row.nodes).every(([key,value])=>key===':@'||['w:bookmarkStart','w:bookmarkEnd','w:proofErr'].includes(key)&&Array.isArray(value)&&!value.length)||row.kind==='paragraph'&&(!known(row.nodes,{legal:true})||row.hidden||!visible(parts,row.nodes))))return unknown();
  const mapped=rows.map(row=>proposal.paragraphs.filter(p=>p.source?.path===row.path&&p.text===row.text.trim()&&p.complete&&p.source.complete&&p.source.container==='body'));
  if(mapped.some(matches=>matches.length!==1))return unknown();const coordinates=mapped.map(matches=>matches[0]);if(coordinates.some((row,index)=>index&&(row.index!==coordinates[index-1].index+1||row.source.ordinal!==coordinates[index-1].source.ordinal+1)))return unknown();
  const before=coordinates[3].index;if(placement.status!=='placed'||placement.itemIndex!==0||placement.insertBefore!==before||placement.insertAfter!==before-1)return {status:'failed',reason:'oracle-first-annex-boundary-mismatch'};
  return {status:'verified',reason:'oracle-native-first-annex-before-statement',assertion:{nativeSignatureEnd:rows[2].path,nativeFinancialStatement:rows[3].path,proposalSha256:proposal.sourceHash,amendmentSha256:hash(nativeQuoted.amendmentBuffer)}};
 }catch{return unknown();}
}

// A second annex may follow the first annex introduced by the immediately
// preceding published amendment. Read both amendments, including paragraphs
// printed between the comparison headings and the second annex's legal table.
export function assertSequentialAnnex({proposal,items,wording,placement,nativeQuoted}) {
 if(!/^Annex (?:2|II)(?: \(new\))?(?: [–-] [^\n\t]+)?$/u.test(wording?.targetLabel??'')||wording.originalText!=='')return null;
 const unknown=()=>({status:'unverified',reason:'oracle-sequential-annex-unavailable'});
 const refs=wording.documentReferences?.filter(ref=>ref.field==='PrecedingAnnex')??[];if(!refs.length)return null;
 const classes=wording.documentReferences?.filter(ref=>ref.field==='DocumentClass'&&ref.scope==='amendment')??[];
 if(classes.length!==1||classes[0].raw!=='Proposal for a regulation'||wording.targetPath?.proposal?.length&&(wording.targetPath.proposal.length!==1||wording.targetPath.proposal[0].raw!==wording.targetLabel)||wording.language!=='en'||wording.baseline!=='commission-proposal'||!Number.isSafeInteger(wording.number)||wording.number<2||nativeQuoted?.number!==wording.number||refs.length!==1||refs[0].basis!=='native-annex-order'||refs[0].scope!=='amendment'||refs[0].raw!==String(wording.number-1)||wording.targetPath?.underlying?.length)return unknown();
 try {
  const bytes=nativeQuoted.amendmentBuffer,parts=quotedWordParts(bytes),tree=parse(parts.get('word/document.xml')),body=quotedWordBody(bytes);
  const w14='http://schemas.microsoft.com/office/word/2010/wordml',w14Bindings=nodes=>nodes.every(node=>(node[':@']?.['@_xmlns:w14']===undefined||node[':@']['@_xmlns:w14']===w14)&&Object.values(node).every(value=>!Array.isArray(value)||w14Bindings(value)));if(!w14Bindings(tree)||descendants(tree,'w14:ligatures').length&&tree.find(node=>node['w:document'])?.[':@']?.['@_xmlns:w14']!==w14)return unknown();
  const head=row=>row.kind==='paragraph'&&/^Amendment\s*[1-9]\d*$/iu.test(row.text.trim()),heads=body.flatMap((row,index)=>head(row)?[{index,number:Number(row.text.match(/\d+$/u)[0])}]:[]),current=heads.filter(row=>row.number===wording.number),prior=heads.filter(row=>row.number===wording.number-1);
  if(current.length!==1||prior.length!==1||heads.indexOf(current[0])!==heads.indexOf(prior[0])+1||descendants(tree,'w:p').filter(p=>new RegExp('^Amendment\\s*'+wording.number+'$','iu').test(text(p).trim())).length!==1)return unknown();
  const priorBlock=body.slice(prior[0].index,current[0].index),priorPrinted=priorBlock.filter(row=>row.kind==='paragraph'&&row.text.trim()),priorTables=priorBlock.filter(row=>row.kind==='other'&&row.nodes['w:tbl']);
  if(priorPrinted.length!==3||priorTables.length!==1)return unknown();
  const priorRows=children(priorTables[0].nodes['w:tbl'],'w:tr'),priorCell=children(priorRows[2]??[],'w:tc')[1];if(!priorCell)return unknown();
  const previous={language:'en',baseline:'commission-proposal',targetLabel:priorPrinted[2].text.trim(),originalText:'',proposedText:children(priorCell,'w:p').map(p=>literal(p).trim()).filter(Boolean).join('\n')};
  if(!annexPayload(previous)||previous.targetLabel!==refs[0].sourceRaw||!comparison(bytes,previous,wording.number-1))return unknown();
  const next=heads[heads.indexOf(current[0])+1],block=body.slice(current[0].index,next?.index??body.length);
  // A final body section definition carries layout only, outside the amendment.
  if(block.at(-1)?.nodes?.['w:sectPr']){const last=block.pop();if(!sectionLayout(last.nodes['w:sectPr']))return unknown();}
  const tables=block.filter(row=>row.kind==='other');if(tables.length!==2||tables.some(row=>!row.nodes['w:tbl']||row.hidden)||!visible(parts,block.flatMap(row=>row.kind==='paragraph'?row.nodes:[row.nodes])))return unknown();
  const first=block.indexOf(tables[0]),last=block.indexOf(tables[1]),header=block.slice(0,first).filter(row=>row.kind==='paragraph'&&row.text.trim());
  if(header.length!==3||!head(header[0])||header[1].text.trim()!=='Proposal for a regulation'||header[2].text.trim()!==wording.targetLabel||block.filter(row=>row.kind==='paragraph').some(row=>row.hidden||row.unsafe||row.numbered||!known(row.nodes,{typography:true})))return unknown();
  const column=cell=>children(cell,'w:p').every(p=>known(p,{typography:true})&&visible(parts,p))?children(cell,'w:p').map(p=>literal(p).trim()).filter(Boolean).join('\n'):null;
  const headerTable=tables[0].nodes['w:tbl'],grid=tables[1].nodes['w:tbl'],count=children(children(grid,'w:tblGrid')[0]??[],'w:gridCol').length;
  if(!completeGrid(headerTable)||children(headerTable,'w:tblGrid').length!==1||children(children(headerTable,'w:tblGrid')[0],'w:gridCol').length!==1||!completeGrid(grid)||children(grid,'w:tblGrid').length!==1||count<2||count>20)return unknown();
  const headerRows=children(headerTable,'w:tr').map(row=>children(row,'w:tc'));
  if(headerRows.length!==2||headerRows.some(row=>row.length!==1||values(children(row[0],'w:tcPr').flat(),'w:gridSpan').length)||column(headerRows[0][0])!=='Text proposed by the Commission'||column(headerRows[1][0])!=='Amendment')return unknown();
  const prefix=block.slice(first+1,last).filter(row=>row.kind==='paragraph'&&row.text.trim()).map(row=>row.text.trim());
  if(prefix.length!==2||!/^ANNEX(?: (?:2|II))?$/u.test(prefix[0])||!/[.:]$/u.test(prefix[1])||block.slice(last+1).some(row=>row.kind!=='paragraph'||row.text.trim()))return unknown();
  const cells=children(grid,'w:tr').map(row=>children(row,'w:tc'));if(cells.length<2||cells.some(row=>row.length!==count||row.some(cell=>values(children(cell,'w:tcPr').flat(),'w:gridSpan').length)))return unknown();
  const matrix=cells.map(row=>row.map(column));if(matrix.some(row=>row.some(value=>value===null))||matrix[0].some(value=>!value)||matrix.some(row=>!row.some(Boolean)))return unknown();
  const proposed=[...prefix,...matrix.map(row=>row.join('\t'))].join('\n');
  if(wording.proposedText!==proposed)return {status:'failed',reason:'oracle-sequential-annex-wording-mismatch'};
  const result=assertAnnexSignatureBoundary({proposal,items,placement,nativeQuoted});
  return result.status==='verified'?{...result,reason:'oracle-native-sequential-annex',assertion:{...result.assertion,precedingAmendment:wording.number-1,precedingTarget:previous.targetLabel}}:result;
 }catch{return unknown();}
}

function sectionLayout(nodes){return nodes.every(node=>Object.entries(node).every(([key,value])=>key===':@'||Array.isArray(value)&&(['w:footnotePr','w:endnotePr'].includes(key)?value.every(part=>Object.entries(part).every(([name,children])=>name===':@'||['w:pos','w:numFmt','w:numStart','w:numRestart'].includes(name)&&Array.isArray(children)&&!children.length)):['w:headerReference','w:footerReference','w:pgSz','w:pgMar','w:cols','w:noEndnote','w:docGrid','w:type','w:pgNumType','w:titlePg'].includes(key)&&!value.length)));}
