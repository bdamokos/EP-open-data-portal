import {waitForRequest} from './request-budget.mjs';

export const PROFILE_MEMBERSHIPS_VERSION = 3;
export const reference = value => typeof value === 'string' ? value : typeof value?.id === 'string' ? value.id : '';
const local = value => reference(value).replace(/^https:\/\/data\.europarl\.europa\.eu\//, '');
export const validMembershipDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0,10) === value;
const category = (value, role, organization) => {
  const classification = local(value);
  if (classification === 'def/ep-entities/NATIONAL_POLITICAL_GROUP') return 'national-parties';
  if (classification === 'def/ep-entities/EU_POLITICAL_GROUP') return 'political-groups';
  if (/^def\/ep-entities\/(DELEGATION_PARLIAMENTARY|DELEGATION_PARLIAMENTARY_ASSEMBLY|DELEGATION_JOINT_COMMITTEE)$/.test(classification)) return 'delegations';
  if (/^def\/ep-entities\/(GOVERNING_BODY|WORKING_GROUP)$/.test(classification)) return 'other-roles';
  if (classification === 'def/ep-entities/EU_INSTITUTION' && /^org\/ep-[1-9]\d*$/.test(local(organization)) && /^def\/ep-roles\/(PRESIDENT|PRESIDENT_VICE|QUAESTOR)$/.test(local(role))) return 'other-roles';
  return null;
};
const source = record => ({url:record.url, fetchedAt:new Date(record.fetchedAt).toISOString(), stale:Boolean(record.stale || record.refreshError)});
const hasLabels = body => body?.prefLabel && typeof body.prefLabel==='object' && !Array.isArray(body.prefLabel) && Object.values(body.prefLabel).some(value=>typeof value==='string'&&value.trim());
const dateIssues = row => {
  const start=row.memberDuring?.startDate,end=row.memberDuring?.endDate;
  return [!validMembershipDay(start) && (start == null ? 'missing-start' : 'invalid-start'),
    !validMembershipDay(end) && (end == null ? 'missing-end' : 'invalid-end'),
    validMembershipDay(start) && validMembershipDay(end) && end < start && 'reversed-period'].filter(Boolean);
};

// Full source observations stay on this profile-only projection. Bodies are
// joined by exact URI and classification; isVersionOf never merges records.
export function profileMemberships(person, record) {
  const available=Array.isArray(person.hasMembership);
  const observations=available ? person.hasMembership : null;
  const observationIssues=(observations || []).flatMap((raw,index)=>{
    const object=raw && typeof raw==='object' && !Array.isArray(raw);
    const issues=[];
    if(!object)issues.push('invalid-observation');
    else {
      if(!reference(raw.organization))issues.push('missing-organization');
      if(!reference(raw.role))issues.push('missing-role');
      const mandate=local(raw.role)==='def/ep-roles/MEMBER_PARLIAMENT'&&/^org\/ep-[1-9]\d*$/.test(local(raw.organization));
      if(!reference(raw.membershipClassification)&&!mandate)issues.push('missing-classification');
      if(raw.memberDuring!=null&&(typeof raw.memberDuring!=='object'||Array.isArray(raw.memberDuring)))issues.push('invalid-period');
    }
    return issues.length?[{index,issues}]:[];
  });
  const observationComplete=available&&!observationIssues.length;
  const items=(observations || []).flatMap((raw,index) => {
    const section=category(raw?.membershipClassification,raw?.role,raw?.organization);
    if (!section) return [];
    return [{index,section,membershipId:reference(raw.id)||null,bodyId:reference(raw.organization)||null,
      role:reference(raw.role)||null,classification:reference(raw.membershipClassification)||null,
      start:raw.memberDuring?.startDate??null,end:raw.memberDuring?.endDate??null,
      dateIssues:dateIssues(raw),observation:raw,body:null}];
  }).sort((a,b)=> {
    const valid=row=>!row.dateIssues.length;
    return Number(valid(b))-Number(valid(a)) || (valid(a) ? b.start.localeCompare(a.start) || b.end.localeCompare(a.end) : 0) || a.index-b.index;
  });
  return {version:PROFILE_MEMBERSHIPS_VERSION,observationAvailable:available,observationComplete,observationIssues,observations,items,
    labelsComplete:items.length===0,dateIssues:items.some(row=>row.dateIssues.length),sources:[source(record)],
    complete:observationComplete,error:!available?'Membership information is unavailable.':observationIssues.length?'Some membership records are incomplete.':null};
}

export function createProfileMembershipReader({request}={}) {
  const rejectedBodies=new Set();
  const reject=id=>{
    rejectedBodies.delete(id);rejectedBodies.add(id);
    if(rejectedBodies.size>256)rejectedBodies.delete(rejectedBodies.values().next().value);
  };
  return async function readMemberships(history,{signal,parentSignal}={}) {
    parentSignal?.throwIfAborted();
    const prioritized=history.items.slice().sort((a,b)=> Number(b.section==='national-parties'||b.section==='political-groups')-Number(a.section==='national-parties'||a.section==='political-groups') || Number(validMembershipDay(b.start))-Number(validMembershipDay(a.start)) || (validMembershipDay(a.start)&&validMembershipDay(b.start)?b.start.localeCompare(a.start):0) || a.index-b.index);
    const ids=[...new Set(prioritized.map(row=>row.bodyId).filter(Boolean))];
    const selected=ids.filter(id=>/^org\/(?:[1-9]\d*|ep-[1-9]\d*)$/.test(local(id))).slice(0,16);
    const bodies=new Map();let cursor=0;
    await Promise.all(Array.from({length:Math.min(2,selected.length)},async()=>{
      while(cursor<selected.length&&!signal?.aborted) {
        const id=selected[cursor++];
        try {
          const record=await waitForRequest(request('/corporate-bodies/'+local(id).slice(4),{},{signal,staleWhileRevalidate:true,force:rejectedBodies.has(id)}),signal);
          const body=record.payload?.data?.[0];
          // Numeric identifiers alone cannot validate a different published URI.
          if(record.payload?.data?.length!==1 || String(body?.identifier)!==local(id).slice(4) || local(body.id)!==local(id)) {reject(id);continue;}
          if(!hasLabels(body)||history.items.some(row=>row.bodyId===id&&local(row.classification)!==local(body.classification)))reject(id);
          else rejectedBodies.delete(id);
          bodies.set(id,{...body,source:source(record)});
        } catch {parentSignal?.throwIfAborted();}
      }
    }));
    parentSignal?.throwIfAborted();
    const items=history.items.map(row=>{
      const body=bodies.get(row.bodyId);
      return {...row,body:body&&local(body.classification)===local(row.classification)?body:null};
    });
    const labelsComplete=items.every(row=>hasLabels(row.body) && !row.body.source.stale);
    const complete=history.observationComplete&&labelsComplete;
    return {...history,items,labelsComplete,complete,
      sources:[...history.sources,...[...bodies.values()].map(body=>body.source)],
      error:!history.observationComplete?history.error:labelsComplete?null:items.some(row=>!hasLabels(row.body))?'Some organisation names are unavailable. Their source identifiers are shown.':'Some organisation names could not be refreshed.'};
  };
}
