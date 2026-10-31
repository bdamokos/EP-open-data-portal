// Shared with the Members list: chairs and vice-chairs count as members.
export function matchesCommittee(member, committee, role='both') {
  return !committee || !!member.memberships?.some(value=>value.current && value.id===committee &&
    (role==='both' || (role==='substitute' ? value.role==='MEMBER_SUBSTITUTE' : value.role!=='MEMBER_SUBSTITUTE')));
}

export const organizationId = value => typeof value==='string' && /^(?:org\/|https:\/\/data\.europarl\.europa\.eu\/org\/)?([1-9]\d*|ep-[1-9]\d*)$/.test(value) ? value.split('/').at(-1) : '';
export function matchesOrganization(member, id) {
  return !id || !!member.organizationMemberships?.some(row=>row.id===id&&row.current);
}
export function membershipHref(id, language='en', name='') {
  const query=new URLSearchParams({organization:organizationId(id)});
  if(name)query.set('organization-name',name.slice(0,512));
  if(language!=='en')query.set('lang',language);
  return '?'+query;
}
