import {RecordMemberAffiliation} from './components/RecordMemberAffiliation';
import {Fragment,lazy,Suspense,useEffect,useRef,useState} from 'react';
import {sourcePageUrl} from './SourceLink';
import {api} from './data';
const AmendmentCard=lazy(()=>import('./Amendments').then(module=>({default:module.AmendmentCard})));
import {InsightSpeechReader} from './InsightReaders';
import {Position,Result} from './MemberVoteSummary';
import {PersonName,usePersonName} from './PersonName';
import {humanDate,insightMemberHref,roleName} from './InsightShared';
import {memberVoteLabel} from './memberVotesPresentation.mjs';
import {useExplorerParam} from './explorerUrl';
import {dossierEmptyLabel,dossierVoteCards,dossierFilters,dossierHref,dossierTimeline,fullDossierReference,mergeDossierPage,retainDossierContributors,validDossierPerson} from './dossierActivityModel.mjs';
import {dossierBackHref,dossierLinkClick,navigateDossier,useDossierReaderState} from './dossierJourney';
import type {DossierActivityResponse,DossierAmendment,DossierCoverage,DossierCursor,DossierFilter,DossierItem,DossierReference,DossierReferencesResponse,DossierRole,DossierSection,DossierSource,DossierSpeech,DossierVote} from './DossierActivityTypes';
import {useInsightData} from './InsightData';
import './DossierActivity.css';

const voteAnchor=(id:string)=>'dossier-decision-'+encodeURIComponent(id);
const stageLabel=(value:string)=>({RDG1:'First reading',RDG2:'Second reading',RDG3:'Third reading'} as Record<string,string>)[value]||value;
const labels:Record<DossierFilter,string>={all:'All',roles:'Roles',speeches:'Speeches',amendments:'Amendments',votes:'Votes'};
type SectionState={data:DossierActivityResponse|null;loading:boolean;error:string|null};
function useDossierSection(reference:string,person:string|null,section:DossierSection,language:string,active:boolean) {
  const [state,setState]=useState<SectionState>({data:null,loading:active,error:null});
  const [request,setRequest]=useState<{key?:string;cursor:DossierCursor;attempt:number}>({cursor:{offset:0,targetOffset:0},attempt:0});
  const key=JSON.stringify([reference,person,section,language]),scope=useRef(key),lastCursor=useRef<DossierCursor>({offset:0,targetOffset:0});
  const previous=useRef<DossierActivityResponse|null>(null);
  const pages=useRef(new Map<string,DossierActivityResponse>()),failedCursor=useRef<DossierCursor|null>(null);
  // Render fences prevent a new person from seeing the previous person's rows.
  const scoped=scope.current===key;
  useEffect(()=>{
    if(!active)return;
    const changed=scope.current!==key;scope.current=key;
    if(changed){previous.current=null;pages.current.clear();failedCursor.current=null;lastCursor.current={offset:0,targetOffset:0};}
    const cursor=changed||request.key!==key?{offset:0,targetOffset:0}:request.cursor;lastCursor.current=cursor;
    let live=true;const controller=new AbortController();
    setState({data:previous.current,loading:true,error:null});
    const query=new URLSearchParams({reference,lang:language,section,offset:String(cursor.offset),'target-offset':String(cursor.targetOffset),limit:'25'});if(person)query.set('member',person);
    api<DossierActivityResponse>('insights/dossier-activity?'+query,controller.signal).then(page=>{
      if(!live)return;
      if(page.version!==6||page.procedure?.reference!==reference||page.memberId!==person||page.section!==section||!Array.isArray(page.items)||!page.coverage||!page.pagination)throw new Error('Unexpected dossier response.');
      if(previous.current&&(previous.current.generation!==page.generation||previous.current.amendmentGeneration!==page.amendmentGeneration)){
        pages.current.clear();
        if(cursor.offset||cursor.targetOffset)page={...page,coverage:{...page.coverage,status:'partial',gaps:[...page.coverage.gaps,'This dossier was updated. Reopen it to load earlier pages.']}};
      }
      const pageKey=JSON.stringify(cursor);page=retainDossierContributors(pages.current.get(pageKey),page);
      pages.current.set(pageKey,page);failedCursor.current=null;
      const ordered=[...pages.current.values()].sort((a,b)=>a.pagination.targetOffset-b.pagination.targetOffset||a.pagination.offset-b.pagination.offset);
      const data=ordered.reduce<DossierActivityResponse|null>((all,page)=>mergeDossierPage(all,page),null)!;
      previous.current=data;setState({data,loading:false,error:null});
    }).catch(error=>{if(live){failedCursor.current=cursor;setState({data:previous.current,loading:false,error:error.message||'Section unavailable.'});}});
    return()=>{live=false;controller.abort();};
  },[key,active,request]);
  const unavailable=[...pages.current.values()].find(page=>page.participantCoverage?.retryable||page.participantCoverage?.status==='unavailable')||[...pages.current.values()].find(page=>page.coverage.retryable||page.coverage.status==='unavailable');
  return {...(scoped?state:{data:null,loading:active,error:null}),pages:[...pages.current.values()],retryableUnavailable:Boolean(unavailable),retry:()=>setRequest(value=>({key,cursor:failedCursor.current||(unavailable?{offset:unavailable.pagination.offset,targetOffset:unavailable.pagination.targetOffset}:lastCursor.current),attempt:value.attempt+1})),more:()=>{if(state.data?.pagination.next&&!state.loading)setRequest(value=>({key,cursor:state.data!.pagination.next!,attempt:value.attempt+1}));}};
}

function Source({source,language,label='Source'}:{source:DossierSource;id?:string;language:string;label?:string}) {
  const href=sourcePageUrl(source.url,{language:source.language||language});
  return href?<a className="dossier-source" href={href} target="_blank" rel="noreferrer">{label} ↗</a>:null;
}
function Coverage({coverage,section,pages}:{coverage:DossierCoverage;section:DossierSection|'people';language:string;pages:DossierActivityResponse[]}) {
  const targets=new Map<string,DossierActivityResponse>();for(const page of pages)if(page.checkedTarget)targets.set(page.checkedTarget,mergeDossierPage(targets.get(page.checkedTarget)||null,page));
  // Gaps stay attributed to the exact target whose read failed.
  const gaps=targets.size?[...targets.entries()].flatMap(([target,page])=>page.coverage.gaps.map(gap=>target+' · '+gap)):coverage.gaps;
  const discovery=coverage.discovery,discoveryGap=Boolean(discovery&&(discovery.pending||discovery.refreshGaps||discovery.capacityGaps.length));
  if(coverage.status==='complete'&&!gaps.length&&!discoveryGap)return null;
  return <div className="dossier-coverage"><p>{section==='people'?'People':labels[section]} · {coverage.status==='unavailable'?'Records unavailable':coverage.status==='partial'||gaps.length?'Partial coverage':discovery?.pending?'Still checking for more amendments':discovery?.refreshGaps?'Some amendment sources unavailable':'Partial coverage'}</p></div>;
}
function Role({item,language}:{item:DossierRole;language:string}) {
  return <article className="dossier-role"><h4>{roleName(item.role)}</h4>{(item.committee||item.stage)&&<p>{[item.committee,item.stage?stageLabel(item.stage):''].filter(Boolean).join(' · ')}</p>}{(item.date||item.documentId)&&<p>{item.date&&<>{item.dateBasis==='document'?'Document date':'Date'}: <time lang={language}>{humanDate(item.date,language)}</time></>}{item.documentId?(item.date?' · ':'')+item.documentId:''}</p>}<Source source={item.source} id={item.participationId||item.id} language={language}/></article>;
}
function Ballot({item,language,memberName}:{item:DossierVote;language:string;memberName:string}) {
  return <article className="dossier-vote" id={voteAnchor(item.id)} data-dossier-vote={item.id}><p className="dossier-muted">Plenary decision{item.date&&<> · <time dateTime={item.date} lang={language}>{humanDate(item.date,language)}</time></>}{item.stage?' · '+stageLabel(item.stage):''}</p><h4>{memberVoteLabel(item.vote,language)}</h4>{item.vote.title&&<p lang={item.vote.titleLanguage??''}>{item.vote.title}</p>}<div className="dossier-ballot"><Position vote={item.vote} memberName={memberName}/><Result vote={item.vote}/></div>{item.vote.intention?.status==='reported'&&<p className="dossier-muted">Declared intention: {item.vote.intention.positions.map(position=>({for:'For',against:'Against',abstaining:'Abstain'}[position])).join(', ')}.</p>}<Source source={item.source} language={language} label="Vote"/></article>;
}
function Amendment({item,votes,shared,showOutcome,unloaded,votesPending,onMoreVotes,language,memberName}:{item:DossierAmendment;votes:DossierVote[];shared:DossierVote[];showOutcome:boolean;unloaded:boolean;votesPending:boolean;onMoreVotes?:()=>void;language:string;memberName:string}) {
  return <div className="dossier-amendment">{(item.tabling.status==='recorded'&&item.tabling.date||item.tabling.status==='conflicting'||item.stage)&&<p className="dossier-muted">{[item.tabling.status==='recorded'&&item.tabling.date?<>Tabled <time dateTime={item.tabling.date} lang={language}>{humanDate(item.tabling.date,language)}</time></>:item.tabling.status==='conflicting'?'Conflicting tabling dates':null,item.stage?stageLabel(item.stage):null].filter(Boolean).map((part,index)=><Fragment key={index}>{index?' · ':''}{part}</Fragment>)}</p>}{item.tabling.observations.length>0&&<details><summary>Recorded tabling dates</summary>{item.tabling.observations.map(observation=><div key={observation.id}><p>{[observation.date?<time lang={language}>{humanDate(observation.date,language)}</time>:null,observation.stage?stageLabel(observation.stage):null].filter(Boolean).map((part,index)=><Fragment key={index}>{index?' · ':''}{part}</Fragment>)}</p><Source source={observation.source} id={observation.id} language={language}/></div>)}</details>}<AmendmentCard item={item.amendment} showOutcome={showOutcome} language={language} onMember={id=>{navigateDossier(insightMemberHref(String(id),language));}}/>{votes.length>0&&<section aria-label="Recorded votes on this amendment">{votes.map(vote=><Ballot key={vote.id} item={vote} language={language} memberName={memberName}/>)}</section>}<>{unloaded&&votesPending&&<p className="dossier-muted">Vote details not loaded.{onMoreVotes&&<> <button type="button" onClick={onMoreVotes}>Check more votes</button></>}</p>}{shared.map(vote=><p key={vote.id} className="dossier-muted">Shared decision: <a href={'#'+voteAnchor(vote.id)} onClick={event=>{event.preventDefault();const target=document.getElementById(voteAnchor(vote.id));if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});}}}>View the vote</a></p>)}</><Source source={item.source} language={language} label="Amendment"/></div>;
}

function Speech({item,language}:{item:DossierSpeech;language:string}) {
  const [open,setOpen]=useDossierReaderState('dossier-speech:'+item.id,false);
  return <article className="dossier-speech"><h4 lang={item.titleLanguage??''}>{item.title||'Speech'}</h4>{item.jointDebate&&<p className="dossier-muted">Joint debate</p>}<details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>Read speech</summary>{open&&<InsightSpeechReader id={item.id} language={language}/>}</details></article>;
}

export function DossierActivity({reference,language='en',onProcedure}:{reference:string;language?:string;onProcedure?:(procedure:DossierReference)=>void}) {
  const [rawPerson]=useExplorerParam<string|null>('dossier-person',null),[filter]=useExplorerParam<DossierFilter>('dossier-show','all',dossierFilters);
  const person=validDossierPerson(rawPerson)?rawPerson:null,displayName=usePersonName();
  const roles=useDossierSection(reference,person,'roles',language,true);
  useEffect(()=>{if(roles.data?.procedure)onProcedure?.(roles.data.procedure);},[roles.data?.procedure,onProcedure]);
  const speeches=useDossierSection(reference,person,'speeches',language,Boolean(person)&&(filter==='all'||filter==='speeches'));
  const amendments=useDossierSection(reference,person,'amendments',language,Boolean(person)&&(filter==='all'||filter==='amendments'));
  const votes=useDossierSection(reference,person,'votes',language,Boolean(person)&&['all','amendments','votes'].includes(filter));
  const states={roles,speeches,amendments,votes};
  const participants=roles.data?.participants||[],selected=participants.find(row=>row.id===person),memberName=person?displayName(person,selected?.name)||'Selected person':'';
  const visibleSections=(person?(filter==='all'?['roles','speeches','amendments','votes']:filter==='amendments'?['amendments','votes']:[filter]):['roles']) as DossierSection[];
  const nonVotes:DossierItem[]=person?(['roles','speeches','amendments'] as const).filter(section=>filter==='all'||filter===section).flatMap(section=>states[section].data?.items||[]):[];
  const documentRoles=nonVotes.filter((row):row is DossierRole=>row.kind==='role'&&row.dateBasis==='document');
  const voteRows=(votes.data?.items||[]).filter((row):row is DossierVote=>row.kind==='vote');
  const visibleAmendments=nonVotes.filter((row):row is DossierAmendment=>row.kind==='amendment');
  const inlineVotes=dossierVoteCards(visibleAmendments,voteRows);
  const renderedVotes=new Set([...inlineVotes.values()].flatMap(group=>group.votes.map(row=>row.id)));
  const remaining=filter==='votes'?voteRows:filter==='all'?voteRows.filter(row=>!renderedVotes.has(row.id)):[];
  const sittings=new Map<string,DossierVote[]>();for(const row of remaining){const key=row.vote.sittingId;const group=sittings.get(key)||[];group.push(row);sittings.set(key,group);}
  const back=dossierBackHref();
  return <section className="dossier-activity" lang="en" data-dossier-reference={reference} data-dossier-person={person||''} data-dossier-pending={roles.loading||visibleSections.some(section=>states[section].loading)?'true':undefined}>
    {back&&<a className="dossier-back" href={back} onClick={dossierLinkClick}>← Back to where you were</a>}
    {rawPerson&&!person&&<p role="alert">Person not found. Choose a participant.</p>}
    <div className="dossier-scope"><h3>{person?'Work on this dossier':'People on this dossier'}</h3>{person&&<><span className="dossier-person-chip"><a href={insightMemberHref(person,language)} onClick={dossierLinkClick}><PersonName id={person} label={selected?.name} fallback={'Person '+person}/></a><RecordMemberAffiliation id={person} language={language}/><a href={dossierHref(reference,null,language)} onClick={dossierLinkClick} aria-label="Clear person selection">×</a></span><div className="dossier-exits"><a href={dossierHref(reference,null,language)} onClick={dossierLinkClick}>Full dossier</a><a href={insightMemberHref(person,language)} onClick={dossierLinkClick}>Member profile</a></div></>}</div>
    {person&&<nav className="dossier-filters" aria-label="Dossier activity type">{dossierFilters.map(value=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>{const url=new URL(location.href);value==='all'?url.searchParams.delete('dossier-show'):url.searchParams.set('dossier-show',value);navigateDossier(url.href);}}>{labels[value]} <small>{value==='all'?'':states[value].data?.items.length&&states[value].data!.coverage.status!=='unavailable'?states[value].data!.items.length+' shown':'—'}</small></button>)}</nav>}

    {!visibleSections.includes('roles')&&roles.error&&<p role="alert">Participant records could not be loaded. <button type="button" disabled={roles.loading} onClick={roles.retry}>Retry participants</button></p>}
    {!person&&roles.data?.participantCoverage&&<Coverage coverage={roles.data.participantCoverage} section="people" language={language} pages={[]}/>}
    {!person&&roles.data&&!roles.loading&&!participants.length&&<p>{dossierEmptyLabel(roles.data.participantCoverage||roles.data.coverage)}</p>}
    {participants.length>0&&<details className="dossier-participants" open={!person}><summary>People · {participants.length} shown</summary><ul>{participants.map(participant=><li key={participant.id}><a href={insightMemberHref(participant.id,language)} onClick={dossierLinkClick}><PersonName id={participant.id} label={participant.name} fallback={'Person '+participant.id}/></a><RecordMemberAffiliation id={participant.id} language={language}/><ul>{participant.roles.map(role=><li key={role.id}>{roleName(role.role)}{role.committee?' · '+role.committee:''}{role.date?' · '+humanDate(role.date,language):''}{role.dateBasis==='document'?' · document date':''}{role.stage?' · '+stageLabel(role.stage):''}<Source source={role.source} id={role.id} language={language}/></li>)}</ul>{Boolean(participant.speeches?.length)&&<p className="dossier-muted">Speeches · {participant.speeches!.length} shown</p>}<a href={dossierHref(reference,participant.id,language)} onClick={dossierLinkClick}>Work on this dossier</a></li>)}</ul></details>}
    {person&&<>{documentRoles.length>0&&<section className="dossier-document-roles"><h4>Roles recorded on documents</h4>{documentRoles.map(item=><Role key={item.id} item={item} language={language}/>)}</section>}<ol className="dossier-timeline">{dossierTimeline(nonVotes).map(group=><li key={group.id}><p className="dossier-event-date">{group.date?<time lang={language}>{humanDate(group.date,language)}</time>:'Date unavailable'}</p>{group.items.map(item=>item.kind==='role'?<Role key={item.id} item={item} language={language}/>:item.kind==='speech'?<Speech key={item.id} item={item} language={language}/>:item.kind==='amendment'?<Amendment key={item.id} item={item} votes={inlineVotes.get(item.id)?.votes||[]} shared={inlineVotes.get(item.id)?.shared||[]} showOutcome={inlineVotes.get(item.id)?.showOutcome??true} unloaded={Boolean(inlineVotes.get(item.id)?.unloaded)} votesPending={Boolean(votes.loading||votes.error||votes.data?.pagination.next)} onMoreVotes={votes.data?.pagination.next&&!votes.loading?votes.more:undefined} language={language} memberName={memberName}/>:null)}</li>)}</ol>
      {[...sittings.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([id,rows])=><section className="dossier-sitting" key={id}><h4>{filter==='all'?'Other votes':'Votes'} · <time lang={language}>{humanDate(rows[0].date||'',language)}</time></h4><p className="dossier-muted">{id}</p>{rows.map(row=><Ballot key={row.id} item={row} language={language} memberName={memberName}/>)}</section>)}
      {visibleSections.every(section=>states[section].data&&!states[section].loading&&!states[section].error)&&!nonVotes.length&&!remaining.length&&filter!=='amendments'&&<p>{visibleSections.every(section=>dossierEmptyLabel(states[section].data!.coverage)==='No linked records.')?'No linked records.':visibleSections.every(section=>states[section].data!.coverage.status==='unavailable')?'Records unavailable.':'No records available yet.'}</p>}
      {filter==='amendments'&&amendments.data&&!amendments.loading&&!visibleAmendments.length&&<p>{dossierEmptyLabel(amendments.data.coverage)==='No linked records.'?'No linked amendments.':dossierEmptyLabel(amendments.data.coverage)}</p>}
    </>}
    <div className="dossier-section-status">{visibleSections.map(section=>{const state=states[section];return <section key={section} aria-label={labels[section]+' coverage'}>{state.data&&<Coverage coverage={state.data.coverage} section={section} language={language} pages={state.pages}/>} {state.loading&&<p role="status">Loading {labels[section].toLowerCase()}…</p>}{state.error&&<p role="alert">{labels[section]} could not be loaded. <button type="button" disabled={state.loading} onClick={state.retry}>Retry {!person?'people':labels[section].toLowerCase()}</button></p>}{!state.error&&state.retryableUnavailable&&<button type="button" disabled={state.loading} onClick={state.retry}>Retry {!person?'people':labels[section].toLowerCase()}</button>}{state.data?.pagination.next&&<button type="button" disabled={state.loading} onClick={state.more}>Load more {!person?'people':labels[section].toLowerCase()}</button>}</section>;})}</div>
  </section>;
}

export function DossierWorkLinks({references,person,language='en'}:{references:Pick<DossierReference,'id'|'reference'>[];person:string|number;language?:string}) {
  const exact=references.filter(row=>fullDossierReference(row.reference));
  if(!exact.length)return null;
  const link=(row:typeof exact[number])=><a key={row.reference} href={dossierHref(row.reference,person,language)} onClick={dossierLinkClick}>Work on this dossier{exact.length>1?' · '+row.reference:''}</a>;
  return <div className="dossier-work-links">{exact.length===1?link(exact[0]):<details><summary>Work on this dossier · choose a procedure</summary>{exact.map(link)}</details>}</div>;
}
export function ActivityDossierLinks({procedureIds,person,language='en'}:{procedureIds?:string[];person:string|number;language?:string}) {
  const ids=[...new Set((procedureIds||[]).filter(id=>/^\d{4}-\d{4}[A-Z]?$/.test(id)))];
  // Resolver accepts at most three exact IDs; remaining IDs stay explicit.
  const query=new URLSearchParams({procedures:ids.slice(0,3).join(','),lang:language});
  const state=useInsightData<DossierReferencesResponse>(ids.length?'insights/dossier-references?'+query:null);
  if(!ids.length)return null;
  return <div className="dossier-work-links">{state.data&&<DossierWorkLinks references={state.data.items.filter(row=>ids.includes(row.id))} person={person} language={language}/>} {state.loading&&<p role="status">Finding dossier references…</p>}{state.error&&<p role="alert">Dossier references unavailable. <button type="button" onClick={state.retry}>Retry dossier links</button></p>}{state.data?.coverage.status!=='complete'&&state.data&&<p className="dossier-muted">Some dossier references unavailable</p>}{ids.length>3&&<p className="dossier-muted">First 3 of {ids.length} procedures shown.</p>}</div>;
}
