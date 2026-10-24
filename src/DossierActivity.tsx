import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {api} from './data';
const AmendmentCard=lazy(()=>import('./Amendments').then(module=>({default:module.AmendmentCard})));
import {InsightSpeechReader} from './InsightReaders';
import {Position,Result} from './MemberVoteSummary';
import {PersonName,usePersonName} from './PersonName';
import {humanDate,insightMemberHref,roleName} from './InsightShared';
import {memberVoteLabel} from './memberVotesPresentation.mjs';
import {useExplorerParam} from './explorerUrl';
import {dossierVoteCards,dossierFilters,dossierHref,dossierTimeline,fullDossierReference,mergeDossierPage,validDossierPerson} from './dossierActivityModel.mjs';
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
  const [request,setRequest]=useState<{cursor:DossierCursor;attempt:number}>({cursor:{offset:0,targetOffset:0},attempt:0});
  const key=JSON.stringify([reference,person,section,language]),scope=useRef(key),lastCursor=useRef<DossierCursor>({offset:0,targetOffset:0});
  const previous=useRef<DossierActivityResponse|null>(null);
  const pages=useRef(new Map<string,DossierActivityResponse>()),failedCursor=useRef<DossierCursor|null>(null);
  // Render fences prevent a new person from seeing the previous person's rows.
  const scoped=scope.current===key;
  useEffect(()=>{
    if(!active)return;
    const changed=scope.current!==key;scope.current=key;
    if(changed){previous.current=null;pages.current.clear();failedCursor.current=null;lastCursor.current={offset:0,targetOffset:0};}
    const cursor=changed?{offset:0,targetOffset:0}:request.cursor;lastCursor.current=cursor;
    let live=true;const controller=new AbortController();
    setState({data:previous.current,loading:true,error:null});
    const query=new URLSearchParams({reference,lang:language,section,offset:String(cursor.offset),'target-offset':String(cursor.targetOffset),limit:'25'});if(person)query.set('member',person);
    api<DossierActivityResponse>('insights/dossier-activity?'+query,controller.signal).then(page=>{
      if(!live)return;
      if(page.version!==1||page.procedure?.reference!==reference||page.memberId!==person||page.section!==section||!Array.isArray(page.items)||!page.coverage||!page.pagination)throw new Error('Unexpected dossier response.');
      if(previous.current&&(previous.current.generation!==page.generation||previous.current.amendmentGeneration!==page.amendmentGeneration)){
        pages.current.clear();
        if(cursor.offset||cursor.targetOffset)page={...page,coverage:{...page.coverage,status:'partial',gaps:[...page.coverage.gaps,'Saved records changed. Reopen this dossier to reload earlier pages.']}};
      }
      pages.current.set(JSON.stringify(cursor),page);failedCursor.current=null;
      const ordered=[...pages.current.values()].sort((a,b)=>a.pagination.targetOffset-b.pagination.targetOffset||a.pagination.offset-b.pagination.offset);
      const data=ordered.reduce<DossierActivityResponse|null>((all,page)=>mergeDossierPage(all,page),null)!;
      previous.current=data;setState({data,loading:false,error:null});
    }).catch(error=>{if(live){failedCursor.current=cursor;setState({data:previous.current,loading:false,error:error.message||'Section unavailable.'});}});
    return()=>{live=false;controller.abort();};
  },[key,active,request]);
  const unavailable=[...pages.current.values()].find(page=>page.coverage.status==='unavailable');
  return {...(scoped?state:{data:null,loading:active,error:null}),pages:[...pages.current.values()],retryableUnavailable:Boolean(unavailable),retry:()=>setRequest(value=>({cursor:failedCursor.current||(unavailable?{offset:unavailable.pagination.offset,targetOffset:unavailable.pagination.targetOffset}:lastCursor.current),attempt:value.attempt+1})),more:()=>{if(state.data?.pagination.next&&!state.loading)setRequest(value=>({cursor:state.data!.pagination.next!,attempt:value.attempt+1}));}};
}

function Source({source,id,language}:{source:DossierSource;id?:string;language:string}) {
  return <details className="dossier-source"><summary>Source details</summary>{id&&<p lang="">{id}</p>}<a href={source.url} target="_blank" rel="noreferrer">Official source ↗</a><p>{source.fetchedAt?<>Retrieved <time lang={language} dateTime={source.fetchedAt} title={source.fetchedAt}>{humanDate(source.fetchedAt,language)}</time></>:'Retrieval date unavailable'} · {source.language?<span lang="">{source.language.toUpperCase()}</span>:'Language unspecified'}</p>{source.stale&&<p>Saved source; refresh pending.</p>}{source.refreshError&&<p>Source refresh failed. Saved records remain shown.</p>}</details>;
}
function Coverage({coverage,section,language,pages}:{coverage:DossierCoverage;section:DossierSection;language:string;pages:DossierActivityResponse[]}) {
  const targets=new Map<string,DossierActivityResponse>();for(const page of pages)if(page.checkedTarget)targets.set(page.checkedTarget,mergeDossierPage(targets.get(page.checkedTarget)||null,page));
  return <div className="dossier-coverage"><p>{labels[section]} · {coverage.status==='complete'?'Available linked records':coverage.status==='partial'?'Partial coverage':'Records unavailable'}</p>{(coverage.gaps.length>0||coverage.sources.length>0||targets.size>0)&&<details><summary>Coverage and sources</summary>{targets.size>0?<ul>{[...targets.entries()].map(([target,page])=><li key={target}><span lang="">{target}</span> · {page.coverage.status==='complete'?'checked source records':page.coverage.status==='partial'?'partially checked':'unavailable'}{page.coverage.gaps.length>0&&<ul>{page.coverage.gaps.map(gap=><li key={gap}>{gap}</li>)}</ul>}</li>)}</ul>:coverage.gaps.length>0&&<ul>{coverage.gaps.map(gap=><li key={gap}>{gap}</li>)}</ul>}{coverage.discovery&&(coverage.discovery.pending||coverage.discovery.refreshGaps||coverage.discovery.capacityGaps.length>0)&&<details><summary>Broader amendment discovery</summary>{coverage.discovery.pending&&<p>Other amendment sources are still being checked.</p>}{coverage.discovery.refreshGaps&&<p>Some other source reads failed.</p>}{coverage.discovery.capacityGaps.map(gap=><p key={gap}>{gap}</p>)}</details>}{coverage.sources.map((source,index)=><Source key={source.url+':'+index} source={source} language={language}/>)}</details>}</div>;
}
function Role({item,language}:{item:DossierRole;language:string}) {
  return <article className="dossier-role"><h4>{roleName(item.role)}</h4><p>{item.committee||'Committee not supplied'}{item.stage?' · '+stageLabel(item.stage):''}</p><p>{item.dateBasis==='document'?'Document date':'Recorded date'}: {item.date?<time lang={language}>{humanDate(item.date,language)}</time>:'unavailable'}{item.documentId?' · '+item.documentId:''}</p>{item.dateBasis==='document'&&<p className="dossier-muted">Role recorded on this document; appointment date unavailable.</p>}<Source source={item.source} id={item.participationId||item.id} language={language}/></article>;
}
function Ballot({item,language,memberName}:{item:DossierVote;language:string;memberName:string}) {
  return <article className="dossier-vote" id={voteAnchor(item.id)} data-dossier-vote={item.id}><p className="dossier-muted">Plenary decision · {item.date?<time dateTime={item.date} lang={language}>{humanDate(item.date,language)}</time>:'Date unavailable'} · {item.stage?stageLabel(item.stage):'Stage not stated'}</p><h4>{memberVoteLabel(item.vote,language)}</h4>{item.vote.title&&<p lang={item.vote.titleLanguage??''}>{item.vote.title}</p>}<div className="dossier-ballot"><Position vote={item.vote} memberName={memberName}/><Result vote={item.vote}/></div>{item.vote.intention?.status==='reported'&&<p className="dossier-muted">Declared intention: {item.vote.intention.positions.map(position=>({for:'For',against:'Against',abstaining:'Abstain'}[position])).join(', ')}.</p>}<Source source={item.source} id={item.id} language={language}/></article>;
}
function Amendment({item,votes,shared,language,memberName}:{item:DossierAmendment;votes:DossierVote[];shared:DossierVote[];language:string;memberName:string}) {
  return <div className="dossier-amendment"><p className="dossier-muted">{item.tabling.status==='recorded'&&item.tabling.date?<>Tabled <time dateTime={item.tabling.date} lang={language}>{humanDate(item.tabling.date,language)}</time></>:item.tabling.status==='conflicting'?'Conflicting tabling dates':'Tabling date unavailable'}{item.stage?' · '+stageLabel(item.stage):''}</p>{item.tabling.observations.length>0&&<details><summary>Recorded tabling dates</summary>{item.tabling.observations.map(observation=><div key={observation.id}><p>{observation.date?<time lang={language}>{humanDate(observation.date,language)}</time>:'Date unavailable'}{observation.stage?' · '+stageLabel(observation.stage):''}</p><Source source={observation.source} id={observation.id} language={language}/></div>)}</details>}<AmendmentCard item={item.amendment} language={language} onMember={id=>{navigateDossier(insightMemberHref(String(id),language));}}/>{votes.length>0&&<section aria-label="Recorded votes on this amendment">{votes.map(vote=><Ballot key={vote.id} item={vote} language={language} memberName={memberName}/>)}</section>}<>{shared.map(vote=><p key={vote.id} className="dossier-muted">Shared decision: <a href={'#'+voteAnchor(vote.id)} onClick={event=>{event.preventDefault();const target=document.getElementById(voteAnchor(vote.id));if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});}}}>View the vote</a></p>)}</><Source source={item.source} id={item.id} language={language}/></div>;
}

function Speech({item,language}:{item:DossierSpeech;language:string}) {
  const [open,setOpen]=useDossierReaderState('dossier-speech:'+item.id,false);
  return <article className="dossier-speech"><h4 lang={item.titleLanguage??''}>{item.title||'Speech'}</h4>{item.jointDebate&&<p className="dossier-muted">Joint debate · this contribution covers the shared debate.</p>}<details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>Read speech</summary>{open&&<InsightSpeechReader id={item.id} language={language}/>}</details><Source source={item.source} id={item.id} language={language}/></article>;
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
    {rawPerson&&!person&&<p role="alert">Invalid person reference. Choose a recorded participant.</p>}
    <div className="dossier-scope"><h3>{person?'Work on this dossier':'People on this dossier'}</h3>{person&&<><span className="dossier-person-chip"><a href={insightMemberHref(person,language)} onClick={dossierLinkClick}><PersonName id={person} label={selected?.name} fallback={'Person '+person}/></a><a href={dossierHref(reference,null,language)} onClick={dossierLinkClick} aria-label="Clear person selection">×</a></span><div className="dossier-exits"><a href={dossierHref(reference,null,language)} onClick={dossierLinkClick}>Full dossier</a><a href={insightMemberHref(person,language)} onClick={dossierLinkClick}>Member profile</a></div></>}</div>
    {person&&<nav className="dossier-filters" aria-label="Dossier activity type">{dossierFilters.map(value=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>{const url=new URL(location.href);value==='all'?url.searchParams.delete('dossier-show'):url.searchParams.set('dossier-show',value);navigateDossier(url.href);}}>{labels[value]} <small>{value==='all'?'':states[value].data?.items.length&&states[value].data!.coverage.status!=='unavailable'?states[value].data!.items.length+' shown':'—'}</small></button>)}</nav>}
    <p className="dossier-muted">Showing linked public records. Coverage may be incomplete.</p>
    <div className="dossier-section-status">{visibleSections.map(section=>{const state=states[section];return <section key={section} aria-label={labels[section]+' coverage'}>{state.data&&<Coverage coverage={state.data.coverage} section={section} language={language} pages={state.pages}/>} {state.loading&&<p role="status">Loading {labels[section].toLowerCase()}…</p>}{state.error&&<p role="alert">{labels[section]} could not be loaded. <button type="button" disabled={state.loading} onClick={state.retry}>Retry {labels[section].toLowerCase()}</button></p>}{!state.error&&state.retryableUnavailable&&<button type="button" disabled={state.loading} onClick={state.retry}>Retry {labels[section].toLowerCase()}</button>}{state.data?.pagination.next&&<button type="button" disabled={state.loading} onClick={state.more}>Load more {labels[section].toLowerCase()}</button>}</section>;})}</div>
    {!visibleSections.includes('roles')&&roles.error&&<p role="alert">Participant records could not be loaded. <button type="button" disabled={roles.loading} onClick={roles.retry}>Retry participants</button></p>}
    {!person&&roles.data&&!roles.loading&&!participants.length&&<p>No recorded participants in the available source. Check the coverage above.</p>}
    {participants.length>0&&<details className="dossier-participants" open={!person}><summary>Recorded participants · {participants.length} shown</summary><ul>{participants.map(participant=><li key={participant.id}><a href={insightMemberHref(participant.id,language)} onClick={dossierLinkClick}><PersonName id={participant.id} label={participant.name} fallback={'Person '+participant.id}/></a><ul>{participant.roles.map(role=><li key={role.id}>{roleName(role.role)}{role.committee?' · '+role.committee:''}{role.date?' · '+humanDate(role.date,language):''}{role.dateBasis==='document'?' · document date':''}{role.stage?' · '+stageLabel(role.stage):''}<Source source={role.source} id={role.id} language={language}/></li>)}</ul><a href={dossierHref(reference,participant.id,language)} onClick={dossierLinkClick}>Work on this dossier</a></li>)}</ul></details>}
    {person&&<>{documentRoles.length>0&&<section className="dossier-document-roles"><h4>Roles recorded on documents</h4><p className="dossier-muted">Document dates; appointment dates unavailable.</p>{documentRoles.map(item=><Role key={item.id} item={item} language={language}/>)}</section>}<ol className="dossier-timeline">{dossierTimeline(nonVotes).map(group=><li key={group.id}><p className="dossier-event-date">{group.date?<time lang={language}>{humanDate(group.date,language)}</time>:'Date unavailable'}</p>{group.items.map(item=>item.kind==='role'?<Role key={item.id} item={item} language={language}/>:item.kind==='speech'?<Speech key={item.id} item={item} language={language}/>:item.kind==='amendment'?<Amendment key={item.id} item={item} votes={inlineVotes.get(item.id)?.votes||[]} shared={inlineVotes.get(item.id)?.shared||[]} language={language} memberName={memberName}/>:null)}</li>)}</ol>
      {[...sittings.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([id,rows])=><section className="dossier-sitting" key={id}><h4>{filter==='all'?'Other votes':'Votes'} · <time lang={language}>{humanDate(rows[0].date||'',language)}</time></h4><p className="dossier-muted">{id}</p>{rows.map(row=><Ballot key={row.id} item={row} language={language} memberName={memberName}/>)}</section>)}
      {visibleSections.every(section=>states[section].data&&!states[section].loading&&!states[section].error)&&!nonVotes.length&&!remaining.length&&filter!=='amendments'&&<p>No linked records in this selection. Check the section coverage above.</p>}
      {filter==='amendments'&&amendments.data&&!amendments.loading&&!visibleAmendments.length&&<p>No linked amendments in the available records.</p>}
    </>}
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
  return <div className="dossier-work-links">{state.data&&<DossierWorkLinks references={state.data.items.filter(row=>ids.includes(row.id))} person={person} language={language}/>} {state.loading&&<p role="status">Finding dossier references…</p>}{state.error&&<p role="alert">Dossier references unavailable. <button type="button" onClick={state.retry}>Retry dossier links</button></p>}{state.data?.coverage.status!=='complete'&&state.data&&<details><summary>Some dossier references are unavailable</summary><ul>{state.data.coverage.gaps.map((gap,index)=><li key={index}>{typeof gap==='string'?gap:gap.message||gap.code||'Reference unavailable'}{typeof gap==='object'&&gap.id?' · '+gap.id:''}</li>)}</ul></details>}{ids.length>3&&<p className="dossier-muted">Only the first three recorded procedures are resolved here.</p>}</div>;
}
