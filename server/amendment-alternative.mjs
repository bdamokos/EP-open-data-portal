// The published heading binds the replacement to the report, without matching
// titles or interpreting a mention of Rule 188 inside the motion's prose.
export function alternativeMotionHeading(references=[],documentId,language='en') {
  if(!Array.isArray(references))return false;
  const headings=references.filter(row=>row.field==='DocAmend'&&row.scope==='amendment');
  if(headings.length!==1||typeof headings[0].raw!=='string')return false;
  const headingsByLanguage={
    en:/^Motion for a resolution \(Rule 188\(3\) of the Rules of Procedure\) replacing non-legislative motion for a resolution A(\d+)[-‑]?(\d{4})\/(\d{4})$/u,
    es:/^Propuesta de Resolución alternativa \(artículo 188, apartado 3, del Reglamento interno\) a la propuesta de Resolución no legislativa A(\d+)[-‑]?(\d{4})\/(\d{4})$/u,
  };
  const match=headingsByLanguage[language]?.exec(headings[0].raw.normalize('NFC').replace(/\s+/gu,' ').trim());
  return Boolean(match&&documentId==='A-'+match[1]+'-'+match[3]+'-'+match[2]);
}
export function amendmentAlternative(variant={}) {
  if(!alternativeMotionHeading(variant.documentReferences,variant.targetDocumentId??variant.listId?.replace(/-AM-\d+-\d+$/u,''),variant.language)||variant.originalText!==''||!variant.proposedText?.trim()||variant.gaps?.some(gap=>!['authors-unavailable','date-unavailable','notes-unavailable'].includes(gap.code)))return null;
  return {operation:'alternative-motion',status:'document-operation',scope:'motion-resolution',reason:'alternative_motion',evidence:[{basis:'published-rule-188-replacement',field:'DocAmend',language:variant.language}]};
}
