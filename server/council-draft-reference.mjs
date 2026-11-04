const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const unique=values=>[...new Set(values)];
const gap=reason=>({status:'unresolved',gaps:[reason]});
// Select only the native ST/C10/CNS reference printed by this exact EP report.
// Translation titles are evidence within one work, never a join between works.
export function reportCouncilDraftReference(report,{reportId,language='en'}={}) {
 if(!/^A-\d{1,2}-\d{4}-\d{4}$/u.test(reportId??'')||!['eli/dl/doc/'+reportId,'https://data.europarl.europa.eu/eli/dl/doc/'+reportId].includes(report?.id)||String(report.work_type?.id??report.work_type).replace(/^https?:\/\/data\.europarl\.europa\.eu\//u,'')!=='def/ep-document-types/REPORT_PLENARY')return gap('council-draft-report-identity');
 if(!/^[a-z]{2}$/u.test(language))return gap('council-draft-language');
 const texts=array(report.is_realized_by).flatMap(e=>Object.values(e.title_alternative??{}).flat()).filter(t=>typeof t==='string');
 const references=texts.flatMap(t=>[...t.matchAll(/(?<![\d/])(\d{4,5})\/(20\d{2})\s*[-–]\s*(C\d+-\d{4}\/\d{4})\s*[-–]\s*(\d{4}\/\d{4})\s*\(CNS\)/gu)].map(m=>({number:Number(m[1]),year:Number(m[2]),epReference:m[3],procedure:m[4]+'(CNS)',raw:m[0]})));
 const identities=unique(references.map(r=>JSON.stringify([r.number,r.year,r.epReference,r.procedure])));
 if(identities.length!==1)return gap(identities.length?'council-draft-reference-ambiguous':'council-draft-reference-unavailable');
 const reference=references[0],linked=unique(array(report.inverse_created_a_realization_of).map(v=>String(v?.id??v).replace(/^https?:\/\/data\.europarl\.europa\.eu\//u,'')));
 if(linked.length!==1||linked[0]!==`eli/dl/proc/${reference.procedure.slice(0,4)}-${reference.procedure.slice(5,9)}`)return gap('council-draft-procedure-mismatch');
 const id=`ST-${reference.number}-${reference.year}-INIT`;
 return {status:'resolved',...reference,id,language,url:`https://data.consilium.europa.eu/doc/document/${id}/${language}/pdf`,gaps:[]};
}
