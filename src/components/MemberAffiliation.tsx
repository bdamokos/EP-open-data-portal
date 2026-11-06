import type {ReactNode} from 'react';
import {useUiI18n} from '../UiI18nReact';
import {groupLabel,groupLabelLanguage,groupColor} from '../groupLabels';
import {countryName} from '../interfaceLabels.mjs';
import './MemberAffiliation.css';

type MemberAffiliationProps={group?:string|null;country?:string|null;language:string;variant?:'line'|'tag';detail?:ReactNode};
export function MemberAffiliation({group,country,language,variant='line',detail}:MemberAffiliationProps) {
  const ui = useUiI18n();
  const code=/^[A-Z]{2}$/.test(country||'')?country:null;
  const label=group&&!/^(unknown|unavailable)$/i.test(group)?groupLabel(group, ui):null,name=code?countryName(language,code, ui):null;
  if(!label&&!name&&!detail)return null;
  const content=<>{label&&<span className="member-affiliation__group" lang={groupLabelLanguage(group!,ui)}><i aria-hidden="true" style={{background:groupColor(group!)}}/>{label}</span>}{label&&name&&' · '}{name&&<span lang={language}>{variant==='tag'?<><span aria-hidden="true">{code}</span><span className="member-affiliation__country-name">{name}</span></>:name}</span>}{detail&&<>{(label||name)&&' · '}{detail}</>}</>;
  return variant==='tag'?<span className="member-affiliation member-affiliation--tag" title={name||undefined}>{content}</span>:<p className="member-affiliation">{content}</p>;
}
