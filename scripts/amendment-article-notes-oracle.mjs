import {createHash} from 'node:crypto';
import {quotedWordBody,quotedWordComparison} from './amendment-benchmark-quoted-oracle.mjs';
import {assertFootnoteComparison} from './amendment-footnote-oracle.mjs';
// Whole articles need a native heading-to-heading extent, in addition to the
// independent note payload and anchor assertions used for smaller provisions.
const attrs=(nodes,key)=>nodes.flatMap(n=>Object.entries(n).flatMap(([k,v])=>k===key?[n[':@']||{}]:Array.isArray(v)?attrs(v,key):[]));
const has=(nodes,key)=>nodes.some(n=>Object.entries(n).some(([k,v])=>k===key||Array.isArray(v)&&has(v,key)));
function nativeText(nodes,result={text:'',notes:[]}) {
 for(const n of nodes)for(const [key,value] of Object.entries(n)){
  if(key==='w:t')result.text+=value.map(n=>n['#text']??'').join('');
  else if(key==='w:tab')result.text+='\t';
  else if(key==='w:br'||key==='w:cr')result.text+='\n';
  else if(key==='w:softHyphen')result.text+='\u00ad';
  else if(key==='w:noBreakHyphen')result.text+='\u2011';
  else if(key==='w:footnoteReference')result.notes.push({id:n[':@']?.['@_w:id'],offset:result.text.length});
  else if(Array.isArray(value))nativeText(value,result);
 }
 return result;
}
// Committee reports print the amendment number and article heading rather
// than tagged amendment fields. Read only their exact English two-column grid.
function reportComparison(body,number){
 const starts=body.flatMap((r,i)=>r.kind==='paragraph'&&new RegExp('^Amendment\\s+'+number+'$','u').test(r.text.trim())?[i]:[]);
 if(starts.length!==1)return null;
 const start=starts[0],next=body.findIndex((r,i)=>i>start&&r.kind==='paragraph'&&/^Amendment\s+\d+$/u.test(r.text.trim())),rows=body.slice(start,next<0?body.length:next).filter(r=>r.kind!=='paragraph'||r.text.trim());
 if(rows.length!==4||rows[0].unsafe||rows[1].text!=='Proposal for a regulation'||rows[1].unsafe||rows[2].unsafe||!/^Article \d+[a-z]*$/u.test(rows[2].text)||rows[3].kind!=='other'||rows[3].hidden)return null;
 const table=rows[3].nodes['w:tbl'];if(!table)return null;
 const forbidden=['w:tbl','w:vMerge','w:hMerge','w:del','w:moveFrom','w:vanish','w:webHidden','w:instrText','w:fldChar','w:drawing','w:pict','w:object','m:oMath','w:footnoteReference','w:endnoteReference'];
 if(forbidden.some(key=>has(table,key)))return null;
 const children=(nodes,key)=>nodes.flatMap(n=>n[key]?[n[key]]:[]),tr=children(table,'w:tr');
 if(tr.length&&children(tr[0],'w:tc').length===1&&nativeText(tr[0]).text.trim()===''&&attrs(tr[0],'w:gridSpan').length===1&&attrs(tr[0],'w:gridSpan')[0]['@_w:val']==='2')tr.shift();
 if(tr.some(r=>has(r,'w:gridSpan')))return null;
 const grid=tr.map(r=>children(r,'w:tc').map(c=>children(c,'w:p').map(p=>nativeText(p).text).join('\n').trim()));
 if(grid.length<2||grid.some(r=>r.length!==2)||grid[0][0]!=='Text proposed by the Commission'||grid[0][1]!=='Amendment')return null;
 return {outer:rows[2].text,language:'{EN}en',original:grid.slice(1).map(r=>r[0]).join('\n').trim(),proposed:grid.slice(1).map(r=>r[1]).join('\n').trim()};
}
export function assertArticleNotes({proposal,wording,placement,nativeQuoted}) {
 const unknown=()=>({status:'unverified',reason:'oracle-article-note-extent-unavailable'});
 const label=wording?.language==='en'&&/^Article (\d+[a-z]*)$/u.exec(wording.targetLabel||'');
 if(!label||wording.baseline!=='commission-proposal'||placement?.operation!=='delete'||!/^deleted\.?$/iu.test(wording.proposedText?.trim()||'')||!nativeQuoted||!Buffer.isBuffer(nativeQuoted.proposalBuffer)||proposal?.sourceHash!==createHash('sha256').update(nativeQuoted.proposalBuffer).digest('hex'))return unknown();
 let body,am;try{body=quotedWordBody(nativeQuoted.proposalBuffer);am=reportComparison(quotedWordBody(nativeQuoted.amendmentBuffer),nativeQuoted.number)||quotedWordComparison(quotedWordBody(nativeQuoted.amendmentBuffer),nativeQuoted.number);}catch{return unknown();}
 if(!am||am.language!=='{EN}en'||am.outer!==wording.targetLabel||am.proposed!==wording.proposedText)return unknown();
 if(am.original!==wording.originalText)return unknown();

 const heading=row=>row.kind==='paragraph'&&attrs(row.nodes,'w:pStyle').some(a=>a['@_w:val']==='Titrearticle')&&/^Article \d+[a-z]*$/u.test(row.text.trim());
 const heads=body.filter(row=>heading(row)&&row.text.trim()===wording.targetLabel);
 if(heads.length!==1)return unknown();
 const start=body.indexOf(heads[0]),end=body.findIndex((row,i)=>i>start&&heading(row));
 if(end<0||body[end].hidden||body[end].unsafe)return unknown();
 const raw=body.slice(start,end),prefix=body.slice(0,start).filter(row=>row.kind==='paragraph'),adoption=prefix.findLastIndex(row=>/^HAVE ADOPTED THIS (?:REGULATION|DIRECTIVE|DECISION):$/u.test(row.text.trim()));
 if(adoption<0||prefix.slice(adoption+1).some(row=>/^\s*['‘“«"]/u.test(row.text)||/\b(?:is|are) (?:amended|replaced|inserted)\b/u.test(row.text)))return unknown();
 if(raw.some(row=>row.kind!=='paragraph'||row.hidden||['w:del','w:moveFrom','w:drawing','w:pict','w:object','w:instrText','w:fldChar','w:endnoteReference','m:oMath','w:numPr'].some(key=>has(row.nodes,key))))return unknown();
 const mapped=[];
 for(const row of raw){const matches=proposal.paragraphs.filter(p=>p.source?.path===row.path&&p.text===row.text.trim()&&p.complete&&p.source.complete===true&&p.source.container==='body');if(matches.length!==1)return unknown();mapped.push(matches[0]);
  const native=nativeText(row.nodes),shift=native.text.length-native.text.trimStart().length,anchors=(proposal.anchors||[]).filter(a=>a.paragraph===matches[0].index);
  if(native.text!==row.text||anchors.length!==native.notes.length||anchors.some((a,i)=>a.note!==native.notes[i].id||a.offset!==native.notes[i].offset-shift))return unknown();
 }
 if(mapped.some((p,i)=>i&&(p.index!==mapped[i-1].index+1||p.source.ordinal!==mapped[i-1].source.ordinal+1)))return unknown();
 const first=mapped[0],last=mapped.at(-1),splice=placement.splice;
 const nextRows=proposal.paragraphs.filter(p=>p.source?.path===body[end].path&&p.text===body[end].text.trim()&&p.complete&&p.source.complete===true&&p.source.container==='body');
 if(nextRows.length!==1||nextRows[0].index!==last.index+1||nextRows[0].source.ordinal!==last.source.ordinal+1)return unknown();
 if(placement.status!=='placed'||placement.span?.start!==first.index||placement.span?.end!==last.index||splice?.start.paragraph!==first.index||splice.start.offset!==0||splice?.end.paragraph!==last.index||splice.end.offset!==last.text.length)return {status:'failed',reason:'oracle-article-note-boundary-mismatch'};
 const notes=assertFootnoteComparison(proposal,wording,placement);
 return notes?.status==='verified'?{status:'verified',reason:'oracle-native-whole-article-and-notes'}:notes||unknown();
}
