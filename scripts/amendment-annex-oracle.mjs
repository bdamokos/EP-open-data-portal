import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
const fold=value=>value.replace(/\s+/gu,' ').trim();
// Adjacent list numbering does not alter whether the intervening row is blank.
const contentUnsafe=nodes=>nodes.some(node=>Object.entries(node).some(([key,value])=>['w:del','w:moveFrom','w:vanish','w:webHidden','w:instrText','w:fldChar','w:drawing','w:pict','w:object','m:oMath','w:footnoteReference','w:endnoteReference'].includes(key)||Array.isArray(value)&&contentUnsafe(value)));
function annexBlankPairs(proposal,buffer) {
  const pairs=new Set();let body;try{body=quotedWordBody(buffer);}catch{return pairs;}
  const paths=new Map(body.map((row,i)=>[row.path,i]));
  const same=(source,native)=>{const prefix=source.properties?.numberingLabel;const text=prefix&&source.text.startsWith(prefix+'\t')?source.text.slice(prefix.length+1):source.text;return native?.kind==='paragraph'&&!native.hidden&&!contentUnsafe(native.nodes)&&fold(text)===fold(native.text);};
  for(let i=1;i<proposal.paragraphs.length;i++) {
    const a=proposal.paragraphs[i-1],b=proposal.paragraphs[i],left=paths.get(a.source.path),right=paths.get(b.source.path);
    if(!Number.isInteger(left)||!Number.isInteger(right)||right<=left+1||!same(a,body[left])||!same(b,body[right]))continue;
    if(body.slice(left+1,right).every(row=>row.kind==='paragraph'&&!row.hidden&&!row.unsafe&&!row.numbered&&row.nodes.every(node=>Object.keys(node).every(key=>key===':@'||key==='w:pPr'))&&!row.nodes.some(node=>node['w:pPr']?.some(prop=>prop['w:numPr']||prop['w:sectPr']))))pairs.add(a.source.path+'|'+b.source.path);
  }
  return pairs;
}
// The projection can omit an unsupported final block entirely. Only native
// body XML can prove that retained text reaches the end of the document.
function nativeAnnexEnd(last,buffer) {
 let body;try{body=quotedWordBody(buffer);}catch{return false;}
 const index=body.findIndex(row=>row.path===last.source.path),native=body[index];
 const prefix=last.properties?.numberingLabel,text=prefix&&last.text.startsWith(prefix+'\t')?last.text.slice(prefix.length+1):last.text;
 if(index<0||native.kind!=='paragraph'||native.hidden||contentUnsafe(native.nodes)||fold(native.text)!==fold(text))return false;
 return body.slice(index+1).every(row=>!row.hidden&&(row.kind==='paragraph'
   ?!row.unsafe&&!row.numbered&&!row.text.trim()&&row.nodes.every(node=>Object.keys(node).every(key=>key===':@'||key==='w:pPr'))
   :Object.keys(row.nodes).every(key=>key===':@'||key==='w:sectPr')&&Object.hasOwn(row.nodes,'w:sectPr')));
}
// Independent raw-source assertion for Annex I a after a sole unnumbered annex.
// Do not inspect parsed units, placement evidence, or production label helpers.
export function assertBareAnnexInsertion(items,wording,placement,nativeQuoted) {
  if(wording.language!=='en'||placement.operation!=='insert'||!/^Annex I\s*[a-z]{1,3} \(new\)$/u.test(wording.targetLabel||''))return null;
  const headings=[];
  for(const [itemIndex,item] of (items||[]).entries())for(const row of item.proposal?.paragraphs||[]) {
    if(/^Annexetitre$/iu.test(row.properties?.styleId||''))headings.push({itemIndex,row,proposal:item.proposal});
  }
  if(headings.length!==1||headings[0].row.text.split(/\r?\n/u)[0].trim()!=='ANNEX')return null;
  const {itemIndex,row,proposal}=headings[0],rows=proposal.paragraphs.filter(p=>p.index>=row.index);
  const unknown=()=>({status:'unverified',reason:'oracle-bare-annex-end-unverified'});
  if(proposal.sourceKind!=='docx'||!rows.length||proposal.gaps?.some(gap=>!Number.isInteger(gap.paragraph)||gap.paragraph>=row.index))return unknown();
  const blanks=nativeQuoted?.proposalBuffer?annexBlankPairs(proposal,nativeQuoted.proposalBuffer):new Set();
  for(const [i,p] of rows.entries()) {
    const previous=rows[i-1];
    if(p.complete!==true||p.source?.complete!==true||p.source.container!=='body'||i&&(p.index!==previous.index+1||p.source.containerPath!==previous.source.containerPath||!(p.source.segment===previous.source.segment&&p.source.ordinal===previous.source.ordinal+1||blanks.has(previous.source.path+'|'+p.source.path))))return unknown();
  }
  if(!nativeAnnexEnd(rows.at(-1),nativeQuoted?.proposalBuffer))return unknown();
  const before=rows.at(-1).index+1;
  return placement.itemIndex===itemIndex&&placement.insertAfter===before-1&&placement.insertBefore===before
    ?{status:'verified',reason:'oracle-sole-bare-annex-end'}:{status:'failed',reason:'oracle-bare-annex-boundary-mismatch'};
}
