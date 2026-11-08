import {useEffect,useRef,useState} from 'react';
import {defaultUi} from './uiDefault.mjs';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {groupMajorities,delegationBreaks} from './voteGroupMetrics.mjs';
import {GroupUnity,VoteGroupSummary} from './VoteGroupSummary';
import {selectLanguageText} from './language.mjs';
import {matchesCountry} from './countries.mjs';
import {InsightPeople,humanDate} from './InsightShared';
import {groupColor,groupLabel,groupLabelLanguage} from './groupLabels';
import {countryName} from './CountryMap';
import {interfaceTerm,voteScope} from './terms.mjs';
import type {InsightProps} from './InsightTypes';
import {memberVoteOutcome} from './memberVotesPresentation.mjs';
import {dossierLinkClick} from './dossierJourney';
import {voteHref,voteSentence} from './votePagePresentation.mjs';
import {PLENARY_REDESIGN_LIVE} from './plenaryRollout.mjs';
import type {LegislationResponse,NamedVote} from './LegislationTypes';

const positions={for:'For',against:'Against',abstaining:'Abstaining'};
export const positionsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof positions => ({for:ui.t("membervotespresentation.for"),against:ui.t("membervotespresentation.against"),abstaining:ui.t("membervotesummary.abstaining")});
export type VoteViewVote=Pick<NamedVote,'id'|'date'|'titles'|'subjects'|'scope'|'outcome'|'aggregateTotals'|'namedVotersAvailable'|'totalsMatchNamed'|'groups'|'politicalGroups'|'intendedCorrections'>;

// The item's outcome in the vote page's words, directly under its agenda heading.
export function AgendaOutcome({main,language}:{main:NonNullable<NonNullable<LegislationResponse['detail']>['mainVote']>;language:string}) {
  const ui=useUiI18n();
  const sentence=voteSentence({...main,scope:{kind:'unclassified',basis:'unclassified'},referenceTexts:{},context:{amendmentIds:[]},parts:[]},{mainVoteId:main.id,procedureReferral:main.procedureReferral,language},ui);
  return <p className="insight-agenda-outcome" lang={ui.language}><UiMessage id={sentence.id} values={sentence.values}/>{sentence.noNames&&<> <UiMessage id="votepage.no_names"/></>} <a href={voteHref(main.id,language)} onClick={dossierLinkClick}><UiMessage id="votepage.see_the_vote"/></a></p>;
}
export function VoteView({vote,language,onMember,country,standalone=false,mainVoteId=null}:{country:string|null;vote:VoteViewVote;language:string;onMember:InsightProps['onMember'];standalone?:boolean;mainVoteId?:string|null}) {
  const ui = useUiI18n();
  const [position,setPosition]=useState<keyof typeof positions>('for'),[group,setGroup]=useState<string|null>(null),[showPeople,setShowPeople]=useState(false),heading=useRef<HTMLHeadingElement>(null),opener=useRef<HTMLButtonElement|null>(null),browse=useRef<HTMLButtonElement>(null);
  useEffect(()=>{setPosition('for');setGroup(null);setShowPeople(false);},[vote.id,country]);
  const choices=Object.keys(positionsUi(ui)) as (keyof typeof positions)[];
  const countryPeople=(p:keyof typeof positions)=>(vote.groups?.[p]||[]).filter(person=>matchesCountry(country,person.country));
  const groupPeople=(code:string,p:keyof typeof positions)=>(vote.politicalGroups?.find(row=>row.code===code)?.positions[p]||[]).filter(person=>matchesCountry(country,person.country));
  const people=countryPeople(position),filtered=group ? groupPeople(group,position) : people;
  const groups=(vote.politicalGroups||[]).map(row=>row.code).filter(code=>choices.some(p=>groupPeople(code,p).length)).sort((a,b)=>choices.reduce((n,p)=>n+groupPeople(b,p).length-groupPeople(a,p).length,0)||a.localeCompare(b));
  const metricRows=(vote.politicalGroups||[]).flatMap(g=>choices.flatMap(position=>g.positions[position].map(person=>({group:g.code,country:person.country,position}))));
  const majorities=groupMajorities(metricRows).sort((a,b)=>choices.reduce((n,p)=>n+b.counts[p]-a.counts[p],0)||a.code.localeCompare(b.code));
  const breaks=delegationBreaks(metricRows).filter(row=>matchesCountry(country,row.country));
  function choose(p:keyof typeof positions,g:string|null){const active=document.activeElement;if(active instanceof HTMLButtonElement&&!active.closest('.insight-voter-list'))opener.current=active;setPosition(p);setGroup(g);setShowPeople(true);requestAnimationFrame(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'start'});});}
  const titles={...vote.titles,...Object.fromEntries(Object.entries(vote.subjects).filter(([,text])=>text.trim()))};
  const label=interfaceTerm('vote',language),title=selectLanguageText(titles,language,label.text,label.language);
  return <section className="insight-vote-detail" lang={ui.language}>
    {!standalone&&<><h3 lang={title.language}>{title.text}</h3>
    <p className="insight-record-meta"><span lang={voteScope(vote.scope,language, ui).language}>{voteScope(vote.scope,language, ui).text}</span><span lang={language}>{humanDate(vote.date,language)}</span>{PLENARY_REDESIGN_LIVE ? vote.id!==mainVoteId&&<span>{memberVoteOutcome(vote,ui)}</span> : <span>{vote.outcome.toLowerCase()}</span>}</p></>}
    {(!standalone||country)&&<div className="insight-vote-totals">{choices.map(p=><div key={p} className={'vote-'+p}><h3>{positionsUi(ui)[p]} <strong>{country ? countryPeople(p).length : (vote.aggregateTotals[p]??'—')}</strong></h3>{country&&<small><UiMessage id="legislation.of_count_across_parliament.dffd8c" values={{count: (vote.aggregateTotals[p]??'—')}}/></small>}</div>)}</div>}
    {vote.namedVotersAvailable&&<><h4><UiMessage id="insightshared.political_groups"/></h4><p className="insight-chart-caption">{country ? <UiMessage id="legislation.named_voters_elected_in_countryname_select_a_count_to_see_the_meps.5d4e97" values={{country: <span lang={language}>{countryName(country,language)}</span>}}/> : <UiMessage id="legislation.named_voters_across_parliament_select_a_count_to_see_the_meps.4bc20f"/>}</p><div className="insight-vote-matrix"><div className="insight-vote-matrix-head"><span><UiMessage id="groupvoices.political_group.c2db1f"/></span>{choices.map(p=><span key={p}>{positionsUi(ui)[p]}</span>)}<span lang={ui.messageLocale("votegroups.with_majority")}><UiMessage id="votegroups.with_majority"/>{country&&<small className="vote-group-scope" lang={ui.messageLocale("votegroups.whole_group")}><UiMessage id="votegroups.whole_group"/></small>}</span></div>{groups.map(code=>{const counts=choices.map(p=>groupPeople(code,p).length),total=counts.reduce((sum,n)=>sum+n,0);return <div className="insight-vote-group-row" key={code}><span lang={groupLabelLanguage(code,ui)}><i style={{background:groupColor(code)}}/>{groupLabel(code, ui)}</span>{choices.map((p,index)=><button lang={ui.language} key={p} className={'vote-'+p} style={{backgroundSize:`${counts[index]/Math.max(1,total)*100}% 100%`}} aria-label={ui.t("legislation.grouplabel_position_count_meps.f476b0", {group: String(groupLabel(code, ui)), position: String(positionsUi(ui)[p].toLowerCase()), count: counts[index]})} aria-pressed={showPeople&&position===p&&group===code} disabled={!counts[index]} onClick={()=>choose(p,code)}>{counts[index]}</button>)}<GroupUnity metric={majorities.find(g=>g.code===code)}/></div>;})}</div>{standalone&&<p className="insight-chart-caption"><UiMessage id="votepage.with_majority_note"/></p>}<VoteGroupSummary groups={majorities} rows={metricRows}/>{breaks.length>0&&<details className="vote-delegation-breaks"><summary><UiMessage id="votegroups.delegations.heading"/></summary><ul>{breaks.map(row=><li key={row.group+row.country}><UiMessage id="votegroups.delegation.row" values={{country:countryName(row.country,language),group:groupLabel(row.group,ui),for:row.for,against:row.against,groupFor:row.groupFor,groupAgainst:row.groupAgainst}}/></li>)}</ul></details>}{!groups.length&&<p><UiMessage id="legislation.no_named_voters_in_this_election_country.f82bd9"/></p>}{!showPeople&&groups.length>0&&<button ref={browse} className="insight-text-button" onClick={()=>choose(choices.find(p=>countryPeople(p).length>0)||'for',null)}><UiMessage id="legislation.browse_voters.83b3d0"/></button>}</>}
    {vote.namedVotersAvailable&&!vote.totalsMatchNamed&&<p className="insight-secondary"><UiMessage id="legislation.the_named_voter_list_differs_from_parliament_s_published_totals.d739ef"/></p>}
    {vote.namedVotersAvailable&&showPeople&&<section className="insight-voter-list"><div className="insight-section-heading"><h3 ref={heading} tabIndex={-1}>{positionsUi(ui)[position]}{group ? <> · <span lang={groupLabelLanguage(group,ui)}>{groupLabel(group, ui)}</span></> : ''} <small><UiMessage id="legislation.count_meps.e2c717" values={{count: filtered.length}}/></small></h3><button className="insight-text-button" onClick={()=>{setShowPeople(false);requestAnimationFrame(()=>{const target=opener.current?.isConnected ? opener.current : browse.current;target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});});}}><UiMessage id="legislation.hide_voters.3bf222"/></button></div><div className="insight-chart-switch" role="group" aria-label={ui.t("legislation.vote_position.4dccce")}>{choices.map(p=><button key={p} aria-pressed={position===p} onClick={()=>choose(p,group)}>{positionsUi(ui)[p]}</button>)}</div>{group&&<button className="insight-text-button" onClick={()=>setGroup(null)}><UiMessage id="legislation.all_groups.33c7d0"/></button>}<InsightPeople key={vote.id+position+(group||'')} people={filtered} language={language} onMember={onMember}/>{!filtered.length&&<p><UiMessage id="legislation.no_named_voters_in_this_selection.51d18b"/></p>}</section>}
    {!vote.namedVotersAvailable&&<p><UiMessage id="legislation.individual_votes_unavailable.ca5dc2"/></p>}
    <details><summary><UiMessage id="legislation.vote_corrections.b7dcb6"/></summary>{choices.map(p=>vote.intendedCorrections[p].length ? <p key={p}><UiMessage id="legislation.intended_position_people.c15a86" values={{position: positionsUi(ui)[p], people: vote.intendedCorrections[p].map((x,index)=><span key={x.id} lang={x.name ? '' : 'en'}>{index ? ', ' : ''}{x.name||ui.t("insightshared.mep")}</span>)}}/></p> : null)}{!Object.values(vote.intendedCorrections).some(a=>a.length)&&<p><UiMessage id="legislation.no_corrections.9b95da"/></p>}</details>
  </section>;
}
