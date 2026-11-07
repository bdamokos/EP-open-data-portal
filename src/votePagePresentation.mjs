import {defaultUi} from './uiDefault.mjs';
import {memberVoteLabel,memberVoteTotals} from './memberVotesPresentation.mjs';
import {filterCountry,matchesCountry} from './countries.mjs';
import {PLENARY_REDESIGN_LIVE} from './plenaryRollout.mjs';
import {groupMajorities} from './voteGroupMetrics.mjs';
import {amendmentNumber as readAmendmentNumber} from './readRoute.mjs';
import {stripNumberPrefix} from './splitRuns.mjs';

const withoutNames=new Set(['VOTE_HAND','VOTE_ELECTRONIC','VOTE_ELECTRONIC_SECRET','VOTE_SECRET','VOTE_SECRET_BALLOT']);
const positions=['for','against','abstaining'];
const unique=values=>[...new Set(values)];

// `member` carries the MEP the reader came from; without it the page is the plain vote page.
export const voteHref=(id,language='en',member=null)=>'?'+new URLSearchParams({view:'legislation','pl-mode':'vote','pl-vote':id,...(member?{'vote-member':String(member)}:{}),lang:language});
/** Back to a member's voting record: the exact address the reader left when it is that member's
 * record, so filters and pages return, otherwise the record itself for a shared link. */
export function memberBackHref(origin,member,language='en') {
  if(origin){const query=new URL(origin,'http://origin.invalid').searchParams;if(query.get('member')===String(member)&&!query.has('view')&&query.get('module')==='votes')return origin;}
  return '?'+new URLSearchParams({member:String(member),module:'votes',...(PLENARY_REDESIGN_LIVE?{}:{'record-preview':'1'}),lang:language});
}
export function agendaItemHref(id,language='en') {
  const day=/^MTG-PL-\d{4}-\d{2}-\d{2}/.exec(id)?.[0];
  return '?'+new URLSearchParams({view:'legislation',...(day?{'agenda-period':'sitting:'+day}:{}),'agenda-topic':id,lang:language});
}
export const sittingHref=(sittingId,language='en')=>'?'+new URLSearchParams({view:'legislation','agenda-period':'sitting:'+sittingId,lang:language});
// English dates on these pages read day, month, year.
const dateLocale=language=>language==='en'?'en-GB':language;
const dateText=(value,language,options)=>new Intl.DateTimeFormat(dateLocale(language),{timeZone:'Europe/Brussels',...options}).format(new Date(value.slice(0,10)+'T12:00:00Z'));
export const longDate=(value,language='en')=>dateText(value,language,{day:'numeric',month:'long',year:'numeric'});
export const fullDate=(value,language='en')=>{const text=dateText(value,language,{weekday:'long',day:'numeric',month:'long',year:'numeric'});return language==='en'?text.replace(',',''):text;};
export const dayDate=(value,language='en')=>dateText(value,language,{weekday:'long',day:'numeric',month:'long'});
export const shortDate=(value,language='en')=>dateText(value,language,{weekday:'short',day:'numeric',month:'short'});
export const clockTime=(value,language='en')=>new Intl.DateTimeFormat(dateLocale(language),{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Europe/Brussels'}).format(new Date(value));

function singleAmendment(vote) {
  const numbers=unique((vote.context?.amendmentIds||[]).map(readAmendmentNumber).filter(Boolean));
  return numbers.length===1?numbers[0]:null;
}
function singlePart(vote) {
  const numbers=unique((vote.parts||[]).map(part=>part.number).filter(value=>value!==null&&value!==undefined&&String(value).trim()).map(String));
  return numbers.length===1?numbers[0]:null;
}
// A part vote whose part can't be named must not read as a vote on the whole amendment: it takes the source label.
export const voteNumbers=vote=>{
  const p=singlePart(vote);
  return vote.scope?.kind==='split-part'&&!p?{n:null,p:null}:{n:singleAmendment(vote),p};
};
const referenceText=(vote,language)=>vote.referenceTexts?.[language]||vote.referenceTexts?.en||Object.values(vote.referenceTexts||{})[0]||null;

/** One row's label. The main vote is the final vote and a block vote counts its amendments;
 * an amendment or part names its exact reference, then the provision the source gives. */
export function voteRowLabel(vote,language='en',ui=defaultUi,{mainVoteId=null}={}) {
  if(vote.id===mainVoteId)return ui.t('votepage.final_vote');
  const amendments=unique(vote.context?.amendmentIds||[]);
  if(amendments.length>1)return ui.t('votepage.row.block',{count:amendments.length},{count:amendments.length});
  const {n,p}=voteNumbers(vote),source=referenceText(vote,language),target=(n?source?.replace(/\s[–—-]\s*Am [\d/]+$/u,''):source)||null;
  if(n)return target&&!/^Amendments by/.test(target)?ui.t(p?'votepage.row.part':'votepage.row.amendment',{n,p,target}):ui.t(p?'votepage.centre.part_row':'votepage.centre.amendment',{n,p});
  if(p&&target&&!target.includes('/'))return ui.t('votepage.row.text_part',{target,p});
  if(target)return target;
  // With no source label, the shared fallback would rebuild the whole amendment's name.
  return vote.scope?.kind==='split-part'&&!p?ui.t('membervotespresentation.decision'):memberVoteLabel(vote,language,ui);
}
/** The word in a row or the chart's centre. Nothing when the record holds no result. */
export function voteOutcomeWord(vote,ui=defaultUi) {
  if(vote.outcome==='ADOPTED')return ui.t('votepage.word.adopted');
  if(vote.outcome==='REJECTED')return ui.t('votepage.word.rejected');
  if(vote.outcome==='LAPSED')return ui.t('votepage.word.lapsed');
  return vote.ballotStatus==='not-conducted'?ui.t('votepage.no_vote_held'):null;
}
// A reference that names a place in the text reads inside a sentence; other labels stand before it.
const provisionLabel=/^(?:§\s*\d|(?:Recital|Citation|Article)\s+\S)/u;
/** The page's sentence: one fixed template per case. `{n}` and `{p}` come from exact amendment
 * and part references. Referral comes only from the server's exact same-date procedure event,
 * never from wording. A rejection's template puts the larger number first. */
export function voteSentence(vote,{mainVoteId=null,procedureReferral=false,language='en'}={},ui=defaultUi) {
  const totals=memberVoteTotals(vote),hands=vote.ballotStatus==='conducted'&&vote.method==='VOTE_HAND';
  const tally=totals?{for:totals.for,against:totals.against,abstaining:totals.abstaining}:{},form=totals?'tally':hands?'hands':'plain';
  const {n,p}=voteNumbers(vote),kind=n?(p?'part':'amendment'):null;
  const noNames=Boolean(totals)&&withoutNames.has(vote.method);
  const label=()=>voteRowLabel(vote,language,ui);
  if(vote.ballotStatus==='not-conducted') {
    const lapsed=vote.outcome==='LAPSED';
    if(kind)return {id:'votepage.'+kind+'.'+(lapsed?'lapsed':'not_held'),values:{n,p},noNames:false};
    return lapsed?{id:'votepage.other.lapsed',values:{label:label()},noNames:false}:{id:'votepage.no_result',values:{},noNames:false};
  }
  const outcome=vote.outcome==='ADOPTED'?'adopted':vote.outcome==='REJECTED'?'rejected':null;
  if(!outcome)return {id:'votepage.no_result',values:{},noNames:false};
  const provision=vote.id!==mainVoteId&&!kind&&!vote.context?.amendmentIds?.length&&provisionLabel.test(vote.referenceTexts?.en??'');
  if(provision)return {id:'votepage.provision.'+outcome+'.'+form,values:{label:label(),...tally},noNames};
  if(vote.id===mainVoteId) {
    const referred=procedureReferral&&outcome==='adopted'&&form!=='plain';
    return {id:'votepage.main.'+(referred?'position':outcome)+'.'+form,values:{...tally,date:longDate(vote.date,language)},noNames};
  }
  if(kind&&form!=='plain')return {id:'votepage.'+kind+'.'+outcome+'.'+form,values:{n,p,...tally},noNames};
  return {id:'votepage.other.'+outcome+'.'+(form==='tally'?'tally':'plain'),values:{label:label(),...tally},noNames};
}
/** The chart's centre: the outcome word, then the small line that says what was voted on. */
export function voteCentre(vote,{mainVoteId=null,procedureReferral=false}={},ui=defaultUi) {
  const {n,p}=voteNumbers(vote),word=voteOutcomeWord(vote,ui);
  if(n&&vote.id!==mainVoteId)return {word,small:p?ui.t('votepage.centre.part',{n,p}):ui.t('votepage.centre.amendment',{n}),smallLanguage:ui.language};
  if(vote.id===mainVoteId&&procedureReferral&&vote.outcome==='ADOPTED')return {word,small:ui.t('votepage.centre.referral'),smallLanguage:ui.language};
  const small=typeof vote.title==='string'?vote.title.split(' – ').at(-1).trim():'';
  return {word,small:small||null,smallLanguage:vote.titleLanguage??''};
}
/** Named voters as flat rows. Current members resolve through the client's directory; everyone
 * else through the response's held names. A conflicting record has no single position to show. */
export function decisionVoterRows(data,directory=new Map(),nameOf=()=>null) {
  if(!data.decision?.namedVoters?.available||data.integrity==='conflicting')return [];
  return data.voters.filter(voter=>voter.status==='recorded').map(voter=>({...decisionPerson(data,voter.personId,directory,nameOf),group:voter.group?.code??'unavailable',position:voter.position}));
}
function decisionPerson(data,id,directory,nameOf) {
  const member=directory.get(id),held=data.people?.[id];
  return {id,name:held?.name??(nameOf(id)||null),country:member?.countryCode??held?.country??null};
}
/** Everyone who appears in Find a member: the voters, then members with no vote on record. */
export function findableMembers(rows,noRecord,data,directory=new Map(),nameOf=()=>null) {
  const absent=(noRecord?.ids||[]).map((id,index)=>({...decisionPerson(data,id,directory,nameOf),group:noRecord.groups?.[index]??'unavailable',position:null}));
  return [...rows,...absent].filter(row=>row.name);
}
const folded=value=>String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLocaleLowerCase();
/** An exact name wins; otherwise the first name containing what was typed, from two letters. */
export function findMember(people,query) {
  const wanted=folded(query).trim();
  if(wanted.length<2)return null;
  return people.find(person=>folded(person.name)===wanted)||people.find(person=>folded(person.name).includes(wanted))||null;
}
export function groupCountsOf(rows) {
  const counts=new Map();
  for(const row of rows) {
    const code=row.group||'unavailable';
    if(!counts.has(code))counts.set(code,{for:0,against:0,abstaining:0,total:0});
    const entry=counts.get(code);entry[row.position]++;entry.total++;
  }
  return counts;
}
/** A group's strict most common position, for bolding; a tie has none. */
export function groupLead(counts) {
  const ranked=[...positions].sort((a,b)=>counts[b]-counts[a]);
  return counts[ranked[0]]&&counts[ranked[0]]!==counts[ranked[1]]?ranked[0]:null;
}
/** The way line: groups by their majority, from `groupMajorities`, in table order. NI is excluded
 * and a tied group goes under Split. */
export function wayLine(rows,order) {
  const majorities=new Map(groupMajorities(rows).map(group=>[group.code,group.majority]));
  const way={for:[],against:[],abstaining:[],split:[]};
  for(const code of order)if(majorities.has(code))way[majorities.get(code)||'split'].push(code);
  return way;
}
const surname=name=>folded(String(name||'').trim().split(/\s+/).at(-1));
const byName=(a,b)=>surname(a.name).localeCompare(surname(b.name))||folded(a.name).localeCompare(folded(b.name))||String(a.id).localeCompare(String(b.id),undefined,{numeric:true});
/** Everyone by group in table order, minority positions first, names by surname. */
export function membersByGroup(rows,order) {
  const counts=groupCountsOf(rows);
  return order.filter(code=>counts.has(code)).map(code=>{
    const lead=groupLead(counts.get(code)),people=rows.filter(row=>(row.group||'unavailable')===code);
    return {code,positions:[...positions].sort((a,b)=>(a===lead)-(b===lead)||positions.indexOf(a)-positions.indexOf(b)).map(position=>({position,people:people.filter(row=>row.position===position).sort(byName)})).filter(entry=>entry.people.length)};
  });
}
/** Members who differ from their group, by group in table order, each position's names by surname.
 * `first` is a member the reader came from: in their own group their position and name lead. */
export function differingByGroup(rows,differIds,order,first=null) {
  return order.flatMap(code=>{
    const people=rows.filter(row=>(row.group||'unavailable')===code&&differIds.has(String(row.id)));
    const lead=first===null?null:people.find(row=>String(row.id)===first)?.position??null;
    const leading=row=>String(row.id)===first;
    return people.length?[{code,count:people.length,positions:[...positions].sort((a,b)=>(b===lead)-(a===lead)).map(position=>({position,people:people.filter(row=>row.position===position).sort((a,b)=>leading(b)-leading(a)||byName(a,b))})).filter(entry=>entry.people.length)}]:[];
  });
}
/** What one member's line says, from this vote's reply alone, or null for no line. A group clause
 * follows `groupMajorities`: NI, an unknown group and a tie have none, and neither does a voter
 * alone in their group. An incomplete list supports neither the group nor the country. A country
 * counts when it has two other voters; voters with no known country are in no country's count. */
export function memberVoteLine(data,rows,member) {
  const vote=data.decision;
  if(!member||!vote||data.integrity==='conflicting'||vote.ballotStatus==='not-conducted'||vote.outcome==='LAPSED')return null;
  const row=rows.find(entry=>entry.id===member);
  if(!row)return data.noRecord?.ids.includes(member)?{state:'no_record'}:null;
  const complete=data.integrity==='complete';
  const group=complete?groupMajorities(rows).find(entry=>entry.code===row.group):null;
  const groupClause=group?.majority&&group.voters>1?(row.position===group.majority?'with':'differs'):'none';
  const line=vote.outcome==='ADOPTED'?'for':vote.outcome==='REJECTED'?'against':null;
  const outcomeClause=!line||row.position==='abstaining'?'none':row.position===line?'with':'differs';
  const peers=complete&&row.country?rows.filter(entry=>entry.country&&matchesCountry(row.country,entry.country)):[];
  return {state:'voted',position:row.position,id:row.position==='abstaining'?'votepage.member.abstained.'+groupClause:'votepage.member.voted.'+groupClause+'.'+outcomeClause,group:groupClause==='none'?null:row.group,
    country:peers.length>=3?{code:filterCountry(row.country),count:peers.filter(entry=>entry.position===row.position).length,total:peers.length}:null};
}
const hasCount=vote=>positions.every(position=>Number.isFinite(vote.totals?.[position]));
/** Votes on an item in the page's sections, main vote first in its own section. A full count is
 * Counted; a vote not held is Lapsed, or No vote held when Parliament's outcome isn't lapsed. Any
 * other row with a number stays Counted, its unknowns dashes. Show of hands is the recorded method
 * only: a missing tally on any other method is No count, never a method the record doesn't state. */
export function itemVoteSections(votes,mainVoteId=null) {
  const counted=[],hands=[],lapsed=[],notHeld=[],noCount=[];
  const ordered=[...votes].sort((a,b)=>(a.id!==mainVoteId)-(b.id!==mainVoteId));
  for(const vote of ordered) {
    if(hasCount(vote))counted.push(vote);
    else if(vote.ballotStatus==='not-conducted')(vote.outcome==='LAPSED'?lapsed:notHeld).push(vote);
    else if(positions.some(position=>Number.isFinite(vote.totals?.[position])))counted.push(vote);
    else (vote.method==='VOTE_HAND'?hands:noCount).push(vote);
  }
  return [{key:'counted',votes:counted},{key:'hands',votes:hands},{key:'no_count',votes:noCount},{key:'lapsed',votes:lapsed},{key:'not_held',votes:notHeld}].filter(section=>section.votes.length);
}
const provisionForms=[[/^§\s*([1-9]\d{0,4}[a-z]{0,3})$/u,match=>'paragraph:'+match[1]],[/^§\s*([1-9]\d{0,4}[a-z]{0,3}), point ([a-z]{1,4})$/u,match=>'point:'+match[1]+':'+match[2]],[/^Recital ([A-Z]{1,3})$/u,match=>'recital:'+match[1]],[/^Citation ([1-9]\d{0,4})$/u,match=>'citation:'+match[1]]];
/** The provision of a report or motion this vote is on, from its exact reference and its own one
 * document. A vote on an amendment to the provision has the amendment's wording instead. */
export function voteProvision(vote) {
  if(!['split-part','unclassified'].includes(vote.scope?.kind)||vote.context?.amendmentIds?.length)return null;
  const reference=vote.referenceTexts?.en?.trim()??'',form=provisionForms.map(([pattern,build])=>{const match=pattern.exec(reference);return match&&build(match);}).find(Boolean);
  const documentId=form?voteDocument(vote):null;
  return documentId?{documentId,provision:form}:null;
}
// Only the vote's own links count. Its title decides among several and must agree with them;
// several documents and no name in the title could mean any of them.
function voteDocument(vote) {
  const documents=unique(vote.context?.documentIds||[]).filter(id=>/^(?:A|B|RC)-\d+-\d{4}-\d{4,6}$/u.test(id));
  const named=/^(RC-)?([AB])(\d+)-(\d{4,6})\/(\d{4})\b/u.exec(vote.title||''),titled=named?(named[1]?'RC':named[2])+'-'+named[3]+'-'+named[5]+'-'+named[4]:null;
  if(titled)return documents.includes(titled)?titled:null;
  return documents.length===1?documents[0]:null;
}
/** A vote's place in the text, for the heading over its wording or parts. */
export function voteReferenceLabel(vote,language='en') {
  return referenceText(vote,language)?.replace(/\s[–—-]\s*Am [\d/]+$/u,'')||null;
}
/** Previous and next follow the order the Votes on this item fold shows. */
export function voteSteps(votes,mainVoteId,id) {
  const flat=itemVoteSections(votes,mainVoteId).flatMap(section=>section.votes),index=flat.findIndex(vote=>vote.id===id);
  return {previous:index>0?flat[index-1].id:null,next:index>=0&&index<flat.length-1?flat[index+1].id:null};
}
/** An old agenda address with a chosen vote now belongs to the vote page. */
export function agendaVoteRedirect(search) {
  const params=new URLSearchParams(search),vote=params.get('agenda-vote');
  if(!vote||!params.get('agenda-topic')||!/^MTG-PL-\d{4}-\d{2}-\d{2}-DEC-\d+$/.test(vote))return null;
  return voteHref(vote,params.get('lang')||'en');
}
/** The wording for a plain amendment page. A number prefix up to the first tab is not the text.
 * The provision keeps the source's case, except an English label's sentence-initial capital. */
function provisionFields(variant) {
  const target=typeof variant.targetLabel==='string'?variant.targetLabel.trim():'';
  return {provision:target&&variant.targetLabelLanguage==='en'?target[0].toLocaleLowerCase('en')+target.slice(1):target,sourceLabel:target,labelLanguage:variant.targetLabelLanguage??null};
}
export function voteAmendmentWording(variants,vote,ui=defaultUi) {
  const available=(variants||[]).filter(variant=>variant?.wordingStatus==='available');
  const held=available.filter(variant=>typeof variant.proposedText==='string'&&variant.proposedText.trim());
  // A deletion can have no wording of its own and still a provision to place.
  if(!held.length)return available[0]?{state:'none',...provisionFields(available[0])}:{state:'none'};
  if(new Set(held.map(variant=>variant.language+'\n'+variant.proposedText)).size>1)return {state:'versions'};
  const variant=held[0],{n}=voteNumbers(vote),fields=provisionFields(variant);
  return {state:'text',language:variant.language||'',text:stripNumberPrefix(variant.proposedText),heading:fields.provision?ui.t('votepage.amendment_provision',{n,provision:fields.provision}):ui.t('votepage.centre.amendment',{n}),...fields};
}
