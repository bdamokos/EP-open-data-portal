import {extractAmendments} from './amendment-documents.mjs';
const normal=s=>String(s??'').normalize('NFC').replace(/\s+/gu,' ').trim();
const headings=new Set(['Text proposed by the Council','Znění navržené Radou']);
export function hasCouncilQuotation(chosen){return chosen?.baselineSource?.conflicted===false&&chosen.baselineSource.headings?.length===1&&headings.has(normal(chosen.baselineSource.headings[0].left.raw));}
// This is a quotation outcome, never a location in the Council's full text.
export function reportCouncilQuotation(buffer,chosen,{reportId,sourceUrl,fetchedAt,operation='replace'}={}){
 if(!hasCouncilQuotation(chosen)||!/^A-10-\d{4}-\d{4,6}$/u.test(reportId??'')||!chosen.originalText?.trim())return null;
 const result=extractAmendments(buffer,{reportId,listId:chosen.listId,targetDocumentId:reportId,language:chosen.language,sourceUrl,fetchedAt});
 const rows=result.amendments.filter(a=>a.number===chosen.number&&normal(a.originalText)===normal(chosen.originalText)&&normal(a.targetLabel)===normal(chosen.targetLabel)&&hasCouncilQuotation(a));
 if(rows.length!==1||result.gaps.some(g=>g.number===chosen.number&&/comparison|text-loss|notes-unavailable/u.test(g.code)))return null;
 return {status:'report-quotation',operation,reason:'council_text_as_quoted_in_report',evidence:[{basis:'report-council-quotation',label:rows[0].baselineSource.headings[0].left.raw,sourceUrl,fetchedAt,language:chosen.language,reportId}]};
}
