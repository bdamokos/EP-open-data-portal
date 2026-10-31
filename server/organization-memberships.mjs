import {reference,validMembershipDay} from './profile-memberships.mjs';
const local=value=>reference(value).replace(/^https:\/\/data\.europarl\.europa\.eu\//,'');
const tail=value=>reference(value).split('/').at(-1)||'';
const validId=value=>/^org\/(?:[1-9]\d*|ep-[1-9]\d*)$/.test(value);

// Unknown dates remain distinct from a proven non-current membership. A known
// body's own dates can rule out current membership, but never name a successor.
export function organizationMembershipStatus(row,day,body) {
  const temporal=body?.temporal;
  const datesKnown=validMembershipDay(row.start)&&(row.end==null||validMembershipDay(row.end)&&row.end>=row.start);
  if(datesKnown&&(row.start>day||row.end!=null&&row.end<day))return false;
  if((temporal?.startDate!=null&&!validMembershipDay(temporal.startDate))
    ||(temporal?.endDate!=null&&!validMembershipDay(temporal.endDate))
    ||(validMembershipDay(temporal?.startDate)&&validMembershipDay(temporal?.endDate)&&temporal.endDate<temporal.startDate))return null;
  if((validMembershipDay(temporal?.startDate)&&temporal.startDate>day)
    ||(validMembershipDay(temporal?.endDate)&&temporal.endDate<day))return false;
  if(!datesKnown)return null;
  return true;
}
export function organizationMembershipSnapshot(person,day,bodies=new Map()) {
  if(!Array.isArray(person.hasMembership))return {items:null,complete:false};
  let complete=true;
  const items=person.hasMembership.flatMap(m=>{
    if(!m||typeof m!=='object'||Array.isArray(m)||!validId(local(m.organization))){complete=false;return [];}
    const id=local(m.organization).slice(4),body=bodies.get(id);
    const row={id,membershipId:reference(m.id)||null,role:tail(m.role),classification:tail(m.membershipClassification),start:m.memberDuring?.startDate??null,end:m.memberDuring?.endDate??null};
    const current=organizationMembershipStatus(row,day,body);
    if(current===null)complete=false;
    return [{...row,current}];
  });
  return {items,complete};
}
