// Whole comparison-cell notes published by Parliament. These describe only the
// selected edition; they never establish the scope of another language edition.
const unaffectedNotes = {
  bg:['Не се отнася до българския текст'],
  cs:['Netýká se českého znění'],
  da:['Vedrører ikke den danske tekst'],
  de:['Betrifft nicht die deutsche Fassung'],
  el:['Δεν αφορά το ελληνικό κείμενο'],
  en:['Does not affect the English version','Does not concern the English version'],
  es:['No afecta a la versión española'],
  et:['Ei puuduta eestikeelset versiooni'],
  fi:['Tarkistus ei vaikuta suomenkieliseen versioon'],
  fr:['Ne concerne pas la version française'],
  hu:['A magyar változatot nem érinti','A magyar nyelvi változatot nem érinti'],
  hr:['Ne odnosi se na hrvatsku verziju'],
  it:['Non concerne la versione italiana'],
  lt:['Tekstas lietuvių kalba nekeičiamas'],
  lv:['Neattiecas uz tekstu latviešu valodā'],
  mt:['Ma taffettwax il-verżjoni Maltija'],
  nl:['Niet van toepassing op de Nederlandse versie'],
  pl:['Nie dotyczy polskiej wersji językowej'],
  pt:['Não se aplica à versão portuguesa'],
  ro:['Nu privește versiunea în limba română'],
  sk:['Netýka sa slovenskej verzie'],
  sl:['Ne zadeva slovenske različice'],
  sv:['Berör inte den svenska versionen'],
};
const normalize=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim().toLowerCase();
const markers=new Map(Object.entries(unaffectedNotes).map(([language,notes])=>[language,new Set(notes.map(normalize))]));
function noteText(value) {
  if(typeof value!=='string'||value.length>300)return null;
  // Published cells can retain a paragraph/point label before the entire note.
  let text=normalize(value).replace(/^(?:\d+[a-z]?\.(?:[a-z])?\s*|\([a-z]\)\s*|[a-z]\)\s*|[–—−-]\s*)?(?=\()/u,'');
  text=text.replace(/\.$/u,'').trimEnd();
  if(text.startsWith('(')&&text.endsWith(')'))text=text.slice(1,-1).trim();
  return text.replace(/\.$/u,'').trimEnd();
}
export function amendmentLanguageScope({originalText,proposedText,language}={}) {
  const supported=markers.get(language);
  if(!supported)return null;
  for(const [field,note] of Object.entries({originalText,proposedText})) {
    if(supported.has(noteText(note)))return {status:'not-applicable',language,field,note};
  }
  return null;
}
