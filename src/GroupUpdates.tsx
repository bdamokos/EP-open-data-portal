import {groupEntries,groupIsNew,type GroupEntry} from './followGroups.mjs';
import {groupsStore,useGroups,useGroupsCheck} from './SavedControls';
import {groupLabel} from './InsightCharts';

export function GroupUpdates({member,language,now,onMember}:{member:string;language:string;now:number;onMember:(id:number)=>void}) {
  const state=useGroups(),{fresh,history}=groupEntries(state,member,now);
  const row=(entry:GroupEntry)=>{
    const label=`Changed group: ${groupLabel(entry.from.code)} → ${groupLabel(entry.to.code)}`;
    const date=new Intl.DateTimeFormat(language==='en'?'en-GB':language,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(entry.date));
    const read=()=>groupsStore.markRead(member,entry.id);
    return <div className="explorer-saved-entry explorer-membership-entry" key={entry.id}><a className="explorer-membership-link" href={'?'+new URLSearchParams({lang:language,member})} onAuxClick={event=>{if(event.button===1)read();}} onClick={event=>{
      read();if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();onMember(Number(member));
    }}>{groupIsNew(entry,now)&&<span className="explorer-saved-new">New</span>}{label} · <span lang={language}>{date}</span></a>
      {groupIsNew(entry,now)&&<button onClick={read} aria-label={`Mark ${label} · ${date} update read`}>Mark read</button>}</div>;
  };
  return <>{fresh.map(row)}{history.length>0&&<details className="explorer-saved-history"><summary>Earlier group updates ({history.length})</summary>{history.map(row)}</details>}</>;
}
export function GroupUpdateStatus({retry}:{retry:()=>void}) {
  const state=useGroups(),check=useGroupsCheck();
  return <>{state.storageError&&<p role="alert">Group updates could not be saved in this browser. <button onClick={()=>groupsStore.retryStorage()}>Retry saving group updates</button></p>}
    {check==='unavailable'&&<p className="explorer-groups-status">Some group updates are unavailable.</p>}
    {check==='error'&&<p className="explorer-groups-status" role="alert">Couldn't check group updates. <button onClick={retry}>Retry group updates</button></p>}</>;
}
