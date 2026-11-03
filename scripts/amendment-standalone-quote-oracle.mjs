import {createHash} from 'node:crypto';
import {quotedWordBody,quotedWordComparison} from './amendment-benchmark-quoted-oracle.mjs';
// A new paragraph after an annex-introducing instruction follows its complete
// native quotation. A delimiter in its own Word paragraph cannot be a possessive.
export function assertStandaloneQuote({proposal,wording,placement,nativeQuoted}) {
 const unknown=()=>({status:'unverified',reason:'oracle-standalone-quote-unavailable'});
 const target=wording?.language==='en'&&/^Annex ([IVXLCDM]+) – paragraph 1 a \(new\)$/u.exec(wording.targetLabel||'');
 if(!target||wording.baseline!=='commission-proposal'||placement?.operation!=='insert'||!nativeQuoted||!Buffer.isBuffer(nativeQuoted.proposalBuffer)||proposal?.sourceHash!==createHash('sha256').update(nativeQuoted.proposalBuffer).digest('hex'))return unknown();
 let body,amendment;try{body=quotedWordBody(nativeQuoted.proposalBuffer);amendment=quotedWordComparison(quotedWordBody(nativeQuoted.amendmentBuffer),nativeQuoted.number);}catch{return unknown();}
 if(!amendment||amendment.outer!==wording.targetLabel||amendment.language!=='{EN}en'||amendment.original!==''||wording.originalText!==''||amendment.proposed!==wording.proposedText)return unknown();
 const heads=body.filter(row=>row.kind==='paragraph'&&row.text.trim()==='ANNEX '+target[1]);
 if(heads.length!==1)return unknown();
 const rest=body.slice(body.indexOf(heads[0])+1),stop=rest.findIndex(row=>row.kind==='paragraph'&&/^ANNEX [IVXLCDM]+$/u.test(row.text.trim()));
 const block=stop<0?rest:rest.slice(0,stop),paras=block.filter(row=>row.kind==='paragraph'&&row.text.trim());
 const lead=/^The following Annex ([IVXLCDM]+) is added:$/u.exec(paras[0]?.text.trim()||'');
 if(!lead||paras[1]?.text.trim()!=='‘ANNEX '+lead[1]||paras.at(-1)?.text.trim()!=='’'||paras.some(row=>row.unsafe||row.hidden))return unknown();
 const readText=nodes=>Array.isArray(nodes)?nodes.map(n=>Object.entries(n).map(([k,v])=>k==='#text'?String(v):readText(v)).join('')).join(''):'';
 const quote=block.slice(block.indexOf(paras[1]),block.indexOf(paras.at(-1))+1);
 const text=quote.map(row=>row.kind==='paragraph'?row.text:readText([row.nodes])).join('\n').trim();
 if(!text.startsWith('‘ANNEX ')||!text.endsWith('’')||/[‘’“”«»"']/u.test(text.slice(1,-1))||quote.some(row=>row.hidden))return unknown();
 const after=block.slice(block.indexOf(paras.at(-1))+1);
 if(after.some(row=>row.kind==='paragraph'?row.text.trim()!=='':!row.nodes['w:sectPr']))return unknown();
 const close=paras.at(-1),mapped=proposal.paragraphs.filter(p=>p.source?.path===close.path&&p.text.trim()==='’'&&p.complete&&p.source.complete===true);
 if(mapped.length!==1)return unknown();
 const before=mapped[0].index+1;
 return placement.status==='placed'&&placement.insertBefore===before&&placement.insertAfter===before-1?{status:'verified',reason:'oracle-native-standalone-quote'}:{status:'failed',reason:'oracle-standalone-quote-boundary-mismatch',expectedBefore:before};
}
