import {quotedWordBody,quotedWordComparison} from './amendment-benchmark-quoted-oracle.mjs';
const forbidden=new Set(['w:del','w:moveFrom','w:vanish','w:webHidden','w:instrText','w:fldChar','w:drawing','w:pict','w:object','m:oMath']);
const unsafeBoundary=nodes=>nodes.some(node=>Object.entries(node).some(([key,value])=>forbidden.has(key)||Array.isArray(value)&&unsafeBoundary(value)));
// Raw native recital adjacency, independent of the producer's hierarchy/order.
export function assertLocalRecitalBoundary({proposal,wording,placement,nativeQuoted}) {
 const unknown=()=>({status:'unverified',reason:'oracle-local-recital-unavailable'});
 if(wording?.language!=='en'||wording.baseline!=='commission-proposal'||placement?.operation!=='insert'||wording.originalText!==''||!nativeQuoted)return unknown();
 const target=/^Recital ([1-9]\d*)\s*([a-z]) \(new\)$/u.exec(wording.targetLabel||'');if(!target)return unknown();
 let rows,comparison;try{rows=quotedWordBody(nativeQuoted.proposalBuffer);comparison=quotedWordComparison(quotedWordBody(nativeQuoted.amendmentBuffer),nativeQuoted.number);}catch{return unknown();}
 if(!comparison||comparison.outer!==wording.targetLabel||comparison.original!==''||comparison.proposed!==wording.proposedText||!new RegExp('^\\('+target[1]+target[2]+'\\)\\s+','u').test(comparison.proposed))return unknown();
 const openings=rows.flatMap((row,i)=>row.kind==='paragraph'&&row.text.trim()==='Whereas:'?[i]:[]);if(openings.length!==1)return unknown();
 const end=rows.findIndex((row,i)=>i>openings[0]&&row.kind==='paragraph'&&row.text.trim()==='HAVE ADOPTED THIS DIRECTIVE:');if(end<0)return unknown();
 const labelled=rows.slice(openings[0]+1,end).filter(row=>row.kind==='paragraph'&&/^\([1-9]\d*[a-z]*\)\s/u.test(row.text));
 const base=target[1],anchors=labelled.filter(row=>new RegExp('^\\('+base+'\\)\\s','u').test(row.text));
 if(anchors.length!==1||labelled.some(row=>new RegExp('^\\('+base+'[a-z]+\\)\\s','u').test(row.text)))return unknown();
 const anchor=anchors[0],next=rows[rows.indexOf(anchor)+1];
 if(!next||next.kind!=='paragraph'||!new RegExp('^\\('+(Number(base)+1)+'\\)\\s','u').test(next.text)||[anchor,next].some(row=>row.hidden||row.numbered||unsafeBoundary(row.nodes)))return unknown();
 const projections=[anchor,next].map(row=>proposal?.paragraphs.find(p=>p.source?.path===row.path));
 if(projections.some((p,i)=>!p?.complete||p.text!==[anchor,next][i].text.trim())||projections[1].index!==projections[0].index+1)return unknown();
 if(placement.insertBefore!==projections[1].index||placement.insertAfter!==projections[0].index)return {status:'failed',reason:'oracle-local-recital-boundary-mismatch'};
 return {status:'verified',reason:'oracle-native-adjacent-recitals'};
}
