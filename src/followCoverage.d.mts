import type {Directory,DirectoryMember} from './explorerTypes';
import type {SavedItem} from './bookmarks.mjs';
import type {MembershipSnapshot} from './followMembership.mjs';
export const COVERAGE_KEY:string;
export type Coverage={dimension:'country'|'group'|'committee';value:string;enrolledAt:number;members:string[];dismissed:string[];pending:string[]};
export type CoverageReason={context:string;reason:string};
export function coverageReason(coverage:Coverage,member:DirectoryMember,directory:Directory,events?:unknown[],language?:string):CoverageReason;
export function createCoverageStore(storage:Storage|null,notify?:()=>void,clock?:()=>number):{
 snapshot:()=>{version:number;coverages:Coverage[];followed:string[];last:Partial<Record<Coverage['dimension'],Record<string,string|string[]|null>>>;unresolvedFollows:Partial<Record<Coverage['dimension'],{id:string;followedAt:number}[]>>;cancelled:(Pick<Coverage,'dimension'|'value'>&{cancelledAt:number})[];storageError:boolean};syncFollows:(items:SavedItem[])=>void;retryStorage:()=>boolean;reload:()=>void;
 observe:(directory:Directory|null,items:SavedItem[],error?:boolean)=>void;observeMembership:(snapshot:MembershipSnapshot)=>void;
 suggestions:()=>{member:DirectoryMember;reasons:CoverageReason[]}[];dismiss:(id:string|number)=>boolean;
};
