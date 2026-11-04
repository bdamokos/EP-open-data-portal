import {nativeAttachedTables} from './amendment-table-oracle.mjs';
import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
import {LANGUAGE_SECTIONS} from './amendment-language-vocabulary.mjs';
import {oracleFold,oracleOpening} from './amendment-oracle-grammar.mjs';
// Independent raw-row boundaries for benchmark assertions. Do not import the
// server motion segmenter: its extent errors are precisely what this checks.
const label=value=>{
  let match=/^(\d{1,6}\s*[a-zα-ωа-я]{0,3})[.)]\s+/u.exec(value);
  if(match)return {kind:'paragraph',label:match[1].replace(/\s/g,'')};
  match=/^([\p{Lu}]{1,3}[\p{Ll}]{0,3})[.)]\s+/u.exec(value);
  if(match)return {kind:'recital',label:match[1]};
  match=/^(?:\(([\p{Ll}]{1,4})\)|([\p{Ll}]{1,4})\))\s+/u.exec(value);
  return match?{kind:'point',label:match[1]||match[2]}:null;
};
function wholeBold(value,format,kind='bold') {
  const start=value.search(/\S/u),end=value.trimEnd().length;
  let covered=start;
  for(const mark of (format?.marks||[]).filter(m=>m.kind===kind).sort((a,b)=>a.start-b.start)) {
    if(mark.start>covered)break;
    covered=Math.max(covered,mark.end);
  }
  return start>=0&&covered>=end;
}
const contiguous=(a,b)=>a?.complete===true&&b?.complete===true&&a.container==='body'&&b.container==='body'
  &&a.containerPath===b.containerPath&&a.segment===b.segment&&b.ordinal===a.ordinal+1;

// Only native XML certifies omitted blanks. Never consume previousParagraph,
// segment deltas, runtime units or placement evidence to establish continuity.
const nativeBodies=new WeakMap();
const nativeValue=row=>(row.numberingLabel?row.numberingLabel+'\t':'')+row.text.trim();
function nativeBody(text) {
  if(nativeBodies.has(text))return nativeBodies.get(text);
  try{const body=quotedWordBody(text.nativeBuffer);nativeBodies.set(text,body);return body;}catch{return null;}
}
// Native scope and text establish the first provision before projection indices
// are compared. A relabelled paragraph-two projection cannot supply this truth.
export function nativeFinnishFirst(text,unit) {
  const body=nativeBody(text);if(!body||!unit?.complete)return false;
  const headings=body.filter(row=>row.kind==='paragraph'&&row.text.trim()==='EUROOPAN PARLAMENTIN PÄÄTÖSLAUSELMAESITYS'&&!row.hidden);
  if(headings.length!==1)return false;
  const heading=body.indexOf(headings[0]);
  const opening=body.findIndex((row,i)=>i>heading&&row.kind==='paragraph'&&/^Euroopan parlamentti(?:, joka)?[,]?$/u.test(row.text.trim())&&!row.hidden);
  if(opening<0)return false;
  const first=body.findIndex((row,i)=>i>opening&&row.kind==='paragraph'&&/^[1-9]\d*[.)]\s/u.test(nativeValue(row)));
  if(first<0||!/^1[.)]\s/u.test(nativeValue(body[first])))return false;
  if(text.paragraphSources[unit.start]?.path!==body[first].path)return false;
  const before=unit.start-1,prior=body.findIndex(row=>row.path===text.paragraphSources[before]?.path);
  if(prior<opening||prior>=first||nativeValue(body[prior])!==text.paragraphs[before]||body[prior].hidden)return false;
  if(body.slice(prior+1,first).some(row=>row.kind!=='paragraph'||row.hidden||row.unsafe||row.numbered||row.nodes.some(node=>Object.keys(node).some(key=>key!==':@'&&key!=='w:pPr'))))return false;
  for(let i=unit.start;i<=unit.end;i++) {
    const source=body.find(row=>row.path===text.paragraphSources[i]?.path);
    if(!source||source.hidden||nativeValue(source)!==text.paragraphs[i])return false;
  }
  return true;
}
const nativePairsCache=new WeakMap();
export function nativeBlankPairs(text) {
  if(nativePairsCache.has(text))return nativePairsCache.get(text);
  const pairs=new Set();let body;
  body=nativeBody(text);if(!body)return pairs;
  nativePairsCache.set(text,pairs);
  const byPath=new Map(body.map((row,i)=>[row.path,i]));
  for(let i=1;i<(text.paragraphSources?.length||0);i++) {
    const left=text.paragraphSources[i-1],right=text.paragraphSources[i];
    const a=byPath.get(left.path),b=byPath.get(right.path);
    if(!Number.isInteger(a)||!Number.isInteger(b)||b<=a+1)continue;
    const first=body[a],last=body[b];
    if([...first.text.matchAll(/(?:^|[;.!?])\s*[1-9]\d*[.)]\t/gu)].length>1)continue;
    if(first.hidden||last.hidden||nativeValue(first)!==text.paragraphs[i-1]||nativeValue(last)!==text.paragraphs[i])continue;
    const omitted=body.slice(a+1,b);
    if(omitted.every(row=>row.kind==='paragraph'&&!row.hidden&&!row.unsafe&&!row.numbered&&row.nodes.every(node=>Object.keys(node).every(key=>key===':@'||key==='w:pPr'||key==='w:r'&&node[key].length===1&&node[key][0]['w:br']?.length===0&&node[key][0][':@']?.['@_w:type']==='page'))
      &&!row.nodes.some(node=>node['w:pPr']?.some(prop=>prop['w:numPr']||prop['w:sectPr']))))pairs.add(left.path+'|'+right.path);
  }
  return pairs;
}

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

export function rawResolutionUnits(text,language,{includeTables=false}={}) {
  const paragraphs=text?.paragraphs,sources=text?.paragraphSources;
  if(!Array.isArray(paragraphs)||sources?.length!==paragraphs.length)return {units:[],reason:'oracle-raw-structure-unavailable'};
  // Native-script labels and literal published report headings stay separate
  // from the runtime body selector.
  const openers=paragraphs.flatMap((p,i)=>oracleOpening.test(oracleFold(p))&&sources[i]?.container==='body'&&sources[i]?.complete===true?[i]:[]);
  const headingKey=value=>oracleFold(value).replace(/^(?:\d+[.)]\s*)/u,'').replace(/[,;:]$/u,'').toLowerCase();
  const reportHeadings=[LANGUAGE_SECTIONS[language]?.resolution,...(LANGUAGE_SECTIONS[language]?.resolutionAliases||[])].filter(Boolean);
  const reportHeading=reportHeadings.length>0;
  // Scope a report independently of the placer's section hint. Plain TOC
  // entries and page suffixes cannot establish the published motion heading.
  const headings=paragraphs.flatMap((p,i)=>reportHeadings.some(heading=>headingKey(p)===headingKey(heading))&&sources[i]?.container==='body'&&wholeBold(p,text.paragraphFormats?.[i])?[i]:[]);
  const scoped=Boolean(reportHeading)&&headings.length===1;
  const requireOpening=openers.length>0||headings.length>0||['en','fr','es','de','bg','el','hr','cs','ro'].includes(language);
  if(requireOpening&&(!openers.length||!reportHeading&&openers.length!==1))return {units:[],reason:'oracle-resolution-start-unverified'};
  const selectedOpening=scoped?openers.find(i=>i>headings[0]):openers[0];
  if(requireOpening&&!Number.isInteger(selectedOpening))return {units:[],reason:'oracle-resolution-start-unverified'};
  const blankPairs=nativeBlankPairs(text);
  const adjacent=(a,b)=>contiguous(a,b)||a?.complete===true&&b?.complete===true&&a.container==='body'&&b.container==='body'&&a.containerPath===b.containerPath&&blankPairs.has(a.path+'|'+b.path);
  const start=Number.isInteger(selectedOpening)?selectedOpening+1:0,events=[],incomplete=[],openerRows=new Set(openers);
  const endings={da:'bilag|begrundelse',et:'lisa|seletuskiri',fi:'liite|perustelut',ga:'iarscríbhinn|ráiteas míniúcháin',hu:'melléklet|indokolás',it:'allegato|motivazione',lt:'priedas|aiškinamoji dalis',lv:'pielikums|paskaidrojums',mt:'anness|nota spjegattiva',nl:'bijlage|toelichting',pl:'załącznik|uzasadnienie',pt:'anexo|exposição de motivos',sk:'príloha|dôvodová správa',sl:'priloga|obrazložitev',sv:'bilaga|motivering',fr:'annexe|exposé des motifs|justification',es:'anexo|exposición de motivos|justificación',de:'anlage|anhang|begründung',bg:'приложение|изложение на мотивите|мотиви|обосновка',el:'παράρτημα|αιτιολογική έκθεση|αιτιολόγηση',hr:'prilog|obrazloženje',cs:'příloha|vysvětlující prohlášení|odůvodnění'};
  const languageEnd=endings[language]?new RegExp(`^(?:${endings[language]})(?=\\s|$|[:.–—-])`,'iu'):null;
  const number=i=>/^\s*([1-9]\d{0,5})\s*[a-zα-ωа-я]{0,3}[.)]\s+/u.exec(paragraphs[i]??'')?.[1];
  const italicTitle=i=>{
    const value=paragraphs[i].trim(),after=number(i+1);
    if(!value||value.length>=180||!/^\p{Lu}/u.test(value)||/[.;!?:]$/u.test(value)||!(wholeBold(paragraphs[i],text.paragraphFormats?.[i],'italic')||['bold','italic'].every(kind=>{const marks=(text.paragraphFormats?.[i]?.marks||[]).filter(m=>m.kind===kind);return marks.some(m=>m.start===0&&m.end>=value.length/3)&&marks.some(m=>m.end===value.length&&m.start<=value.length*2/3);})))return false;
    // Only native XML may certify omitted blank rows between title and number.
    if(!after||!adjacent(sources[i],sources[i+1])||/:\s*$/u.test(paragraphs[i-1]??''))return false;
    let before=null;
    for(let j=i-1;j>=start;j--){if(sources[j]?.container!=='body')continue;before=number(j);if(before)break;}
    return Boolean(before)&&Number(before)+1===Number(after);
  };
  let group=0,parent=null,citation=0,provisions=false,active=true;
  for(let i=start;i<paragraphs.length;i++) {
    const value=paragraphs[i].trim(),format=text.paragraphFormats?.[i],source=sources[i];
    if(openerRows.has(i)){events.push({start:i,boundary:true});group++;parent=null;citation=0;provisions=false;if(!scoped)active=true;continue;}
    if(!active)continue;
    if(source?.complete!==true||source.container!=='body'||i>start&&!adjacent(sources[i-1],source)) {
      events.push({start:i,boundary:true,uncertain:true});group++;parent=null;
      if(source?.complete!==true||source.container!=='body') {
        // Damaged body rows cannot establish a target, but their printed text
        // still competes with tolerant matches at another provision.
        const ref=source?.container==='body'&&label(value);
        if(ref&&['paragraph','recital'].includes(ref.kind))incomplete.push({...ref,start:i,end:i,complete:false});
        continue;
      }
    }
    const separator=/^[°\s/]+$/u.test(value)&&value.includes('°');
    // A standalone Word editorial reference between successive recitals is
    // outside the legal wording; preserve it as its own boundary.
    const prior=label((paragraphs[i-1]||'').trim()), following=label((paragraphs[i+1]||'').trim());
    const ordinal=s=>/^[A-Z]{1,3}$/u.test(s||'')?[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0):null;
    if(language==='en'&&!/[\r\n]/u.test(paragraphs[i])&&/^\(Ex AM [1-9]\d* \(Or\. [A-Z]{2}\) of FdR [^()\r\n]+\.docx\)$/u.test(value)
      &&prior?.kind==='recital'&&following?.kind==='recital'&&ordinal(prior.label)!==null&&ordinal(following.label)===ordinal(prior.label)+1
      &&adjacent(sources[i-1],source)&&adjacent(source,sources[i+1])) {
      events.push({start:i,boundary:true});group++;parent=null;continue;
    }
    const translatedEnd=Object.values(LANGUAGE_SECTIONS[language]||{}).filter(v=>typeof v==='string').some(v=>headingKey(value)===headingKey(v))||languageEnd?.test(value.split(/[\r\n]/u)[0]);
    const section=(translatedEnd||/^(?:annex(?:es)?|explanatory statement|notes|footnotes|signatures?|section|chapter|anexă|expunere de motive|aviz)(?![\p{L}\p{N}_])/iu.test(value))&&!/[.;!?]$/u.test(value);
    const bold=wholeBold(paragraphs[i],format),heading=bold||Number.isInteger(format?.heading)&&format.heading>=1&&format.heading<=6;
    if(separator||section||heading) {
      events.push({start:i,boundary:true});group++;parent=null;
      if(section&&(translatedEnd||/^(?:annex(?:es)?|explanatory statement|notes|footnotes|signatures?|anexă|expunere de motive|aviz)(?![\p{L}\p{N}_])/iu.test(value))){if(scoped)break;active=false;}
      continue;
    }
    let ref=label(value);
    if(!ref&&!provisions&&/^[–—−\-•]\s*\S/u.test(value))ref={kind:'citation',label:String(++citation)};
    if(ref) {
      if(ref.kind==='point'&&parent===null){events.push({start:i,boundary:true,uncertain:true});group++;continue;}
      if(ref.kind!=='point'){parent=ref.kind==='paragraph'?i:null;if(ref.kind!=='citation')provisions=true;}
      events.push({...ref,start:i,group,parent:ref.kind==='point'?parent:null});
    } else if(italicTitle(i)) {
      // A wholly italic title between consecutively numbered paragraphs is a
      // section boundary: the raw numbers on both sides establish the extent.
      events.push({start:i,boundary:true});group++;parent=null;
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
    for(let i=unit.start;i<=end;i++)if(sources[i]?.complete!==true||sources[i].container!=='body'||i>unit.start&&!adjacent(sources[i-1],sources[i]))complete=false;
    units.push({...unit,end,complete});
  }
  for(const table of includeTables?nativeAttachedTables(text):[]) {
    const owners=units.filter(unit=>unit.kind==='paragraph'&&unit.label===table.label);
    if(owners.length===1&&owners[0].start===table.start)Object.assign(owners[0],{end:table.end,complete:true});
  }
  for(const unit of incomplete)for(let i=unit.start+1;i<paragraphs.length&&i<unit.start+30;i++) {
    const current=sources[i],previous=sources[i-1],ref=label(paragraphs[i].trim());
    if(current?.container!=='body'||current.containerPath!==previous?.containerPath||current.segment!==previous.segment||current.ordinal!==previous.ordinal+1
      ||ref&&ref.kind!=='point'||events.some(event=>event.start===i&&event.boundary&&!event.uncertain))break;
    unit.end=i;
  }
  return {units,start,incomplete};
}


// Independently prove a Latin ordinal from its complete published sequence.
export function assertMixedRecital({text,wording,placement}) {
 const unknown={status:'unverified',reason:'oracle-mixed-recital-unavailable'};
 if(wording?.language!=='en'||wording.baseline!=='motion-resolution'||wording.originalText!==''||placement?.operation!=='insert')return unknown;
 const match=/^Recital ([MN]) ([a-z]) \(new\)$/u.exec(wording.targetLabel||'');
 if(!match||!new RegExp('^'+match[1]+match[2]+'[.)]\\s+whereas\\b','u').test(wording.proposedText||''))return unknown;
 const raw=rawResolutionUnits(text,'en'), units=raw.units.filter(u=>u.kind==='recital'),first=raw.units.find(u=>u.kind==='paragraph');
 const aliases={'Μ':'M','Ν':'N'}, normal=s=>aliases[s]||s;
 // An incomplete native row can hide a competing recital, including one
 // spelled with the other script. It cannot support a complete sequence.
 if((raw.incomplete||[]).some(unit=>unit.kind==='recital'))return unknown;
 if(raw.reason||!first||first.label!=='1'||!units.length||units.some((u,i)=>normal(u.label)!==String.fromCharCode(65+i)||!u.complete||u.end>=first.start||i>0&&units[i-1].end+1!==u.start))return unknown;
 const pos=units.findIndex(u=>normal(u.label)===match[1]);
 if(pos<1||pos>=units.length-1||units[pos].label===match[1]||units[pos].end+1!==units[pos+1].start)return unknown;
 const a=units[pos];
 if(placement.insertAfter!==a.end||placement.insertBefore!==a.end+1)return {status:'failed',reason:'oracle-mixed-recital-boundary-mismatch'};
 return {status:'verified',reason:'oracle-mixed-recital-sequence'};
}

// Raw body rows independently establish a terminal dash-list insertion.
export function assertTerminalIndent({text,wording,placement}) {
 const unknown={status:'unverified',reason:'oracle-terminal-indent-unavailable'};
 if(wording?.language!=='en'||wording.baseline!=='motion-resolution'||wording.originalText!==''||placement?.operation!=='insert'||!/^[-–—•]\s+\S/u.test(wording.proposedText||''))return unknown;
 const match=/^Paragraph ([1-9]\d*) – indent ([1-9]\d*) a \(new\)$/u.exec(wording.targetLabel||'');if(!match)return unknown;
 const raw=rawResolutionUnits(text,'en'),owners=raw.units.filter(u=>u.kind==='paragraph'&&u.label===match[1]);
 if(raw.reason||owners.length!==1||!owners[0].complete||raw.incomplete.some(u=>u.kind==='paragraph'&&u.label===match[1]))return unknown;
 const owner=owners[0], p=text.paragraphs, s=text.paragraphSources, count=Number(match[2]);
 if(!/:\s*$/u.test(p[owner.start])||owner.end-owner.start!==count||count>100)return unknown;
 const formats=text.paragraphFormats, lead=formats?.[owner.start], first=formats?.[owner.start+1];
 if(!Number.isFinite(lead?.indent)||!Number.isFinite(first?.indent)||first.indent<=lead.indent||!Number.isFinite(first.hanging))return unknown;
 for(let i=owner.start+1;i<=owner.end;i++)if(/[\r\n]/u.test(p[i])||!/^\s*[-–—•]\s+\S/u.test(p[i])||!contiguous(s[i-1],s[i])||formats[i]?.indent!==first.indent||formats[i]?.hanging!==first.hanging)return unknown;
 const next=raw.units.filter(u=>u.start===owner.end+1&&u.kind==='paragraph');
 if(next.length!==1||Number(next[0].label)!==Number(match[1])+1||!contiguous(s[owner.end],s[next[0].start]))return unknown;
 if(placement.insertAfter!==owner.end||placement.insertBefore!==next[0].start)return {status:'failed',reason:'oracle-terminal-indent-boundary-mismatch'};
 return {status:'verified',reason:'oracle-terminal-indent-boundary'};
}

// Prove the first numbered point of an identified recommendation in the
// native Swedish resolution annex, independently of projected hierarchy.
export function assertSwedishRecommendation({text,wording,placement}) {
 const unknown={status:'unverified',reason:'oracle-recommendation-annex-unavailable'};
 if(wording?.language!=='sv'||wording.baseline!=='motion-resolution'||placement?.operation!=='replace'||!text?.nativeBuffer)return unknown;
 const address=/^Bilaga I – rekommendation ([1-9]\d*) – punkt 1$/u.exec(wording.targetLabel||'');if(!address)return unknown;
 let body;try{body=quotedWordBody(text.nativeBuffer);}catch{return unknown;}
 const headers=body.flatMap((row,i)=>row.kind==='paragraph'&&/^BILAGA TILL RESOLUTIONSFÖRSLAGET(?:\n|$)/u.test(row.text)?[i]:[]);
 if(headers.length!==1)return unknown;
 const end=body.findIndex((row,i)=>i>headers[0]&&row.kind==='paragraph'&&row.text.trim()==='MOTIVERING');if(end<0)return unknown;
 const rows=body.slice(headers[0]+1,end),hits=rows.flatMap((row,i)=>row.kind==='paragraph'&&row.text.trim()==='Rekommendation '+address[1]?[i]:[]);
 if(hits.length!==1)return unknown;
 const at=hits[0],next=rows.findIndex((row,i)=>i>at&&row.kind==='paragraph'&&row.text.trim()==='Rekommendation '+(Number(address[1])+1));
 if(next<0)return unknown;
 if(rows.slice(at+1,next).some(row=>row.kind!=='paragraph'||row.hidden||row.unsafe||row.numbered))return unknown;
 const section=rows.slice(at+1,next).filter(row=>row.text.trim());
 if(section.some(row=>row.hidden||row.unsafe||row.numbered)||section.filter(row=>/^1[.)]\s+\S/u.test(row.text)).length!==1)return unknown;
 const group=rows.slice(at,at+4);if(group.length!==4||group.some(r=>r.kind!=='paragraph'||r.hidden||r.unsafe||r.numbered)||!/^1[.)]\s+\S/u.test(group[2].text)||!/^2[.)]\s+\S/u.test(group[3].text))return unknown;
 const projected=text.paragraphSources.flatMap((source,i)=>source?.path===group[2].path?[i]:[]),normal=s=>String(s).normalize('NFC').replace(/\s+/gu,' ').trim();
 if(projected.length!==1)return unknown;
 const index=projected[0];if(text.paragraphSources[index].complete!==true||normal(text.paragraphs[index])!==normal(group[2].text)||normal(wording.originalText)!==normal(group[2].text))return unknown;
 if(placement.span?.start!==index||placement.span?.end!==index)return {status:'failed',reason:'oracle-recommendation-boundary-mismatch'};
 return {status:'verified',reason:'oracle-native-recommendation-point'};
}

// An exact printed paragraph lead can be replaced without replacing its points.
export function assertResolutionLead({text,wording,placement}) {
 const target=/^Paragraph ([1-9]\d*)$/u.exec(wording.targetLabel||'');
 if(wording.language!=='en'||!target||placement.operation!=='replace')return {status:'unverified',reason:'oracle-lead-unavailable'};
 const raw=rawResolutionUnits(text,'en'),units=raw.units.filter(u=>u.kind==='paragraph'&&u.label===target[1]);
 if(raw.reason||units.length!==1)return {status:'unverified',reason:'oracle-lead-unavailable'};
 const unit=units[0],next=text.paragraphs[unit.start+1],source=text.paragraphSources;
 const compact=v=>v.normalize('NFC').replace(/\s+/gu,' ').trim();
 if(!unit.complete||!/:$/u.test(text.paragraphs[unit.start])||!/^\(a\)\s/u.test(next||'')||!contiguous(source[unit.start],source[unit.start+1])||compact(wording.originalText)!==compact(text.paragraphs[unit.start]))return {status:'unverified',reason:'oracle-lead-unavailable'};
 return placement.span?.start===unit.start&&placement.span?.end===unit.start?{status:'verified',reason:'oracle-exact-paragraph-lead'}:{status:'failed',reason:'oracle-lead-boundary-mismatch'};
}
