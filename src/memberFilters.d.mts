export function matchesCommittee(member:Pick<import('./explorerTypes').DirectoryMember,'memberships'>,committee:string,role?:string):boolean;

export function organizationId(value:unknown):string;
export function matchesOrganization(member:Pick<import('./explorerTypes').DirectoryMember,'organizationMemberships'>,id:string):boolean;
export function membershipHref(id:string,language?:string,name?:string):string;

export function organizationCoverageComplete(member:import('./explorerTypes').DirectoryMember,id:string):boolean;
