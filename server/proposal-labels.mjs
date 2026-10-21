// Surface forms are deliberately language-specific. Proposal headings were checked
// against COM(2025)87 DOCX in all 24 languages; amendment forms include the public
// EP amendment excerpts in server/fixtures. See docs/PROPOSAL_STRUCTURE.md.
const rows = {
  bg:['Член','съображение','параграф','точка|буква','приложение','нова|нов'],
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
  nl:['Artikel','overweging','lid|alinea','punt|letter','bijlage|bĳlage','nieuw|nieuwe'],
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
const reverseOrder=new Set(['fi','hu','lt','lv']);
const grammars=new Map();
const qualifiers=new Map();
function grammar(language) {
  if(grammars.has(language))return grammars.get(language);
  const row=rows[language],words=Object.fromEntries(kinds.map((kind,i)=>[kind,row[i]]));
  Object.assign(words,extra[language]??{chapter:chapterWords[language],section:sectionWords[language],title:titleWords[language]});
  const out=Object.entries(words).map(([kind,terms])=>{
    const pattern=terms.split('|').map(escape).join('|');
    return {kind,terms:terms.split('|'),pattern,forward:new RegExp(`^(?:${pattern})\\s+(.+)$`,'iu'),backward:new RegExp(`^(.+?)\\s+(?:${pattern})$`,'iu')};
  });
  grammars.set(language,out);return out;
}

// Preserve suffix spelling/script; never turn Greek alpha or Cyrillic a into a
// Latin suffix. Such a cross-language mapping belongs to an explicit resolver.
export function proposalNumber(raw,language='en') {
  const text=fold(raw).replace(/^[([]|[)\]]$/g,'').replace(/(\d+)\.º(?=-[\p{L}]|$)/u,'$1').replace(/[.\s]*(?:º|°)$/u,'').replace(/\.$/,'').replace(/^(\d+)[.‑–-]\s*([\p{L}])$/u,'$1$2');
  if(language==='fr'&&/^(?:premier|1er)$/i.test(text))return {value:'1',number:1,suffix:''};
  const decimal=text.match(/^(\d+(?:\.\d+)*)\s*([\p{L}]+|[\p{L}]\s[\p{L}])?$/u);
  if(decimal){const suffix=(decimal[2]??'').replace(/\s/g,'').toLowerCase();
    if(suffix.length>1&&!/^(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies|aa|ab|ac)$/u.test(suffix))return null;
    return {value:decimal[1]+suffix,number:decimal[1].includes('.')?null:Number(decimal[1]),suffix};}
  if(/^[IVXLCDM]+$/.test(text))return {value:text,number:null,suffix:''};
  if(/^(?:[\p{L}]{1,2}|[ivxlcdm]{1,8})$/u.test(text))return {value:text.toLowerCase(),number:null,suffix:''};
  return null;
}

export function parseLabelSegment(label,language='en') {
  language=proposalLanguage(language);let text=fold(label),isNew=false;
  if(!qualifiers.has(language))qualifiers.set(language,new RegExp(`\\s*\\((?:${rows[language][5].split('|').map(escape).join('|')})\\)\\s*$`,'iu'));
  text=text.replace(qualifiers.get(language),()=>{isNew=true;return '';});
  for(const {kind,forward:forwardPattern,backward:backwardPattern} of grammar(language)) {
    const forward=text.match(forwardPattern);
    const backward=text.match(backwardPattern);
    if(!forward&&!backward)continue;
    let rawValue=forward?.[1]??backward?.[1]??'',sourceValue=null;
    // Greek annex/title headings use Greek Ι/Χ glyphs in Roman numerals.
    // This is an ordinal grammar rule, never transliteration of a suffix.
    if(language==='el'&&['annex','title','chapter','section'].includes(kind)&&/^[IVXLCDMΙΧ]+\.?$/u.test(rawValue.trim())){const roman=rawValue.replaceAll('Ι','I').replaceAll('Χ','X');if(roman!==rawValue){sourceValue=rawValue;rawValue=roman;}}
    const value=proposalNumber(rawValue,language);
    if(value){if(['article','annex','chapter','section','title'].includes(kind)&&!/^\d|^[IVXLCDM]+$|^[\p{L}]$/u.test(value.value))continue;return {kind,...value,isNew,raw:label,...(sourceValue?{sourceValue}:{})};}
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
      // EP's Polish and Latvian forms use the same noun at two levels.
      if(parsed.kind==='paragraph'&&((language==='pl'&&segments.at(-1)?.kind==='paragraph'&&/ustęp|ust\./iu.test(part))||(language==='lv'&&/punkts/iu.test(part)&&['paragraph','annex'].includes(segments.at(-1)?.kind))))parsed={...parsed,kind:'point'};
      segments.push(parsed);
    } else if(parts.length===1) {
      // Lithuanian labels are inflected and space-separated, without dashes.
      // The same tokenizer handles e.g. Croatian "Članak 26. stavak 1.a".
      const words=fold(part).split(' ');let at=0;
      while(at<words.length) {
        let found=null,width=0;
        for(let n=Math.min(6,words.length-at);n>=2;n--){found=parseLabelSegment(words.slice(at,at+n).join(' '),language);if(found){width=n;break;}}
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
