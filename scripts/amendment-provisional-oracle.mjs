import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
// Document identity is asserted from native template paragraphs, independently
// of production extraction, comparison columns and placement evidence.
export function verifyProvisional({buffer,id,documentId,listId,decisions=[],placement}) {
  const unknown=reason=>({status:'unverified',reason});
  const am=/^(A-10-(\d{4})-(\d{4,6}))-AM-([1-9]\d*)$/u.exec(id||'');
  if(!am||am[1]!==documentId)return unknown('provisional-identity-unverified');
  const list=/^(A-10-\d{4}-\d{4,6})-AM-(\d+)-(\d+)$/u.exec(listId||'');
  if(!list||list[1]!==documentId||Number(list[2])!==Number(am[4])||Number(list[3])!==Number(am[4]))return unknown('provisional-list-unverified');
  const matches=decisions.filter(d=>d.reference?.trim().toLowerCase()==='provisional agreement'&&d.amendmentIds?.includes(id)&&d.id&&d.source?.url&&d.source?.fetchedAt);
  if(!matches.length)return unknown('provisional-decision-unverified');
  let body;try{body=quotedWordBody(buffer);}catch{return unknown('provisional-native-source-unavailable');}
  const paragraphs=body.filter(row=>row.kind==='paragraph');
  const raw=paragraphs.map(row=>row.text).join('\n');
  const numbers=[...raw.matchAll(/<NumAm>\s*(\d+)\s*<\/NumAm>/gu)].map(m=>Number(m[1]));
  const reports=[...raw.matchAll(/<\/TitreType>\s*A10[-‑]?(\d{4,6})\/(\d{4})/gu)].map(m=>'A-10-'+m[2]+'-'+m[1]);
  const articles=[...raw.matchAll(/<Article>([^<]*)<\/Article>/gu)];
  const identityRows=paragraphs.filter(row=>/<(?:Amend|NumAm|TitreType|Article)>/u.test(row.text));
  if(identityRows.some(row=>row.unsafe)||numbers.length<1||numbers.some(n=>n!==Number(am[4]))||reports.length!==1||reports[0]!==documentId||articles.length!==1||!/^\s*[–—-]\s*$/u.test(articles[0][1])||!raw.includes('</Amend>')||raw.split('</Article>')[1]?.split('<Original>')[0]?.replace(/<[^>]*>/gu,'').trim().length<100)return unknown('provisional-native-identity-unverified');
  if(!placement)return {status:'verified',reason:'source-attested-provisional-agreement',scope:'whole-document'};
  const observed=placement.status==='document-operation'&&placement.operation==='replace'&&placement.scope==='whole-document'&&!['span','splice','insertAfter','insertBefore','itemIndex'].some(key=>Object.hasOwn(placement,key));
  return {status:observed?'verified':'failed',reason:observed?'source-attested-provisional-agreement':'provisional-document-operation-not-observed',scope:'whole-document'};
}
