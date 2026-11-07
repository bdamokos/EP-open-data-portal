import {lazy,Suspense,useMemo,useRef,useState} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {VotePartDescriptions} from './MemberVoteSummary';
import {insightMemberHref} from './InsightShared';
import {useDirectoryMembers,usePersonName} from './PersonName';
import {useData} from './data';
import {dossierLinkClick} from './dossierJourney';
import {decisionVotesRoute,validateDecisionVotes} from './decisionVotesPresentation.mjs';
import {displayVoteTitle,memberVoteTotals} from './memberVotesPresentation.mjs';
import {publicUrl} from './publicUrl';
import {documentReferenceLabel,readableDocument,readHref} from './readRoute.mjs';
import {agendaItemHref,clockTime,dayDate,decisionVoterRows,differingByGroup,findMember,findableMembers,fullDate,groupCountsOf,groupLead,itemVoteSections,membersByGroup,shortDate,sittingHref,voteCentre,voteHref,voteNumbers,voteOutcomeWord,voteRowLabel,voteSentence,voteSteps,wayLine} from './votePagePresentation.mjs';
import {FoldLink,FoldRow} from './FoldRow';
import {PageStrip,StripLink} from './PageStrip';
import {VoteAmendmentText} from './VoteAmendmentText';
import {VoteMark} from './VoteMark';
import {TallyHeads,TallyNumbers,TotalFigure,TotalsFigures,VoteRow} from './VoteRow';
import {groupLabel,groupLabelLanguage} from './groupLabels';
import {voteCountryName as countryName} from './voteCountryName';
import {filterCountry,matchesCountry} from './countries.mjs';
import {delegationBreaks} from './voteGroupMetrics.mjs';
import {differingVoterIds,planGroupOrder,tableGroupOrder} from './voteSeatsModel.mjs';
import {panelVoters} from './voterPanelModel.mjs';
import {groupCounts,type HemicycleSeat} from './hemicycleModel.mjs';
import {validateVotePeriods,type VotePeriodsResponse} from './plenaryPeriods.mjs';
import {votePositionKeys,type VotePosition} from './votePositions';
import type {DecisionItemVote,DecisionVotesResponse} from './DecisionVotesTypes';
import type {InsightProps} from './InsightTypes';

import './VoteSystem.css';
import './VotePage.css';

const VoteArc=lazy(()=>import('./VoteArc').then(module=>({default:module.VoteArc})));
const VoteCountries=lazy(()=>import('./VoteCountries').then(module=>({default:module.VoteCountries})));
const DossierStatus=lazy(()=>import('./DossierStatus').then(module=>({default:module.DossierStatus})));
const chamberFor=(location:string|null|undefined)=>location==='Brussels'?'bru':'str';
const column={for:'f',against:'a',abstaining:'x'} as const;
type Row={id:string;name:string|null;country:string|null;group:string;position:VotePosition};
type HemicyclePlan={chamber:string;seats:HemicycleSeat[]};
type Filter={country:string|null;group:string|null;position:VotePosition|null};

function usePositionWords() {
  const ui=useUiI18n();
  return (position:VotePosition)=>ui.t(position==='for'?'votepage.line.for':position==='against'?'votepage.line.against':'votepage.line.abstained');
}
function groupName(code:string,ui:ReturnType<typeof useUiI18n>) {
  return code==='unavailable'?ui.t('votegroups.seats.unknownGroup'):groupLabel(code,ui);
}
function Names({people,language}:{people:Row[];language:string}) {
  const ui=useUiI18n();
  return <>{people.map((person,index)=><span key={person.id}>{index?', ':''}<a href={insightMemberHref(person.id,language)} lang="">{person.name||ui.t('insightshared.mep')}</a></span>)}</>;
}
function WayLine({rows,order}:{rows:Row[];order:string[]}) {
  const ui=useUiI18n(),words=usePositionWords(),way=wayLine(rows,order);
  const names=(codes:string[])=>codes.map((code,index)=><span key={code}>{index?', ':''}<span lang={groupLabelLanguage(code,ui)}>{groupName(code,ui)}</span></span>);
  if(!votePositionKeys.some(position=>way[position].length)&&!way.split.length)return null;
  return <p className="way">{votePositionKeys.filter(position=>way[position].length).map(position=><span key={position} className="wp"><VoteMark position={position}/><span className="muted">{words(position)}:</span> {names(way[position])}</span>)}{way.split.length>0&&<span className="wp"><span className="muted"><UiMessage id="votepage.split"/></span> {names(way.split)}</span>}</p>;
}
// A group is the same row as a vote, in a real table. Pointing at it picks out its wedge.
function GroupTable({rows,order,totals,official,onDim}:{rows:Row[];order:string[];totals:ReturnType<typeof memberVoteTotals>;official:Record<VotePosition,number|null>;onDim:(group:string|null)=>void}) {
  const ui=useUiI18n(),counts=useMemo(()=>groupCountsOf(rows),[rows]),pointer=useRef('mouse'),tapped=useRef<string|null>(null);
  const tap=(code:string)=>{if(pointer.current==='mouse')return;tapped.current=tapped.current===code?null:code;onDim(tapped.current);};
  return <section className="ledger" id="groups"><table>
    <colgroup><col/><col className="numcol"/><col className="numcol"/><col className="numcol"/></colgroup>
    <thead><tr className="total"><th scope="col" className="meta">{totals?<UiMessage id="votepage.votes_cast" values={{count:totals.total}} counts={{count:totals.total}}/>:<span className="sr"><UiMessage id="groupvoices.political_group.c2db1f"/></span>}</th>{votePositionKeys.map(position=><th scope="col" key={position} className={'n fig '+column[position]}><TotalFigure position={position} value={official[position]}/></th>)}</tr></thead>
    <tbody>{order.filter(code=>counts.has(code)).map(code=>{
      const row=counts.get(code)!,lead=groupLead(row);
      return <tr key={code} className="grp" onPointerDown={event=>{pointer.current=event.pointerType;}} onPointerEnter={event=>{if(event.pointerType==='mouse')onDim(code);}} onPointerLeave={event=>{if(event.pointerType==='mouse')onDim(null);}} onClick={()=>tap(code)}>
        <th scope="row"><span className="t" lang={groupLabelLanguage(code,ui)}>{groupName(code,ui)}</span></th>
        {votePositionKeys.map(position=><td key={position} className={['n',column[position],row[position]===0?'zero':'',lead===position?'maj':''].filter(Boolean).join(' ')}>{row[position]}</td>)}
      </tr>;
    })}</tbody>
  </table></section>;
}
function FindMember({people,language,onFound}:{people:(Omit<Row,'position'>&{position:VotePosition|null})[];language:string;onFound:(id:string|null)=>void}) {
  const ui=useUiI18n(),words=usePositionWords(),[query,setQuery]=useState('');
  const options=useMemo(()=>[...new Set(people.map(person=>person.name!))].sort((a,b)=>a.localeCompare(b)),[people]);
  const found=findMember(people,query);
  const change=(value:string)=>{setQuery(value);const next=findMember(people,value);onFound(next?.position?next.id:null);};
  const details=found?[groupName(found.group,ui),found.country?countryName(found.country,language):null].filter(Boolean).join(', '):'';
  return <div className="findbox"><label className="find"><span className="sr"><UiMessage id="votepage.find"/></span><input type="search" placeholder={ui.t('votepage.find')} autoComplete="off" list="vote-page-members" value={query} onChange={event=>change(event.target.value)}/><datalist id="vote-page-members">{options.map(name=><option key={name} value={name}/>)}</datalist></label>
    <p className="findans" aria-live="polite">{found&&<UiMessage id="votepage.find_answer" values={{member:<><a href={insightMemberHref(found.id,language)} lang="">{found.name}</a>, {details}</>,position:found.position?words(found.position):ui.t('votepage.no_vote')}}/>}</p>
  </div>;
}
function PeopleBlock({entries,language}:{entries:ReturnType<typeof membersByGroup>;language:string}) {
  const ui=useUiI18n(),words=usePositionWords();
  return <div className="people">{entries.map(entry=><div key={entry.code}><p className="gname" lang={groupLabelLanguage(entry.code,ui)}>{groupName(entry.code,ui)}</p>{entry.positions.map(line=><p key={line.position}><VoteMark position={line.position}/><b>{words(line.position)} {line.people.length}:</b> <Names people={line.people as Row[]} language={language}/></p>)}</div>)}</div>;
}
function DifferBlock({entries,language}:{entries:ReturnType<typeof differingByGroup>;language:string}) {
  const ui=useUiI18n();
  return <div className="people">{entries.map(entry=><p key={entry.code}><b><span lang={groupLabelLanguage(entry.code,ui)}>{groupName(entry.code,ui)}</span> {entry.count}:</b>{entry.positions.map(line=><span key={line.position}> <VoteMark position={line.position}/><Names people={line.people as Row[]} language={language}/></span>)}</p>)}</div>;
}
// Every vote on the item, complete, main vote first. The agenda item uses the same rows.
export function ItemVotes({votes,current,mainVoteId,language}:{votes:DecisionItemVote[];current?:string;mainVoteId:string|null;language:string}) {
  const ui=useUiI18n();
  const heading=(key:string,count:number)=><h3><UiMessage id={'votepage.section.'+key}/> <small>{count}</small></h3>;
  return <>{itemVoteSections(votes,mainVoteId).map(section=>{
    const counted=section.key==='counted';
    return <div key={section.key}>
      {counted?<TallyHeads heading={heading(section.key,section.votes.length)}/>:<div className="heads static"><span className="main">{heading(section.key,section.votes.length)}</span></div>}
      {section.votes.map(row=>{
        const label=voteRowLabel(row,language,ui,{mainVoteId});
        return <VoteRow key={row.id} tight title={row.id===current?<span className="t"><b lang="">{label}</b></span>:<a className="t" lang="" href={voteHref(row.id,language)} onClick={dossierLinkClick}>{label}</a>} sub={row.id===current?<UiMessage id="votepage.this_vote"/>:undefined} word={voteOutcomeWord(row,ui)} rejected={row.outcome==='REJECTED'} totals={counted?row.totals:null}/>;
      })}
    </div>;
  })}</>;
}
function NoChart() {
  return <figure className="seats"><p className="seatkey" role="status"><UiMessage id="votepage.seat_chart_unavailable"/></p></figure>;
}

export function VotePage({decisionId,language,onMember,country,onCountry}:{decisionId:string;language:string;onMember:InsightProps['onMember'];country:string|null;onCountry:(country:string|null)=>void}) {
  const ui=useUiI18n(),words=usePositionWords();
  const directory=useDirectoryMembers(),displayName=usePersonName();
  const route=decisionVotesRoute(decisionId,language);
  const request=useData<DecisionVotesResponse>(route,{unavailable:'votepage.unavailable'});
  const data=request.data&&validateDecisionVotes(request.data,decisionId) ? request.data : null;
  const vote=data?.decision??null;
  const rows=useMemo<Row[]>(()=>data?decisionVoterRows(data,directory,displayName) as Row[]:[],[data,directory,displayName]);
  const named=rows.length>0;
  const calendar=useData<VotePeriodsResponse>(route?'vote-periods':null,{unavailable:'error.records'});
  const sitting=useMemo(()=>calendar.data&&validateVotePeriods(calendar.data)?calendar.data.weeks.flatMap(week=>week.sittings).find(row=>row.sittingId===decisionId.slice(0,17))??null:null,[calendar.data,decisionId]);
  const chamber=chamberFor(sitting?.location);
  const planState=useData<HemicyclePlan>(named&&(calendar.data||calendar.error)?`hemicycle/${chamber}`:null,{unavailable:'error.unavailable'});
  const plan=planState.data?.chamber===chamber?planState.data:null;
  const seats=useMemo(()=>plan?plan.seats.filter(seat=>seat.member):[],[plan]);
  const voteCounts=useMemo(()=>[...groupCountsOf(rows)].map(([code,counts])=>[code,counts.total] as [string,number]),[rows]);
  const tableOrder=useMemo(()=>tableGroupOrder(voteCounts,groupCounts(seats)),[voteCounts,seats]);
  const seatOrder=useMemo(()=>planGroupOrder(seats),[seats]);
  const differIds=useMemo(()=>differingVoterIds(rows),[rows]);
  const differing=useMemo(()=>differingByGroup(rows,differIds,tableOrder),[rows,differIds,tableOrder]);
  const people=useMemo(()=>data?findableMembers(rows,data.noRecord,data,directory,displayName):[],[data,rows,directory,displayName]);
  const [picked,setPicked]=useState<string|null>(null),[dimmed,setDimmed]=useState<string|null>(null);
  const [filter,setFilter]=useState<Filter>({country:null,group:null,position:null});
  const [membersOpen,setMembersOpen]=useState(false);
  const [votesOpen,setVotesOpen]=useState<boolean|null>(typeof location!=='undefined'&&location.hash==='#votes'?true:null);
  const activeCountry=filter.country??country;
  const filtered=useMemo(()=>{
    const positions=Object.fromEntries(votePositionKeys.map(position=>[position,rows.filter(row=>row.position===position)]));
    const groups=new Map(rows.map(row=>[row.id,row.group]));
    return panelVoters(positions,{groupOf:(id:string)=>groups.get(String(id))??null,matchesCountry:(code:string|null|undefined)=>matchesCountry(activeCountry,code??''),group:filter.group}).rows as Row[];
  },[rows,activeCountry,filter.group]);
  const memberEntries=useMemo(()=>membersByGroup(filtered,tableOrder),[filtered,tableOrder]);
  const breaks=useMemo(()=>rows.length?delegationBreaks(rows):[],[rows]);
  const loading=Boolean(route&&request.loading&&!data);
  const stripDate=/^MTG-PL-(\d{4}-\d{2}-\d{2})/.exec(decisionId)?.[1]??null;
  const dayBack=stripDate?<StripLink href={sittingHref(decisionId.slice(0,17),language)} onClick={dossierLinkClick} wide={<>‹ {dayDate(stripDate,language)}</>} narrow={<>‹ {shortDate(stripDate,language)}</>}/>:<span/>;
  const page=(children:React.ReactNode)=><article className="vs vote-page" lang={ui.language} data-vote-page={decisionId} data-vote-pending={loading ? 'true' : undefined}>{children}</article>;
  if(loading)return page(<><PageStrip back={dayBack}/><h1 className="vote-page-placeholder" role="status" tabIndex={-1}><UiMessage id="votepage.loading"/></h1></>);
  if(!data||data.status!=='found'||!vote)return page(<><PageStrip back={dayBack}/><h1 tabIndex={-1}>{!route||data?.coverage==='complete' ? <UiMessage id="votepage.not_found"/> : <UiMessage id="votepage.unavailable"/>}</h1></>);
  const subject=data.subject,agendaItem=subject?.agendaItemIds[0]??null;
  const mainVoteId=data.mainVoteId,siblings=data.siblings;
  const itemTitle=subject?.title ? displayVoteTitle(subject.title) : null,itemLanguage=subject?.titleLanguage??'';
  const sentence=voteSentence(vote,{mainVoteId,procedureReferral:data.procedureReferral,language},ui);
  const {n}=voteNumbers(vote),amendmentPage=Boolean(n)&&vote.id!==mainVoteId;
  const totals=memberVoteTotals(vote);
  const conflicting=data.integrity==='conflicting',hands=vote.ballotStatus==='conducted'&&vote.method==='VOTE_HAND';
  const centre=voteCentre(vote,{mainVoteId,procedureReferral:data.procedureReferral},ui);
  const steps=voteSteps(siblings,mainVoteId,decisionId);
  const count=siblings.length;
  const openVotes=(event:React.MouseEvent<HTMLAnchorElement>)=>{event.preventDefault();setVotesOpen(true);requestAnimationFrame(()=>document.getElementById('votes')?.scrollIntoView({block:'start'}));};
  const place=sitting?.location??null;
  const say=<>
    <UiMessage id={sentence.id} values={sentence.values.label?{...sentence.values,label:<span lang="">{sentence.values.label}</span>}:sentence.values}/>{sentence.noNames&&<> <UiMessage id="votepage.no_names"/></>}
  </>;
  const chooseCountry=(next:string|null,group:string|null,position:VotePosition)=>{setFilter({country:next,group,position});setMembersOpen(true);requestAnimationFrame(()=>document.getElementById('members')?.scrollIntoView({block:'start'}));};
  const clearFilter=()=>{setFilter({country:null,group:null,position:null});if(country)onCountry(null);};
  const documents=subject?.documentIds??[];
  const corrections=data.corrections?votePositionKeys.flatMap(position=>data.corrections![position].map(id=>({id,position,name:data.people?.[id]?.name??(displayName(id)||null)}))):[];
  const referenceDossier=data.procedureReferral?subject?.procedures[0]??null:null;
  return page(<>
    <PageStrip back={dayBack}>
      {count>1&&<>
        <StripLink href={steps.previous?voteHref(steps.previous,language):null} onClick={dossierLinkClick} label={ui.t('votepage.previous_vote')} wide={<>‹ <UiMessage id="votepage.previous_vote"/></>} narrow="‹"/>
        <StripLink href="#votes" onClick={openVotes} wide={<UiMessage id="votepage.votes_on_item" values={{count}} counts={{count}}/>} narrow={<UiMessage id="votepage.votes_short" values={{count}} counts={{count}}/>}/>
        <StripLink href={steps.next?voteHref(steps.next,language):null} onClick={dossierLinkClick} label={ui.t('votepage.next_vote')} wide={<><UiMessage id="votepage.next_vote"/> ›</>} narrow="›"/>
      </>}
    </PageStrip>
    {amendmentPage||!itemTitle?<>
      {(amendmentPage&&itemTitle)&&<p className="kicker">{agendaItem?<a lang={itemLanguage} href={agendaItemHref(agendaItem,language)} onClick={dossierLinkClick}>{itemTitle}</a>:<span lang={itemLanguage}>{itemTitle}</span>}<span className="meta">{place?<UiMessage id="votepage.date_place" values={{date:fullDate(vote.date,language),place}}/>:fullDate(vote.date,language)}</span></p>}
      <h1 tabIndex={-1}>{say}</h1>
    </>:<>
      <h1 tabIndex={-1} lang={itemLanguage}>{itemTitle}</h1>
      <p className="say">{say}</p>
    </>}
    {named&&<WayLine rows={rows} order={tableOrder}/>}
    {vote.parts.length>0&&<VotePartDescriptions vote={vote} language={language} grouped/>}
    {amendmentPage&&<VoteAmendmentText key={decisionId+':'+language} vote={vote} language={language}/>}
    {named&&<div className="split">
      {planState.error&&!plan?<NoChart/>:plan?<Suspense fallback={<figure className="seats"><div className="stage stage-empty"/></figure>}><VoteArc voters={rows} order={seatOrder} word={centre.word} small={centre.small} smallLanguage={centre.smallLanguage} noRecord={data.noRecord?data.noRecord.ids.length:null} picked={picked} onPick={setPicked} dimmedGroup={dimmed} language={language} onMember={onMember?(id:number)=>onMember(id):undefined} positionWord={words}/></Suspense>:<figure className="seats"><div className="stage stage-empty"/></figure>}
      <GroupTable rows={rows} order={tableOrder} totals={totals} official={vote.totals} onDim={setDimmed}/>
      <FindMember people={people} language={language} onFound={setPicked}/>
    </div>}
    {!named&&totals&&<TotalsFigures totals={totals} label={<UiMessage id="votepage.votes_cast" values={{count:totals.total}} counts={{count:totals.total}}/>}/>}
    {data.integrity==='partial'&&named&&<p className="note"><UiMessage id="legislation.the_named_voter_list_differs_from_parliament_s_published_totals.d739ef"/></p>}
    {conflicting&&<p className="note"><UiMessage id="legislation.individual_votes_unavailable.ca5dc2"/></p>}
    <div className="frows">
      {differing.length>0&&<FoldRow title={<UiMessage id="votepage.differs"/>} value={<UiMessage id="votepage.meps" values={{count:differIds.size}} counts={{count:differIds.size}}/>}><DifferBlock entries={differing} language={language}/></FoldRow>}
      {named&&<FoldRow id="members" title={<UiMessage id="votepage.members"/>} value={rows.length} open={membersOpen} onOpenChange={setMembersOpen}>
        {(activeCountry||filter.group)&&<p className="chip"><button type="button" className="word" onClick={clearFilter}>{filter.group&&<><span lang={groupLabelLanguage(filter.group,ui)}>{groupName(filter.group,ui)}</span>{activeCountry?' · ':''}</>}{activeCountry&&<UiMessage id="legislation.meps_elected_in_countryname.9c4b7d" values={{country:<span lang={language}>{countryName(activeCountry,language)}</span>}}/>}</button></p>}
        <PeopleBlock entries={memberEntries} language={language}/>
      </FoldRow>}
      {named&&<FoldRow title={<UiMessage id="votepage.countries"/>} value={new Set(rows.flatMap(row=>row.country?[filterCountry(row.country)]:[])).size}>
        <Suspense fallback={<p role="status"><UiMessage id="insightshared.loading"/></p>}><VoteCountries rows={rows} language={language} country={filter.country} group={filter.group} position={filter.position} onChoose={chooseCountry}/></Suspense>
        {breaks.length>0&&<><h3 className="breaks"><UiMessage id="votegroups.delegations.heading"/></h3><ul className="break-list">{breaks.map(row=><li key={row.group+row.country}><UiMessage id="votegroups.delegation.row" values={{country:countryName(row.country,language),group:groupLabel(row.group,ui),for:row.for,against:row.against,restFor:row.restFor,restAgainst:row.restAgainst}}/></li>)}</ul></>}
      </FoldRow>}
      {count>1&&<FoldRow id="votes" title={<UiMessage id="votepage.votes_fold"/>} value={count} open={votesOpen??hands} onOpenChange={setVotesOpen}><ItemVotes votes={siblings} current={decisionId} mainVoteId={mainVoteId} language={language}/></FoldRow>}
      {referenceDossier&&<FoldRow title={<UiMessage id="votepage.the_file"/>} value={referenceDossier.reference}><Suspense fallback={<p role="status"><UiMessage id="insightshared.loading"/></p>}><DossierStatus reference={referenceDossier.reference} language={language}/></Suspense></FoldRow>}
      {corrections.length>0&&<FoldRow title={<UiMessage id="votepage.corrections"/>} value={corrections.length}><div className="people">{votePositionKeys.map(position=>{const list=corrections.filter(row=>row.position===position);return list.length?<p key={position}><VoteMark position={position}/><b>{words(position)} {list.length}:</b> {list.map((row,index)=><span key={row.id}>{index?', ':''}<a href={insightMemberHref(row.id,language)} lang="">{row.name||ui.t('insightshared.mep')}</a></span>)}</p>:null;})}</div></FoldRow>}
      {subject?.debates.map(debate=><FoldLink key={debate.id} title={<UiMessage id="votepage.debate"/>} value={debate.start?<UiMessage id="votepage.date_time" values={{date:shortDate(debate.date,language),time:clockTime(debate.start,language)}}/>:shortDate(debate.date,language)} href={debate.agendaItemId?agendaItemHref(debate.agendaItemId,language):sittingHref(debate.id.slice(0,17),language)} onClick={dossierLinkClick}/>)}
      {documents.length>0&&<FoldRow title={<UiMessage id="votepage.documents"/>} value={documents.length}><ul className="refs">{documents.map(id=><li key={id}>{readableDocument(id)?<a href={publicUrl(readHref({documentId:id,language}))} onClick={dossierLinkClick}>{documentReferenceLabel(id)}</a>:id}</li>)}</ul></FoldRow>}
    </div>
  </>);
}
