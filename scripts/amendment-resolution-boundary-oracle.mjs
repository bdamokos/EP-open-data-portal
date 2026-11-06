import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {safe} from './amendment-native-table-oracle.mjs';
const normal=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
const nativeText=row=>(row.numberingLabel?row.numberingLabel+'\t':'')+row.text;
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
// Note references do not create or remove a dash-led citation. Other objects remain unsupported.
const citationNodes=nodes=>nodes.filter(node=>!['w:footnoteReference','w:endnoteReference'].some(key=>node[key]?.length===0&&/^\d+$/u.test(node[':@']?.['@_w:id']??''))).map(node=>Object.fromEntries(Object.entries(node).map(([key,value])=>[key,Array.isArray(value)?citationNodes(value):value])));
export function assertResolutionBoundaryInsertion({text,wording,placement}){
 const citation=wording.language==='en'&&/^Citation ([1-9]\d{0,5}) \(new\)$/u.exec(normal(wording.targetLabel??''));
 if(!citation)return null;
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
 }
 return placement.insertAfter===after&&placement.insertBefore===before?{status:'verified',reason:'oracle-native-resolution-boundary'}:{status:'failed',reason:'oracle-resolution-boundary-mismatch'};
}
