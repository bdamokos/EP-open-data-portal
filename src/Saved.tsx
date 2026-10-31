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
import {followEntries,isNewEntry,itemHasNew,summarizeByType,LIST_LIMIT,NEW_WINDOW_MS,type FollowEntry} from './followUpdates.mjs';
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
function FollowCard({item,directoryMember,language,onMember,renderActivity,now,resolution,retry,checkState,check}:{item:SavedItem;directoryMember?:Directory['members'][number];now:number;resolution:{pending?:boolean;error?:string};retry:()=>void;checkState:string;check:()=>void}&Pick<SavedProps,'language'|'onMember'|'renderActivity'>) {
  const ui = useUiI18n();
  const groups=useGroups(),groupsNew=(item.kind==='mep') ? groupEntries(groups,item.id,now).fresh.length : 0;
  const membership=useMembership(),membershipNew=(item.kind==='mep') ? membershipEntries(membership,item.id,now).fresh.length : 0;
  const key=savedKey(item),{fresh,history,historyOmitted}=followEntries(item,now),hasNew=itemHasNew(item,now)||membershipNew>0||groupsNew>0;
  const [open,setOpen]=useState(new Set<string>()),[retained,setRetained]=useState<FollowEntry[]>([]);
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
    const read=()=>{if(current.readAt===null){if(fresh.some(value=>entryKey(value)===id))setRetained(previous=>previous.some(value=>entryKey(value)===id) ? previous : ([...previous,{...entry,readAt:now}]));store.markEntryRead(key,entry.kind,entry.id);}};
    return <div className="explorer-saved-entry" key={id}>
      <a className="explorer-saved-disclosure" role="button" href={href} aria-expanded={expanded} onAuxClick={event=>{if(event.button===1)read();}} onKeyDown={event=>{if(event.key===' '){event.preventDefault();event.currentTarget.click();}}} onClick={event=>{
        if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey){read();return;}
        event.preventDefault();if(!expanded)read();setOpen(previous=>{const next=new Set(previous);if(expanded)next.delete(id);else next.add(id);return next;});
      }}><span aria-hidden="true">{expanded ? '▾' : '▸'}</span>{isNew&&<span className="explorer-saved-new"><UiMessage id="groupupdates.tsx.new"/></span>}<span lang={entry.titleLanguage||''}>{entry.title}</span><small>{summarizeByType([entry], undefined, ui).replace(/^1 /,'')} · <span lang={entry.date ? language : 'en'}>{entry.date ? humanDate(entry.date,language) : ui.t("dossieractivity.date_unavailable")}</span></small></a>
      {expanded&&<div className="explorer-saved-detail">{renderActivity({member,sourceId:entry.id,profileHref:href,onOpenProfile:()=>onMember(member,entry.id)})}</div>}
    </div>;
  };
  return <article>
    <div className="explorer-saved-heading">{(item.kind==='mep') ? <><Portrait member={{id:Number(item.id),firstName:'',lastName:'',sortName:'',gender:'m',countryCode:null,imageUrl:`${API_ROOT}/portrait/${item.id}`}}/><div className="explorer-saved-member-heading"><h3 lang={item.titleLanguage||''}>{item.title}</h3><MemberAffiliation group={directoryMember?.groupCode} country={directoryMember?.countryCode} language={language}/></div></> : <h3 lang={item.titleLanguage||''}>{item.title}</h3>}<SaveButton item={item} language={language} compact/></div>
    <div className="explorer-saved-state">{(item.unresolved?.activity||item.unresolved?.answer) ? (resolution.error ? <p role="alert"><UiMessage id="Saved.activityError" values={{error:resolution.error}}/> <button onClick={retry}><UiMessage id="textsearch.retry.9f5cd8"/></button></p> : <strong className="explorer-update-label"><UiMessage id="Saved.checking_for_new_activity"/></strong>) : (hasNew&&<strong className="explorer-update-label">{((((fresh.length===1) && (membershipNew===0)) && (groupsNew===0)) && (fresh[0].kind==='answer')) ? ui.t("Saved.new_answer") : ((fresh.length+membershipNew+groupsNew) ? ui.t("dossierCard.state.1", {count: String((fresh.length+membershipNew+groupsNew+omitted))}) : (item.legacyUpdated ? ui.t("Saved.updated_before_the_upgrade") : ui.t("Saved.question_details_changed")))}</strong>)}
    {!hasNew&&checkState==='available'&&!item.legacy&&<p>{(item.availability==='available') ? ui.t("dossierCard.state.3") : (item.checkedAt ? ui.t("Saved.update_information_is_unavailable") : '')}</p>}
    </div>
    {item.availability==='outside-roster'&&membership.members[item.id]?.status!=='former'&&<p><UiMessage id="Saved.no_longer_on_the_current_roster"/></p>}
    {item.kind==='question'&&<p>{item.current?.answerIds?.length ? ui.t("Saved.answer_available") : ((item.availability==='available') ? ui.t("Saved.no_answer_yet") : ui.t("Saved.answer_availability_has_not_been_checked"))}</p>}
    {item.legacy&&<p><UiMessage id="Saved.update_check_pending"/> <button onClick={check}><UiMessage id="textsearch.retry.9f5cd8"/></button></p>}
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
  const ui = useUiI18n();
  const membersById=useMemo(()=>new Map(members?.map(member=>[String(member.id),member])),[members]);
  const checkDossierUpdates=useDossierChecks();
  const dossiers=useDossiers(),dossierChecking=useDossierChecking();
  const membershipCheck=useMembershipCheck(),membership=useMembership(),groups=useGroups(),saved=useSaved(),now=useSavedNow(),resolver=useResolveSavedMembers(language),items=saved.items,[checking,setChecking]=useState(false),[error,setError]=useState('');
  // Before the first manifest, persisted signals still identify unread MEPs.
  const cards=[...items,...dossiers.items].map(item=>({item,hasNew:itemHasNew(((item.kind==='mep') && (!saved.manifest)) ? ({...item,unresolved:{activity:true,answer:true}}) : item,now)||item.kind==='mep'&&(membershipEntries(membership,item.id,now).fresh.length>0||groupEntries(groups,item.id,now).fresh.length>0)}))
    .sort((a,b)=>Number(b.hasNew)-Number(a.hasNew));
  // Prioritise unread cards on entry, then keep this visit's reading order.
  // Reading, expiry and background checks must not move cards under the user.
  const cardOrder=useRef(new Map<string,number>());
  const cardKey=(item:typeof cards[number]['item'])=>item.kind+':'+item.id+':'+item.savedAt;
  for(const {item} of cards)if(!cardOrder.current.has(cardKey(item)))cardOrder.current.set(cardKey(item),cardOrder.current.size);
  cards.sort((a,b)=>cardOrder.current.get(cardKey(a.item))!-cardOrder.current.get(cardKey(b.item))!);
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
    <button onClick={onBack}><UiMessage id="document.back"/></button>
    <div className="explorer-saved-heading"><h1><UiMessage id="batch4.dossiercontrols.tsx.64.2"/></h1><button onClick={()=>{if(items.length)check();void checkDossierUpdates();}} disabled={!items.length&&!dossiers.items.length} aria-disabled={checking||dossierChecking||undefined} style={(checking||dossierChecking) ? ({opacity:.45,cursor:'default'}) : undefined}>{(checking||dossierChecking) ? <UiMessage id="batch6.procedureprogress.checking.62"/> : <UiMessage id="Saved.check_for_updates"/>}</button></div>
    {!saved.persistent&&<p><UiMessage id="Saved.browser_storage_is_unavailable_follows_last_only_for_this_tab"/></p>}
    {saved.storageError&&<p role="alert" className="explorer-storage-error"><UiMessage id="Saved.storageError" values={{time:new Date(saved.unsavedSince||Date.now()).toLocaleTimeString(ui.locale)}}/> <button onClick={()=>store.retryStorage()}><UiMessage id="Saved.retry_saving"/></button></p>}
    {items.some(item=>item.kind==='mep')&&<GroupUpdateStatus retry={check}/>}
    {membership.storageError&&<p role="alert"><UiMessage id="Saved.membership_updates_could_not_be_saved_in_this_browser"/> <button onClick={()=>membershipStore.retryStorage()}><UiMessage id="Saved.retry_saving_membership_updates"/></button></p>}
    {items.some(item=>item.kind==='mep')&&membershipCheck==='unavailable'&&<p className="explorer-membership-status"><UiMessage id="Saved.some_membership_updates_are_unavailable"/></p>}
    {items.some(item=>item.kind==='mep')&&membershipCheck==='error'&&<p className="explorer-membership-status" role="alert"><UiMessage id="Saved.couldn_t_check_membership_updates"/> <button onClick={check}><UiMessage id="Saved.retry_membership_updates"/></button></p>}
    {items.some(item=>item.kind==='mep')&&saved.checkState==='unavailable'&&<p><UiMessage id="Saved.update_checks_are_not_available_yet_for_meps"/> <button onClick={check}><UiMessage id="textsearch.retry.9f5cd8"/></button></p>}
    {items.some(item=>item.kind==='mep')&&saved.checkState==='error'&&<p><UiMessage id="Saved.couldn_t_check_for_mep_updates"/> <button onClick={check}><UiMessage id="textsearch.retry.9f5cd8"/></button></p>}
    {items.some(item=>item.kind==='question')&&saved.questionCheckState==='error'&&<p><UiMessage id="Saved.couldn_t_check_for_question_answers"/> <button onClick={check}><UiMessage id="textsearch.retry.9f5cd8"/></button></p>}
    {error&&membershipCheck!=='error'&&<p>{error}</p>}
    {!dossiers.persistent&&dossiers.items.length>0&&<p><UiMessage id="Saved.dossier_follows_last_only_for_this_tab"/></p>}
    {dossiers.storageError&&<p role="alert"><UiMessage id="Saved.dossier_changes_couldn_t_be_saved_in_this_browser"/> <button onClick={()=>dossierStore.retryStorage()}><UiMessage id="Saved.retry_saving"/></button></p>}
    {!items.length&&!dossiers.items.length&&<p><UiMessage id="Saved.follow_a_mep_or_dossier_or_save_a_question_to_see_updates_here"/></p>}
    <div className="explorer-saved-items">{cards.map(({item})=>(item.kind==='dossier') ? <DossierCard key={'dossier:'+item.id+':'+item.savedAt} item={item} language={language} now={now}/> : <FollowCard key={savedKey(item)+':'+item.savedAt} item={item} directoryMember={membersById.get(item.id)} language={language} onMember={onMember} renderActivity={renderActivity} now={now} resolution={resolver.resolution(item)} retry={()=>resolver.retry(item)} checkState={(item.kind==='question') ? saved.questionCheckState : saved.checkState} check={check}/>)}</div>
    <FollowSuggestions language={language}/>
  </section>;
}
