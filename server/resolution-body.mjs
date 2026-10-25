// Shared resolution boundaries and source completeness for comparisons and readers.
const normalize=value=>String(value).normalize('NFC').replace(/\u00ad/g,'').replace(/\s+/gu,' ').trim();
const openings={
  bg:'Европейският парламент',es:'El Parlamento Europeo',cs:'Evropský parlament',da:'Europa-Parlamentet',de:'Das Europäische Parlament',et:'Euroopa Parlament',
  el:'Το Ευρωπαϊκό Κοινοβούλιο',en:'The European Parliament',fr:'Le Parlement européen',ga:'Parlaimint na hEorpa',hr:'Europski parlament',it:'Il Parlamento europeo',
  lv:'Eiropas Parlaments',lt:'Europos Parlamentas',hu:'Az Európai Parlament',mt:'Il-Parlament Ewropew',nl:'Het Europees Parlement',pl:'Parlament Europejski',
  pt:'O Parlamento Europeu',ro:'Parlamentul European',sk:'Európsky parlament',sl:'Evropski parlament',fi:'Euroopan parlamentti',sv:'Europaparlamentet',
};
const openingVariants={fi:['Euroopan parlamentti, joka'],sv:['Europaparlamentet utfärdar denna resolution']};
export const objectWarnings=new Set([
  'A drawing, equation or other document object is shown as a placeholder; the surrounding text is retained.',
  'An unmapped symbol is shown as an object placeholder; the surrounding text is retained.',
]);
// Use the same row completeness evidence as document-context-model. Saved texts
// without trustworthy source/object locations retain the document-wide gate.
export function bodyCompleteness(text,start) {
  if(text.structureStatus!=='extracted' || !Array.isArray(text.paragraphSources)
    || text.paragraphSources.length!==text.paragraphs.length || !Array.isArray(text.documentObjects))return null;
  let previousOrdinal=-1;const paths=new Set();
  for(let index=0;index<text.paragraphs.length;index++) {
    const source=text.paragraphSources[index];
    if(typeof text.paragraphs[index]!=='string' || !source || typeof source.path!=='string' || !source.path || paths.has(source.path)
      || !Number.isSafeInteger(source.ordinal) || source.ordinal<=previousOrdinal
      || !['body','table-cell','other'].includes(source.container) || typeof source.containerPath!=='string' || !source.containerPath
      || !((typeof source.segment==='string' && source.segment.length>0) || (typeof source.segment==='number' && Number.isSafeInteger(source.segment)))
      || typeof source.complete!=='boolean')return null;
    previousOrdinal=source.ordinal;paths.add(source.path);
  }
  for(const object of text.documentObjects) {
    if(!object || !Number.isSafeInteger(object.paragraph) || object.paragraph<0 || object.paragraph>=text.paragraphs.length
      || !Number.isSafeInteger(object.offset) || object.offset<0 || object.offset>=text.paragraphs[object.paragraph].length
      || !['mapped','unresolved'].includes(object.status))return null;
  }
  return {
    incomplete:text.paragraphSources.slice(start+1).some(source=>!source.complete),
    unresolved:text.paragraphs.slice(start+1).some(value=>value.includes('\uFFFC'))
      || text.documentObjects.some(object=>object.paragraph>start && object.status==='unresolved')
      || (text.notes || []).some(note=>note.text.includes('\uFFFC')),
  };
}
export function motionBodyStart(paragraphs,language) {
  const opening=openings[language];
  // Some translations use the same Parliament heading on the cover and in the body.
  // Require a following citation/recital/operative item and one unambiguous boundary.
  const normalized=paragraphs.map(normalize),starts=[];
  if(opening)for(let i=0;i<normalized.length;i++) {
    if(![opening,...(openingVariants[language] || [])].some(value=>normalized[i].replace(/[,;:]$/,'').toLocaleLowerCase(language)===value.toLocaleLowerCase(language)))continue;
    let next=i+1;while(next<normalized.length&&!normalized[next])next++;
    if(/^(?:[–—−\-•]\s*\S|(?:\d+|\p{Lu}{1,3})[.)]\s+\S)/u.test(normalized[next] || ''))starts.push(i);
  }
  return starts.length===1?starts[0]:-1;
}
