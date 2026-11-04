import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
const folded=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
// Read native template boundaries independently of the application extractor.
// Whole-document scope is explicit in the published Rule 188(3) heading.
export function nativeAlternative(buffer,{number,documentId,language='en'}={}) {
  let body;try{body=quotedWordBody(buffer);}catch{return null;}
  const starts=body.flatMap((row,i)=>row.kind==='paragraph'&&row.text.includes('<Amend>')&&row.text.includes('<NumAm>'+number+'</NumAm>')?[i]:[]);
  if(starts.length!==1)return null;
  const rows=body.slice(starts[0]),end=rows.findIndex(row=>row.kind==='paragraph'&&row.text.includes('</Amend>'));
  if(end<0)return null;
  const group=rows.slice(0,end+1);
  if(group.some(row=>row.kind!=='paragraph'))return null;
  const heading=group.filter(row=>row.text.includes('<DocAmend>'));
  if(heading.length!==1)return null;
  const patterns={en:/^Motion for a resolution \(Rule 188\(3\) of the Rules of Procedure\) replacing non-legislative motion for a resolution A(\d+)[-‑]?(\d{4})\/(\d{4})$/u,es:/^Propuesta de Resolución alternativa \(artículo 188, apartado 3, del Reglamento interno\) a la propuesta de Resolución no legislativa A(\d+)[-‑]?(\d{4})\/(\d{4})$/u};
  const field=/<DocAmend>([^<]+)<\/DocAmend>/u.exec(heading[0].text)?.[1];
  const match=field&&patterns[language]?.exec(folded(field));
  if(!match||'A-'+match[1]+'-'+match[3]+'-'+match[2]!==documentId)return null;
  const title=group.flatMap((row,i)=>row.text.includes('<Article>')?[i]:[]),tail=group.flatMap((row,i)=>row.text.includes('<Original>')?[i]:[]);
  if(title.length!==1||tail.length!==1||tail[0]<=title[0]+1)return null;
  const legal=group.slice(title[0]+1,tail[0]);
  if(legal.some(row=>row.hidden||row.numbered||/"(?:w:(?:drawing|pict|object|del|moveFrom|instrText)|m:oMath)"/u.test(JSON.stringify(row.nodes))))return null;
  const content=legal.map(row=>row.text).filter(value=>value.trim());
  if(content.some(value=>/<[^>]+>/u.test(value)))return null;
  return {proposed:content.join('\n'),scope:'motion-resolution'};
}
export function verifyAlternative({buffer,wording,placement}) {
  const native=nativeAlternative(buffer,{number:wording.number,documentId:wording.targetDocumentId,language:wording.language});
  if(!native)return null;
  if(wording.originalText!==''||typeof wording.proposedText!=='string'||folded(native.proposed)!==folded(wording.proposedText))return {status:'unverified',reason:'alternative-native-wording-unavailable'};
  const verified=placement?.status==='document-operation'&&placement.operation==='alternative-motion'&&placement.scope===native.scope&&!['span','splice','insertAfter','insertBefore'].some(key=>Object.hasOwn(placement,key));
  return {status:verified?'verified':'unverified',reason:verified?'source-attested-alternative-motion':'alternative-motion-not-observed',scope:native.scope};
}
