import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {docxParts} from './document-text.mjs';

export function provisionalDecisions(decisions,amendmentId) {
  return Array.isArray(decisions)?decisions.filter(decision=>decision.id&&decision.source?.url&&decision.source?.fetchedAt&&decision.amendmentIds?.includes(amendmentId)&&/^Provisional agreement$/iu.test(decision.reference?.trim()||'')):[];
}
export const provisionalDecision=(decisions,amendmentId)=>provisionalDecisions(decisions,amendmentId).length>0;
// This outcome locates an entire published agreement; it does not extract or
// compare the agreement's legal text. Readers open the original source.
export function amendmentProvisional({amendmentId,documentId,listId,decisions,buffer,source}={}) {
  const identity=/^(A-10-(\d{4})-(\d{4,6}))-AM-([1-9]\d*)$/u.exec(amendmentId||'');
  const range=/^(A-10-\d{4}-\d{4,6})-AM-(\d+)-(\d+)$/u.exec(listId||'');
  if(!identity||identity[1]!==documentId||!range||range[1]!==documentId||Number(range[2])!==Number(identity[4])||Number(range[3])!==Number(identity[4])||!provisionalDecision(decisions,amendmentId)||!source?.fetchedAt)return null;
  let url;try{url=new URL(source.url);}catch{return null;}
  if(url.origin!=='https://data.europarl.europa.eu'||url.username||url.password||url.search||url.hash||url.pathname!==`/distribution/reds_iPlRp_Amd/${listId}/${listId}_${source.language}.docx`)return null;
  let text;
  try {
    const xml=docxParts(buffer).get('word/document.xml');
    if(!xml||/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)return null;
    const tree=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml);
    const visit=nodes=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key==='w:t'?value.map(v=>v['#text']??''):key==='w:p'?[visit(value)+'\n']:Array.isArray(value)?[visit(value)]:[])).join('');
    // Tracked/deleted/hidden headings cannot establish a current identity.
    if(/<w:(?:del|moveFrom|vanish|webHidden)\b/u.test(xml))return null;
    text=visit(tree);
  }catch{return null;}
  const numbers=[...text.matchAll(/<NumAm>\s*(\d+)\s*<\/NumAm>/gu)].map(m=>Number(m[1]));
  const reports=[...text.matchAll(/<\/TitreType>\s*A10[-‑]?(\d{4,6})\/(\d{4})/gu)];
  const labels=[...text.matchAll(/<Article>([^<]*)<\/Article>/gu)];
  if(!numbers.length||numbers.some(n=>n!==Number(identity[4]))||reports.length!==1||reports[0][1]!==identity[3]||reports[0][2]!==identity[2]||labels.length!==1||!/^\s*[–—-]\s*$/u.test(labels[0][1])||!text.includes('</Amend>')||text.split('</Article>')[1]?.split('<Original>')[0]?.replace(/<[^>]*>/gu,'').trim().length<100)return null;
  return {status:'document-operation',operation:'replace',scope:'whole-document',reason:'provisional_agreement',evidence:[{basis:'exact-provisional-agreement',sourceUrl:source.url,fetchedAt:source.fetchedAt,reference:amendmentId,language:source.language}]};
}
