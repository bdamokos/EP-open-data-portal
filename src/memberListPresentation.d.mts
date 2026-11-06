import type {Committee,DirectoryMember} from './explorerTypes';

export const memberListPageSize:number;
export function queryMemberView(value:unknown):'cards'|'list'|null;
export function effectiveMemberView(view:'cards'|'list'|null,narrow:boolean):'cards'|'list';
export function memberCommittees(member:Pick<DirectoryMember,'memberships'>,committees:Pick<Committee,'id'|'code'>[]):{code:string;substitute:boolean}[]|null;
export function memberParty(member:Pick<DirectoryMember,'organizationMemberships'>,parties?:Record<string,string>|null):string|null;
export type MemberSort={key:'name'|'group'|'country'|null;descending?:boolean};
export function sortMembers<T extends {id:number;lastName?:string;firstName?:string}>(members:T[],sort:MemberSort,labels:{group:(member:T)=>string;country:(member:T)=>string;collate:(a:string,b:string)=>number}):T[];
