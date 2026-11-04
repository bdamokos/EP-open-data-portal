import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {safe} from './amendment-native-table-oracle.mjs';
import {rawResolutionUnits,rawResolutionPointUnits} from './amendment-benchmark-resolution-oracle.mjs';
const normal=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
const nativeText=row=>(row.numberingLabel?row.numberingLabel+'\t':'')+row.text;
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
// Note references do not create or remove a dash-led citation. Other objects remain unsupported.
const citationNodes=nodes=>nodes.filter(node=>!['w:footnoteReference','w:endnoteReference'].some(key=>node[key]?.length===0&&/^\d+$/u.test(node[':@']?.['@_w:id']??''))).map(node=>Object.fromEntries(Object.entries(node).map(([key,value])=>[key,Array.isArray(value)?citationNodes(value):value])));
function boldItalic(nodes){
 const runs=children(nodes,'w:r').filter(run=>children(run,'w:t').some(t=>t.some(p=>String(p['#text']??'').trim())));
 return runs.length>0&&runs.every(run=>['w:b','w:i'].every(key=>children(run,'w:rPr').some(props=>props.some(node=>node[key]&&!['0','false','off'].includes(node[':@']?.['@_w:val'])))));
}
export function assertResolutionBoundaryInsertion({text,wording,placement}){
 const citation=wording.language==='en'&&/^Citation ([1-9]\d{0,5}) \(new\)$/u.exec(normal(wording.targetLabel??''));
 const first=wording.language==='fr'&&/^Paragraphe ([1-9]\d{0,5}) [–—-] point 1 bis \(nouveau\)$/u.exec(normal(wording.targetLabel??''));
 if(!citation&&!first)return null;
 const unknown=()=>({status:'unverified',reason:'oracle-resolution-boundary-unavailable'});
 if(wording.originalText!==''||typeof wording.proposedText!=='string'||!wording.proposedText.trim()||placement.operation!=='insert')return unknown();
 let body;try{body=quotedWordBody(text?.nativeBuffer);}catch{return unknown();}
 const mapped=(row,notes=false)=>{if(row?.kind!=='paragraph'||row.hidden||row.unsafe&&!notes||!safe(notes?citationNodes(row.nodes):row.nodes))return null;const indices=text.paragraphSources.flatMap((source,i)=>source.path===row.path?[i]:[]);return indices.length===1&&text.paragraphSources[indices[0]].complete&&text.paragraphSources[indices[0]].container==='body'&&normal(text.paragraphs[indices[0]])===normal(nativeText(row))?indices[0]:null;};
 let after,before;
 if(citation){
  if(!/^[–—−-]\s*\S/u.test(wording.proposedText))return unknown();
  const openers=body.filter(row=>row.kind==='paragraph'&&row.text.trim()==='The European Parliament,');
  if(openers.length!==1||mapped(openers[0])===null)return unknown();
  const citations=[];let stopped=false;
  for(const row of body.slice(body.indexOf(openers[0])+1)){
   if(row.kind!=='paragraph'||row.hidden||row.numbered||!safe(citationNodes(row.nodes)))return unknown();
   const value=row.text.trim();if(!value)continue;
   if(/^(?:A|1)[.)]\s/u.test(value)){stopped=true;break;}
   if(!/^[–—−-]\s*\S/u.test(value)||mapped(row,true)===null)return unknown();
   citations.push(mapped(row,true));
  }
  const at=Number(citation[1])-1,opening=mapped(openers[0]);
  if(!stopped||at<1||at>=citations.length||citations.some((index,i)=>index!==opening+i+1))return unknown();
  after=citations[at-1];before=citations[at];
 }else{
  if(!/^1\s*bis\)\s/u.test(normal(wording.proposedText)))return unknown();
  const raw=rawResolutionUnits(text,'fr'),parents=raw.units.filter(unit=>unit.kind==='paragraph'&&unit.label===first[1]);
  if(raw.reason||parents.length!==1)return unknown();
  const parent=parents[0],points=rawResolutionPointUnits(text).units.filter(unit=>unit.parent===parent.start&&unit.path.length===2).sort((a,b)=>a.start-b.start),point=points[0];
  if(point?.label!=='a'||!point.complete||!/:\s*$/u.test(text.paragraphs[parent.start])||![parent.start+1,parent.start+2].includes(point.start))return unknown();
  const nativeRows=[];
  for(let i=parent.start;i<=point.start;i++){const rows=body.filter(row=>row.path===text.paragraphSources[i]?.path);if(rows.length!==1||mapped(rows[0])!==i)return unknown();nativeRows.push(rows[0]);}
  if(nativeRows.some((row,i)=>i&&body.indexOf(row)!==body.indexOf(nativeRows[i-1])+1)||nativeRows.length===3&&!boldItalic(nativeRows[1].nodes))return unknown();
  after=parent.start;before=parent.start+1;
 }
 return placement.insertAfter===after&&placement.insertBefore===before?{status:'verified',reason:'oracle-native-resolution-boundary'}:{status:'failed',reason:'oracle-resolution-boundary-mismatch'};
}
