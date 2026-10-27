import {groupLabel,groupColor} from '../groupLabels';
import {countryName} from '../interfaceLabels.mjs';
import './MemberAffiliation.css';

type MemberAffiliationProps={group?:string|null;country?:string|null;language:string;variant?:'line'|'tag'};
export function MemberAffiliation({group,country,language,variant='line'}:MemberAffiliationProps) {
  const code=/^[A-Z]{2}$/.test(country||'')?country:null;
  const label=group&&!/^(unknown|unavailable)$/i.test(group)?groupLabel(group):null,name=code?countryName(language,code):null;
  if(!label&&!name)return null;
  const content=<>{label&&<span className="member-affiliation__group" lang={['NI','TheLeft','Verts/ALE'].includes(group!)?'en':''}><i aria-hidden="true" style={{background:groupColor(group!)}}/>{label}</span>}{label&&name&&' · '}{name&&<span lang={language}>{variant==='tag'?code:name}</span>}</>;
  return variant==='tag'?<span className="member-affiliation member-affiliation--tag" title={name||undefined} aria-label={[label,name].filter(Boolean).join(', ')}>{content}</span>:<p className="member-affiliation">{content}</p>;
}
