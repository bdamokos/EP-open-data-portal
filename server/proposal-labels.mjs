// Surface forms are deliberately language-specific. Proposal headings were checked
// against COM(2025)87 DOCX in all 24 languages; amendment forms include the public
// EP amendment excerpts in server/fixtures. See docs/PROPOSAL_STRUCTURE.md.
const rows = {
  bg:['Член','съображение','параграф','точка|буква','приложение','нова|нов|ново'],
  cs:['Článek|Čl.','bod odůvodnění','odstavec|odst.','bod|písmeno|písm.','příloha','nový|nová|nové'],
  da:['Artikel','betragtning','stk.|stykke','nr.|litra|punkt','bilag','ny|nyt'],
  de:['Artikel','Erwägung|Erwägungsgrund','Absatz','Nummer|Buchstabe|Ziffer','Anhang','neu'],
  el:['Άρθρο|ΑΡΘΡΟ','αιτιολογική σκέψη','παράγραφος','σημείο|στοιχείο','παράρτημα|ΠΑΡΑΡΤΗΜΑ','νέο|νέα|νέος'],
  en:['Article','recital','paragraph','point','Annex','new'],
  es:['Artículo','considerando','apartado|párrafo','punto|letra','anexo','nuevo|nueva'],
  et:['Artikkel','põhjendus','lõige|lõik','punkt|alapunkt','lisa','uus'],
  fi:['artikla','johdanto-osan kappale','kohta','alakohta','liite','uusi'],
  fr:['Article','considérant','paragraphe|alinéa','point|sous-point','annexe','nouveau|nouvelle'],
  ga:['Airteagal','aithris','mír','pointe','Iarscríbhinn','nua'],
  hr:['Članak','uvodna izjava','stavak','točka|podtočka','prilog','novi|nova|novo'],
  hu:['cikk','preambulumbekezdés','bekezdés','pont|alpont','melléklet','új'],
  it:['Articolo','considerando','paragrafo|comma','punto|lettera','allegato','nuovo|nuova'],
  lt:['straipsnis|straipsnio','konstatuojamoji dalis','dalis|dalies','punktas|punkto|papunktis','priedas|priedo','naujas|nauja'],
  lv:['pants','apsvērums','daļa|punkts','punkts|apakšpunkts','pielikums','jauns|jauna'],
  mt:['Artikolu','premessa','paragrafu','punt','anness','ġdid|ġdida'],
  nl:['Artikel','overweging','lid|alinea|paragraaf','punt|letter','bijlage|bĳlage','nieuw|nieuwe'],
  pl:['Artykuł|Art.','motyw','akapit|ustęp|ust.','punkt|pkt|litera|lit.','załącznik','nowy|nowa|nowe'],
  pt:['Artigo','considerando','número|n.º|parágrafo','ponto|alínea','anexo','novo|nova'],
  ro:['Articolul','considerentul|considerent','alineatul|alineat|paragraful','punctul|litera','anexa|anexă','nou|nouă'],
  sk:['Článok|Čl.','odôvodnenie','odsek|ods.','bod|písmeno','príloha','nový|nová|nové'],
  sl:['Člen','uvodna izjava','odstavek','točka','priloga','novo|nov|nova'],
  sv:['Artikel','skäl','punkt|stycke','led','bilaga','ny|nytt'],
};
const iso3={bul:'bg',ces:'cs',dan:'da',deu:'de',ell:'el',eng:'en',est:'et',fin:'fi',fra:'fr',gle:'ga',hrv:'hr',hun:'hu',ita:'it',lav:'lv',lit:'lt',mlt:'mt',nld:'nl',pol:'pl',por:'pt',ron:'ro',slk:'sk',slv:'sl',spa:'es',swe:'sv'};
export const PROPOSAL_LANGUAGES=Object.freeze(Object.keys(rows));
export function proposalLanguage(language='en') {
  const value=String(language).toLowerCase();const code=iso3[value]??value;
  if(!Object.hasOwn(rows,code))throw new RangeError(`Unsupported proposal language: ${language}`);
  return code;
}
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const fold=value=>value.normalize('NFC').replace(/[\u00a0\u202f]/g,' ').replace(/\s+/g,' ').trim();
const kinds=['article','recital','paragraph','point','annex'];
const extra={
  en:{chapter:'Chapter',section:'Section',title:'Title',subparagraph:'subparagraph',indent:'indent',sentence:'sentence'},
  fr:{chapter:'Chapitre',section:'Section',title:'Titre',subparagraph:'alinéa',indent:'tiret',sentence:'phrase'},
  de:{chapter:'Kapitel',section:'Abschnitt',title:'Titel',subparagraph:'Unterabsatz',indent:'Spiegelstrich',sentence:'Satz'},
  hu:{chapter:'fejezet',section:'szakasz',title:'cím',subparagraph:'albekezdés',indent:'franciabekezdés',sentence:'mondat'},
  fi:{chapter:'luku',section:'jakso',title:'osasto',subparagraph:'alakohta',indent:'luetelmakohta',sentence:'virke'},
  el:{chapter:'κεφάλαιο|ΚΕΦΑΛΑΙΟ',section:'τμήμα|ΤΜΗΜΑ',title:'τίτλος|ΤΙΤΛΟΣ',subparagraph:'εδάφιο',indent:'περίπτωση',sentence:'περίοδος'},
  ga:{chapter:'Caibidil',section:'Roinn',title:'Teideal',subparagraph:'fomhír',indent:'fleasc',sentence:'abairt'},
};
const chapterWords={bg:'глава',cs:'kapitola',da:'kapitel',es:'capítulo',et:'peatükk',hr:'poglavlje',it:'capo',lt:'skyrius',lv:'nodaļa',mt:'kapitolu',nl:'hoofdstuk',pl:'rozdział',pt:'capítulo',ro:'capitolul',sk:'kapitola',sl:'poglavje',sv:'kapitel'};
const sectionWords={bg:'раздел',cs:'oddíl',da:'afdeling',es:'sección',et:'jagu',hr:'odjeljak',it:'sezione',lt:'skirsnis',lv:'iedaļa',mt:'taqsima',nl:'afdeling',pl:'sekcja',pt:'secção',ro:'secțiunea',sk:'oddiel',sl:'oddelek',sv:'avsnitt'};
const titleWords={bg:'дял',cs:'hlava',da:'afsnit',es:'título',et:'jaotis',hr:'glava',it:'titolo',lt:'antraštinė dalis',lv:'sadaļa',mt:'titolu',nl:'titel',pl:'tytuł',pt:'título',ro:'titlul',sk:'hlava',sl:'naslov',sv:'avdelning'};
// Bare selectors and subparagraph terms from the same public EP list in all
// languages; fixtures/proposal-selector-labels.json retains the exact labels.
const selectors={
  bg:["уводна част", "заглавие"],
  es:["parte introductoria", "título"],
  cs:["návětí", "název"],
  da:["indledning", "overskrift"],
  de:["Einleitung", "Überschrift"],
  et:["sissejuhatav osa", "pealkiri"],
  el:["εισαγωγικό μέρος", "τίτλος"],
  en:["introductory part", "title"],
  fr:["partie introductive", "titre"],
  ga:["an chuid réamhráiteach", "teideal"],
  hr:["uvodni dio", "naslov"],
  it:["parte introduttiva", "titolo"],
  lv:["ievaddaļa", "virsraksts"],
  lt:["įžanginė dalis", "pavadinimas"],
  hu:["bevezető rész", "cím"],
  mt:["parti introduttorja", "titolu"],
  nl:["inleidende formule", "titel"],
  pl:["wprowadzenie", "nagłówek"],
  pt:["parte introdutória", "título"],
  ro:["partea introductivă", "titlu"],
  sk:["úvodná časť", "nadpis"],
  sl:["uvodni del", "naslov"],
  fi:["johdantokappale", "otsikko"],
  sv:["inledningen", "rubriken"],
};
const subparagraphWords={"bg": "алинея", "es": "párrafo", "cs": "pododstavec", "da": "afsnit", "de": "Unterabsatz", "et": "lõik", "el": "εδάφιο", "en": "subparagraph", "fr": "alinéa", "ga": "fomhír", "hr": "podstavak", "it": "comma", "lv": "daļa", "lt": "pastraipa|pastraipos", "hu": "albekezdés", "mt": "subparagrafu", "nl": "alinea", "pl": "akapit", "pt": "parágrafo", "ro": "paragraful", "sk": "pododsek", "sl": "pododstavek", "fi": "alakohta", "sv": "stycke"};
const reverseOrder=new Set(['fi','hu','lt','lv']);
const grammars=new Map();
const qualifiers=new Map();
function grammar(language) {
  if(grammars.has(language))return grammars.get(language);
  const row=rows[language],words=Object.fromEntries(kinds.map((kind,i)=>[kind,row[i]]));
  Object.assign(words,extra[language]??{chapter:chapterWords[language],section:sectionWords[language],title:titleWords[language]});
  words.subparagraph=subparagraphWords[language];
  if(language==='sv')words.recommendation='rekommendation';
  if(language==='en'){words.subheading='subheading';words.citation='Citation';}
  const out=Object.entries(words).map(([kind,terms])=>{
    const pattern=terms.split('|').map(escape).join('|');
    return {kind,terms:terms.split('|'),pattern,forward:new RegExp(`^(?:${pattern})(?:\\s+${kind==='article'?'|(?=\\d)':''})(.+)$`,'iu'),backward:new RegExp(`^(.+?)\\s+(?:${pattern})$`,'iu')};
  });
  grammars.set(language,out);return out;
}

// Preserve suffix spelling/script; never turn Greek alpha or Cyrillic a into a
// Latin suffix. Such a cross-language mapping belongs to an explicit resolver.
export function proposalNumber(raw,language='en') {
  const text=fold(raw).replace(/^[([]|[)\]]$/g,'').replace(/(\d+)\.º(?=-[\p{L}]|$)/u,'$1').replace(/[.\s]*(?:º|°)$/u,'').replace(/\.$/,'').replace(/^(\d+)[.‑–-]\s*([\p{L}])$/u,'$1$2');
  // EP separates an inserted suffix from its alphabetic/Roman base; source
  // point labels also publish compact forms such as Croatian "ba".
  const spaced=text.match(/^([\p{Lu}]{1,3}|[a-z]{1,8})\s+([\p{Ll}]{1,2})$/u);
  if(spaced)return {value:spaced[1]+spaced[2],number:null,base:spaced[1],suffix:spaced[2]};
  const romanSuffix=text.match(/^([IVXLCDM]+)\s*([a-z]{1,2})$/u);
  if(romanSuffix)return {value:romanSuffix[1]+romanSuffix[2],number:null,base:romanSuffix[1],suffix:romanSuffix[2]};
  const letterSuffix=text.match(/^([a-z])([a-z])$/u);
  if(letterSuffix&&!/^[ivxlcdm]+$/u.test(text))return {value:text,number:null,base:letterSuffix[1],suffix:letterSuffix[2]};
  if(language==='fr'&&/^(?:premier|1er)$/i.test(text))return {value:'1',number:1,suffix:''};
  const decimal=text.match(/^(\d+(?:\.\d+)*)\s*([\p{L}]+|[\p{L}]\s[\p{L}])?$/u);
  if(decimal){const suffix=(decimal[2]??'').replace(/\s/g,'').toLowerCase();
    if(suffix.length>1&&!/^(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies|aa|ab|ac|ba)$/u.test(suffix))return null;
    return {value:decimal[1]+suffix,number:decimal[1].includes('.')?null:Number(decimal[1]),suffix};}
  if(/^[IVXLCDM]+$/.test(text))return {value:text,number:null,suffix:''};
  if(/^(?:[\p{L}]{1,2}|[ivxlcdm]{1,8})$/u.test(text))return {value:text.toLowerCase(),number:null,suffix:''};
  return null;
}

export function parseLabelSegment(label,language='en') {
  language=proposalLanguage(language);let text=fold(label),isNew=false;
  if(!qualifiers.has(language))qualifiers.set(language,new RegExp(`\\s*\\((?:${rows[language][5].split('|').map(escape).join('|')})\\)\\s*$`,'iu'));
  text=text.replace(qualifiers.get(language),()=>{isNew=true;return '';});
  if(language==='el'&&/^εισαγωγικό μέρος$/iu.test(text))return {kind:'introductory-part',value:'',number:null,suffix:'',isNew,raw:label};
  const selector=selectors[language].findIndex(term=>fold(term).toLocaleLowerCase(language)===text.toLocaleLowerCase(language));
  if(selector>=0)return {kind:selector===1?'title':'introductory-part',value:'',number:null,suffix:'',isNew,raw:label};
  // Finnish recital numbers occur inside the compound noun, e.g. the
  // published "Johdanto-osan Q a kappale (uusi)" (A-10-2026-0237 AM57).
  if(language==='fi')text=text.replace(/^johdanto-osan (.+) kappale$/iu,'$1 johdanto-osan kappale');
  for(const {kind,forward:forwardPattern,backward:backwardPattern} of grammar(language)) {
    const forward=text.match(forwardPattern);
    const backward=text.match(backwardPattern);
    if(!forward&&!backward)continue;
    let rawValue=forward?.[1]??backward?.[1]??'',sourceValue=null;
    // Greek annex/title headings use Greek Ι/Χ glyphs in Roman numerals.
    // This is an ordinal grammar rule, never transliteration of a suffix.
    if(language==='el'&&['annex','title','chapter','section'].includes(kind)&&/^[IVXLCDMΙΧ]+\.?$/u.test(rawValue.trim())){const roman=rawValue.replaceAll('Ι','I').replaceAll('Χ','X');if(roman!==rawValue){sourceValue=rawValue;rawValue=roman;}}
    if(language==='pt'&&kind==='point')rawValue=rawValue.replace(/^([a-z])[‑–-]([A-Z])$/u,(_,base,suffix)=>base+' '+suffix.toLowerCase());
    rawValue=rawValue.trim().replace(/^[−‑–]/u,'-').replace(/\.$/u,'');
    const negative=/^-(?:[\p{L}]|\d+)(?:\s*[a-z])?$/u.test(rawValue);
    const value=proposalNumber(negative?rawValue.slice(1):rawValue,language);
    const capital=['recital','paragraph'].includes(kind)&&/^([\p{Lu}]{1,3})(?:\s*([\p{Ll}]{1,3}))?$/u.exec(negative?rawValue.slice(1):rawValue);
    if(value&&capital){value.value=capital[1]+(capital[2]??'');value.suffix=capital[2]??'';if(capital[2])value.base=capital[1];}
    if(value&&negative){value.value='-'+value.value;value.negative=true;}
    if(value){if(['article','annex','chapter','section','title'].includes(kind)&&!/^(-?\d)|^[IVXLCDM]+[a-z]{0,2}$|^[\p{L}]$/u.test(value.value))continue;return {kind,...value,isNew,raw:label,...(sourceValue?{sourceValue}:{})};}
  }
  return null;
}
export function isBareLabel(text,kind,language='en') {
  language=proposalLanguage(language);return grammar(language).find(entry=>entry.kind===kind)?.terms.some(term=>fold(text).toLowerCase()===term.toLowerCase())??false;
}

export function parseTargetLabel(label,language='en') {
  language=proposalLanguage(language);
  const raw=String(label??''),lines=raw.split(/\r?\n/).filter(line=>line.trim());
  // EP's second line identifies the underlying act. Never append it to the
  // proposal path. Keep it verbatim for the caller's separate identity check.
  const primary=lines[0]??'',segments=[],unparsed=[];
  const parts=primary.split(/\s+[–—-]\s+/u);
  for(const part of parts) {
    let parsed=parseLabelSegment(part,language);
    if(!parsed&&language==='nl'&&segments.at(-1)?.kind==='point'&&/^[a-z]$/u.test(part.trim()))parsed={kind:'point',...proposalNumber(part.trim(),language),isNew:false,raw:part};
    if(parsed) {
      // Shared nouns are disambiguated only by their explicit parent level.
      if(['paragraph','title'].includes(parsed.kind)&&segments.at(-1)?.kind==='paragraph') {
        const entry=grammar(language).find(entry=>entry.kind==='subparagraph');
        if(entry?.forward.test(fold(part))||entry?.backward.test(fold(part)))parsed={...parsed,kind:'subparagraph'};
      }
      // EP's Polish and Latvian forms use the same noun at two levels.
      if(parsed.kind==='paragraph'&&((language==='pl'&&segments.at(-1)?.kind==='paragraph'&&/ustęp|ust\./iu.test(part))||(language==='lv'&&/punkts/iu.test(part)&&['paragraph','annex'].includes(segments.at(-1)?.kind))))parsed={...parsed,kind:'point'};
      segments.push(parsed);
    } else if(parts.length===1) {
      // Lithuanian labels are inflected and space-separated, without dashes.
      // The same tokenizer handles e.g. Croatian "Članak 26. stavak 1.a".
      const words=fold(part).split(' ');let at=0;
      while(at<words.length) {
        let found=null,width=0;
        for(let n=Math.min(6,words.length-at);n>=1;n--){found=parseLabelSegment(words.slice(at,at+n).join(' '),language);if(found){width=n;break;}}
        if(!found){unparsed.push(words.slice(at).join(' '));break;}
        segments.push(found);at+=width;
      }
    } else if(part.trim())unparsed.push(part.trim());
  }
  return {language,raw,segments,complete:segments.length>0&&!unparsed.length,unparsed,underlyingLabel:lines.slice(1).join('\n')||null};
}

export function unitLabel(unit,language='en') {
  language=proposalLanguage(language);const segment=unit.label??unit;
  const kind=segment.kind??unit.kind,entry=grammar(language).find(entry=>entry.kind===kind);
  if(!entry)return String(segment.raw??segment.value??kind??'');
  let value=String(segment.value??'');
  if(kind==='article'&&language==='fr'&&value==='1')value='premier';
  const word=entry.terms[0];
  let label=reverseOrder.has(language)?`${value}${['hu','lv'].includes(language)?'.':''} ${word}`:`${word} ${value}`;
  if(kind==='article'&&language==='hr')label+='.';
  if(kind==='article'&&language==='pt'&&/^\d+$/.test(value))label+='.º';
  if(segment.isNew)label+=` (${rows[language][5].split('|')[0]})`;
  return label;
}
