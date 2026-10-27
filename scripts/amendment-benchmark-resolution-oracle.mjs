// Independent raw-row boundaries for benchmark assertions. Do not import the
// server motion segmenter: its extent errors are precisely what this checks.
const label=value=>{
  let match=/^(\d{1,6}\s*[a-z]{0,3})[.)]\s+/u.exec(value);
  if(match)return {kind:'paragraph',label:match[1].replace(/\s/g,'')};
  match=/^([\p{Lu}]{1,3}[\p{Ll}]{0,3})[.)]\s+/u.exec(value);
  if(match)return {kind:'recital',label:match[1]};
  match=/^(?:\(([\p{Ll}]{1,4})\)|([\p{Ll}]{1,4})\))\s+/u.exec(value);
  return match?{kind:'point',label:match[1]||match[2]}:null;
};
function wholeBold(value,format) {
  const start=value.search(/\S/u),end=value.trimEnd().length;
  let covered=start;
  for(const mark of (format?.marks||[]).filter(m=>m.kind==='bold').sort((a,b)=>a.start-b.start)) {
    if(mark.start>covered)break;
    covered=Math.max(covered,mark.end);
  }
  return start>=0&&covered>=end;
}
const contiguous=(a,b)=>a?.complete===true&&b?.complete===true&&a.container==='body'&&b.container==='body'
  &&a.containerPath===b.containerPath&&a.segment===b.segment&&b.ordinal===a.ordinal+1;

// A second raw-row assertion for explicitly indented point addresses. Work
// backwards from each printed point to its owning paragraph/shallower point;
// do not reuse the runtime's stack or its placement evidence.
export function rawResolutionPointUnits(text) {
  const paragraphs=text?.paragraphs??[],sources=text?.paragraphSources??[],formats=text?.paragraphFormats??[];
  const point=value=>{const match=/^\s*(?:\(([a-z]{1,4})\)|([a-z]{1,4})\)|([ivxlcdm]+)\.)\s+/u.exec(value);return match&&(match[1]||match[2]||match[3]);};
  const heading=i=>wholeBold(paragraphs[i],formats[i])||(Number.isInteger(formats[i]?.heading)&&formats[i].heading>=1);
  const topic=i=>wholeBold(paragraphs[i],formats[i])&&(formats[i]?.marks??[]).some(mark=>mark.kind==='italic'&&mark.start<=paragraphs[i].search(/\S/u)&&mark.end>=paragraphs[i].trimEnd().length);
  const units=[];
  for(let start=0;start<paragraphs.length;start++){
    const value=point(paragraphs[start]),indent=formats[start]?.indent;
    if(!value||!Number.isFinite(indent)||sources[start]?.container!=='body'||!sources[start].complete)continue;
    let parent=null,paragraph=null,blocked=false;
    for(let i=start-1;i>=0;i--){
      if(!contiguous(sources[i],sources[i+1]))break;
      const numeric=/^\s*([1-9]\d{0,5}[a-z]{0,3})[.)]\s+/u.exec(paragraphs[i]);
      if(numeric){
        if(Number.isFinite(formats[i]?.indent)&&formats[i].indent<indent)paragraph={kind:'paragraph',label:numeric[1],start:i};
        break;
      }
      if(heading(i)){
        if(!topic(i)||!point(paragraphs[i+1])){blocked=true;break;}
        continue;
      }
      if(!parent&&point(paragraphs[i])&&Number.isFinite(formats[i]?.indent)&&formats[i].indent<indent)parent=units.find(unit=>unit.start===i)??null;
      if(/^[°\s]+$/u.test(paragraphs[i])&&paragraphs[i].includes('°'))break;
    }
    if(blocked||!paragraph)continue;
    if(parent&&parent.path[0].value!==paragraph.label)continue;
    const path=parent?[...parent.path,{kind:'point',value}]:[{kind:'paragraph',value:paragraph.label},{kind:'point',value}];
    let end=start,complete=false;
    for(let i=start+1;i<paragraphs.length;i++){
      if(!contiguous(sources[i-1],sources[i]))break;
      if(heading(i)||/^\s*(?:\d+|[A-Z]{1,3})[.)]\s+/u.test(paragraphs[i])||point(paragraphs[i])&&formats[i]?.indent<=indent){end=i-1;complete=true;break;}
      end=i;
    }
    const crossedTopic=paragraphs.slice(paragraph.start+1,start).some((_,offset)=>heading(paragraph.start+1+offset));
    if(crossedTopic&&!/:\s*$/u.test(paragraphs[paragraph.start]))continue;
    units.push({kind:'point',label:value,start,end,complete,path,parent:parent?.start??paragraph.start,group:paragraph.start});
  }
  return {units};
}

export function rawResolutionUnits(text,language) {
  const paragraphs=text?.paragraphs,sources=text?.paragraphSources;
  if(!Array.isArray(paragraphs)||sources?.length!==paragraphs.length)return {units:[],reason:'oracle-raw-structure-unavailable'};
  // Insertions currently have English label grammar. For other languages an
  // exact unique raw label may verify a span; duplicates remain unverified.
  const openers=paragraphs.flatMap((p,i)=>/^\s*The European Parliament\s*,?\s*$/i.test(p)&&sources[i]?.container==='body'&&sources[i]?.complete===true?[i]:[]);
  if(language==='en'&&!openers.length)return {units:[],reason:'oracle-resolution-start-unverified'};
  const start=language==='en'?openers[0]+1:0,events=[],openerRows=new Set(openers);
  let group=0,parent=null,citation=0,provisions=false,active=true;
  for(let i=start;i<paragraphs.length;i++) {
    const value=paragraphs[i].trim(),format=text.paragraphFormats?.[i],source=sources[i];
    if(openerRows.has(i)){events.push({start:i,boundary:true});group++;parent=null;citation=0;provisions=false;active=true;continue;}
    if(!active)continue;
    if(source?.complete!==true||source.container!=='body'||i>start&&!contiguous(sources[i-1],source)) {
      events.push({start:i,boundary:true,uncertain:true});group++;parent=null;
      if(source?.complete!==true||source.container!=='body')continue;
    }
    const separator=/^[°\s/]+$/u.test(value)&&value.includes('°');
    const section=/^(?:annex(?:es)?|explanatory statement|notes|footnotes|signatures?|section|chapter)\b/iu.test(value)&&!/[.;!?]$/u.test(value);
    const bold=wholeBold(paragraphs[i],format),heading=bold||Number.isInteger(format?.heading)&&format.heading>=1&&format.heading<=6;
    if(separator||section||heading) {
      events.push({start:i,boundary:true});group++;parent=null;
      if(section&&/^(?:annex(?:es)?|explanatory statement|notes|footnotes|signatures?)\b/iu.test(value))active=false;
      continue;
    }
    let ref=label(value);
    if(!ref&&!provisions&&/^[–—−\-•]\s*\S/u.test(value))ref={kind:'citation',label:String(++citation)};
    if(ref) {
      if(ref.kind==='point'&&parent===null){events.push({start:i,boundary:true,uncertain:true});group++;continue;}
      if(ref.kind!=='point'){parent=ref.kind==='paragraph'?i:null;if(ref.kind!=='citation')provisions=true;}
      events.push({...ref,start:i,group,parent:ref.kind==='point'?parent:null});
    } else if(value&&value.length<180&&/^\p{Lu}/u.test(value)&&(!/[.;!?]$/u.test(value)||value.endsWith(':'))) {
      // Unformatted title-like rows cannot establish either prose continuation
      // or a heading boundary. Withhold the preceding extent instead of guessing.
      events.push({start:i,boundary:true,uncertain:true});group++;parent=null;
    }
  }
  const units=[];
  for(let at=0;at<events.length;at++) {
    const unit=events[at];if(!unit.kind)continue;
    const next=events.slice(at+1).find(event=>unit.kind==='point'||event.kind!=='point');
    const end=(next?.start??paragraphs.length)-1;
    let complete=Boolean(next)&&!next.uncertain&&end>=unit.start;
    for(let i=unit.start;i<=end;i++)if(sources[i]?.complete!==true||sources[i].container!=='body'||i>unit.start&&!contiguous(sources[i-1],sources[i]))complete=false;
    units.push({...unit,end,complete});
  }
  return {units};
}
