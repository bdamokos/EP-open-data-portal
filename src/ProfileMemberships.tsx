import type {MemberProfile,ProfileMembershipHistory} from './explorerTypes';
import {selectLanguageText} from './language.mjs';

const sections = [
  {title:'Political affiliations',groups:[['national-parties','National parties'],['political-groups','European Parliament political groups']]},
  {title:'Delegations and other roles',groups:[['delegations','Delegations'],['other-roles','Governing and working bodies']]},
];
const hasName = (body:ProfileMembershipHistory['items'][number]['body']) => body?.prefLabel && typeof body.prefLabel==='object' && !Array.isArray(body.prefLabel) && Object.values(body.prefLabel).some(value=>typeof value==='string'&&value.trim());
const knownRoles = new Set(['CHAIR','CHAIR_VICE','MEMBER','MEMBER_SUBSTITUTE']);
const officeRoles:Record<string,string> = {PRESIDENT:'President',PRESIDENT_VICE:'Vice-President',CHAIR_CO:'Co-Chair',QUAESTOR:'Quaestor'};
const rawText = (value:unknown):string => typeof value==='string'?value:JSON.stringify(value)??String(value);
const validDate = (value:unknown):value is string => typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
  &&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const bodyLink = (id:string|null) => id && /^(?:https:\/\/data\.europarl\.europa\.eu\/)?org\/[^\s/?#]+$/.test(id)
  ? 'https://data.europarl.europa.eu/'+id.replace('https://data.europarl.europa.eu/','') : null;

export function ProfileMemberships({profile,lang,roleName,date,retry}:{profile:MemberProfile;lang:string;roleName:(role:string)=>string;date:(value:string,lang:string)=>string;retry:()=>void}) {
  const history=profile.membershipHistory;
  const periodDate=(value:unknown,side:'Start'|'End')=>value==null?<span lang="en">{side} date not supplied</span>:validDate(value)?<span lang={lang}>{date(value,lang)}</span>:<span lang="en">Invalid {side.toLowerCase()} date: <span lang="">{rawText(value)}</span></span>;
  const row=(item:ProfileMembershipHistory['items'][number])=>{
    const labels=item.body?.prefLabel;
    const names=labels&&typeof labels==='object'&&!Array.isArray(labels)?Object.fromEntries(Object.entries(labels).filter(([,value])=>typeof value==='string'&&value.trim())):{};
    const name=selectLanguageText(names,lang,'Name unavailable');
    const href=bodyLink(item.bodyId);
    const role=item.role?.replace(/^https:\/\/data\.europarl\.europa\.eu\//,'').replace(/^def\/ep-roles\//,'');
    return <li key={item.index}>
      <p>{name.text!=='Name unavailable' ? href?<a href={href} lang={name.language}>{name.text}</a>:<span lang={name.language}>{name.text}</span> :
        <>{href?<a href={href} lang="">{item.bodyId}</a>:<span lang={item.bodyId?'':'en'}>{item.bodyId||'Organisation identifier not supplied'}</span>} · <span lang="en">Name unavailable</span></>}</p>
      <p><span lang={role&&knownRoles.has(role)?lang:'en'}>{!role?'Role not supplied':knownRoles.has(role)?roleName(role):officeRoles[role]||'Role unavailable'}</span>
        {role&&!knownRoles.has(role)&&!officeRoles[role]&&<small lang=""> · {item.role}</small>}</p>
      <p className="explorer-affiliation-dates">{periodDate(item.start,'Start')} — {periodDate(item.end,'End')}
        {item.dateIssues.includes('reversed-period')&&<> · <span lang="en">End date precedes start date</span></>}</p>
    </li>;
  };
  return <div className="explorer-profile-memberships" lang="en">
    {sections.map(section=>{
      const items=history?.items.filter(item=>section.groups.some(([key])=>item.section===key))||[];
      const namesUnavailable=items.some(item=>!hasName(item.body)||item.body?.source?.stale);
      return <details key={section.title}>
      <summary>{section.title}</summary>
      {!history?.observationComplete?<p>Membership observations are unavailable.</p>:section.groups.map(([key,title])=>{
        const items=history.items.filter(item=>item.section===key);
        return <section key={key}><h3>{title}</h3>{items.length?<ol>{items.map(row)}</ol>:<p>No memberships supplied.</p>}</section>;
      })}
      {(!history?.observationComplete||namesUnavailable)&&<p className="explorer-membership-gap">{namesUnavailable?'Some organisation names are unavailable. Showing the published identifiers.':''} <button type="button" onClick={retry}>Retry profile details</button></p>}
      {history?.sources?.length>0&&<details className="explorer-membership-sources"><summary>Sources</summary><ul>{history.sources.filter((source,index,all)=>all.findIndex(value=>value.url===source.url)===index).filter(source=>source.url===history.sources[0].url||items.some(item=>item.body?.source?.url===source.url)).map(source=><li key={source.url}>
        <a href={source.url}>{source.url===history.sources[0].url?'Member record':'Organisation record'}</a> · Retrieved <time lang={lang} dateTime={source.fetchedAt} title={source.fetchedAt}>{date(source.fetchedAt.slice(0,10),lang)}</time>{source.stale?' · Update unavailable':''}
      </li>)}</ul></details>}
    </details>;})}
  </div>;
}
