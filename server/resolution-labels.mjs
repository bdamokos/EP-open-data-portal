// Exact relative subheading forms from A-10-2026-0080 AM6; see the attributed
// resolution-special-labels fixture. Only the paragraph ordinal is variable.
const templates={
  "bg": "Подзаглавие (ново) (след параграф 25)",
  "es": "Subtítulo (nuevo) (después del apartado 25)",
  "cs": "Dílčí nadpis (nový) – za bod 25",
  "da": "Overskrift (ny) – efter afsnit 25",
  "de": "Zwischenüberschrift (neu) – nach Ziffer 25",
  "et": "Alapealkiri (uus) (pärast punkti 25)",
  "el": "Υπότιτλος (νέος) – μετά την παράγραφο 25",
  "en": "Subheading (new) – after paragraph 25",
  "fr": "Sous-titre (nouveau) – après le paragraphe 25",
  "hr": "Podnaslov (novi) – nakon stavka 25.",
  "it": "Titolo (nuovo) – dopo il paragrafo 25",
  "lv": "Apakšvirsraksts (jauns) – pēc 25. punkta",
  "lt": "Paantraštė (nauja) po 25 dalies",
  "hu": "Alcím (új) a 25 bekezdés után",
  "mt": "Subintestatura (ġdida) – wara paragrafu 25",
  "nl": "Kopje (nieuw) – na paragraaf 25",
  "pl": "Śródtytuł (nowy) - po ustępie 25",
  "pt": "Subtítulo (novo) – após o n.º 25",
  "ro": "Subtitlu (nou) – după punctul 25",
  "sk": "Podnadpis (nový) – za odsekom 25",
  "sl": "Podnaslov (novo) – po odstavku 25",
  "fi": "Alaotsikko (uusi) – 25 kohdan jälkeen",
  "sv": "Underrubrik (ny) – efter punkt 25"
};
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.fromEntries(Object.entries(templates).map(([language,label])=>[language,
  new RegExp('^'+escape(label).replace('25','([1-9]\\d{0,5})')+'$','iu')]));
export function relativeResolutionHeading(label,language) {
  const match=language==='en'?/^Subheading \(new\)\s*(?:[–—-]\s*)?after paragraph ([1-9]\d{0,5})$/iu.exec(label):patterns[language]?.exec(label);
  return match?{kind:'paragraph',label:match[1],base:match[1],suffix:'',after:true,isNew:true,parents:[]}:null;
}
