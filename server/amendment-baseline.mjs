// Exact labels transcribed from public DOCX; see fixtures/proposal-comparison-headings.json.
const normalise=value=>String(value??'').normalize('NFC').replace(/\s+/gu,' ').trim().toLocaleLowerCase('und');
export const COMPARISON_HEADINGS=Object.freeze({
  "bg": {
    "amendment": "Изменение",
    "commission-proposal": "Текст, предложен от Комисията",
    "present-text": "Текст в сила",
    "motion-resolution": "Предложение за резолюция",
    "council-position": "Позиция на Съвета"
  },
  "es": {
    "amendment": "Enmienda",
    "commission-proposal": "Texto de la Comisión",
    "present-text": "Texto en vigor",
    "motion-resolution": "Propuesta de Resolución",
    "council-position": "Posición del Consejo"
  },
  "cs": {
    "amendment": "Pozměňovací návrh",
    "commission-proposal": "Znění navržené Komisí",
    "present-text": "Platné znění",
    "motion-resolution": "Návrh usnesení",
    "council-position": "Postoj Rady"
  },
  "da": {
    "amendment": "Ændringsforslag",
    "commission-proposal": "Kommissionens forslag",
    "present-text": "Gældende ordlyd",
    "motion-resolution": "Forslag til beslutning",
    "council-position": "Rådets holdning"
  },
  "de": {
    "amendment": "Geänderter Text",
    "commission-proposal": "Vorschlag der Kommission",
    "present-text": "Derzeitiger Wortlaut",
    "motion-resolution": "Entschließungsantrag",
    "council-position": "Standpunkt des Rates"
  },
  "et": {
    "amendment": "Muudatusettepanek",
    "commission-proposal": "Komisjoni ettepanek",
    "present-text": "Kehtiv tekst",
    "motion-resolution": "Resolutsiooni ettepanek",
    "council-position": "Nõukogu seisukoht"
  },
  "el": {
    "amendment": "Τροπολογία",
    "commission-proposal": "Κείμενο που προτείνει η Επιτροπή",
    "present-text": "Ισχύον κείμενο",
    "motion-resolution": "Πρόταση ψηφίσματος",
    "council-position": "Θέση του Συμβουλίου"
  },
  "en": {
    "amendment": "Amendment",
    "commission-proposal": "Text proposed by the Commission",
    "present-text": "Present text",
    "motion-resolution": "Motion for a resolution",
    "council-position": "Council position"
  },
  "fr": {
    "amendment": "Amendement",
    "commission-proposal": "Texte proposé par la Commission",
    "present-text": "Texte en vigueur",
    "motion-resolution": "Proposition de résolution",
    "council-position": "Position du Conseil"
  },
  "ga": {
    "amendment": "Leasú",
    "commission-proposal": "Téacs arna mholadh ag an gCoimisiún",
    "present-text": "An téacs atá ann",
    "motion-resolution": "Tairiscint i gcomhair rúin",
    "council-position": "Seasamh ón gComhairle"
  },
  "hr": {
    "amendment": "Izmjena",
    "commission-proposal": "Tekst koji je predložila Komisija",
    "present-text": "Tekst na snazi",
    "motion-resolution": "Prijedlog rezolucije",
    "council-position": "Stajalište Vijeća"
  },
  "it": {
    "amendment": "Emendamento",
    "commission-proposal": "Testo della Commissione",
    "present-text": "Testo in vigore",
    "motion-resolution": "Proposta di risoluzione",
    "council-position": "Posizione del Consiglio"
  },
  "lv": {
    "amendment": "Grozījums",
    "commission-proposal": "Komisijas ierosinātais teksts",
    "present-text": "Spēkā esošais teksts",
    "motion-resolution": "Rezolūcijas priekšlikums",
    "council-position": "Padomes nostāja"
  },
  "lt": {
    "amendment": "Pakeitimas",
    "commission-proposal": "Komisijos siūlomas tekstas",
    "present-text": "Dabartinis tekstas",
    "motion-resolution": "Pasiūlymas dėl rezoliucijos",
    "council-position": "Tarybos pozicija"
  },
  "hu": {
    "amendment": "Módosítás",
    "commission-proposal": "A Bizottság által javasolt szöveg",
    "present-text": "Hatályos szöveg",
    "motion-resolution": "Állásfoglalásra irányuló indítvány",
    "council-position": "A Tanács álláspontja"
  },
  "mt": {
    "amendment": "Emenda",
    "commission-proposal": "Test propost mill-Kummissjoni",
    "present-text": "Test fis-seħħ",
    "motion-resolution": "Mozzjoni għal riżoluzzjoni",
    "council-position": "Pożizzjoni tal-Kunsill"
  },
  "nl": {
    "amendment": "Amendement",
    "commission-proposal": "Door de Commissie voorgestelde tekst",
    "present-text": "Bestaande tekst",
    "motion-resolution": "Ontwerpresolutie",
    "council-position": "Standpunt van de Raad"
  },
  "pl": {
    "amendment": "Poprawka",
    "commission-proposal": "Tekst proponowany przez Komisję",
    "present-text": "Tekst obowiązujący",
    "motion-resolution": "Projekt rezolucji",
    "council-position": "Stanowisko Rady"
  },
  "pt": {
    "amendment": "Alteração",
    "commission-proposal": "Texto da Comissão",
    "present-text": "Texto em vigor",
    "motion-resolution": "Proposta de resolução",
    "council-position": "Posição do Conselho"
  },
  "ro": {
    "amendment": "Amendamentul",
    "commission-proposal": "Textul propus de Comisie",
    "present-text": "Textul în vigoare",
    "motion-resolution": "Propunerea de rezoluție",
    "council-position": "Poziția Consiliului"
  },
  "sk": {
    "amendment": "Pozmeňujúci návrh",
    "commission-proposal": "Text predložený Komisiou",
    "present-text": "Platný text",
    "motion-resolution": "Návrh uznesenia",
    "council-position": "Pozícia Rady"
  },
  "sl": {
    "amendment": "Predlog spremembe",
    "commission-proposal": "Besedilo, ki ga predlaga Komisija",
    "present-text": "Veljavno besedilo",
    "motion-resolution": "Predlog resolucije",
    "council-position": "Stališče Sveta"
  },
  "fi": {
    "amendment": "Tarkistus",
    "commission-proposal": "Komission teksti",
    "present-text": "Nykyinen teksti",
    "motion-resolution": "Päätöslauselmaesitys",
    "council-position": "Neuvoston kanta"
  },
  "sv": {
    "amendment": "Ändringsförslag",
    "commission-proposal": "Kommissionens förslag",
    "present-text": "Nuvarande lydelse",
    "motion-resolution": "Förslag till resolution",
    "council-position": "Rådets ståndpunkt"
  }
});
export function comparisonHeading(raw,language) {
  const vocabulary=COMPARISON_HEADINGS[language];
  const category=Object.entries(vocabulary||{}).find(([,label])=>normalise(label)===normalise(raw))?.[0]
    ?? (language==='ro'&&normalise(raw)==='propunere de rezoluție'?'motion-resolution':undefined);
  return {raw:raw??null,category:category==='amendment'?'other':category||'unknown'};
}
export const isAmendmentHeading=(raw,language)=>normalise(raw)!==''&&normalise(COMPARISON_HEADINGS[language]?.amendment)===normalise(raw);
export function baselineDescriptor(headings) {
  const categories=new Set(headings.map(h=>h.left.category));
  return {category:headings.length&&categories.size===1?[...categories][0]:'unknown',headings,conflicted:categories.size>1};
}
// Metadata tags carry structural scope independently of translated label grammar.
export function amendmentTargetPath(references) {
  const parts=references.filter(r=>r.field==='Article').map(r=>({raw:r.raw,labels:r.raw.split(/\s+[–—]\s+/u).map(raw=>({raw}))}));
  const underlying=references.filter(r=>/^Article[2-4]$/.test(r.field)).map(r=>({document:references.find(d=>d.field==='DocAmend'+r.field.slice(7))?.raw??null,raw:r.raw,labels:r.raw.split(/\s+[–—]\s+/u).map(raw=>({raw}))}));
  return {proposal:parts,underlying};
}
