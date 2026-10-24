import {GroupUpdates,GroupUpdateStatus} from './GroupUpdates';
import {groupEntries} from './followGroups.mjs';
import {groupsStore,useGroups} from './SavedControls';
import {FollowSuggestions} from './FollowSuggestions';
import {MembershipUpdates} from './MembershipUpdates';
import {membershipEntries} from './followMembership.mjs';
import {membershipStore,useMembership,useMembershipCheck} from './SavedControls';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Status} from './Status';
import {savedKey,type SavedItem,type SavedStates} from './bookmarks.mjs';
import {followEntries,isNewEntry,itemHasNew,summarizeByType,LIST_LIMIT,NEW_WINDOW_MS,type FollowEntry} from './followUpdates.mjs';
import {humanDate} from './InsightCharts';
import {SaveButton,useSaved,checkSaved,savedStore as store,requestedKeys,useSavedNow,useResolveSavedMembers} from './SavedControls';

function savedCheckMessage(items:SavedItem[],data:SavedStates) {
  const unread=items.filter(item=>itemHasNew(item,Date.now())||item.kind==='mep'&&(membershipEntries(membershipStore.snapshot(),item.id,Date.now()).fresh.length>0||groupEntries(groupsStore.snapshot(),item.id,Date.now()).fresh.length>0)).length;
  const unavailable=items.filter(item=>item.availability!=='available'||item.legacy).length;
  const state=store.snapshot();
  if(items.some(item=>item.kind==='mep')&&state.checkState!=='available')return [state.checkState==='unavailable'?'Update checks are not available yet for MEPs.':'MEP updates could not be checked.',items.some(item=>item.kind==='question')&&state.questionCheckState==='available'?'Question answers were checked.':'','Saved items are still shown.'].filter(Boolean).join(' ');
  return ['Check finished.',unread?`${unread} followed ${unread===1?'item has':'items have'} unread updates.`:'No unread updates are currently recorded.',unavailable?`Update information is unavailable for ${unavailable} followed ${unavailable===1?'item':'items'}.`:'',data.coverage?.indexComplete===true?'':'The saved index is incomplete.'].filter(Boolean).join(' ');
}
export type FollowingActivityProps={member:number;sourceId:string;profileHref:string;onOpenProfile:()=>void};
type SavedProps={language:string;onBack:()=>void;onMember:(id:number,sourceId?:string)=>void;renderActivity:(props:FollowingActivityProps)=>ReactNode};
const entryKey=(entry:FollowEntry)=>entry.kind+':'+entry.id;
function FollowCard({item,language,onMember,renderActivity,now,resolution,retry,checkState,check}:{item:SavedItem;now:number;resolution:{pending?:boolean;error?:string};retry:()=>void;checkState:string;check:()=>void}&Pick<SavedProps,'language'|'onMember'|'renderActivity'>) {
  const groups=useGroups(),groupsNew=item.kind==='mep'?groupEntries(groups,item.id,now).fresh.length:0;
  const membership=useMembership(),membershipNew=item.kind==='mep'?membershipEntries(membership,item.id,now).fresh.length:0;
  const key=savedKey(item),{fresh,history,historyOmitted}=followEntries(item,now),hasNew=itemHasNew(item,now)||membershipNew>0||groupsNew>0;
  const [open,setOpen]=useState(new Set<string>()),[retained,setRetained]=useState<FollowEntry[]>([]);
  const member=Number(item.kind==='mep'?item.id:item.memberId),profileHref='?'+new URLSearchParams({lang:language,member:String(member),module:'activities'});
  const onOpenProfile=()=>onMember(member);
  const rowOrder=useRef(new Map<string,number>());
  for(const entry of item.entries||[])if(!rowOrder.current.has(entryKey(entry)))rowOrder.current.set(entryKey(entry),rowOrder.current.size);
  const pinned=new Set(retained.map(entryKey)),visibleHistory=history.filter(entry=>!pinned.has(entryKey(entry)));
  const listed=[...fresh,...retained.filter(entry=>!fresh.some(other=>entryKey(entry)===entryKey(other)))].sort((a,b)=>b.discoveredAt-a.discoveredAt||b.date.localeCompare(a.date)||(rowOrder.current.get(entryKey(a))??0)-(rowOrder.current.get(entryKey(b))??0));
  const omitted=item.unreadOmittedAt!==undefined&&item.unreadOmittedAt+NEW_WINDOW_MS>now?item.unreadOmitted||0:0;
  const summary=fresh.length>LIST_LIMIT||omitted>0;
  const link=(label:string)=><a href={profileHref} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();onOpenProfile();}}>{label}</a>;
  const row=(entry:FollowEntry)=>{
    const id=entryKey(entry),expanded=open.has(id),current=item.entries?.find(value=>entryKey(value)===id)||entry,isNew=isNewEntry(current,now),href=profileHref+'&activity='+encodeURIComponent(entry.id);
    const read=()=>{if(current.readAt===null){if(fresh.some(value=>entryKey(value)===id))setRetained(previous=>previous.some(value=>entryKey(value)===id)?previous:[...previous,{...entry,readAt:now}]);store.markEntryRead(key,entry.kind,entry.id);}};
    return <div className="explorer-saved-entry" key={id}>
      <a className="explorer-saved-disclosure" role="button" href={href} aria-expanded={expanded} onAuxClick={event=>{if(event.button===1)read();}} onKeyDown={event=>{if(event.key===' '){event.preventDefault();event.currentTarget.click();}}} onClick={event=>{
        if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey){read();return;}
        event.preventDefault();if(!expanded)read();setOpen(previous=>{const next=new Set(previous);if(expanded)next.delete(id);else next.add(id);return next;});
      }}><span aria-hidden="true">{expanded?'▾':'▸'}</span>{isNew&&<span className="explorer-saved-new">New</span>}<span lang={entry.titleLanguage||''}>{entry.title}</span><small>{summarizeByType([entry]).replace(/^1 /,'')} · <span lang={entry.date?language:'en'}>{entry.date?humanDate(entry.date,language):'Date unavailable'}</span></small></a>
      {expanded&&<div className="explorer-saved-detail">{renderActivity({member,sourceId:entry.id,profileHref:href,onOpenProfile:()=>onMember(member,entry.id)})}</div>}
    </div>;
  };
  return <article>
    <div className="explorer-saved-heading"><h3 lang={item.titleLanguage||''}>{item.title}</h3><SaveButton item={item} language={language} compact/></div>
    <div className="explorer-saved-state">{(item.unresolved?.activity||item.unresolved?.answer)?resolution.error?<p role="alert">Couldn't load new activity. {resolution.error} <button onClick={retry}>Retry</button></p>:<strong className="explorer-update-label">Checking for new activity…</strong>:hasNew&&<strong className="explorer-update-label">{fresh.length===1&&membershipNew===0&&groupsNew===0&&fresh[0].kind==='answer'?'New answer':fresh.length+membershipNew+groupsNew?`${fresh.length+membershipNew+groupsNew+omitted} new`:item.legacyUpdated?'Updated before the upgrade':'Question details changed'}</strong>}
    {!hasNew&&checkState==='available'&&!item.legacy&&<p>{item.availability==='available'?'No new updates.':item.checkedAt?'Update information is unavailable.':'Checking will establish a starting point for future updates.'}</p>}
    </div>
    {item.availability==='outside-roster'&&membership.members[item.id]?.status!=='former'&&<p>No longer on the current roster.</p>}
    {item.kind==='question'&&<p>{item.current?.answerIds?.length?'Answer available.':item.availability==='available'?'No answer available in the indexed data yet.':'Answer availability has not been checked.'}</p>}
    {item.legacy&&<p>Update check pending. <button onClick={check}>Retry</button></p>}
    {!item.indexComplete&&<small>The index is incomplete; more updates may be available.</small>}
    <div className="explorer-saved-actions">{(item.kind==='mep'||item.memberId)&&<button onClick={()=>{if(item.kind==='question')store.openQuestion(key);onMember(member,item.kind==='question'?item.id:undefined);}}>{item.kind==='mep'?'Profile':item.current?.answerIds?.length?'Read question and answers':'Read question'}</button>}
    {item.kind==='question'&&item.availability==='not-saved'&&<p>Question metadata is not available yet.</p>}
    {hasNew&&<button onClick={()=>{store.markRead(key);if(item.kind==='mep'){membershipStore.markRead(item.id);groupsStore.markRead(item.id);}}}>Mark all read</button>}</div>
    {item.kind==='mep'&&<GroupUpdates member={item.id} language={language} now={now} onMember={onMember}/>}
    {item.kind==='mep'&&<MembershipUpdates member={item.id} language={language} now={now} onMember={onMember}/>}
    {summary?<p>{summarizeByType(fresh,omitted)}. {link('Open the profile to read them')}</p>:(item.kind==='mep'||item.memberId)&&listed.map(row)}
    {(visibleHistory.length>0||historyOmitted>0)&&<details className="explorer-saved-history"><summary>Earlier updates ({visibleHistory.length+historyOmitted})</summary>{(item.kind==='mep'||item.memberId)&&visibleHistory.map(row)}{historyOmitted>0&&link('See all activity in the full profile')}</details>}
  </article>;
}
export function Saved({language,onBack,onMember,renderActivity}:SavedProps) {
  const membershipCheck=useMembershipCheck(),membership=useMembership(),saved=useSaved(),now=useSavedNow(),resolver=useResolveSavedMembers(language),items=saved.items,[checking,setChecking]=useState(false),[error,setError]=useState('');
  const key=items.map(item=>savedKey(item)+':'+(item.savedAt??'')).sort().join(','),context=language+':'+key,request=useRef(0),active=useRef(false);
  const [attempt,setAttempt]=useState(0),[completion,setCompletion]=useState<{items:SavedItem[];message:string}|null>(null);
  useEffect(()=>{active.current=true;setChecking(false);setError('');setCompletion(null);return()=>{active.current=false;request.current++;};},[context]);
  const check=()=>{
    if(checking)return;
    const token=++request.current;setAttempt(token);setChecking(true);setError('');setCompletion(null);
    const current=()=>active.current&&request.current===token&&store.snapshot().items.map(item=>savedKey(item)+':'+(item.savedAt??'')).sort().join(',')===key;
    void (async()=>{
      while(current()){
        const checked=checkSaved(language,true),matches=requestedKeys.get(checked)===key;
        try{
          const result=await checked;if(!current())return;
          // A changed follow set already queues its matching refresh in checkSaved.
          // Keep this deliberate attempt attached to that result, including errors.
          if(!matches)continue;
          if(result){const settled=store.snapshot().items;setCompletion({items:settled,message:savedCheckMessage(settled,result.data)});}return;
        }catch(e){if(!current())return;if(!matches)continue;setError((e as Error).message);setCompletion({items:store.snapshot().items,message:store.snapshot().questionCheckState==='available'?'Question answers were checked. Other updates could not be checked. Saved items are still shown.':'Could not check for updates. Saved items are still shown.'});return;}
      }
    })().finally(()=>{if(current())setChecking(false);});
  };
  return <section className="explorer-saved-view" lang="en">
    <Status scope={`saved-check:${context}:${attempt}`} message={completion?.items===items?completion.message:null} pending={checking}/>
    <button onClick={onBack}>← Back</button>
    <div className="explorer-saved-heading"><h1>Following</h1><button onClick={check} disabled={!items.length} aria-disabled={checking||undefined} style={checking?{opacity:.45,cursor:'default'}:undefined}>{checking?'Checking…':'Check for updates'}</button></div>
    <FollowSuggestions/>
    {!saved.persistent&&<p>Browser storage is unavailable. Follows last only for this tab.</p>}
    {saved.storageError&&<p role="alert" className="explorer-storage-error">Changes since {new Date(saved.unsavedSince||Date.now()).toLocaleTimeString()} could not be saved in this browser and will be lost on reload. <button onClick={()=>store.retryStorage()}>Retry saving</button></p>}
    {items.some(item=>item.kind==='mep')&&<GroupUpdateStatus retry={check}/>}
    {membership.storageError&&<p role="alert">Membership updates could not be saved in this browser. <button onClick={()=>membershipStore.retryStorage()}>Retry saving membership updates</button></p>}
    {items.some(item=>item.kind==='mep')&&membershipCheck==='unavailable'&&<p className="explorer-membership-status">Some membership updates are unavailable.</p>}
    {items.some(item=>item.kind==='mep')&&membershipCheck==='error'&&<p className="explorer-membership-status" role="alert">Couldn't check membership updates. <button onClick={check}>Retry membership updates</button></p>}
    {saved.restarted&&<p>Update tracking restarted. Previously unread items are kept.</p>}
    {items.some(item=>item.kind==='mep')&&saved.checkState==='unavailable'&&<p>Update checks are not available yet for MEPs. <button onClick={check}>Retry</button></p>}
    {items.some(item=>item.kind==='mep')&&saved.checkState==='error'&&<p>Couldn't check for MEP updates. <button onClick={check}>Retry</button></p>}
    {items.some(item=>item.kind==='question')&&saved.questionCheckState==='error'&&<p>Couldn't check for question answers. <button onClick={check}>Retry</button></p>}
    {error&&membershipCheck!=='error'&&<p>{error}</p>}
    {!items.length&&<p>Follow a MEP or save a question to see new activity and answers here.</p>}
    <div className="explorer-saved-items">{items.map(item=><FollowCard key={savedKey(item)+':'+item.savedAt} item={item} language={language} onMember={onMember} renderActivity={renderActivity} now={now} resolution={resolver.resolution(item)} retry={()=>resolver.retry(item)} checkState={item.kind==='question'?saved.questionCheckState:saved.checkState} check={check}/>)}</div>
  </section>;
}
