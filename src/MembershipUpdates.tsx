const mandateDate=(value:string,language:string)=>new Intl.DateTimeFormat(language==='en'?'en-GB':language,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value));
import {membershipEntries,membershipIsNew,type MembershipEntry} from './followMembership.mjs';
import {membershipStore,useMembership} from './SavedControls';

export function MembershipUpdates({member,language,now,onMember}:{member:string;language:string;now:number;onMember:(id:number)=>void}) {
  const state=useMembership(),{fresh,history}=membershipEntries(state,member,now),status=state.members[member];
  const row=(entry:MembershipEntry)=>{
    const href='?'+new URLSearchParams({lang:language,member});
    const read=()=>membershipStore.markRead(member,entry.id);
    return <div className="explorer-saved-entry explorer-membership-entry" key={entry.id}><a className="explorer-membership-link" href={href} onAuxClick={event=>{if(event.button===1)read();}} onClick={event=>{
      read();if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();onMember(Number(member));
    }}>{membershipIsNew(entry,now)&&<span className="explorer-saved-new">New</span>}{entry.type==='mandate-ended'?'Left Parliament':entry.subtype==='returned'?'Returned to Parliament':'Joined Parliament'} · <span lang={language}>{mandateDate(entry.date,language)}</span></a>
    {membershipIsNew(entry,now)&&<button onClick={read} aria-label={`Mark ${entry.type==='mandate-ended'?'Left Parliament':'Joined or returned to Parliament'} update read`}>Mark read</button>}</div>;
  };
  return <>{status?.status==='former'&&<p>Former MEP · mandate ended <span lang={language}>{mandateDate(status.endDate!,language)}</span></p>}
    {fresh.map(row)}{history.length>0&&<details className="explorer-saved-history"><summary>Earlier membership updates ({history.length})</summary>{history.map(row)}</details>}</>;
}

export function FormerMemberNotice({member,language}:{member:number;language:string}) {
  const state=useMembership(),status=state.members[String(member)];
  return <section lang="en" className="explorer-former-member"><p>{status?.status==='former'?<>Activity tracking for this MEP ended with their mandate on <span lang={language}>{mandateDate(status.endDate!,language)}</span>.</>:<>This MEP is not in the current roster. Activity tracking is limited to current MEPs.</>}</p>
    <p><a href={`https://www.europarl.europa.eu/meps/en/${member}`}>Official European Parliament profile</a></p></section>;
}
