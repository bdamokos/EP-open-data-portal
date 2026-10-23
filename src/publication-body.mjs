// Keep original extraction intact; only move a recognised matching English header.
export function publicationBody(paragraphs, documentId, language) {
  const original={paragraphs,header:[],start:0,exact:true};
  if(Array.isArray(paragraphs)&&/^[A-Z]{3,5}-(?:PR|PA|AD|AM|AL)-\d+$/.test(String(documentId))) {
    const cleaned=paragraphs.map(p=>p.replace(/<\/?(?:Commission|Date|Depute|DocRef|FootprintIntro|RefProc|RefTypeProc|Titre|TitreType)>/g,''));
    const contents=cleaned.findIndex(p=>/^CONTENTS$/.test(p.trim()));
    const body=contents>=0?cleaned.findIndex((p,i)=>i>contents&&/^(?:DRAFT )?(?:EUROPEAN PARLIAMENT )?(?:RECOMMENDATION|REPORT|OPINION|AMENDMENTS)\s*$/.test(p.trim())):-1;
    // Removing tags shifts character positions, so footnote markers are not placed in this text.
    return body>0?{paragraphs:cleaned.slice(body),header:paragraphs.slice(0,body),start:body,exact:false}:{paragraphs:cleaned,header:[],start:0,exact:false};
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
