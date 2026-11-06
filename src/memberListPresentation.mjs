import {compareMembers} from './memberOrder.mjs';

export const memberListPageSize=50;
export const queryMemberView=value=>value==='cards'||value==='list'?value:null;
// Phones read a list; wider screens start with portraits. An explicit choice wins.
export const effectiveMemberView=(view,narrow)=>view||(narrow?'list':'cards');

const codes=new Intl.Collator('en',{usage:'sort',sensitivity:'base'});
// Current committees as codes, members before substitutes; null while memberships are unknown.
export function memberCommittees(member,committees) {
  if(!member.memberships)return null;
  const known=new Map(committees.map(committee=>[committee.id,committee.code]));
  const rows=new Map();
  for(const row of member.memberships) {
    const code=row.current&&known.get(row.id);
    if(code)rows.set(code,(rows.get(code)??true)&&row.role==='MEMBER_SUBSTITUTE');
  }
  return [...rows].map(([code,substitute])=>({code,substitute}))
    .sort((a,b)=>Number(a.substitute)-Number(b.substitute)||codes.compare(a.code,b.code));
}

// The national party named by exactly one current membership with a retained label.
export function memberParty(member,parties) {
  const ids=new Set((member.organizationMemberships??[])
    .filter(row=>row.classification==='NATIONAL_POLITICAL_GROUP'&&row.current===true).map(row=>row.id));
  if(ids.size!==1)return null;
  const [id]=ids;
  return parties&&Object.hasOwn(parties,id)?parties[id]:null;
}

// `group` and `country` give each member's display label; members without one sort last in both directions.
export function sortMembers(members,{key,descending=false},{group,country,collate}) {
  if(!key)return members;
  const direction=descending?-1:1;
  const label=key==='group'?group:key==='country'?country:null;
  return [...members].sort((a,b)=>{
    if(!label)return direction*compareMembers(a,b);
    const x=label(a),y=label(b);
    if(!x||!y)return x?-1:y?1:compareMembers(a,b);
    return direction*collate(x,y)||compareMembers(a,b);
  });
}
