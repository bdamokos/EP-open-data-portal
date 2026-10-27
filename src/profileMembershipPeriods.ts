import type {ProfileMembershipHistory} from './explorerTypes';
import {validDate} from './Period';

type Item=ProfileMembershipHistory['items'][number];
type DisplayPeriod={item:Item;start:unknown;end:unknown;ongoing:boolean;items:Item[]};
const local=(value:unknown)=>typeof value==='string'?value.replace(/^https:\/\/data\.europarl\.europa\.eu\//,''):'';
const termStarts=new Set(['1979-07-17','1984-07-24','1989-07-25','1994-07-19','1999-07-20','2004-07-20','2009-07-14','2014-07-01','2019-07-02','2024-07-16']);
const family=(item:Item)=>{
  const value=local(item.body?.isVersionOf);
  return /^org\/[A-Z][A-Z0-9_-]*$/.test(value)?value:'';
};
const sameBody=(a:Item,b:Item)=>Boolean(local(a.bodyId)&&local(a.bodyId)===local(b.bodyId)||family(a)&&family(a)===family(b));
const day=(value:string)=>Date.parse(value+'T12:00:00Z')/86400000;
const dated=(item:Item)=>validDate(item.start)&&(item.end==null||validDate(item.end)&&item.end>=item.start);
const partySignature=(item:Item)=>{
  const body=item.body;
  if(item.section!=='national-parties'||!body||body.source.stale||local(body.id)!==local(item.bodyId)
    ||local(body.classification)!=='def/ep-entities/NATIONAL_POLITICAL_GROUP')return null;
  const countries=body.represents,code=body.label,names=body.prefLabel;
  if(!Array.isArray(countries)||countries.length!==1||typeof countries[0]!=='string'
    ||!/^http:\/\/publications\.europa\.eu\/resource\/authority\/country\/[A-Z]{3}$/.test(countries[0])
    ||typeof code!=='string'||!code.trim()||/^[-–—]$/.test(code.trim())
    ||!names||typeof names!=='object'||Array.isArray(names)||!Object.keys(names).length
    ||Object.values(names).some(value=>typeof value!=='string'||!value.trim()))return null;
  return JSON.stringify([countries[0],code,Object.entries(names).sort(([a],[b])=>a.localeCompare(b))]);
};
const samePartyAcrossTerms=(a:Item,b:Item)=>{
  // The approved fallback groups display periods only; it supplies no canonical identity.
  if(family(a)&&family(b)&&family(a)!==family(b))return false;
  const before=a.body?.temporal as {endDate?:unknown}|undefined;
  const after=b.body?.temporal as {startDate?:unknown}|undefined;
  const signature=partySignature(a);
  return Boolean(signature&&signature===partySignature(b)&&validDate(b.start)&&termStarts.has(b.start)
    &&before?.endDate===a.end&&after?.startDate===b.start);
};

// Original observations stay intact. The last row supplies its label and current-status evidence.
export function profileMembershipPeriods(items:Item[],ongoing:(item:Item)=>boolean) {
  const periods:DisplayPeriod[]=[];
  for(const item of items.slice().sort((a,b)=>String(a.start).localeCompare(String(b.start))||a.index-b.index)) {
    const candidates=periods.filter(prior=>prior.item.section===item.section&&item.role&&item.classification
      &&local(prior.item.role)===local(item.role)&&local(prior.item.classification)===local(item.classification)
      &&validDate(prior.end)&&validDate(item.start)&&day(item.start)===day(prior.end)+1
      &&dated(item)&&prior.items.every(dated)
      &&new Set([...prior.items,item].map(family).filter(Boolean)).size<=1
      &&(sameBody(prior.item,item)||samePartyAcrossTerms(prior.item,item)));
    const prior=candidates.length===1?candidates[0]:undefined;
    const conflict=prior&&items.some(other=>{
      if(prior.items.includes(other)||other===item||other.section!==item.section)return false;
      if(!sameBody(other,item)&&!['national-parties','political-groups'].includes(item.section))return false;
      return !dated(other)||(other.start as string)<=(item.start as string)&&(other.end==null||(other.end as string)>=(prior.end as string));
    });
    if(prior&&!conflict) {
      prior.end=item.end;
      prior.ongoing=ongoing(item);
      prior.item=item;
      prior.items.push(item);
    } else periods.push({item,start:item.start,end:item.end,ongoing:ongoing(item),items:[item]});
  }
  const order=new Map(items.map((item,index)=>[item,index]));
  return periods.sort((a,b)=>Math.min(...a.items.map(item=>order.get(item)!))-Math.min(...b.items.map(item=>order.get(item)!)));
}
