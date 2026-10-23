// Shared with the Members list: chairs and vice-chairs count as members.
export function matchesCommittee(member, committee, role='both') {
  return !committee || !!member.memberships?.some(value=>value.current && value.id===committee &&
    (role==='both' || (role==='substitute' ? value.role==='MEMBER_SUBSTITUTE' : value.role!=='MEMBER_SUBSTITUTE')));
}
