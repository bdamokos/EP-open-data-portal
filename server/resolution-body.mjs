// Shared resolution boundaries and source completeness for comparisons and readers.
const normalize=value=>String(value).normalize('NFC').replace(/\u00ad/g,'').replace(/\s+/gu,' ').trim();
export const resolutionSeparator=value=>/^\s*°(?:\s*°)*\s*$/u.test(value);
// EP subheadings such as A-10-2026-0080's "Prevention and detection"
// cover the whole source row with both marks. Partial emphasis is not a heading.
export function resolutionSubheading(value,format) {
  const start=value.search(/\S/u),end=value.trimEnd().length;
  return start>=0 && ['bold','italic'].every(kind=>(format?.marks||[]).some(mark=>
    mark.kind===kind && Number.isInteger(mark.start) && Number.isInteger(mark.end)
    && mark.start<=start && mark.end>=end));
}
const openings={
  bg:'Европейският парламент',es:'El Parlamento Europeo',cs:'Evropský parlament',da:'Europa-Parlamentet',de:'Das Europäische Parlament',et:'Euroopa Parlament',
  el:'Το Ευρωπαϊκό Κοινοβούλιο',en:'The European Parliament',fr:'Le Parlement européen',ga:'Parlaimint na hEorpa',hr:'Europski parlament',it:'Il Parlamento europeo',
  lv:'Eiropas Parlaments',lt:'Europos Parlamentas',hu:'Az Európai Parlament',mt:'Il-Parlament Ewropew',nl:'Het Europees Parlement',pl:'Parlament Europejski',
  pt:'O Parlamento Europeu',ro:'Parlamentul European',sk:'Európsky parlament',sl:'Evropski parlament',fi:'Euroopan parlamentti',sv:'Europaparlamentet',
};
const openingVariants={ga:['Tá Parlaimint na hEorpa'],fi:['Euroopan parlamentti, joka'],sv:['Europaparlamentet utfärdar denna resolution','Europaparlamentet fattar detta beslut']};
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
// Exact public report headings; see fixtures/resolution-section-headings.json.
// Contents entries with trailing page numbers are not body headings.
const sectionHeadings={
  bg:["ПРЕДЛОЖЕНИЕ ЗА РЕЗОЛЮЦИЯ НА ЕВРОПЕЙСКИЯ ПАРЛАМЕНТ,", "ПРЕДЛОЖЕНИЕ ЗА РЕШЕНИЕ НА ЕВРОПЕЙСКИЯ ПАРЛАМЕНТ"],
  es:["PROPUESTA DE RESOLUCIÓN DEL PARLAMENTO EUROPEO", "PROPUESTA DE DECISIÓN DEL PARLAMENTO EUROPEO"],
  cs:["NÁVRH USNESENÍ EVROPSKÉHO PARLAMENTU", "NÁVRH ROZHODNUTÍ EVROPSKÉHO PARLAMENTU"],
  da:["FORSLAG TIL EUROPA-PARLAMENTETS BESLUTNING", "FORSLAG TIL EUROPA-PARLAMENTETS AFGØRELSE"],
  de:["ENTWURF EINER ENTSCHLIESSUNG DES EUROPÄISCHEN PARLAMENTS", "VORSCHLAG FÜR EINEN BESCHLUSS DES EUROPÄISCHEN PARLAMENTS"],
  et:["EUROOPA PARLAMENDI RESOLUTSIOONI ETTEPANEK", "ETTEPANEK VÕTTA VASTU EUROOPA PARLAMENDI OTSUS"],
  el:["ΠΡΟΤΑΣΗ ΨΗΦΙΣΜΑΤΟΣ ΤΟΥ ΕΥΡΩΠΑΪΚΟΥ ΚΟΙΝΟΒΟΥΛΙΟΥ", "ΠΡΟΤΑΣΗ ΑΠΟΦΑΣΗΣ ΤΟΥ ΕΥΡΩΠΑΪΚΟΥ ΚΟΙΝΟΒΟΥΛΙΟΥ"],
  en:["MOTION FOR A EUROPEAN PARLIAMENT RESOLUTION", "PROPOSAL FOR A EUROPEAN PARLIAMENT DECISION"],
  fr:["PROPOSITION DE RÉSOLUTION DU PARLEMENT EUROPÉEN", "PROPOSITION DE DÉCISION DU PARLEMENT EUROPÉEN"],
  ga:["TAIRISCINT LE HAGHAIDH RÚIN Ó PHARLAIMINT NA hEORPA", "TOGRA LE HAGHAIDH CINNIDH Ó PHARLAIMINT NA HEORPA"],
  hr:["PRIJEDLOG REZOLUCIJE EUROPSKOG PARLAMENTA", "PRIJEDLOG ODLUKE EUROPSKOG PARLAMENTA"],
  it:["PROPOSTA DI RISOLUZIONE DEL PARLAMENTO EUROPEO", "PROPOSTA DI DECISIONE DEL PARLAMENTO EUROPEO"],
  lv:["EIROPAS PARLAMENTA REZOLŪCIJAS PRIEKŠLIKUMS", "EIROPAS PARLAMENTA LĒMUMA PRIEKŠLIKUMS"],
  lt:["PASIŪLYMAS DĖL EUROPOS PARLAMENTO REZOLIUCIJOS", "PASIŪLYMAS DĖL EUROPOS PARLAMENTO SPRENDIMO"],
  hu:["AZ EURÓPAI PARLAMENT ÁLLÁSFOGLALÁSÁRA IRÁNYULÓ INDÍTVÁNY", "AZ EURÓPAI PARLAMENT HATÁROZATÁRA IRÁNYULÓ JAVASLAT"],
  mt:["MOZZJONI GĦAL RIŻOLUZZJONI TAL-PARLAMENT EWROPEW", "PROPOSTA GĦAL DEĊIŻJONI TAL-PARLAMENT EWROPEW"],
  nl:["ONTWERPRESOLUTIE VAN HET EUROPEES PARLEMENT", "ONTWERPBESLUIT VAN HET EUROPEES PARLEMENT"],
  pl:["PROJEKT REZOLUCJI PARLAMENTU EUROPEJSKIEGO", "PROJEKT DECYZJI PARLAMENTU EUROPEJSKIEGO"],
  pt:["PROPOSTA DE RESOLUÇÃO DO PARLAMENTO EUROPEU", "PROPOSTA DE DECISÃO DO PARLAMENTO EUROPEU"],
  ro:["PROPUNERE DE REZOLUȚIE A PARLAMENTULUI EUROPEAN", "PROPUNERE DE DECIZIE A PARLAMENTULUI EUROPEAN"],
  sk:["NÁVRH UZNESENIA EURÓPSKEHO PARLAMENTU", "NÁVRH ROZHODNUTIA EURÓPSKEHO PARLAMENTU"],
  sl:["PREDLOG RESOLUCIJE EVROPSKEGA PARLAMENTA", "PREDLOG SKLEPA EVROPSKEGA PARLAMENTA"],
  fi:["EUROOPAN PARLAMENTIN PÄÄTÖSLAUSELMAESITYS", "EUROOPAN PARLAMENTIN PÄÄTÖSEHDOTUS"],
  sv:["FÖRSLAG TILL EUROPAPARLAMENTETS RESOLUTION", "FÖRSLAG TILL EUROPAPARLAMENTETS BESLUT"],
};
const sectionEnds={
  bg:["ПРИЛОЖЕНИЕ", "ИЗЛОЖЕНИЕ НА МОТИВИТЕ"],
  es:["ANEXO", "EXPOSICIÓN DE MOTIVOS"],
  cs:["PŘÍLOHA", "VYSVĚTLUJÍCÍ PROHLÁŠENÍ"],
  da:["BILAG", "BEGRUNDELSE"],
  de:["ANLAGE", "BEGRÜNDUNG"],
  et:["LISA", "SELETUSKIRI"],
  el:["ΠΑΡΑΡΤΗΜΑ", "ΑΙΤΙΟΛΟΓΙΚΗ ΕΚΘΕΣΗ"],
  en:["ANNEX", "EXPLANATORY STATEMENT"],
  fr:["ANNEXE", "EXPOSÉ DES MOTIFS"],
  ga:["IARSCRÍBHINN", "RÁITEAS MÍNIÚCHÁIN"],
  hr:["PRILOG", "OBRAZLOŽENJE"],
  it:["ALLEGATO", "MOTIVAZIONE"],
  lv:["PIELIKUMS", "PASKAIDROJUMS"],
  lt:["PRIEDAS", "AIŠKINAMOJI DALIS"],
  hu:["MELLÉKLET", "INDOKOLÁS"],
  mt:["ANNESS", "NOTA SPJEGATTIVA"],
  nl:["BIJLAGE", "TOELICHTING"],
  pl:["ZAŁĄCZNIK", "UZASADNIENIE"],
  pt:["ANEXO", "EXPOSIÇÃO DE MOTIVOS"],
  ro:["ANEXĂ", "EXPUNERE DE MOTIVE"],
  sk:["PRÍLOHA", "DÔVODOVÁ SPRÁVA"],
  sl:["PRILOGA", "OBRAZLOŽITEV"],
  fi:["LIITE", "PERUSTELUT"],
  sv:["BILAGA", "MOTIVERING"],
};
const headingKey=value=>normalize(String(value).split(/[\r\n]/u)[0]).replace(/^\d+\.\s*/u,'').replace(/,$/u,'').toLocaleLowerCase('und');
const resolutionHeading=(value,language)=>headingKey(value)===headingKey(sectionHeadings[language]?.[0]??'')
  || language==='ga'&&headingKey(value)===headingKey('TAIRISCINT I gCOMHAIR RÚN Ó PHARLAIMINT NA hEORPA');
export const resolutionSectionHeading=(value,language='en')=>resolutionHeading(value,language)
  || Boolean(sectionHeadings[language]?.some(heading=>headingKey(value)===headingKey(heading)))
  || language==='ga'&&headingKey(value)===headingKey('TOGRA LE hAGHAIDH CINNEADH Ó PHARLAIMINT NA hEORPA');
const sectionEnd=(value,language)=>resolutionSectionHeading(value,language)
  || sectionEnds[language]?.some(heading=>{
    const key=headingKey(value),end=headingKey(heading);
    return key===end || key.startsWith(end)&&/^(?:\s+[IVXLCDM\d]+)?\s*[:.–—-]/iu.test(key.slice(end.length));
  })
  || language==='en'&&/^(?:JUSTIFICATION|INFORMATION ON ADOPTION(?:\s.*)?|FINAL VOTE BY ROLL CALL(?:\s.*)?)$/u.test(value);
export function motionBodySelection(paragraphs,language) {
  const opening=openings[language];
  // Some translations use the same Parliament heading on the cover and in the body.
  // Require a following citation/recital/operative item and one unambiguous boundary.
  const normalized=paragraphs.map(normalize),starts=[];
  if(opening)for(let i=0;i<normalized.length;i++) {
    if(![opening,...(openingVariants[language] || [])].some(value=>normalized[i].replace(/[,;:]$/,'').toLocaleLowerCase(language)===value.toLocaleLowerCase(language)))continue;
    let next=i+1;while(next<normalized.length&&!normalized[next])next++;
    if(/^(?:[–—−\-•]\s*\S|(?:\d+|\p{Lu}{1,3})[.)]\s+\S)/u.test(normalized[next] || ''))starts.push(i);
  }
  if(sectionHeadings[language]) {
    const sections=[];let hasHeading=false;
    for(let heading=0;heading<normalized.length;heading++)if(resolutionHeading(paragraphs[heading],language)) {
      hasHeading=true;
      let end=heading+1;while(end<normalized.length&&!sectionEnd(paragraphs[end],language))end++;
      const candidates=starts.filter(start=>start>heading&&start<end);
      // A split contents entry may be an exact heading, but has no opening
      // before the next section. Several openings in one section stay ambiguous.
      if(candidates.length)sections.push({heading,start:candidates.length===1?candidates[0]:-1});
    }
    if(sections.length)return sections.length===1?{...sections[0],multipleOpenings:starts.length>1}:{start:-1};
    if(hasHeading)return {start:-1};
  }
  return {start:starts.length===1?starts[0]:-1};
}
export const motionBodyStart=(paragraphs,language)=>motionBodySelection(paragraphs,language).start;
