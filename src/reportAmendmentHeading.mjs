const clean=value=>value.replace(/\s+/gu,' ').trim();

// Published headings from the same-language report editions; attributed native
// excerpts are in server/fixtures/report-amendment-headings.json. These are
// navigation boundaries, independent of amendment wording and legal placement.
// [legislative resolution, amendment, explanatory statement, declaration annex,
//  procedure, opinion heading]
const headingsByLanguage={
  bg:['ПРОЕКТ НА ЗАКОНОДАТЕЛНА РЕЗОЛЮЦИЯ НА ЕВРОПЕЙСКИЯ ПАРЛАМЕНТ','Изменение','ИЗЛОЖЕНИЕ НА МОТИВИТЕ','ПРИЛОЖЕНИЕ: ДЕКЛАРАЦИЯ ЗА ИЗТОЧНИЦИТЕ НА ИНФОРМАЦИЯ','ПРОЦЕДУРА НА ВОДЕЩАТА КОМИСИЯ',/^СТАНОВИЩЕ НА КОМИСИЯТА .+$/iu],
  cs:['NÁVRH LEGISLATIVNÍHO USNESENÍ EVROPSKÉHO PARLAMENTU','Pozměňovací návrh','VYSVĚTLUJÍCÍ PROHLÁŠENÍ','PŘÍLOHA: ZVEŘEJŇOVÁNÍ PODNĚTŮ','POSTUP V PŘÍSLUŠNÉM VÝBORU',/^STANOVISKO VÝBORU .+$/iu],
  da:['FORSLAG TIL EUROPA-PARLAMENTETS LOVGIVNINGSMÆSSIGE BESLUTNING','Ændringsforslag','BEGRUNDELSE','BILAG: ERKLÆRING OM INPUT','PROCEDURE I KORRESPONDERENDE UDVALG',/^UDTALELSE FRA .+$/iu],
  de:['ENTWURF EINER LEGISLATIVEN ENTSCHLIESSUNG DES EUROPÄISCHEN PARLAMENTS','Änderungsantrag','BEGRÜNDUNG','ANLAGE: ERKLÄRUNG ZU BEITRÄGEN','VERFAHREN DES FEDERFÜHRENDEN AUSSCHUSSES',/^STELLUNGNAHME DES (?:.+)?AUSSCHUSSES(?: .+)?$/iu],
  el:['ΣΧΕΔΙΟ ΝΟΜΟΘΕΤΙΚΟΥ ΨΗΦΙΣΜΑΤΟΣ ΤΟΥ ΕΥΡΩΠΑΪΚΟΥ ΚΟΙΝΟΒΟΥΛΙΟΥ','Τροπολογία','ΑΙΤΙΟΛΟΓΙΚΗ ΕΚΘΕΣΗ','ΠΑΡΑΡΤΗΜΑ: ΔΗΛΩΣΗ ΕΙΣΗΓΗΣΕΩΝ','ΔΙΑΔΙΚΑΣΙΑ ΤΗΣ ΑΡΜΟΔΙΑΣ ΕΠΙ ΤΗΣ ΟΥΣΙΑΣ ΕΠΙΤΡΟΠΗΣ',/^ΓΝΩΜΟΔΟΤΗΣΗ ΤΗΣ ΕΠΙΤΡΟΠΗΣ .+$/iu],
  en:['DRAFT EUROPEAN PARLIAMENT LEGISLATIVE RESOLUTION','Amendment','EXPLANATORY STATEMENT','ANNEX: DECLARATION OF INPUT','PROCEDURE – COMMITTEE RESPONSIBLE',/^OPINION OF THE COMMITTEE(?: .*)?$/iu],
  es:['PROYECTO DE RESOLUCIÓN LEGISLATIVA DEL PARLAMENTO EUROPEO','Enmienda','EXPOSICIÓN DE MOTIVOS','ANEXO: DECLARACIÓN DE CONTRIBUCIONES','PROCEDIMIENTO DE LA COMISIÓN COMPETENTE PARA EL FONDO',/^OPINIÓN DE LA COMISIÓN .+$/iu],
  et:['EUROOPA PARLAMENDI SEADUSANDLIKU RESOLUTSIOONI PROJEKT','Muudatusettepanek','SELETUSKIRI','LISA: SISENDI DEKLARATSIOON','VASTUTAVA KOMISJONI MENETLUS',/^.+KOMISJONI ARVAMUS$/iu],
  fi:['LUONNOS EUROOPAN PARLAMENTIN LAINSÄÄDÄNTÖPÄÄTÖSLAUSELMAKSI','Tarkistus','PERUSTELUT','LIITE: ILMOITUS SAADUISTA TIEDOISTA','ASIAN KÄSITTELY ASIASTA VASTAAVASSA VALIOKUNNASSA',/^.+VALIOKUNNAN LAUSUNTO$/iu],
  fr:['PROJET DE RÉSOLUTION LÉGISLATIVE DU PARLEMENT EUROPÉEN','Amendement','EXPOSÉ DES MOTIFS','ANNEXE: DÉCLARATION DES CONTRIBUTIONS','PROCÉDURE DE LA COMMISSION COMPÉTENTE AU FOND',/^AVIS DE LA COMMISSION .+$/iu],
  ga:['DRÉACHTRÚN REACHTACH Ó PHARLAIMINT NA hEORPA','Leasú','RÁITEAS MÍNIÚCHÁIN','IARSCRÍBHINN: DEARBHÚ IONCHUIR','NÓS IMEACHTA – AN COISTE ATÁ FREAGRACH',/^TUAIRIM ÓN gCOISTE .+$/iu],
  hr:['NACRT ZAKONODAVNE REZOLUCIJE EUROPSKOG PARLAMENTA','Amandman','OBRAZLOŽENJE','PRILOG: PRIJAVA PRIMLJENIH INFORMACIJA','POSTUPAK U NADLEŽNOM ODBORU',/^MIŠLJENJE ODBORA .+$/iu],
  hu:['AZ EURÓPAI PARLAMENT JOGALKOTÁSI ÁLLÁSFOGLALÁS-TERVEZETE','Módosítás','INDOKOLÁS','MELLÉKLET: NYILATKOZAT AZ ÉSZREVÉTELEKRŐL','ELJÁRÁS AZ ILLETÉKES BIZOTTSÁGBAN',/^VÉLEMÉNY A(?:Z)? .+ BIZOTTSÁG RÉSZÉRŐL$/iu],
  it:['PROGETTO DI RISOLUZIONE LEGISLATIVA DEL PARLAMENTO EUROPEO','Emendamento','MOTIVAZIONE','ALLEGATO: DICHIARAZIONE DEI CONTRIBUTI','PROCEDURA DELLA COMMISSIONE COMPETENTE PER IL MERITO',/^PARERE DELLA COMMISSIONE .+$/iu],
  lt:['EUROPOS PARLAMENTO TEISĖKŪROS REZOLIUCIJOS PROJEKTAS','Pakeitimas','AIŠKINAMOJI DALIS','PRIEDAS. GAUTOS INFORMACIJOS DEKLARACIJA','ATSAKINGO KOMITETO PROCEDŪRA',/^.+KOMITETO NUOMONĖ$/iu],
  lv:['EIROPAS PARLAMENTA NORMATĪVĀS REZOLŪCIJAS PROJEKTS','Grozījums Nr.','PASKAIDROJUMS','PIELIKUMS. PIENESUMA DEKLARĀCIJA','ATBILDĪGĀS KOMITEJAS PROCEDŪRA',/^.+KOMITEJAS ATZINUMS$/iu],
  mt:['ABBOZZ TA’ RIŻOLUZZJONI LEĠIŻLATTIVA TAL-PARLAMENT EWROPEW','Emenda','NOTA SPJEGATTIVA','ANNESS: DIKJARAZZJONI TA’ KONTRIBUT','PROĊEDURA TAL-KUMITAT RESPONSABBLI',/^OPINJONI TAL-KUMITAT .+$/iu],
  nl:['ONTWERPWETGEVINGSRESOLUTIE VAN HET EUROPEES PARLEMENT','Amendement','TOELICHTING','BIJLAGE: BEKENDMAKING VAN INPUT','PROCEDURE VAN DE BEVOEGDE COMMISSIE',/^ADVIES VAN DE COMMISSIE .+$/iu],
  pl:['PROJEKT REZOLUCJI USTAWODAWCZEJ PARLAMENTU EUROPEJSKIEGO','Poprawka','UZASADNIENIE','ZAŁĄCZNIK: WYKAZ PODMIOTÓW, OD KTÓRYCH SPRAWOZDAWCZYNI OTRZYMAŁA INFORMACJE','PROCEDURA W KOMISJI PRZEDMIOTOWO WŁAŚCIWEJ',/^OPINIA KOMISJI .+$/iu],
  pt:['PROJETO DE RESOLUÇÃO LEGISLATIVA DO PARLAMENTO EUROPEU','Alteração','EXPOSIÇÃO DE MOTIVOS','ANEXO: DECLARAÇÃO DE CONTRIBUTOS','PROCESSO DA COMISSÃO COMPETENTE QUANTO À MATÉRIA DE FUNDO',/^PARECER DA COMISSÃO .+$/iu],
  ro:['PROIECT DE REZOLUȚIE LEGISLATIVĂ A PARLAMENTULUI EUROPEAN','Amendamentul','EXPUNERE DE MOTIVE','ANEXĂ: DECLARAȚIE PRIVIND CONTRIBUȚIILE','PROCEDURA COMISIEI COMPETENTE',/^AVIZ AL COMISIEI .+$/iu],
  sk:['NÁVRH LEGISLATÍVNEHO UZNESENIA EURÓPSKEHO PARLAMENTU','Pozmeňujúci návrh','DÔVODOVÁ SPRÁVA','PRÍLOHA: VYHLÁSENIE O POSKYTNUTÝCH INFORMÁCIÁCH','POSTUP GESTORSKÉHO VÝBORU',/^STANOVISKO VÝBORU .+$/iu],
  sl:['OSNUTEK ZAKONODAJNE RESOLUCIJE EVROPSKEGA PARLAMENTA','Predlog spremembe','OBRAZLOŽITEV','PRILOGA: IZJAVA O PRISPEVKIH','POSTOPEK V PRISTOJNEM ODBORU',/^MNENJE ODBORA .+$/iu],
  sv:['FÖRSLAG TILL EUROPAPARLAMENTETS LAGSTIFTNINGSRESOLUTION','Ändringsförslag','MOTIVERING','BILAGA: FÖRKLARING OM SYNPUNKTER','ÄRENDETS GÅNG I DET ANSVARIGA UTSKOTTET',/^YTTRANDE FRÅN UTSKOTTET .+$/iu],
};
const vocabulary=Object.fromEntries(Object.entries(headingsByLanguage).map(([language,[start,amendment,statement,annex,procedure,opinion]])=>
  [language,{start:start.toLowerCase(),amendment:amendment.toLowerCase(),ends:[statement,annex,procedure].map(value=>value.toLowerCase()),opinion}]));
const englishStart=/^(?:DRAFT )?EUROPEAN PARLIAMENT LEGISLATIVE RESOLUTION$/iu;
const englishEnd=/^(?:EXPLANATORY STATEMENT|OPINION OF THE COMMITTEE(?: .*)?|PROCEDURE(?: [–—-].*)?|MINORITY POSITION|INFORMATION ON ADOPTION(?: .*)?)$/iu;

// The main report's comparison section precedes opinions, whose numbering
// restarts at one. An exact list range must cover this complete sequence.
export function reportAmendmentHeading(text,documentId,amendmentId,listId) {
  const language=text?.textLanguage,labels=vocabulary[language];
  if(!labels||text.structureStatus!=='extracted'||!/^A-10-\d{4}-\d{4,6}$/.test(documentId))return null;
  const number=amendmentId?.startsWith(documentId+'-AM-')?amendmentId.slice(documentId.length+4):'';
  const range=listId?.startsWith(documentId+'-AM-')?listId.slice(documentId.length+4).match(/^(\d+)-(\d+)$/):null;
  if(!/^\d+$/.test(number)||!range||Number(range[1])!==1||Number(number)<1||Number(number)>Number(range[2]))return null;
  const paragraphs=text.paragraphs,sources=text.paragraphSources;
  if(!Array.isArray(paragraphs)||paragraphs.length>20000||!Array.isArray(sources)||sources.length!==paragraphs.length)return null;
  const body=index=>sources[index]?.container==='body'&&sources[index]?.complete===true;
  const headings=paragraphs.map(clean),starts=[];
  const opening=value=>value.toLowerCase()===labels.start||language==='en'&&englishStart.test(value);
  const ending=value=>labels.ends.includes(value.toLowerCase())||labels.opinion.test(value)||language==='en'&&englishEnd.test(value);
  for(let i=0;i<headings.length;i++)if(body(i)&&opening(headings[i]))starts.push(i);
  if(starts.length!==1)return null;
  const start=starts[0],end=headings.findIndex((value,index)=>index>start&&ending(value));
  if(end<0)return null;
  let expected=1,matched=null;
  for(let index=start+1;index<end;index++) {
    const heading=headings[index].match(/^(.*) (\d+)$/u);
    if(!heading||heading[1].toLowerCase()!==labels.amendment)continue;
    if(!body(index)||Number(heading[2])!==expected++)return null;
    if(Number(heading[2])===Number(number))matched=index;
  }
  return expected-1===Number(range[2])?matched:null;
}
