import {useAutomaticRetry} from './useAutomaticRetry';
import {useSavedReadState,useSavedRecovery} from './SavedControls';
import {YourVotes,useHasSavedVotes} from './YourVotes';
import {dossierLinkClick} from './dossierJourney';
import {interfaceLanguageInUrl} from './interfaceLanguage.mjs';
import {FollowedTopics,useTopics} from './TopicFollowing';
import {uiErrorText} from './uiErrors.mjs';
import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {API_ROOT} from './api';
import type {Directory} from './explorerTypes';
import {Portrait} from './components/Portrait';
import {MemberAffiliation} from './components/MemberAffiliation';
import {DossierCard} from './DossierCard';
import {useDossiers,useDossierChecks,useDossierChecking,dossierStore} from './DossierControls';
import {GroupUpdates,GroupUpdateStatus} from './GroupUpdates';
import {groupEntries} from './followGroups.mjs';
import {groupsStore,useGroups} from './SavedControls';
import {FollowSuggestions} from './FollowSuggestions';
import {MembershipUpdates} from './MembershipUpdates';
import {membershipEntries} from './followMembership.mjs';
import {membershipStore,useMembership,useMembershipCheck} from './SavedControls';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Status} from './Status';
import {savedKey,type SavedItem,type SavedStates} from './bookmarks.mjs';
import {followEntries,isNewEntry,itemHasNew,readTogether,summarizeByType,LIST_LIMIT,NEW_WINDOW_MS,type FollowEntry} from './followUpdates.mjs';
import {humanDate} from './InsightCharts';
import {SaveButton,useSaved,checkSaved,savedStore as store,requestedKeys,useSavedNow,useResolveSavedMembers} from './SavedControls';

function savedCheckMessage(items:SavedItem[],data:SavedStates, ui: import('./uiI18n.mjs').UiFormatter = defaultUi) {
  const unread=items.filter(item=>itemHasNew(item,Date.now())||item.kind==='mep'&&(membershipEntries(membershipStore.snapshot(),item.id,Date.now()).fresh.length>0||groupEntries(groupsStore.snapshot(),item.id,Date.now()).fresh.length>0)).length;
  const unavailable=items.filter(item=>item.availability!=='available'||item.legacy).length;
  const state=store.snapshot();
  if(items.some(item=>item.kind==='mep')&&state.checkState!=='available')return [(state.checkState==='unavailable') ? ui.t("Saved.update_checks_are_not_available_yet_for_meps") : ui.t("Saved.mep_updates_could_not_be_checked")].filter(Boolean).join(' ');
  return [ui.t("Saved.check_finished"),unread ? ui.t("Saved.unreadMany", {count: unread}) : ui.t("dossierCard.state.3"),unavailable ? ui.t("Saved.unavailableMany", {count: unavailable}) : '',(data.coverage?.indexComplete===true) ? '' : ui.t("Saved.some_updates_could_not_be_checked")].filter(Boolean).join(' ');
}
export type FollowingActivityProps={member:number;sourceId:string;profileHref:string;onOpenProfile:()=>void};
type SavedProps={members?:Directory['members'];language:string;onBack:()=>void;onMember:(id:number,sourceId?:string)=>void;renderActivity:(props:FollowingActivityProps)=>ReactNode};
const entryKey=(entry:FollowEntry)=>entry.kind+':'+entry.id;
const cardId=(item:SavedItem)=>savedKey(item)+':'+item.savedAt;
function FollowCard({item,directoryMember,language,onMember,renderActivity,now,retained,openEntry,resolution,retry,checkState,check}:{item:SavedItem;directoryMember?:Directory['members'][number];now:number;retained:FollowEntry[];openEntry:(item:SavedItem,entry:FollowEntry)=>void;resolution:{pending?:boolean;error?:string;failure?:unknown};retry:()=>void;checkState:string;check:()=>void}&Pick<SavedProps,'language'|'onMember'|'renderActivity'>) {
  const ui = useUiI18n();
  const retrying=useAutomaticRetry(JSON.stringify([language,item.kind,item.id,item.savedAt]),resolution.failure,Boolean(resolution.pending),retry);
  const groups=useGroups(),groupsNew=(item.kind==='mep') ? groupEntries(groups,item.id,now).fresh.length : 0;
  const membership=useMembership(),membershipNew=(item.kind==='mep') ? membershipEntries(membership,item.id,now).fresh.length : 0;
  const key=savedKey(item),{fresh,history,historyOmitted}=followEntries(item,now),hasNew=itemHasNew(item,now)||membershipNew>0||groupsNew>0;
  const [open,setOpen]=useState(new Set<string>());
  const member=Number((item.kind==='mep') ? item.id : item.memberId),profileHref='?'+new URLSearchParams({lang:language,member:String(member),module:'activities'});
  const onOpenProfile=()=>onMember(member);
  const rowOrder=useRef(new Map<string,number>());
  for(const entry of item.entries||[])if(!rowOrder.current.has(entryKey(entry)))rowOrder.current.set(entryKey(entry),rowOrder.current.size);
  const pinned=new Set(retained.map(entryKey)),visibleHistory=history.filter(entry=>!pinned.has(entryKey(entry)));
  const listed=[...fresh,...retained.filter(entry=>!fresh.some(other=>entryKey(entry)===entryKey(other)))].sort((a,b)=>b.discoveredAt-a.discoveredAt||b.date.localeCompare(a.date)||(rowOrder.current.get(entryKey(a))??0)-(rowOrder.current.get(entryKey(b))??0));
  const omitted=((item.unreadOmittedAt!==undefined) && (item.unreadOmittedAt+NEW_WINDOW_MS>now)) ? (item.unreadOmitted||0) : 0;
  const summary=fresh.length>LIST_LIMIT||omitted>0;
  const link=(label:string)=><a href={profileHref} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();onOpenProfile();}}>{label}</a>;
  const row=(entry:FollowEntry)=>{
    const id=entryKey(entry),expanded=open.has(id),current=item.entries?.find(value=>entryKey(value)===id)||entry,isNew=isNewEntry(current,now),href=profileHref+'&activity='+encodeURIComponent(entry.id);
    const read=()=>openEntry(item,current);
    return <div className="explorer-saved-entry" key={id}>
      <a className="explorer-saved-disclosure" role="button" href={href} aria-expanded={expanded} onAuxClick={event=>{if(event.button===1)read();}} onKeyDown={event=>{if(event.key===' '){event.preventDefault();event.currentTarget.click();}}} onClick={event=>{
        if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey){read();return;}
        event.preventDefault();if(!expanded)read();setOpen(previous=>{const next=new Set(previous);if(expanded)next.delete(id);else next.add(id);return next;});
      }}><span aria-hidden="true">{expanded ? '▾' : '▸'}</span>{isNew&&<span className="explorer-saved-new"><UiMessage id="groupupdates.tsx.new"/></span>}<span lang={entry.titleLanguage||''}>{entry.title}</span><small>{summarizeByType([entry], undefined, ui).replace(/^1 /,'')} · <span lang={entry.date ? language : 'en'}>{entry.date ? humanDate(entry.date,language) : ui.t("dossieractivity.date_unavailable")}</span></small></a>
      {expanded&&<div className="explorer-saved-detail">{renderActivity({member,sourceId:entry.id,profileHref:href,onOpenProfile:()=>onMember(member,entry.id)})}</div>}
    </div>;
  };
  return <article>
    <div className="explorer-saved-heading">{(item.kind==='mep') ? <><Portrait member={{id:Number(item.id),firstName:'',lastName:'',sortName:'',gender:directoryMember?.gender??null,countryCode:null,imageUrl:`${API_ROOT}/portrait/${item.id}`}}/><div className="explorer-saved-member-heading"><h3 lang={item.titleLanguage||''}>{item.title}</h3><MemberAffiliation group={directoryMember?.groupCode} country={directoryMember?.countryCode} language={language}/></div></> : <h3 lang={item.titleLanguage||''}>{item.title}</h3>}<SaveButton item={item} language={language} compact/></div>
    <div className="explorer-saved-state">{(item.unresolved?.activity||item.unresolved?.answer) ? (resolution.error&&!retrying ? <p role="alert"><UiMessage id="Saved.activityError" values={{error:resolution.error}}/> </p> : <strong className="explorer-update-label"><UiMessage id="Saved.checking_for_new_activity"/></strong>) : (hasNew&&<strong className="explorer-update-label">{((((fresh.length===1) && (membershipNew===0)) && (groupsNew===0)) && (fresh[0].kind==='answer')) ? ui.t("Saved.new_answer") : ((fresh.length+membershipNew+groupsNew) ? ui.t("dossierCard.state.1", {count: String((fresh.length+membershipNew+groupsNew+omitted))}) : (item.legacyUpdated ? ui.t("Saved.updated_before_the_upgrade") : ui.t("Saved.question_details_changed")))}</strong>)}
    {!hasNew&&checkState==='available'&&!item.legacy&&<p>{(item.availability==='available') ? ui.t("dossierCard.state.3") : (item.checkedAt ? ui.t("Saved.update_information_is_unavailable") : '')}</p>}
    </div>
    {item.availability==='outside-roster'&&membership.members[item.id]?.status!=='former'&&<p><UiMessage id="Saved.no_longer_on_the_current_roster"/></p>}
    {item.kind==='question'&&<p>{item.current?.answerIds?.length ? ui.t("Saved.answer_available") : ((item.availability==='available') ? ui.t("Saved.no_answer_yet") : ui.t("Saved.answer_availability_has_not_been_checked"))}</p>}
    
    {!item.indexComplete&&<small><UiMessage id="Saved.some_updates_could_not_be_checked"/></small>}
    <div className="explorer-saved-actions">{(item.kind==='mep'||item.memberId)&&<button onClick={()=>{if(item.kind==='question')store.openQuestion(key);onMember(member,(item.kind==='question') ? item.id : undefined);}}>{(item.kind==='mep') ? ui.t("interface.profile") : (item.current?.answerIds?.length ? ui.t("parliamentsearchresults.read_question_and_answers.d9f136") : ui.t("textsearch.read_question"))}</button>}
    {item.kind==='question'&&item.availability==='not-saved'&&<p><UiMessage id="Saved.details_not_available_yet"/></p>}
    {hasNew&&<button onClick={()=>{store.markRead(key);if(item.kind==='mep'){membershipStore.markRead(item.id);groupsStore.markRead(item.id);}}}><UiMessage id="dossierCard.actions.4"/></button>}</div>
    {item.kind==='mep'&&<GroupUpdates member={item.id} language={language} now={now} onMember={onMember}/>}
    {item.kind==='mep'&&<MembershipUpdates member={item.id} language={language} now={now} onMember={onMember}/>}
    {summary ? <p><>{summarizeByType(fresh,omitted, ui)}. {link(ui.t("Saved.open_the_profile_to_read_them"))}</></p> : ((item.kind==='mep'||item.memberId)&&listed.map(row))}
    {(visibleHistory.length>0||historyOmitted>0)&&<details className="explorer-saved-history"><summary><UiMessage id="dossierCard.history.1" values={{count: (visibleHistory.length+historyOmitted)}}/></summary>{(item.kind==='mep'||item.memberId)&&visibleHistory.map(row)}{historyOmitted>0&&link(ui.t("Saved.see_all_activity_in_the_full_profile"))}</details>}
  </article>;
}
export function Saved({members,language,onBack,onMember,renderActivity}:SavedProps) {
  useSavedRecovery(language);
  const topicFollows=useTopics(),hasVotes=useHasSavedVotes(),readState=useSavedReadState(),recovering=readState.loading||readState.retrying;
  const ui = useUiI18n();
  const membersById=useMemo(()=>new Map(members?.map(member=>[String(member.id),member])),[members]);
  useDossierChecks();
  const dossiers=useDossiers(),dossierChecking=useDossierChecking();
  const membershipCheck=useMembershipCheck(),membership=useMembership(),groups=useGroups(),saved=useSaved(),now=useSavedNow(),resolver=useResolveSavedMembers(language),items=saved.items,[checking,setChecking]=useState(false),[error,setError]=useState('');
  // Before the first manifest, persisted signals still identify unread MEPs.
  const cards=[...items,...dossiers.items].map(item=>({item,hasNew:itemHasNew(((item.kind==='mep') && (!saved.manifest)) ? ({...item,unresolved:{activity:true,answer:true}}) : item,now)||item.kind==='mep'&&(membershipEntries(membership,item.id,now).fresh.length>0||groupEntries(groups,item.id,now).fresh.length>0)}))
    .sort((a,b)=>Number(b.hasNew)-Number(a.hasNew));
  // Prioritise unread cards on entry, then keep this visit's reading order.
  // Reading, expiry and background checks must not move cards under the user.
  const cardOrder=useRef(new Map<string,number>());
  // Rows read through any card stay where they are for this visit.
  const [retained,setRetained]=useState(new Map<string,FollowEntry[]>());
  const openEntry=(owner:SavedItem,entry:FollowEntry)=>{
    const at=Date.now(),next=new Map(retained);
    for(const other of items)for(const row of other.entries||[])if(isNewEntry(row,at)&&readTogether(entry,row)) {
      const kept=next.get(cardId(other))||[];
      if(!kept.some(value=>entryKey(value)===entryKey(row)))next.set(cardId(other),[...kept,{...row,readAt:at}]);
    }
    setRetained(next);store.markEntryRead(savedKey(owner),entry.kind,entry.id);
  };
  const cardKey=(item:typeof cards[number]['item'])=>item.kind+':'+item.id+':'+item.savedAt;
  for(const {item} of cards)if(!cardOrder.current.has(cardKey(item)))cardOrder.current.set(cardKey(item),cardOrder.current.size);
  cards.sort((a,b)=>cardOrder.current.get(cardKey(a.item))!-cardOrder.current.get(cardKey(b.item))!);
  const empty=!items.length&&!dossiers.items.length&&!topicFollows.length&&!hasVotes;
  const href=(path:string,query:Record<string,string>={})=>{const params=new URLSearchParams(interfaceLanguageInUrl(language)?{lang:language,...query}:query).toString();return params?path+'?'+params:path;};
  const emptyLinks=[{id:'Saved.findMep',href:href('/')},{id:'Saved.thisWeeksAgenda',href:href('/',{view:'legislation'})},{id:'Saved.findTopic',href:href('/',{view:'legislation','pl-mode':'topics'})}];
  const key=items.map(item=>savedKey(item)+':'+(item.savedAt??'')).sort().join(','),context=language+':'+key,request=useRef(0),active=useRef(false);
  const [attempt,setAttempt]=useState(0),[completion,setCompletion]=useState<{items:SavedItem[];message:string}|null>(null);
  useEffect(()=>{active.current=true;setChecking(false);setError('');setCompletion(null);return()=>{active.current=false;request.current++;};},[context]);
  const check=()=>{
    if(checking)return;
    const token=++request.current;setAttempt(token);setChecking(true);setError('');setCompletion(null);
    const current=()=>active.current&&request.current===token&&store.snapshot().items.map(item=>savedKey(item)+':'+(item.savedAt??'')).sort().join(',')===key;
    void (async()=>{
      while(current()){
        const checked=checkSaved(language,true, ui),matches=requestedKeys.get(checked)===key;
        try{
          const result=await checked;if(!current())return;
          // A changed follow set already queues its matching refresh in checkSaved.
          // Keep this deliberate attempt attached to that result, including errors.
          if(!matches)continue;
          if(result){const settled=store.snapshot().items;setCompletion({items:settled,message:savedCheckMessage(settled,result.data, ui)});}return;
        }catch(e){if(!current())return;if(!matches)continue;setError(uiErrorText(e,ui));setCompletion({items:store.snapshot().items,message:(store.snapshot().questionCheckState==='available') ? ui.t("Saved.some_updates_could_not_be_checked") : ui.t("Saved.could_not_check_for_updates")});return;}
      }
    })().finally(()=>{if(current())setChecking(false);});
  };
  return <section className="explorer-saved-view" lang={ui.language}>
    <Status scope={`saved-check:${context}:${attempt}`} message={((!dossiers.items.length) && (completion?.items===items)) ? completion.message : null} pending={checking||dossierChecking}/>
    <button className="explorer-saved-back" onClick={onBack}><UiMessage id="document.back"/></button>
    <div className="explorer-saved-heading"><h1><UiMessage id="batch4.dossiercontrols.tsx.64.2"/></h1></div>
    <FollowedTopics/><YourVotes language={language} members={members}/>
    {!saved.persistent&&<p><UiMessage id="Saved.browser_storage_is_unavailable_follows_last_only_for_this_tab"/></p>}
    {saved.storageError&&<p role="alert" className="explorer-storage-error"><UiMessage id="Saved.storageError" values={{time:new Date(saved.unsavedSince||Date.now()).toLocaleTimeString(ui.locale)}}/> </p>}
    {items.some(item=>item.kind==='mep')&&<GroupUpdateStatus retry={check}/>}
    {membership.storageError&&<p role="alert"><UiMessage id="Saved.membership_updates_could_not_be_saved_in_this_browser"/> </p>}
    {items.some(item=>item.kind==='mep')&&membershipCheck==='unavailable'&&<p className="explorer-membership-status"><UiMessage id="Saved.some_membership_updates_are_unavailable"/></p>}
    {items.some(item=>item.kind==='mep')&&membershipCheck==='error'&&!recovering&&<p className="explorer-membership-status" role="alert"><UiMessage id="Saved.couldn_t_check_membership_updates"/> </p>}
    {items.some(item=>item.kind==='mep')&&saved.checkState==='unavailable'&&<p><UiMessage id="Saved.update_checks_are_not_available_yet_for_meps"/> </p>}
    {items.some(item=>item.kind==='mep')&&saved.checkState==='error'&&!recovering&&<p><UiMessage id="Saved.couldn_t_check_for_mep_updates"/> </p>}
    {items.some(item=>item.kind==='question')&&saved.questionCheckState==='error'&&!recovering&&<p><UiMessage id="Saved.couldn_t_check_for_question_answers"/> </p>}
    {error&&!recovering&&membershipCheck!=='error'&&<p>{error}</p>}
    {!dossiers.persistent&&dossiers.items.length>0&&<p><UiMessage id="Saved.dossier_follows_last_only_for_this_tab"/></p>}
    {dossiers.storageError&&<p role="alert"><UiMessage id="Saved.dossier_changes_couldn_t_be_saved_in_this_browser"/> </p>}
    {empty&&<div className="explorer-saved-empty"><p lang={ui.messageLocale('Saved.emptyLead')}><UiMessage id="Saved.emptyLead"/></p>{saved.persistent&&<p lang={ui.messageLocale('Saved.emptyStorage')}><UiMessage id="Saved.emptyStorage"/></p>}<nav className="explorer-saved-empty-links">{emptyLinks.map(({id,href})=><a key={id} href={href} lang={ui.messageLocale(id)} onClick={dossierLinkClick}><UiMessage id={id}/></a>)}</nav></div>}
    <div className="explorer-saved-items">{cards.map(({item})=>(item.kind==='dossier') ? <DossierCard key={'dossier:'+item.id+':'+item.savedAt} item={item} language={language} now={now}/> : <FollowCard key={cardId(item)} item={item} directoryMember={membersById.get(item.id)} language={language} onMember={onMember} renderActivity={renderActivity} now={now} retained={retained.get(cardId(item))||[]} openEntry={openEntry} resolution={resolver.resolution(item)} retry={()=>resolver.retry(item)} checkState={(item.kind==='question') ? saved.questionCheckState : saved.checkState} check={check}/>)}</div>
    <FollowSuggestions language={language}/>
  </section>;
}
