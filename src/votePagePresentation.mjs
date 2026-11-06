import {defaultUi} from './uiDefault.mjs';
import {memberVoteLabel,memberVoteOutcome,memberVoteTotals} from './memberVotesPresentation.mjs';

const amendmentNumber=/-AM-(\d+(?:-\d+)?)$/;
const withoutNames=new Set(['VOTE_HAND','VOTE_ELECTRONIC','VOTE_ELECTRONIC_SECRET','VOTE_SECRET','VOTE_SECRET_BALLOT']);
const unique=values=>[...new Set(values)];

export const voteHref=(id,language='en')=>'?'+new URLSearchParams({view:'legislation','pl-mode':'vote','pl-vote':id,lang:language});
export function agendaItemHref(id,language='en') {
  const day=/^MTG-PL-\d{4}-\d{2}-\d{2}/.exec(id)?.[0];
  return '?'+new URLSearchParams({view:'legislation',...(day?{'agenda-period':'sitting:'+day}:{}),'agenda-topic':id,lang:language});
}
function singleAmendment(vote) {
  const numbers=unique((vote.context?.amendmentIds||[]).map(id=>amendmentNumber.exec(id)?.[1]).filter(Boolean));
  return numbers.length===1?numbers[0]:null;
}
function singlePart(vote) {
  const numbers=unique((vote.parts||[]).map(part=>part.number).filter(value=>value!==null&&value!==undefined&&String(value).trim()).map(String));
  return numbers.length===1?numbers[0]:null;
}
const voteTally=(vote,ui)=>{const totals=memberVoteTotals(vote);return totals?ui.t('votepage.tally',{for:totals.for,against:totals.against,abstaining:totals.abstaining}):null;};
/** A block vote names every amendment it covers, so its row uses the source label. */
export function voteRowLabel(vote,language='en',ui=defaultUi) {
  if(unique(vote.context?.amendmentIds||[]).length>1)return vote.referenceTexts?.[language]||vote.referenceTexts?.en||Object.values(vote.referenceTexts||{})[0]||memberVoteLabel(vote,language,ui);
  return memberVoteLabel(vote,language,ui);
}
export function voteRowResult(vote,ui=defaultUi) {
  if(vote.ballotStatus==='not-conducted')return {text:ui.t('activityvote.not_put_to_a_vote'),label:null};
  const totals=memberVoteTotals(vote);
  if(totals)return {text:totals.for+'–'+totals.against+'–'+totals.abstaining,label:voteTally(vote,ui)};
  return vote.method==='VOTE_HAND'?{text:ui.t('voteMethod.hands'),label:null}:null;
}
/** The page heading: one fixed template per case. `{n}` and `{p}` come from exact
 * amendment and part references. Referral comes only from the server's exact
 * same-date procedure event, never from wording. */
export function voteSentence(vote,{mainVoteId=null,procedureReferral=false,itemTitle=null,language='en'}={},ui=defaultUi) {
  const conducted=vote.ballotStatus==='conducted',hands=conducted&&vote.method==='VOTE_HAND',tally=voteTally(vote,ui);
  const noNames=conducted&&withoutNames.has(vote.method);
  const form=tally?'tally':hands?'hands':'plain';
  const outcome=vote.outcome==='ADOPTED'?'adopted':vote.outcome==='REJECTED'?'rejected':null;
  const n=singleAmendment(vote),p=singlePart(vote);
  if(vote.id===mainVoteId&&itemTitle&&outcome) {
    const referred=procedureReferral&&outcome==='adopted';
    return {id:'votepage.main.'+(referred?'position':outcome)+'.'+form,values:{tally},item:true,noNames};
  }
  if(n) {
    const kind=p?'part':'amendment';
    if(vote.ballotStatus==='not-conducted')return {id:'votepage.'+kind+'.not_voted',values:{n,p},item:false,noNames:false};
    if(outcome)return {id:'votepage.'+kind+'.'+outcome+'.'+form,values:{n,p,tally},item:false,noNames};
  }
  return {id:'votepage.other.'+(tally?'tally':'plain'),values:{label:voteRowLabel(vote,language,ui),outcome:memberVoteOutcome(vote,ui),tally},item:false,noNames};
}
/** Build the agenda's vote shape from a decision read. Current members resolve
 * through the client's directory; everyone else through the response's held names. */
export function namedVoteFromDecision(data,directory=new Map(),nameOf=()=>null) {
  const positions=['for','against','abstaining'];
  const person=(id,group)=>{
    const member=directory.get(id),held=data.people?.[id];
    return {id,name:held?.name??(nameOf(id)||null),personUri:'https://data.europarl.europa.eu/person/'+id,currentMep:Boolean(member),country:member?.countryCode??held?.country??null,group,contributionGroup:group};
  };
  const decision=data.decision,recorded=data.voters.filter(voter=>voter.status==='recorded');
  const available=Boolean(decision.namedVoters?.available)&&data.integrity!=='conflicting';
  const groups=Object.fromEntries(positions.map(position=>[position,recorded.filter(voter=>voter.position===position).map(voter=>person(voter.personId,voter.group?.code??null))]));
  const codes=unique(recorded.map(voter=>voter.group?.code||'unavailable')).sort();
  return {
    id:decision.id,date:decision.date,titles:{},subjects:{},scope:decision.scope?.kind||'unclassified',outcome:decision.outcome||'',aggregateTotals:decision.totals,
    namedVotersAvailable:available,totalsMatchNamed:data.integrity==='complete',groups:available?groups:null,
    politicalGroups:available?codes.map(code=>({code,positions:Object.fromEntries(positions.map(position=>[position,groups[position].filter(row=>(row.contributionGroup||'unavailable')===code)]))})):null,
    intendedCorrections:Object.fromEntries(positions.map(position=>[position,(data.corrections?.[position]||[]).map(id=>person(id,null))])),
  };
}
