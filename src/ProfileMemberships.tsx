import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import type {MemberProfile,ProfileMembershipHistory} from './explorerTypes';
import {Period,validDate} from './Period';
import {profileMembershipPeriods} from './profileMembershipPeriods';

const TERM_START='2024-07-16';
import {selectLanguageText} from './language.mjs';

type HistoryItem=ProfileMembershipHistory['items'][number];
const sections = [
  {title:'Political affiliations',groups:[['national-parties','National parties'],['political-groups','Parliament political groups']]},
  {title:'Delegations and other roles',groups:[['delegations','Delegations'],['other-roles','Governing and working bodies']]},
];
export const sectionsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof sections => ([
  {title:ui.t("ProfileMemberships.political_affiliations"),groups:[['national-parties',ui.t("ProfileMemberships.national_parties")],['political-groups',ui.t("ProfileMemberships.parliament_political_groups")]]},
  {title:ui.t("ProfileMemberships.delegations_and_other_roles"),groups:[['delegations',ui.t("ProfileMemberships.delegations")],['other-roles',ui.t("ProfileMemberships.governing_and_working_bodies")]]},
]);

const knownRoles = new Set(['CHAIR','CHAIR_VICE','MEMBER','MEMBER_SUBSTITUTE']);
const officeRoles:Record<string,string> = {PRESIDENT:'President',PRESIDENT_VICE:'Vice-President',CHAIR_CO:'Co-Chair',QUAESTOR:'Quaestor'};
export const officeRolesUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof officeRoles => ({PRESIDENT:ui.t("ProfileMemberships.president"),PRESIDENT_VICE:ui.t("ProfileMemberships.vice_president"),CHAIR_CO:ui.t("ProfileMemberships.co_chair"),QUAESTOR:ui.t("ProfileMemberships.quaestor")});

const roleCode=(item:HistoryItem)=>item.role?.replace(/^https:\/\/data\.europarl\.europa\.eu\//,'').replace(/^def\/ep-roles\//,'');
const itemName=(item:HistoryItem,lang:string, ui: import('./uiI18n.mjs').UiFormatter = defaultUi)=>{
  const labels=item.body?.prefLabel;
  const names=((labels && (typeof labels==='object')) && (!Array.isArray(labels))) ? Object.fromEntries(Object.entries(labels).filter(([,value])=>typeof value==='string'&&value.trim())) : ({});
  return selectLanguageText(names,lang,ui.t("ProfileMemberships.unnamed_organisation"),ui.language);
};
const hasName=(item:HistoryItem)=>item.body?.prefLabel&&typeof item.body.prefLabel==='object'&&!Array.isArray(item.body.prefLabel)&&Object.values(item.body.prefLabel).some(value=>typeof value==='string'&&value.trim());

export function ProfileMemberships({profile,lang,roleName,date,retry}:{profile:MemberProfile;lang:string;roleName:(role:string)=>string;date:(value:string,lang:string)=>string;retry:()=>void}) {
  const ui = useUiI18n();
  const history=profile.membershipHistory;
  const current=profile.currentAffiliation?.status==='matched',today=profile.currentAffiliation?.day;
  // Term 10 opened on 2024-07-16; continuous service from earlier terms does not make older memberships current.
  const since=[TERM_START,profile.parliamentaryService?.currentSince].filter(validDate).sort().at(-1)!;
  // An open end reads as ongoing only for a dated membership begun this term (and current service), not after today,
  // with no supplied end and no ended body.
  const ongoing=(item:HistoryItem)=>{
    const temporal=item.body?.temporal as {endDate?:unknown}|undefined;
    return current&&validDate(today)&&validDate(item.start)&&item.start>=since&&item.start<=today&&item.end==null
      &&!(temporal?.endDate!=null&&!(validDate(temporal.endDate)&&temporal.endDate>=today));
  };
  const row=({item,start,end,ongoing}:ReturnType<typeof profileMembershipPeriods>[number])=>{
    const name=itemName(item,lang, ui),role=roleCode(item),period=<Period start={start} end={end} ongoing={ongoing} lang={lang} date={date}/>;
    const ordinaryAffiliation=role==='MEMBER'&&['national-parties','political-groups'].includes(item.section);
    return <li key={item.index}>
      <p><span lang={name.language}>{name.text}</span></p>
      {!ordinaryAffiliation&&role&&(knownRoles.has(role)||officeRolesUi(ui)[role])&&<p><span lang={knownRoles.has(role) ? lang : 'en'}>{knownRoles.has(role) ? roleName(role) : officeRolesUi(ui)[role]}</span></p>}
      {period&&<p className="explorer-affiliation-dates">{period}</p>}
    </li>;
  };
  return <div className="explorer-profile-memberships" lang={ui.language}>
    {sectionsUi(ui).map(section=>{
      const items=history?.items.filter(item=>section.groups.some(([key])=>item.section===key))||[];
      const namesMissing=items.some(item=>!hasName(item));
            return <details key={section.title}>
        <summary>{section.title}</summary>
        {(!history?.observationAvailable) ? <p><UiMessage id="ProfileMemberships.membership_information_is_unavailable"/></p> : section.groups.map(([key,title])=>{
          const groupItems=profileMembershipPeriods(items.filter(item=>item.section===key),ongoing);
          return <section key={key}><h3>{title}</h3>{groupItems.length ? <ol>{groupItems.map(row)}</ol> : <p>{history.observationComplete ? <UiMessage id="ProfileMemberships.none_listed"/> : <UiMessage id="ProfileMemberships.membership_information_is_incomplete"/>}</p>}</section>;
        })}
        {(!history?.observationComplete||namesMissing)&&<p className="explorer-membership-gap">
          {(history?.observationAvailable && (!history.observationComplete)) ? ui.t("ProfileMemberships.some_memberships_unavailable") : ''}
          {namesMissing ? ui.t("ProfileMemberships.some_organisation_names_unavailable") : ''}
          <button type="button" onClick={retry}><UiMessage id="ProfileMemberships.retry_profile_details"/></button>
        </p>}
      </details>;
    })}
  </div>;
}
