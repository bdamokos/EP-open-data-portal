import {defaultUi} from './uiDefault.mjs';
import {selectLanguageText} from './language.mjs';
import {brusselsDate} from './plenaryAvailability.mjs';
import {agendaItemHref,dayDate,longDate,voteHref,voteOutcomeWord} from './votePagePresentation.mjs';

const positions=['for','against','abstaining'];
const reports=topic=>topic.documentIds.filter(id=>/^(?:A|B|RC)-\d{1,2}-\d{4}-\d{4,6}$/.test(id)).sort();
const isVote=topic=>topic.kind==='PLENARY_VOTE';
const isDebate=topic=>topic.kind==='PLENARY_DEBATE';
const count=value=>Number.isSafeInteger(value)&&value>=0;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const byOrder=(a,b)=>(a.order??0)-(b.order??0)||a.id.localeCompare(b.id);

export const weekHref=(week,language='en')=>'?'+new URLSearchParams({view:'legislation','pl-mode':'week','pl-week':week,lang:language});
// The agenda's own route, so the two views share one cached response.
export const weekRoute=(week,language='en')=>'insights/legislation?'+new URLSearchParams({lang:language,week});
export const weekStoryRoute=(week,language='en')=>'insights/week-story?'+new URLSearchParams({week,lang:language});
export const rowAnchor=id=>'item-'+id;
// The exact identifiers of one agenda item, read when its fold first opens. Without any there is nothing to read.
export function weekItemRoute(topic,sittingIds,language='en') {
  const procedures=[...topic.procedureIds].sort().slice(0,2),documents=reports(topic).slice(0,6);
  if(!procedures.length&&!documents.length)return null;
  return 'insights/week-item?'+new URLSearchParams({...(procedures.length?{procedures:procedures.join(',')}:{}),...(documents.length?{documents:documents.join(',')}:{}),...(sittingIds.length?{sittings:[...sittingIds].sort().slice(0,5).join(',')}:{}),lang:language});
}

/** At the flip the agenda opens on the week page unless a sitting or an item was chosen. */
export const agendaOpensWeekPage=({live,mode,topic,sitting,agendaPeriod})=>Boolean(live&&mode==='agenda'&&!topic&&!sitting&&!agendaPeriod.startsWith('sitting:'));

export const counted=totals=>positions.every(key=>count(totals?.[key]));
const anyCount=totals=>positions.some(key=>count(totals?.[key]));

/** `5–8 October`, `11–12 November`; one day reads as that day. */
export function sittingRangeLabel(dates,language='en') {
  const sorted=[...dates].sort(),first=sorted[0],last=sorted.at(-1);
  if(!first)return null;
  const format=new Intl.DateTimeFormat(language==='en'?'en-GB':language,{timeZone:'Europe/Brussels',day:'numeric',month:'long'}),noon=date=>new Date(date+'T12:00:00Z');
  if(first===last)return format.format(noon(first));
  const text=format.formatRange(noon(first),noon(last));
  return first.slice(5,7)===last.slice(5,7)?text.replace(/[\s ]*–[\s ]*/u,'–'):text.replaceAll(' ',' ');
}

/** Neighbouring sitting weeks across the held and the upcoming lists. */
export function weekNeighbours(calendar,week,language='en') {
  const weeks=[...(calendar?.weeks||[]),...(calendar?.upcoming||[])];
  const entry=row=>row&&{week:row.week,label:sittingRangeLabel(row.sittings.map(sitting=>sitting.date),language)};
  const earlier=weeks.filter(row=>row.week<week).sort((a,b)=>b.week.localeCompare(a.week))[0];
  const later=weeks.filter(row=>row.week>week).sort((a,b)=>a.week.localeCompare(b.week))[0];
  return {previous:entry(earlier)||null,next:entry(later)||null};
}

/** A vote's slot time from its agenda container, `…-TF-1100`. */
export function slotTime(topic) {
  const match=/-TF-(\d{2})(\d{2})$/.exec(topic.evidence?.containerId||'');
  return match?match[1]+':'+match[2]:null;
}

/** What the coming days' count line says. */
export function comingSummary(topics) {
  const votes=topics.filter(isVote),dates=new Set(votes.map(topic=>topic.date)),times=new Set(votes.map(slotTime));
  const date=dates.size===1?[...dates][0]:null;
  return {votes:votes.length,others:topics.length-votes.length,date,time:date&&times.size===1?[...times][0]:null};
}

/** One day's agenda order, cut into slots wherever the time or the kind of business changes. */
export function comingSlots(topics) {
  const slots=[];
  for(const topic of [...topics].sort(byOrder)) {
    const time=slotTime(topic),kind=isVote(topic)?'votes':'debates',last=slots.at(-1);
    if(last&&last.time===time&&last.kind===kind)last.topics.push(topic);
    else slots.push({key:topic.id,time,kind,topics:[topic]});
  }
  return slots;
}

const sharesProcedure=(a,b)=>a.id!==b.id&&(a.procedureIds||[]).some(id=>(b.procedureIds||[]).includes(id));
const firstDate=rows=>rows.map(row=>row.date).sort()[0]||null;
/** The debate that goes with a vote and the vote that goes with a debate: same exact procedure, never the title. */
export const debateDateFor=(topic,topics)=>firstDate(topics.filter(other=>isDebate(other)&&sharesProcedure(topic,other)));
export const voteDateFor=(topic,topics)=>firstDate(topics.filter(other=>isVote(other)&&sharesProcedure(topic,other)));

const sum=values=>{const known=values.filter(count);return known.length?known.reduce((a,b)=>a+b,0):null;};
/** A report or a named rapporteur is what a fold answers from. A procedure alone holds only its own type and reference. */
export const itemHasFacts=topic=>reports(topic).length>0||(topic.agendaCreatorIds?.length??0)>0;
/** The dated and counted facts of an item's fold, none of them invented: an unknown one is null. */
export function foldFacts(item,topic,topics) {
  const documents=item?.documents||[],vote=isVote(topic);
  const listed=documents.map(row=>row.votingList?.sittingId).filter(Boolean).sort()[0];
  return {
    // A vote row already sits in its slot, and its debate may be this week or earlier.
    voteDate:vote?null:voteDateFor(topic,topics)||listed?.slice(7)||null,
    debateDate:vote?debateDateFor(topic,topics)||item?.debated||null:null,
    amendments:sum(documents.map(row=>row.amendments)),
    amendmentTarget:documents.length===1?{document:documents[0].id}:item?.procedures[0]?{procedure:item.procedures[0].id}:null,
    listRows:sum(documents.map(row=>row.votingList?.rows)),
  };
}
/** The week-item contract. Anything else shows the links alone. */
export const validWeekItem=data=>object(data)&&[data.procedures,data.rapporteurs,data.committees,data.standing,data.documents].every(Array.isArray)&&data.documents.every(row=>typeof row?.id==='string')&&(data.press===null||typeof data.press?.url==='string'&&typeof data.press.title==='string');

export function tallyWords(summary,ui=defaultUi) {
  return ['adopted','rejected','lapsed','unknown'].filter(key=>summary[key]>0).map(key=>ui.t('week.tally_words.'+key,{n:summary[key]})).join(', ');
}
function voteCells(vote,ui) {
  const shared={word:voteOutcomeWord(vote,ui),rejected:vote.outcome==='REJECTED'};
  if(anyCount(vote.totals))return {...shared,totals:vote.totals};
  return vote.method==='VOTE_HAND'?{...shared,hands:true}:shared;
}
// A published vote label ends in what was voted on; the reference and rapporteurs come before it.
const ownLabel=label=>typeof label==='string'?label.split(' – ').at(-1).trim()||null:null;
/** Word and numbers for an agenda item. With no main vote: one vote under its own label, else the tally in words. */
export function itemCells(item,ui=defaultUi) {
  if(item.main)return voteCells(item.main,ui);
  if(item.summary?.kind==='single')return {...voteCells(item.summary.vote,ui),label:ownLabel(item.summary.vote.label)};
  if(item.summary?.kind==='counts')return {words:tallyWords(item.summary,ui)};
  return {};
}

const titleOf=(titles,language,fallback='',fallbackLanguage='en')=>selectLanguageText(titles,language,fallback,fallbackLanguage);
function itemHref(item,topic,language) {
  if(item?.main)return voteHref(item.main.id,language);
  if(topic)return agendaItemHref(topic.id,language);
  return item?.summary?.kind==='single'?voteHref(item.summary.vote.id,language):item?agendaItemHref(item.agendaItemId,language):null;
}
/** One past day's rows: decisions with no agenda item first, then the items in agenda order, then items the agenda lacks. */
export function resultRows(day,topics,results,language='en',ui=defaultUi) {
  const items=new Map((results?.items||[]).map(item=>[item.agendaItemId,item]));
  const own=topics.filter(topic=>topic.sittingId===day.id&&(isVote(topic)||items.has(topic.id))).sort(byOrder);
  const known=new Set(own.map(topic=>topic.id));
  const elsewhere=new Set(topics.map(topic=>topic.id));
  const loose=(results?.unlinked||[]).filter(row=>row.sittingId===day.id).sort((a,b)=>a.id.localeCompare(b.id)).map(row=>({
    key:row.id,anchor:null,...titleOf(row.titles,language,ui.t('legislation.vote.64f872'),ui.language),href:voteHref(row.id,language),cells:voteCells(row,ui),votes:null,debated:null,
  }));
  const row=(topic,item)=>{
    const text=topic?.title??(item.summary?.kind==='single'?ownLabel(item.summary.vote.label):null)??ui.t('legislation.agenda_item.39cc14'),cells=item?itemCells(item,ui):{};
    return {
      key:item?.agendaItemId??topic.id,anchor:rowAnchor(item?.agendaItemId??topic.id),text,language:topic?.titleLanguage??'',
      href:itemHref(item,topic,language),cells:cells.label===text?{...cells,label:null}:cells,votes:item?item.voteCount:null,
      debated:topic?debateDateFor(topic,topics):null,agendaItemId:item?.agendaItemId??topic.id,
    };
  };
  const orphans=(results?.items||[]).filter(item=>item.agendaItemId.slice(0,17)===day.id&&!known.has(item.agendaItemId)&&!elsewhere.has(item.agendaItemId)).sort((a,b)=>a.agendaItemId.localeCompare(b.agendaItemId));
  return [...loose,...own.map(topic=>row(topic,items.get(topic.id))),...orphans.map(item=>row(null,item))];
}

/** Exact totals only when every past day is among the results and each was read in full. */
export function pastCounts(results,pastDayIds) {
  if(!results?.days.length||results.days.some(day=>!day.complete))return null;
  if(pastDayIds.some(id=>!results.days.some(day=>day.sittingId===id)))return null;
  return {votes:results.days.reduce((total,day)=>total+day.voteCount,0),items:results.items.length};
}

const reasonOrder=['closest','differing','speeches','blueCards'];
const capitalise=(text,language)=>{const [first='']=text;return first.toLocaleUpperCase(language)+text.slice(first.length);};
/** Facts by best rank, comma-joined: the page's one glued line. */
export function reasonLine(reasons,ui=defaultUi) {
  const facts=[...reasons].sort((a,b)=>a.rank-b.rank||reasonOrder.indexOf(a.list)-reasonOrder.indexOf(b.list)).flatMap(reason=>{
    if(reason.list==='closest')return reason.rank>=1&&reason.rank<=5?[ui.t('week.reason.rank'+reason.rank)]:[];
    if(reason.list==='differing')return [ui.t('week.reason.differs',{count:reason.value})];
    if(reason.list==='speeches')return [ui.t('week.reason.speeches',{count:reason.value})];
    return reason.list==='blueCards'?[ui.t('week.reason.blue',{count:reason.value})]:[];
  });
  return capitalise(facts.join(', '),ui.language);
}
/** A press release's text: the lead, then the first sentence of the next paragraph. Verbatim. */
export const storyText=press=>[press?.lead,press?.second].filter(Boolean).join(' ');
/** The Brussels day a release came out, as a date for the sentence under it. */
export const pressDate=(publishedAt,language='en')=>{const time=Date.parse(publishedAt);return Number.isFinite(time)?dayDate(brusselsDate(time),language):null;};
/** The same day with its year, for a release from before this week. */
export const pressFullDate=(publishedAt,language='en')=>{const time=Date.parse(publishedAt);return Number.isFinite(time)?longDate(brusselsDate(time),language):null;};

/** One cell per fact. A debate leading two lists gets two cells; a debate with no label has nothing to show. */
export function highlightCells(highlights,language='en',ui=defaultUi) {
  return highlights.flatMap(row=>(row.lists||[row.list]).flatMap(list=>{
    const debate=list==='speeches'||list==='blueCards';
    const title=titleOf(row.titles,language);
    if(!title.text)return [];
    const href=debate?(row.agendaItemIds?.[0]?agendaItemHref(row.agendaItemIds[0],language):null):voteHref(row.id,language);
    const base={key:list+':'+row.id,text:title.text,language:title.language,href};
    if(list==='closest')return [{...base,label:ui.t('week.highlight.closest'),totals:row.totals}];
    if(list==='differing')return [{...base,label:ui.t('week.highlight.differs',{count:row.differing}),totals:row.totals}];
    if(list==='rejected')return [{...base,label:ui.t('week.highlight.rejected'),totals:row.totals}];
    if(list==='speeches')return [{...base,label:ui.t('week.highlight.debated'),value:ui.t('week.highlight.debated_value',{speeches:ui.t('week.reason.speeches',{count:row.speeches}),speakers:ui.t('week.speakers',{count:row.speakers})})}];
    return [{...base,label:ui.t('week.highlight.blue'),value:ui.t('week.reason.blue',{count:row.blueCards})}];
  }));
}

/** The week-story contract. Anything else shows no stories. */
export const validWeekStory=data=>object(data)&&['complete','partial','unavailable'].includes(data.status)&&Array.isArray(data.stories)&&Array.isArray(data.highlights)&&object(data.press)
  &&data.stories.every(story=>object(story?.press)&&typeof story.press.url==='string'&&Array.isArray(story.reasons))
  &&data.highlights.every(row=>object(row)&&(Array.isArray(row.lists)||typeof row.list==='string'));
/** The week-results v2 fields this page reads, on top of the shared contract. */
export const validWeekPageResults=data=>Array.isArray(data?.unlinked)&&data.unlinked.every(row=>typeof row?.id==='string'&&typeof row.sittingId==='string'&&object(row.titles))
  &&data.items.every(item=>item.summary===null||item.summary===undefined||item.summary.kind==='counts'||item.summary.kind==='single'&&typeof item.summary.vote?.id==='string');
