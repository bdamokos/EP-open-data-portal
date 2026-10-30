import {UiMessage, useUiI18n} from './UiI18nReact';
const mandateDate=(value:string,language:string)=>new Intl.DateTimeFormat((language==='en') ? 'en-GB' : language,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value));
import {membershipEntries,membershipIsNew,type MembershipEntry} from './followMembership.mjs';
import {membershipStore,useMembership} from './SavedControls';

export function MembershipUpdates({member,language,now,onMember}:{member:string;language:string;now:number;onMember:(id:number)=>void}) {
  const ui = useUiI18n();
  const state=useMembership(),{fresh,history}=membershipEntries(state,member,now),status=state.members[member];
  const row=(entry:MembershipEntry)=>{
    const href='?'+new URLSearchParams({lang:language,member});
    const read=()=>membershipStore.markRead(member,entry.id);
    return <div className="explorer-saved-entry explorer-membership-entry" key={entry.id}><a className="explorer-membership-link" href={href} onAuxClick={event=>{if(event.button===1)read();}} onClick={event=>{
      read();if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();onMember(Number(member));
    }}>{membershipIsNew(entry,now)&&<span className="explorer-saved-new"><UiMessage id="groupupdates.tsx.new"/></span>}{(entry.type==='mandate-ended') ? ui.t("batch4.membershipupdates.tsx.13.2") : ((entry.subtype==='returned') ? ui.t("batch4.membershipupdates.tsx.13.3") : ui.t("batch4.membershipupdates.tsx.13.4"))} · <span lang={language}>{mandateDate(entry.date,language)}</span></a>
    {membershipIsNew(entry,now)&&<button onClick={read} aria-label={(entry.type==='mandate-ended') ? ui.t("batch4.membershipupdates.tsx.14.2") : ui.t("batch4.membershipupdates.tsx.14.3")}><UiMessage id="groupupdates.tsx.mark.read"/></button>}</div>;
  };
  return <>{status?.status==='former'&&<p><UiMessage id="batch4.membershipupdates.tsx.16.1" values={{date: <span lang={language}>{mandateDate(status.endDate!,language)}</span>}}/></p>}
    {fresh.map(row)}{history.length>0&&<details className="explorer-saved-history"><summary><UiMessage id="batch4.membershipupdates.tsx.17.1" values={{count: history.length}}/></summary>{history.map(row)}</details>}</>;
}

export function FormerMemberNotice({member,language}:{member:number;language:string}) {
  const ui = useUiI18n();
  const state=useMembership(),status=state.members[String(member)];
  return <section lang={ui.language} className="explorer-former-member"><p>{(status?.status==='former') ? <><UiMessage id="batch4.membershipupdates.tsx.22.1" values={{date: <span lang={language}>{mandateDate(status.endDate!,language)}</span>}}/></> : <><UiMessage id="batch4.membershipupdates.tsx.22.2"/></>}</p>
    <p><a href={`https://www.europarl.europa.eu/meps/en/${member}`}><UiMessage id="batch4.membershipupdates.tsx.23.1"/></a></p></section>;
}
