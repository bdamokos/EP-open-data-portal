import type {MemberProfile,ProfileMembershipHistory} from './explorerTypes';
import {selectLanguageText} from './language.mjs';

type HistoryItem=ProfileMembershipHistory['items'][number];
const sections = [
  {title:'Political affiliations',groups:[['national-parties','National parties'],['political-groups','Parliament political groups']]},
  {title:'Delegations and other roles',groups:[['delegations','Delegations'],['other-roles','Governing and working bodies']]},
];
const knownRoles = new Set(['CHAIR','CHAIR_VICE','MEMBER','MEMBER_SUBSTITUTE']);
const officeRoles:Record<string,string> = {PRESIDENT:'President',PRESIDENT_VICE:'Vice-President',CHAIR_CO:'Co-Chair',QUAESTOR:'Quaestor'};
const validDate = (value:unknown):value is string => typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
  &&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const roleCode=(item:HistoryItem)=>item.role?.replace(/^https:\/\/data\.europarl\.europa\.eu\//,'').replace(/^def\/ep-roles\//,'');
const itemName=(item:HistoryItem,lang:string)=>{
  const labels=item.body?.prefLabel;
  const names=labels&&typeof labels==='object'&&!Array.isArray(labels)?Object.fromEntries(Object.entries(labels).filter(([,value])=>typeof value==='string'&&value.trim())):{};
  return selectLanguageText(names,lang,item.bodyId||'Organisation identifier not supplied',item.bodyId?'':'en');
};
const hasName=(item:HistoryItem)=>item.body?.prefLabel&&typeof item.body.prefLabel==='object'&&!Array.isArray(item.body.prefLabel)&&Object.values(item.body.prefLabel).some(value=>typeof value==='string'&&value.trim());

export function ProfileMemberships({profile,lang,roleName,date,retry}:{profile:MemberProfile;lang:string;roleName:(role:string)=>string;date:(value:string,lang:string)=>string;retry:()=>void}) {
  const history=profile.membershipHistory;
  const periodDate=(value:unknown,side:'Start'|'End')=>value==null?<span lang="en">{side} date not supplied</span>:validDate(value)?<span lang={lang}>{date(value,lang)}</span>:<span lang="en">{side} date invalid in source</span>;
  const row=(item:HistoryItem)=>{
    const name=itemName(item,lang),role=roleCode(item);
    const ordinaryAffiliation=role==='MEMBER'&&['national-parties','political-groups'].includes(item.section);
    return <li key={item.index}>
      <p><span lang={name.language}>{name.text}</span>{!hasName(item)&&<> · Name unavailable</>}</p>
      {!ordinaryAffiliation&&<p><span lang={role&&knownRoles.has(role)?lang:'en'}>{!role?'Role not supplied':knownRoles.has(role)?roleName(role):officeRoles[role]||'Role label unavailable'}</span></p>}
      <p className="explorer-affiliation-dates">{periodDate(item.start,'Start')} — {periodDate(item.end,'End')}
        {item.dateIssues.includes('reversed-period')&&<> · <span lang="en">End date precedes start date</span></>}</p>
    </li>;
  };
  return <div className="explorer-profile-memberships" lang="en">
    {sections.map(section=>{
      const items=history?.items.filter(item=>section.groups.some(([key])=>item.section===key))||[];
      const namesMissing=items.some(item=>!hasName(item));
            return <details key={section.title}>
        <summary>{section.title}</summary>
        {!history?.observationAvailable?<p>Membership information is unavailable.</p>:section.groups.map(([key,title])=>{
          const groupItems=items.filter(item=>item.section===key);
          return <section key={key}><h3>{title}</h3>{groupItems.length?<ol>{groupItems.map(row)}</ol>:<p>{history.observationComplete?'None listed.':'Membership information is incomplete.'}</p>}</section>;
        })}
        {(!history?.observationComplete||namesMissing)&&<p className="explorer-membership-gap">
          {history?.observationAvailable&&!history.observationComplete?'Some memberships unavailable. ':''}
          {namesMissing?'Some organisation names unavailable. ':''}
          <button type="button" onClick={retry}>Retry profile details</button>
        </p>}
      </details>;
    })}
  </div>;
}
