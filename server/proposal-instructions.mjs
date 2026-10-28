// Commission proposal instruction verbs, checked against COM(2025)87 in each
// language. Match only the document's language; preserve the complete raw text.
const words={
  bg:['изменя','заменя','добавя|вмъква','заличава'],
  cs:['mění','nahrazuje','vkládá|doplňuje','zrušuje|vypouští'],
  da:['ændres','erstattes|affattes','indsættes|tilføjes','udgår|slettes'],
  de:['geändert','ersetzt|erhält.*Fassung','eingefügt|angefügt','gestrichen'],
  el:['τροποποι','αντικαθίστα','προστίθε|παρεμβάλλ','διαγράφ|απαλείφ'],
  en:['\\bamend(?:ed|s)?\\b','\\breplace[ds]?\\b','\\binsert(?:ed|s)?\\b|\\badd(?:ed|s)?\\b','\\bdelete[ds]?\\b'],
  es:['modifica','sustituye','añade|inserta','suprime|elimina'],
  et:['muudetakse','asendatakse','lisatakse','jäetakse välja|kustutatakse'],
  fi:['muutetaan','korvataan','lisätään','poistetaan'],
  fr:['modifi','remplac','insér|ajout','supprim'],
  ga:['leasaítear','ionad','cuirtear.*isteach|cuirtear.*leis','scriostar'],
  hr:['mijenja','zamjenjuje|zamjenjuju','umeće|dodaje|dodaju','briše|brišu'],
  hu:['módosul|módosít','helyébe','beilleszt|egészül ki','elhagy|töröl'],
  it:['modificat','sostituit','inserit|aggiunt','soppress|eliminat'],
  lt:['iš dalies keičiam','pakeičiam','papildom|įterpiam','išbraukiam'],
  lv:['groza','aizstāj','pievieno|iekļauj','svītro'],
  mt:['emendat','sostitwit','jiddaħħal|miżjud','imħassar|jitħassar'],
  nl:['gewijzigd','vervangen','ingevoegd|toegevoegd','geschrapt'],
  pl:['zmienia','zastępuje|otrzymuje.*brzmienie','dodaje','skreśla|uchyla'],
  pt:['alterad','substituíd|passa a ter.*reda[cç][aã]o','aditad|inserid|acrescentad','suprimid'],
  ro:['modifică','înlocuiește|înlocuit','introduce|adaugă|adăugat','elimină'],
  sk:['mení','nahrádza','vkladá|dopĺňa','vypúšťa'],
  sl:['spremeni','nadomesti','vstavi|doda','črta'],
  sv:['ändras','ersätts|ersättas','införs|införas|läggs|läggas','utgår|stryks'],
};
const patterns=new Map();
export function instructionOperation(text,language) {
  if(!patterns.has(language))patterns.set(language,words[language].map(word=>new RegExp(word,language==='en'?'i':'iu')));
  const row=patterns.get(language);
  // A deletion or a replacement may itself contain a reference to an amended
  // act. Select the concrete operation before the general "amended" verb.
  for(const index of [3,2,1,0])if(row[index].test(text))return ['amend','replace','insert','delete'][index];
  return null;
}
