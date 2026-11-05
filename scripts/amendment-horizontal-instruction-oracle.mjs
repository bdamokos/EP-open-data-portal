import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {safe,literal,completeGrid} from './amendment-native-table-oracle.mjs';
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
const all=(nodes,key)=>nodes.flatMap(node=>Object.entries(node).flatMap(([name,value])=>name===key?[node]:Array.isArray(value)?all(value,key):[]));
// Inspect current paragraph/row/cell revision markers independently of the
// producer. Historical property snapshots do not change current boundaries.
const currentRevision=nodes=>nodes.some(node=>Object.entries(node).some(([name,value])=>
 ['w:pPrChange','w:rPrChange','w:tblPrChange','w:tblPrExChange','w:tblGridChange','w:trPrChange','w:tcPrChange'].includes(name)?false:
 ['w:ins','w:del','w:moveFrom','w:moveTo','w:cellIns','w:cellDel','w:cellMerge','w:moveFromRangeStart','w:moveFromRangeEnd','w:moveToRangeStart','w:moveToRangeEnd'].includes(name)||Array.isArray(value)&&currentRevision(value)));
export function assertHorizontalInstruction({wording,nativeQuoted}){
 const refs=wording?.documentReferences?.filter(r=>r.basis==='full-width-deletion-instruction')??[];
 if(!refs.length)return null;
 const unknown=()=>({status:'unverified',reason:'oracle-horizontal-instruction-unavailable'});
 if(refs.length!==1||wording.language!=='hu'||!/^\d+\.? cikk$/u.test(wording.targetLabel??'')||nativeQuoted?.number!==wording.number)return unknown();
 try{
  const body=quotedWordBody(nativeQuoted.amendmentBuffer),heading=row=>row.kind==='paragraph'&&/^Módosítás\s+<NumAm>\d+<\/NumAm>$/u.test(row.text.trim());
  const starts=body.flatMap((row,i)=>heading(row)&&Number(row.text.match(/<NumAm>(\d+)<\/NumAm>/u)[1])===wording.number?[i]:[]);if(starts.length!==1)return unknown();
  const end=body.findIndex((row,i)=>i>starts[0]&&heading(row)),block=body.slice(starts[0],end<0?body.length:end),tables=block.filter(row=>row.nodes?.['w:tbl']);
  if(tables.length!==1||block.some(row=>row.unsafe)||tables[0].hidden)return unknown();
  const table=tables[0].nodes['w:tbl'];if(currentRevision(table)||!completeGrid(table)||all(table,'w:numPr').length)return unknown();
  const rows=[];
  for(const row of children(table,'w:tr')){
   const cells=[];for(const cell of children(row,'w:tc')){
    const paragraphs=children(cell,'w:p');if(!paragraphs.every(safe))return unknown();
    const span=all(cell,'w:gridSpan');if(span.length>1)return unknown();
    cells.push({text:paragraphs.map(literal).filter(t=>t.trim()).join('\n').trim(),span:span.length?Number(span[0][':@']?.['@_w:val']):1});
   }
   if(!cells.some(c=>c.text))continue;
   if(cells.reduce((n,c)=>n+c.span,0)!==2)return unknown();if(cells.some(c=>c.text))rows.push(cells);
  }
  const tail=rows.pop();if(tail?.length!==1||tail[0].span!==2||!/^\(Horizontális módosítás [–—-] [^\r\n]+\)$/u.test(tail[0].text)||rows.length<2||rows.some(r=>r.length!==2||r.some(c=>c.span!==1))||rows[0][0].text!=='A Bizottság által javasolt szöveg'||rows[0][1].text!=='Módosítás'||rows[1][1].text!=='törölve'||rows.slice(2).some(r=>r[1].text))return unknown();
  if(refs[0].raw!==tail[0].text||wording.proposedText!=='törölve'||wording.originalText!==rows.slice(1).map(r=>r[0].text).filter(Boolean).join('\n'))return {status:'failed',reason:'oracle-horizontal-instruction-wording-mismatch'};
  return {status:'verified',reason:'oracle-native-horizontal-instruction'};
 }catch{return unknown();}
}
