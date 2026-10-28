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
/** A verified standalone note beside other wording cannot describe the whole column. */
export function amendmentMixedLanguageScope({originalText,proposedText,language}={}) {
  const supported=markers.get(language);
  if(!supported)return null;
  for(const [field,value] of Object.entries({originalText,proposedText})) {
    if(typeof value!=='string'||value.length>200_000)continue;
    const notes=[];let otherWording=false;
    for(const line of value.matchAll(/[^\r\n]+/gu)) {
      const text=line[0].trim();
      if(!text||/^_{3,}$/u.test(text))continue;
      if(supported.has(noteText(text))) {
        const start=line.index+line[0].indexOf(text);
        notes.push({start,end:start+text.length,note:text});
      } else otherWording=true;
    }
    if(notes.length&&otherWording)return {status:'partial',language,field,notes};
  }
  return null;
}
export function amendmentLanguageScope({originalText,proposedText,language}={}) {
  const supported=markers.get(language);
  if(!supported||amendmentMixedLanguageScope({originalText,proposedText,language}))return null;
  for(const [field,note] of Object.entries({originalText,proposedText})) {
    if(typeof note!=='string'||note.length>4000)continue;
    // A column may repeat the note for each numbered provision or retain the
    // printed footnote divider. Every nonempty line must still be a note.
    const lines=note.split(/\r\n?|\n/u).map(line=>line.trim()).filter(line=>line&&!/^_{3,}$/u.test(line));
    if(supported.has(noteText(note))||lines.length>0&&lines.length<=16&&lines.every(line=>supported.has(noteText(line))))return {status:'not-applicable',language,field,note};
  }
  return null;
}
