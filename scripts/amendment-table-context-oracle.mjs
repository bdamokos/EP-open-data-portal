import {assertCaptionedComparison} from './amendment-captioned-comparison-oracle.mjs';
import {createHash} from 'node:crypto';
import {quotedWordBody,quotedWordParts} from './amendment-benchmark-quoted-oracle.mjs';
import {safe,literal,completeGrid,nativeAnnexInstructionRows} from './amendment-native-table-oracle.mjs';
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
const clean=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
const title=value=>clean(value).replace(/^[‘'"\[]+/u,'').toLowerCase();
const elision=value=>/^[\s‘’'"\[\]]*(?:…|\.{3})[\s‘’'"\[\]]*$/u.test(value);
export function assertTableContext({items,wording,placement,nativeQuoted}) {
 if(wording?.language!=='en'||wording.baseline!=='commission-proposal'||typeof wording.originalText!=='string'||!/(?:…|\.{3})/u.test(wording.originalText)||placement.operation!=='replace')return null;
 const unknown=()=>({status:'unverified',reason:'oracle-table-context-unavailable'});
 const outer=wording.targetPath?.proposal?.[0]?.raw??wording.targetLabel?.split('\n')[0]??'';
 const named=/^Annex(?: ([IVXLCDM]+))? [–—-] table [–—-] (.+)$/u.exec(outer),point=/^Annex ([IVXLCDM]+) [–—-] point (\d+)$/u.exec(outer);
 const inner=wording.targetPath?.underlying?.length===1?/^Annex ([IVXLCDM]+) [–—-] point (\d+) [–—-] Table (.+)$/u.exec(wording.targetPath.underlying[0].raw):null;
 if(!named&&!(point&&inner))return null;
 if(named&&wording.targetPath?.underlying?.length)return unknown();
 if(wording.targetPath?.proposal?.length>1||wording.targetPath?.language&&wording.targetPath.language!=='en')return unknown();
 const annex=named?.[1]??point?.[1]??'',caption=named?.[2]??inner[3],lines=wording.originalText.split(/\r?\n/u),at=lines.findIndex(line=>title(line)===title(caption));
 if(at<0||at>1||lines.filter(line=>title(line)===title(caption)).length!==1||point&&(at!==1||!new RegExp('^\\('+point[2]+'\\)\\s','u').test(lines[0]))||!point&&at!==0)return unknown();
 const captioned=assertCaptionedComparison({wording,nativeQuoted});if(captioned&&captioned.status!=='verified')return unknown();
 const original=captioned?captioned.originalRows.map(row=>row.map(clean)):lines.slice(at+1).map(line=>line.split('\t').map(clean));
 if(!original.length||!original.some(row=>row.every(elision))||original.some(row=>row.some(elision)&&!row.every(elision)))return unknown();
 const found=[];
 for(const [itemIndex,item] of (items||[]).entries()){
  if(item.kind!=='annex'||item.proposal?.sourceKind!=='docx')continue;
  const bytes=nativeQuoted?.proposalBuffers?.[itemIndex]??nativeQuoted?.proposalBuffer;if(!Buffer.isBuffer(bytes)||createHash('sha256').update(bytes).digest('hex')!==item.proposal.sourceHash)return unknown();
  let body;try{body=quotedWordBody(bytes);}catch{continue;}
  const annexHeads=body.filter(row=>row.kind==='paragraph'&&row.text.trim()==='ANNEX'+(annex?' '+annex:''));if(annexHeads.length!==1||annexHeads[0].hidden||annexHeads[0].unsafe||!safe(annexHeads[0].nodes))continue;
  let tableNumber=0;
  for(let index=0;index<body.length;index++){
   const entry=body[index];if(entry.kind!=='other'||!entry.nodes['w:tbl'])continue;tableNumber++;
   if(entry.hidden||!completeGrid(entry.nodes['w:tbl']))continue;
   const before=body.slice(0,index),captions=before.filter(row=>row.kind==='paragraph'&&row.text.trim()),last=captions.at(-1),heading=captions.filter(row=>/^ANNEX(?: [IVXLCDM]+)?$/u.test(row.text.trim())).at(-1);
   if(!last||last.hidden||last.unsafe||!safe(last.nodes)||title(last.text)!==title(caption)||heading?.text.trim()!=='ANNEX'+(annex?' '+annex:''))continue;
   if(point){
    const owner=captions.at(-2);if(!owner||owner.hidden||!safe(owner.nodes))continue;
    const leaders=body.slice(body.indexOf(heading)+1,body.indexOf(owner)).filter(row=>row.kind==='paragraph'&&/^Annex [IVXLCDM]+ is amended as follows?:$/u.test(clean(row.text)));
    if(leaders.length!==1||leaders[0].hidden||leaders[0].unsafe||!safe(leaders[0].nodes)||!new RegExp('^Annex '+inner[1]+' is amended as follows?:$','u').test(clean(leaders[0].text)))continue;
    const pointed=/^(?:\(\d+\)\s+)?in point (\d+), the table [‘'"](.+)[’'"] is replaced by the following:$/u.exec(clean(owner.text));
    if(!pointed||pointed[1]!==inner[2]||title(pointed[2])!==title(inner[3]))continue;
    if(clean(owner.text)!==clean(lines[0])){
     const first=body.indexOf(heading),next=body.findIndex((row,i)=>i>first&&row.kind==='paragraph'&&/^ANNEX(?: [IVXLCDM]+)?$/u.test(row.text.trim()));
     let numbered;try{numbered=nativeAnnexInstructionRows(quotedWordParts(nativeQuoted?.proposalBuffers?.[itemIndex]??nativeQuoted?.proposalBuffer),body,first,next<0?body.length:next);}catch{continue;}
     if(numbered[Number(point[2])-1]?.path!==owner.path||clean('('+point[2]+') '+owner.text)!==clean(lines[0]))continue;
    }
   }
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
   let compared=original;
   if(original[0]?.join('\t')!==grid[0]?.join('\t')&&/^\d{8}$/u.test(grid[0]?.[0]??'')){
    const start=body.indexOf(heading),firstTable=body.slice(start+1,index).find(row=>row.kind==='other'&&row.nodes['w:tbl']);
    if(firstTable&&!firstTable.hidden&&completeGrid(firstTable.nodes['w:tbl'])){
     const headerRow=children(firstTable.nodes['w:tbl'],'w:tr')[0],header=children(headerRow,'w:tc').map(cell=>clean(children(cell,'w:p').map(literal).join('\n')));
     if(children(headerRow,'w:tc').every(cell=>children(cell,'w:p').every(safe))&&header.join('\t')===original[0]?.join('\t'))compared=original.slice(1);
    }
   }
   let prior=-1,known=0,ok=true;
   for(const line of compared){
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
