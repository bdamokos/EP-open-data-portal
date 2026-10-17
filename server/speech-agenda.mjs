const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const canonical = value => String(value?.id || value || '').replace(/^https?:\/\/data\.europarl\.europa\.eu\//, '');
const itemNumber = value => value.split('-').map(n=>n.replace(/^0+(?=\d)/,'')).join('-');
const chapter = id => String(id).match(/^CRE-(9|10)-(\d{4}-\d{2}-\d{2})-ITM-(\d+(?:-\d+)*)$/);

export function speechParentDocumentId(documents) {
  const identities = new Set(documents.map(id=>{
    const match=chapter(id);
    return match ? match[1]+'|'+match[2]+'|'+itemNumber(match[3]) : null;
  }));
  return identities.size === 1 && !identities.has(null) ? documents[0] : null;
}

export function speechParentEvidence(activity) {
  const groups=array(activity.recorded_in_a_realization_of).map(doc=>
    doc && typeof doc === 'object' ? array(doc.is_part_of).map(canonical)
      .map(uri=>uri.match(/^eli\/dl\/doc\/(CRE-(?:9|10)-\d{4}-\d{2}-\d{2}-ITM-\d+(?:-\d+)*)$/)?.[1] || null) : []);
  return {parentDocumentIds:[...new Set(groups.flat().filter(Boolean))],
    parentDocumentsComplete:groups.length > 0 && groups.every(ids=>ids.length > 0 && ids.every(Boolean))};
}

// CRE chapter numbers are padded; PVCRE event numbers are not. Resolve only
// among published parents, from one explicit transcript chapter on the same day.
// Never infer continuity from a resumption label, order, title or timestamps.
export function speechAgendaMembership(row) {
  const reported = row.reportedParentIds || row.parentIds;
  if (reported.length < 2 || row.parentDocumentsComplete !== true) return row;
  // Older projections retained only one basename and discarded secondary
  // documents and URI provenance. They need a source-writer metadata refresh.
  const documents = row.parentDocumentIds || [];
  const chapters = [...new Set(documents.map(id=> {
    const match = chapter(id);
    return match && Number(match[1]) === row.term && match[2] === row.date ? itemNumber(match[3]) : null;
  }))];
  if (chapters.length !== 1 || chapters[0] === null) return row;
  const candidates = reported.map(id=>id.match(/^MTG-PL-(\d{4}-\d{2}-\d{2})-PVCRE-ITM-(\d+(?:-\d+)*)$/));
  if (candidates.some(match=>!match || match[1] !== row.date)) return row;
  const matches = reported.filter((id,index)=>candidates[index][2] === chapters[0]);
  return matches.length === 1 ? {...row,parentIds:matches,reportedParentIds:reported} : row;
}
