const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const canonical = value => String(value?.id || value || '').replace(/^https?:\/\/data\.europarl\.europa\.eu\//, '');
const itemNumber = value => value.split('-').map(n=>n.replace(/^0+(?=\d)/,'')).join('-');

export function speechParentDocuments(activity) {
  return [...new Set(array(activity.recorded_in_a_realization_of)
    .filter(doc=>doc && typeof doc === 'object')
    .flatMap(doc=>array(doc.is_part_of))
    .map(canonical).map(uri=>uri.match(/^eli\/dl\/doc\/(CRE-(?:9|10)-\d{4}-\d{2}-\d{2}-ITM-\d+(?:-\d+)*)$/)?.[1]).filter(Boolean))];
}

// CRE chapter numbers are padded; PVCRE event numbers are not. Resolve only
// among published parents, from one explicit transcript chapter on the same day.
// Never infer continuity from a resumption label, order, title or timestamps.
export function speechAgendaMembership(row) {
  const reported = row.reportedParentIds || row.parentIds;
  if (reported.length < 2) return row;
  const documents = row.parentDocumentIds || (row.parentDocumentId ? [row.parentDocumentId] : []);
  const chapters = [...new Set(documents.map(id=> {
    const match = id.match(/^CRE-(9|10)-(\d{4}-\d{2}-\d{2})-ITM-(\d+(?:-\d+)*)$/);
    return match && Number(match[1]) === row.term && match[2] === row.date ? itemNumber(match[3]) : null;
  }))];
  if (chapters.length !== 1 || chapters[0] === null) return row;
  const candidates = reported.map(id=>id.match(/^MTG-PL-(\d{4}-\d{2}-\d{2})-PVCRE-ITM-(\d+(?:-\d+)*)$/));
  if (candidates.some(match=>!match || match[1] !== row.date)) return row;
  const matches = reported.filter((id,index)=>candidates[index][2] === chapters[0]);
  return matches.length === 1 ? {...row,parentIds:matches,reportedParentIds:reported} : row;
}
