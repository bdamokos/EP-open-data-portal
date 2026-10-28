// Oracle-owned vocabulary, transcribed from the published 24-language editions
// of A-10-2025-0150-AM-001-129 and A-10-2026-0080-AM-001-007 (2026-10-27).
// See fixtures/amendment-oracle-localization.json for attributable source rows.
// Never import production label, segmentation or normalization code here.
export const oracleFold=value=>String(value??'').normalize('NFC').replace(/\u00ad/gu,'').replace(/[‘’‚‛ʻʼ]/gu,"'").replace(/[“”„‟«»]/gu,'"').replace(/[‐‑‒–—−]/gu,'-').replace(/\s+/gu,' ').trim();
// article | annex | paragraph | subparagraph | point | recital | citation |
// introductory part | title | new. Alternatives are source spellings, not translations.
const words={
 en:['Article','Annex','paragraph','subparagraph','point','Recital|Rectial','Citation','introductory part','title','new'],
 bg:['член','приложение','параграф|точка','алинея','точка|буква','съображение','позоваване','уводна част','заглавие','нов|нова|ново'],
 cs:['článek|čl.','příloha','odstavec|odst.|bod','pododstavec','bod|písmeno|písm.','bod odůvodnění','právní východisko','návětí|úvodní část','název','nový|nová|nové'],
 da:['artikel','bilag','stk.|afsnit|punkt','afsnit','nr.|litra','betragtning','henvisning','indledning','overskrift','ny|nyt'],
 de:['Artikel','Anhang','Absatz|Ziffer','Unterabsatz','Nummer|Buchstabe','Erwägung|Erwägungsgrund','Bezugsvermerk','Einleitung','Überschrift','neu'],
 el:['άρθρο','παράρτημα','παράγραφος','εδάφιο','σημείο|στοιχείο','αιτιολογική σκέψη','αιτιολογική αναφορά','εισαγωγικό μέρος','τίτλος','νέο|νέα|νέος'],
 es:['artículo','anexo','apartado|párrafo','párrafo','punto|letra','considerando','visto','parte introductoria','título','nuevo|nueva'],
 et:['artikkel','lisa','lõige|lõik|punkt','lõik','punkt|alapunkt','põhjendus','volitus','sissejuhatav osa','pealkiri','uus'],
 fi:['artikla','liite','kohta','alakohta','alakohta','johdanto-osan # kappale','johdanto-osan # viite','johdantokappale','otsikko','uusi'],
 fr:['article','annexe','paragraphe|alinéa','alinéa','point|sous-point','considérant','visa','partie introductive','titre','nouveau|nouvelle'],
 ga:['airteagal','iarscríbhinn','mír','fomhír','pointe','aithris','lua','an chuid réamhráiteach','teideal','nua'],
 hr:['članak','prilog','stavak','podstavak','točka|podtočka','uvodna izjava','pozivanje','uvodni dio','naslov','novi|nova|novo'],
 hu:['cikk','melléklet','bekezdés','albekezdés','pont','preambulumbekezdés','bevezető hivatkozás','bevezető rész','cím','új'],
 it:['articolo','allegato','paragrafo|comma','comma','punto|lettera','considerando','visto','parte introduttiva','titolo','nuovo|nuova'],
 lt:['straipsnis|straipsnio','priedas|priedo','dalis|dalies','pastraipa|pastraipos','punktas|punkto|papunktis|papunkčio','konstatuojamoji dalis','nurodomoji dalis','įžanginė dalis','pavadinimas','naujas|nauja|naujo'],
 lv:['pants|panta','pielikums|pielikuma','daļa|daļas|punkts','apakšpunkts','punkts|apakšpunkts','apsvērums','norāde','ievaddaļa','virsraksts','jauns|jauna'],
 mt:['artikolu','anness','paragrafu','subparagrafu','punt','premessa','kunsiderazzjoni','parti introduttorja','titolu','ġdid|ġdida'],
 nl:['artikel','bijlage','alinea|lid|paragraaf','alinea','punt','overweging','visum','inleidende formule','titel','nieuw|nieuwe|new'],
 pl:['artykuł','załącznik','ustęp|ust.|akapit','akapit','punkt|litera','motyw','umocowanie','wprowadzenie','tytuł','nowy|nowa|nowe'],
 pt:['artigo','anexo','n.º|parágrafo','parágrafo','ponto|alínea','considerando','citação','parte introdutória','título','novo|nova'],
 ro:['articolul','anexa|anexă','alineatul|paragraful|punctul','paragraf','punctul|litera','considerentul','referirea','partea introductivă','titlu','nou|nouă'],
 sk:['článok|čl.','príloha','odsek|ods.','pododsek','bod|písmeno|písm.','odôvodnenie','citácia','úvodná časť','názov','nový|nová|nové'],
 sl:['člen','priloga','odstavek','pododstavek','točka|podtočka','uvodna izjava','navedba sklicevanja','uvodni del','naslov','novo|nova|nov'],
 sv:['artikel','bilaga','punkt|stycke','stycke','led','skäl','beaktandeled','inledningen','rubrik|rubriken','ny|nytt'],
};
// Literal row/indent labels from AM109/119 of the same published list. They
// remain explicit unsupported scopes, rather than disappearing into a generic
// quote fallback. Portuguese prints linha for both addresses; retain 'row'.
const selectors={bg:['ред','тире'],cs:['řádek','odrážka'],da:['række','led'],de:['Zeile','Gedankenstrich'],el:['σειρά','περίπτωση'],en:['row','indent'],es:['fila','guion'],et:['rida','taane'],fi:['rivi','luetelmakohta'],fr:['ligne','tiret'],ga:['ró','fleasc'],hr:['redak','alineja'],hu:['sor','franciabekezdés'],it:['riga','trattino'],lt:['eilutė','įtrauka'],lv:['rinda','ievilkums'],mt:['ringiela','inċiż'],nl:['rij','bolletje'],pl:['wiersz','tiret'],pt:['linha','linha'],ro:['rândul','liniuța'],sk:['riadok','zarážka'],sl:['vrstica','alinea'],sv:['rad','strecksats']};
const kinds=['article','annex','paragraph','subparagraph','point','recital','citation','introductory-part','title'];
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const literal=value=>value.split('|').map(escape).join('|');
export const oracleWords=language=>words[language]??null;
const token='(?:-?\\d+|-[a-z]|[\\p{Lu}]{1,3}|[IVXLCDM]+)(?:\\.?\\s*-?\\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies|[\\p{Ll}]{1,3}))?';
function labelValue(value,language){
 value=value.replace(/(?<=\d)-(?=\p{L})/gu,'').replace(/\.$/u,'').replace(/\[|\]/gu,'').trim();
 // Dots/hyphens join published suffixes in HR/LV/PT; never transliterate scripts.
 if(['hr','lv'].includes(language))value=value.replace(/\.(?=\p{L})/gu,'');
 if(language==='pt')value=value.replace(/(?<=\d)-?([A-Z])$|(?<=[a-zA-Z])-([A-Z])$/u,(_,a,b)=>(a||b).toLowerCase());
 return value.replace(/\s+/gu,'');
}
const relatives={
 "bg": "Подзаглавие (ново) (след параграф #)",
 "cs": "Dílčí nadpis (nový) – za bod #",
 "da": "Overskrift (ny) – efter afsnit #",
 "de": "Zwischenüberschrift (neu) – nach Ziffer #",
 "el": "Υπότιτλος (νέος) – μετά την παράγραφο #",
 "en": "Subheading (new) – after paragraph #",
 "es": "Subtítulo (nuevo) (después del apartado #)",
 "et": "Alapealkiri (uus) (pärast punkti #)",
 "fi": "Alaotsikko (uusi) – # kohdan jälkeen",
 "fr": "Sous-titre (nouveau) – après le paragraphe #",
 "hr": "Podnaslov (novi) – nakon stavka #.",
 "hu": "Alcím (új) a # bekezdés után",
 "it": "Titolo (nuovo) – dopo il paragrafo #",
 "lt": "Paantraštė (nauja) po # dalies",
 "lv": "Apakšvirsraksts (jauns) – pēc #. punkta",
 "mt": "Subintestatura (ġdida) – wara paragrafu #",
 "nl": "Kopje (nieuw) – na paragraaf #",
 "pl": "Śródtytuł (nowy) - po ustępie #",
 "pt": "Subtítulo (novo) – após o n.º #",
 "ro": "Subtitlu (nou) – după punctul #",
 "sk": "Podnadpis (nový) – za odsekom #",
 "sl": "Podnaslov (novo) – po odstavku #",
 "sv": "Underrubrik (ny) – efter punkt #"
};
export function oracleRelative(raw,language){
 const templates=[relatives[language],...(language==='en'?['Subheading (new) (after paragraph #)','Subheading (new) after paragraph #']:[])].filter(Boolean);
 for(const template of templates){const match=new RegExp('^'+oracleFold(template).split('#').map(escape).join('(\\d+)')+'$','iu').exec(oracleFold(raw));if(match)return {kind:'heading',value:match[1],number:Number(match[1]),base:match[1],after:match[1],suffix:'',isNew:true};}
 return null;
}
export function oracleAddress(raw,language='en',{resolution=false}={}) {
 const vocabulary=words[language];if(!vocabulary)return null;
 const original=String(raw??'');
 if(resolution&&language==='en'){
  const compound=/^Paragraph\s+(\d+)\s+\(([a-z])\)\s+([a-z]+)\s+\(new\)$/u.exec(oracleFold(original));
  if(compound)return [{kind:'paragraph',value:compound[1],number:Number(compound[1]),isNew:false,suffix:''},{kind:'point',value:compound[2]+compound[3],base:compound[2],number:compound[2],suffix:compound[3],isNew:true}];
  const bare=/^(\d+)\s*([a-z]{1,3})\s+\(new\)$/u.exec(oracleFold(original));
  if(bare)return [{kind:'paragraph',value:bare[1]+bare[2],base:bare[1],number:Number(bare[1]),suffix:bare[2],isNew:true}];
 }
 if(/[\r\n]/u.test(original))return null;
 const segments=[];
 const clauses=original.split(/\s+[–—-]\s+|\s*[–—]\s*/u).map(oracleFold);
 for(const clause of clauses){
  let rest=clause.trim(),isNew=false;
  const fresh=new RegExp('\\s*\\((?:'+literal(vocabulary[9])+')\\)\\s*$','iu');
  if(fresh.test(rest)){rest=rest.replace(fresh,'').trim();isNew=true;}
  let consumed=false;
  // Longest labels first: 'bod odůvodnění' must precede 'bod'. Lithuanian
  // has no dash separators; consume its consecutive inflected noun phrases.
  while(rest){
   let found=false;
   for(const [index,term] of (selectors[language]||[]).entries()){
    const postfix=['hu','lt','lv'].includes(language)||language==='fi'&&index===1;
    const pattern=postfix?'(\\d+)\\.?\\s+'+escape(term):escape(term)+'\\s+(\\d+)\\.?';
    const match=new RegExp('^'+pattern+'$','iu').exec(rest);
    if(match){segments.push({kind:index===0||language==='pt'?'row':'indent',value:match[1],number:Number(match[1]),suffix:'',isNew:false});rest='';found=true;break;}
   }
   if(found){consumed=true;break;}
   const order=[5,6,7,8,0,1,2,3,4];
   for(const at of order){
    const kind=kinds[at],term=vocabulary[at];if(!term)continue;
    if(at===1&&new RegExp('^(?:'+literal(term)+')(?=\\s|$)','iu').test(rest)&&!new RegExp('^(?:'+literal(term)+')\\s+\\[?'+token+'\\]?\\.?$','iu').test(rest)){const m=new RegExp('^(?:'+literal(term)+')','iu').exec(rest);segments.push({kind,value:'',base:'',suffix:'',isNew:false});rest=rest.slice(m[0].length).trim();found=true;break;}
    if(at===3&&(language==='fi'||language==='lv'&&/[a-z]/u.test(rest)||!segments.some(s=>s.kind==='paragraph')))continue;
    if(at===2&&segments.length>=2&&term.split('|').some(t=>vocabulary[4].split('|').includes(t))&&new RegExp('^(?:'+literal(vocabulary[4])+')\\s','iu').test(rest))continue;
    if(at>=7){if(new RegExp('^(?:'+literal(term)+')$','iu').test(rest)){segments.push({kind,value:'',isNew});rest='';found=true;break;}continue;}
    let pattern;
    if(term.includes('#'))pattern=term.split('#').map(literal).join('('+token+')');
    else if(['hu','lt','lv'].includes(language)||language==='fi'&&kind!=='annex'||language==='et'&&kind==='annex')pattern='('+token+')\\.?\\s+(?:'+literal(term)+')';
    else pattern='(?:'+literal(term)+')\\s*\\[?('+token+')\\]?\\.?(?:º)?\\)?';
    let match=new RegExp('^'+pattern+'(?=\\s|$)','iu').exec(rest);
    if(!match&&kind==='point'&&['nl'].includes(language))match=new RegExp('^('+token+')$','iu').exec(rest);
    if(!match)continue;
    const rawValue=match[1],canonical=labelValue(rawValue,language),suffix=/^(\d+|[\p{Lu}]{1,3})([\p{Ll}]+)$/u.exec(canonical)||/^([a-z]{1,4})(?:\s+|-)(bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies|[a-z]{1,3})$/iu.exec(rawValue)?.map((v,i)=>i===2&&language==='pt'?v.toLowerCase():v);
    segments.push({kind,value:canonical,base:suffix?.[1]??canonical,suffix:suffix?.[2]??'',number:/^\d+$/u.test(suffix?.[1]??canonical)?Number(suffix?.[1]??canonical):null,isNew:false,negative:canonical.startsWith('-')});
    rest=rest.slice(match[0].length).trim();found=true;break;
   }
   if(!found)return null;
   consumed=true;
  }
  if(!consumed)return null;
  if(isNew)segments.at(-1).isNew=true;
 }
 if(!segments.length)return null;
 // A resolution's 'point' labels are operative paragraphs in BG/CS/DA/ET.
 for(let i=2;i<segments.length;i++)if(['bg','cs','da','et','lv'].includes(language)&&segments[i].kind==='paragraph'&&segments[i-1].kind==='paragraph')segments[i].kind='point';
 if(resolution&&segments.length===1&&segments[0].kind==='paragraph'&&/^\p{Lu}+$/u.test(segments[0].base))segments[0].kind='recital';
 if(resolution&&segments.length===1&&segments[0].kind==='point')segments[0].kind='paragraph';
 return segments;
}

// Published amendment instructions in COM(2024)183, all 24 DOCX editions.
// A printed numeral alone is insufficient: quoted legal paragraphs also have
// numerals. These literal legislative verbs distinguish the instruction rows.
const instructionVerbs={
 en:'is amended|are amended|is replaced|are replaced|is inserted|are inserted|are added|is added|is deleted|are deleted',
 bg:'се изменя|се заменя|се заменят|се вмъква|се вмъкват|се добавя|се добавят|добавят се|се заличава|вмъква се|вмъкват се',
 cs:'se mění|se nahrazuje|se nahrazují|se vkládá|se vkládají|se doplňuje|se doplňují|doplňují se|se zrušuje|nahrazuje|nahrazují|vkládá|vkládají|mění',
 da:'foretages følgende ændringer|affattes således|indsættes|erstattes|tilføjes|udgår',
 de:'geändert|erhält folgende Fassung|erhalten folgende Fassung|eingefügt|angefügt|ersetzt|gestrichen|erhält der einleitende Absatz folgende Fassung|aufgehoben',
 el:'τροποποιείται|αντικαθίσταται|αντικαθίστανται|παρεμβάλλεται|παρεμβάλλονται|προστίθεται|προστίθενται|διαγράφεται|απαλείφεται',
 es:'se modifica|se sustituye|se sustituyen|se inserta|se insertan|se añade|se añaden|se suprime',
 et:'muudetakse|asendatakse|lisatakse|jäetakse välja',fi:'muutetaan|korvataan|lisätään|poistetaan|kumotaan',
 fr:'est modifié|sont modifiés|est remplacé|sont remplacés|est inséré|sont insérés|sont ajoutés|est ajouté|est supprimé|sont insérées|sont remplacées|sont ajoutées',
 ga:'leasaítear|cuirtear|cuirfear|scriostar|ionadaítear',hr:'mijenja se|zamjenjuje se|zamjenjuju se|umeće se|umeću se|dodaje se|dodaju se|briše se',
 hu:'módosul|helyébe|egészül ki|el kell hagyni|kiegészül',it:'è così modificato|è sostituit|sono sostituit|è inserit|sono inserit|sono aggiunt|è aggiunt|è soppres',
 lt:'keičiamas|keičiama|pakeičiam|įterpiam|pridedam|išbraukiam|papildomas|papildoma',lv:'groza šādi|aizstāj|iekļauj|pievieno|svītro',
 mt:'emendat|sostitwit|jiddaħħal|jiddaħħlu|jiżdied|jiżdiedu|jitħassar|tiddaħħal',nl:'wordt als volgt gewijzigd|wordt vervangen|worden vervangen|wordt ingevoegd|worden ingevoegd|worden toegevoegd|wordt toegevoegd|wordt geschrapt|vervangen door|alinea toegevoegd|lid toegevoegd|punten toegevoegd|artikelen ingevoegd|afdelingen ingevoegd|afdeling II ingevoegd|lid 2 geschrapt',
 pl:'wprowadza się|otrzymuje brzmienie|dodaje się|zastępuje się|uchyla się|otrzymują brzmienie',pt:'é alterad|são alterad|passa a ter|passam a ter|é aditad|são aditad|é substituíd|são substituíd|é suprimid|é inserido|é inserida|são inseridos|são inseridas',
 ro:'se modifică|se înlocuiește|se înlocuiesc|se introduce|se introduc|se adaugă|sunt înlocuite|sunt adăugate|se elimină',
 sk:'sa mení|sa nahrádza|sa nahrádzajú|sa vkladá|sa vkladajú|sa dopĺňa|sa dopĺňajú|dopĺňajú sa|sa vypúšťa|nahrádza|nahrádzajú|vkladá|vkladajú',
 sl:'se spremeni|se nadomesti|se nadomestijo|se vstavi|se vstavijo|se doda|se dodajo|dodajo se|se črta|nadomesti|nadomestijo|vstavi|vstavijo|vstavita|spremeni',
 sv:'ska ändras|ska ersättas|ska införas|ska läggas till|ska utgå|ersätts|införs|ersättas med|läggas till|införas',
};
export function oracleInstruction(value,language){
 const row=oracleFold(value),label=/^(?:\((\d+|[\p{Ll}]{1,3})\)|(\d+|[\p{Ll}]{1,3})[.)])\s+/u.exec(row);
 if(!label||!instructionVerbs[language])return null;
 const text=row.slice(label[0].length);
 if(!new RegExp(instructionVerbs[language],'iu').test(text))return null;
 return {value:label[1]||label[2],level:/^\d+$/u.test(label[1]||label[2])?0:1};
}

export const oracleOpening=/^(?:The European Parliament|Европейският парламент|Evropský parlament|Europa-Parlamentet|Das Europäische Parlament|Το Ευρωπαϊκό Κοινοβούλιο|El Parlamento Europeo|Euroopa Parlament|Euroopan parlamentti(?:, joka)?|Le Parlement européen|(?:Tá )?Parlaimint na hEorpa|Europski parlament|Az Európai Parlament|Il Parlamento europeo|Europos Parlamentas|Eiropas Parlaments|Il-Parlament Ewropew|Het Europees Parlement|Parlament Europejski|O Parlamento Europeu|Parlamentul European|Európsky parlament|Evropski parlament|Europaparlamentet(?: utfärdar denna resolution)?)[,;:]?$/iu;
