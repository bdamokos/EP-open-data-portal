import {motionBodyStart,bodyCompleteness} from '../server/resolution-body.mjs';

// Keep original extraction and source offsets intact when moving a recognised header.
export function publicationBody(paragraphs, documentId, language) {
  const original={paragraphs,header:[],start:0,exact:true};
  if(Array.isArray(paragraphs)&&/^[A-Z]{3,5}-(?:PR|PA|AD|AM|AL)-\d+$/.test(String(documentId))) {
    const cleaned=paragraphs.map(p=>p.replace(/<\/?(?:Commission|Date|Depute|DocRef|FootprintIntro|RefProc|RefTypeProc|Titre|TitreType)>/g,''));
    const contents=cleaned.findIndex(p=>/^CONTENTS$/.test(p.trim()));
    const body=contents>=0?cleaned.findIndex((p,i)=>i>contents&&/^(?:DRAFT )?(?:EUROPEAN PARLIAMENT )?(?:RECOMMENDATION|REPORT|OPINION|AMENDMENTS)\s*$/.test(p.trim())):-1;
    // Removing tags shifts character positions, so footnote markers are not placed in this text.
    return body>0?{paragraphs:cleaned.slice(body),header:paragraphs.slice(0,body),start:body,exact:false}:{paragraphs:cleaned,header:[],start:0,exact:false};
  }
  const adopted=String(documentId).match(/^TA-10-(\d{4})-(\d{4})$/);
  if(language==='en'&&adopted&&Array.isArray(paragraphs)) {
    const clean=paragraphs.map(value=>value.replace(/\s+/gu,' ').trim());
    const logo=clean[2]==='\uFFFC'?2:null,label=logo===null?2:3;
    const start=label+3,boundary=motionBodyStart(paragraphs,language);
    // The logo occupies its own cell between the term and TEXTS ADOPTED.
    // Match the published reference and a structured resolution before moving it.
    if(clean[0]==='European Parliament'&&clean[1]==='2024-2029'&&clean[label]==='TEXTS ADOPTED'
      &&clean[label+1]===`P10_TA(${adopted[1]})${adopted[2]}`&&clean[label+2]
      &&/^European Parliament (?:legislative )?resolution of \d{1,2} \p{L}+ \d{4} (?:on|seeking)\b/u.test(clean[start]||'')
      &&boundary>start&&boundary<=start+2&&!paragraphs.slice(0,boundary+1).some((value,index)=>index!==logo&&value.includes('\uFFFC')))
      return {paragraphs:paragraphs.slice(start),header:paragraphs.slice(0,start),start,exact:true,coverLogoParagraph:logo};
  }
  const match=String(documentId).match(/^([EPHO])-10-(\d{4})-(\d+)(-ASW)?$/);
  if(language!=='en'||!match||!Array.isArray(paragraphs)||paragraphs.length<2)return original;
  const reference=`${match[1]}-${match[3]}/${match[2]}`;
  if(match[4]) {
    const opening=paragraphs.slice(0,4).join(' ').replace(/\s+/g,' ').trim();
    if(!opening.includes(reference)||!new RegExp(`^(?:EN )?${reference} Answer given by\\b`).test(opening))return original;
    const author=paragraphs.findIndex((p,index)=>index<4&&/Answer given by\b/.test(p));
    let end=author+1;
    while(end<Math.min(6,paragraphs.length-1)&&(/^(?:on behalf of (?:the )?(?:European Commission|Commission|Council))\s*$/.test(paragraphs[end].trim())||/^\(\d{1,2}\.\d{1,2}\.\d{4}\)$/.test(paragraphs[end].trim())))end++;
    return {paragraphs:paragraphs.slice(end),header:paragraphs.slice(0,end),start:end,exact:true};
  }
  if(!/^\s*(?:Priority question|Question) for (?:written|oral) answer\b/.test(paragraphs[0])||!paragraphs[0].includes(reference))return original;
  const subject=paragraphs.findIndex((p,index)=>index>0&&index<8&&/^\s*Subject\s*:/.test(p));
  return subject>0&&subject<paragraphs.length-1?{paragraphs:paragraphs.slice(subject+1),header:paragraphs.slice(0,subject+1),start:subject+1,exact:true}:original;
}

// Recognise only an isolated drawing in the official report masthead, with
// the exact printed report reference. Coordinates remain those of the source.
export function publicationCoverLogo(text,documentId,language) {
  const match=String(documentId).match(/^A-(\d+)-(\d{4})-(\d{4})$/);
  if(language!=='en'||!match||!text||text.structureStatus!=='extracted')return null;
  const paragraphs=text.paragraphs||[],opening=paragraphs.slice(0,10).map(p=>p.replace(/\s+/gu,' ').trim());
  const reference=`A${Number(match[1])}-${match[3]}/${match[2]}`;
  if(!opening.includes(reference)||!opening.includes('Plenary sitting')||!opening.includes('REPORT'))return null;
  const heading=opening.findIndex(p=>p.replace(/\uFFFC/gu,'').trim()==='European Parliament');
  if(heading<0||heading>1||!/^\d{4}[-–]\d{4}$/.test(opening[heading+1]||''))return null;
  const candidates=(text.documentObjects||[]).filter(o=>o.paragraph>=heading&&o.paragraph<=heading+2&&o.kind==='drawing'&&o.status==='unresolved'&&paragraphs[o.paragraph]?.[o.offset]==='\uFFFC');
  if(candidates.length!==1)return null;
  const logo=candidates[0],content=paragraphs[logo.paragraph];
  if((content.match(/\uFFFC/gu)||[]).length!==1||content.replace(/\uFFFC/gu,'').trim()!==(logo.paragraph===heading?'European Parliament':''))return null;
  return {paragraph:logo.paragraph,offset:logo.offset};
}

// A recognised cover logo does not make the visible resolution incomplete.
// Unknown structure, other objects, note gaps and unrelated warnings stay explicit.
export function publicationHasMissingContent(text,body,decorative=null) {
  if(decorative) {
    const paragraphs=text.paragraphs.map((value,index)=>index===decorative.paragraph?value.slice(0,decorative.offset)+value.slice(decorative.offset+1):value);
    const documentObjects=(text.documentObjects||[]).filter(object=>object.paragraph!==decorative.paragraph||object.offset!==decorative.offset);
    const warning='A drawing, equation or other document object is shown as a placeholder; the surrounding text is retained.';
    const extractionWarnings=(text.extractionWarnings||[]).filter(value=>value!==warning||documentObjects.some(object=>object.status==='unresolved')||paragraphs.some(value=>value.includes('\uFFFC'))||(text.notes||[]).some(note=>note.text.includes('\uFFFC')));
    return publicationHasMissingContent({...text,paragraphs,documentObjects,extractionWarnings},body);
  }
  if(!text)return false;
  const objects=text.documentObjects||[],warnings=text.extractionWarnings||[];
  const missing=objects.some(object=>object.status==='unresolved')||warnings.length>0||text.notesStatus==='not-extracted'
    ||(text.paragraphs||[]).some(value=>value.includes('\uFFFC'))||(text.notes||[]).some(note=>note.text.includes('\uFFFC'));
  if(!missing||!Number.isInteger(body.coverLogoParagraph)||body.start<=body.coverLogoParagraph)return Boolean(missing);
  const complete=bodyCompleteness(text,body.start-1),logo=body.coverLogoParagraph;
  if(!complete||complete.incomplete||complete.unresolved||text.notesStatus==='not-extracted'
    ||objects.filter(object=>object.paragraph===logo).length!==1)return true;
  if(text.paragraphSources.slice(0,body.start).some((source,index)=>index!==logo&&!source.complete))return true;
  if(objects.some(object=>object.paragraph<body.start&&!(object.paragraph===logo&&object.offset===0&&object.kind==='drawing'&&object.status==='unresolved')))return true;
  return warnings.some(warning=>warning!=='A drawing, equation or other document object is shown as a placeholder; the surrounding text is retained.');
}

// Closing labels of EP question texts, as printed in each language version.
const questionDateLabels={
  bg:['Внесен','Краен срок'],cs:['Předložení','Platná do'],da:['Indgivet','Svarfrist'],de:['Eingang','Fristablauf'],
  el:['Κατάθεση','Λήξη προθεσμίας'],en:['Submitted','Lapses'],es:['Presentación','Plazo límite'],et:['Esitatud','Tähtaeg'],
  fi:['Jätetty','Määräaika'],fr:['Dépôt','Échéance'],ga:['Curtha síos','Spriocdháta i gcomhair freagra'],hr:['Podneseno','Rok za odgovor'],
  hu:['Előterjesztve','Határidő'],it:['Presentazione','Scadenza'],lt:['Pateikta','Atsakyti iki'],lv:['Iesniegšanas datums','Termiņš'],
  mt:['Imressqa','Skadenza'],nl:['Ingediend','Vervalt'],pl:['Przedłożone','Termin ważności'],pt:['Apresentação','Prazo'],
  ro:['Depunere','Dată-limită'],sk:['Predložené','Termín na zodpovedanie'],sl:['Vloženo','Rok za odgovor'],sv:['Ingiven','Sista svarsdag'],
};

// Source index of a question's closing submission line when the card already
// shows that same date, or null. A following deadline ("Lapses:") line stays.
export function repeatedSubmittedLine(body,documentId,language,shownDate) {
  const labels=questionDateLabels[language];
  if(!labels||!shownDate||!/^[EPHO]-10-\d{4}-\d+$/.test(String(documentId)))return null;
  const dated=label=>new RegExp(`^${label}\\s*:\\s*(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})$`,'u');
  const paragraphs=body.paragraphs,last=paragraphs.length-1;
  const lapses=last>0&&dated(labels[1]).test(paragraphs[last].trim());
  const index=lapses?last-1:last,line=paragraphs[index]?.trim().match(dated(labels[0]));
  if(!line||index<1)return null;
  const submitted=`${line[3]}-${line[2].padStart(2,'0')}-${line[1].padStart(2,'0')}`;
  return submitted===String(shownDate).slice(0,10)?body.start+index:null;
}
