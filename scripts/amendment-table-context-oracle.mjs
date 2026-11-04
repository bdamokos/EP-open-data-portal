import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {safe,literal,completeGrid} from './amendment-native-table-oracle.mjs';
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
const clean=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
const title=value=>clean(value).replace(/^[‘'"\[]+/u,'').toLowerCase();
const elision=value=>/^[\s‘’'"\[\]]*(?:…|\.{3})[\s‘’'"\[\]]*$/u.test(value);
export function assertTableContext({items,wording,placement,nativeQuoted}) {
 if(wording?.language!=='en'||wording.baseline!=='commission-proposal'||typeof wording.originalText!=='string'||!/(?:…|\.{3})/u.test(wording.originalText)||placement.operation!=='replace')return null;
 const unknown=()=>({status:'unverified',reason:'oracle-table-context-unavailable'});
 const outer=wording.targetPath?.proposal?.[0]?.raw??wording.targetLabel?.split('\n')[0]??'';
 const named=/^Annex(?: ([IVXLCDM]+))? [–—-] table [–—-] (.+)$/u.exec(outer),point=/^Annex ([IVXLCDM]+) [–—-] point (\d+)$/u.exec(outer);
 const inner=wording.targetPath?.underlying?.length===1?/^Annex [IVXLCDM]+ [–—-] point \d+ [–—-] Table (.+)$/u.exec(wording.targetPath.underlying[0].raw):null;
 if(!named&&!(point&&inner))return null;
 const annex=named?.[1]??point?.[1]??'',caption=named?.[2]??inner[1],lines=wording.originalText.split(/\r?\n/u).map(line=>line.trimEnd()),at=lines.findIndex(line=>title(line)===title(caption));
 if(at<0||at>1||lines.filter(line=>title(line)===title(caption)).length!==1||point&&(at!==1||!new RegExp('^\\('+point[2]+'\\)\\s','u').test(lines[0]))||!point&&at!==0)return unknown();
 const original=lines.slice(at+1).map(line=>line.split('\t').map(clean));
 if(!original.length||!original.some(row=>row.every(elision))||original.some(row=>row.some(elision)&&!row.every(elision)))return unknown();
 const found=[];
 for(const [itemIndex,item] of (items||[]).entries()){
  if(item.kind!=='annex'||item.proposal?.sourceKind!=='docx')continue;
  let body;try{body=quotedWordBody(nativeQuoted?.proposalBuffers?.[itemIndex]??nativeQuoted?.proposalBuffer);}catch{continue;}
  let tableNumber=0;
  for(let index=0;index<body.length;index++){
   const entry=body[index];if(entry.kind!=='other'||!entry.nodes['w:tbl'])continue;tableNumber++;
   if(entry.hidden||!completeGrid(entry.nodes['w:tbl']))continue;
   const before=body.slice(0,index),captions=before.filter(row=>row.kind==='paragraph'&&row.text.trim()),last=captions.at(-1),heading=captions.filter(row=>/^ANNEX(?: [IVXLCDM]+)?$/u.test(row.text.trim())).at(-1);
   if(!last||last.hidden||last.unsafe||!safe(last.nodes)||title(last.text)!==title(caption)||heading?.text.trim()!=='ANNEX'+(annex?' '+annex:''))continue;
   if(point&&clean(captions.at(-2)?.text??'')!==clean(lines[0]))continue;
   const path=`/w:document[1]/w:body[1]/w:tbl[${tableNumber}]`,grid=[],mapped=[],valid=[];
   for(const [ri,row] of children(entry.nodes['w:tbl'],'w:tr').entries()){
    const cells=[];
    for(const [ci,cell] of children(row,'w:tc').entries()){
     const paragraphs=children(cell,'w:p');cells.push(clean(paragraphs.map(literal).join('\n')));
     for(const [pi,p] of paragraphs.entries()){
      if(!safe(p)){valid.push(false);continue;}
      if(!literal(p).trim())continue;
      const sourcePath=path+`/w:tr[${ri+1}]/w:tc[${ci+1}]/w:p[${pi+1}]`,matches=item.proposal.paragraphs.filter(p=>p.source?.path===sourcePath);
      if(matches.length!==1||!matches[0].complete||matches[0].source.complete!==true||clean(matches[0].text)!==clean(literal(p)))valid.push(false);else mapped.push(matches[0].index);
     }
    }
    grid.push(cells);
   }
   if(valid.length||!mapped.length||item.proposal.paragraphs.filter(p=>p.source?.path.startsWith(path+'/')).length!==mapped.length)continue;
   let prior=-1,known=0,ok=true;
   for(const line of original){
    if(line.every(elision)){if(grid.some(row=>row.length!==line.length))ok=false;continue;}
    const matches=grid.flatMap((row,i)=>row.length===line.length&&row.every((value,j)=>value===line[j])?[i]:[]);
    if(matches.length!==1||matches[0]<=prior){ok=false;break;}prior=matches[0];known++;
   }
   if(ok&&known)found.push({itemIndex,start:Math.min(...mapped),end:Math.max(...mapped)});
  }
 }
 if(found.length!==1)return unknown();
 const expected=found[0];
 if(placement.itemIndex!==expected.itemIndex||placement.span?.start!==expected.start||placement.span?.end!==expected.end||placement.splice)return {status:'failed',reason:'oracle-table-context-boundary-mismatch'};
 return {status:'verified',reason:'oracle-native-table-context'};
}
