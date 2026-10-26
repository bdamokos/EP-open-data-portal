import type {MemberProfile,ProfileMembershipHistory} from './explorerTypes';
import {Period} from './Period';
import {selectLanguageText} from './language.mjs';

type HistoryItem=ProfileMembershipHistory['items'][number];
const sections = [
  {title:'Political affiliations',groups:[['national-parties','National parties'],['political-groups','Parliament political groups']]},
  {title:'Delegations and other roles',groups:[['delegations','Delegations'],['other-roles','Governing and working bodies']]},
];
const knownRoles = new Set(['CHAIR','CHAIR_VICE','MEMBER','MEMBER_SUBSTITUTE']);
const officeRoles:Record<string,string> = {PRESIDENT:'President',PRESIDENT_VICE:'Vice-President',CHAIR_CO:'Co-Chair',QUAESTOR:'Quaestor'};
const roleCode=(item:HistoryItem)=>item.role?.replace(/^https:\/\/data\.europarl\.europa\.eu\//,'').replace(/^def\/ep-roles\//,'');
const itemName=(item:HistoryItem,lang:string)=>{
  const labels=item.body?.prefLabel;
  const names=labels&&typeof labels==='object'&&!Array.isArray(labels)?Object.fromEntries(Object.entries(labels).filter(([,value])=>typeof value==='string'&&value.trim())):{};
  return selectLanguageText(names,lang,'Unnamed organisation','en');
};
const hasName=(item:HistoryItem)=>item.body?.prefLabel&&typeof item.body.prefLabel==='object'&&!Array.isArray(item.body.prefLabel)&&Object.values(item.body.prefLabel).some(value=>typeof value==='string'&&value.trim());

export function ProfileMemberships({profile,lang,roleName,date,retry}:{profile:MemberProfile;lang:string;roleName:(role:string)=>string;date:(value:string,lang:string)=>string;retry:()=>void}) {
  const history=profile.membershipHistory;
  const current=profile.currentAffiliation?.status==='matched';
  const row=(item:HistoryItem)=>{
    const name=itemName(item,lang),role=roleCode(item),period=Period({start:item.start,end:item.end,ongoing:current,lang,date});
    const ordinaryAffiliation=role==='MEMBER'&&['national-parties','political-groups'].includes(item.section);
    return <li key={item.index}>
      <p><span lang={name.language}>{name.text}</span></p>
      {!ordinaryAffiliation&&role&&(knownRoles.has(role)||officeRoles[role])&&<p><span lang={knownRoles.has(role)?lang:'en'}>{knownRoles.has(role)?roleName(role):officeRoles[role]}</span></p>}
      {period&&<p className="explorer-affiliation-dates">{period}</p>}
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
