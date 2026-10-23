import type {Directory,DirectoryMember} from './explorerTypes';
import type {SavedItem} from './bookmarks.mjs';
import type {MembershipSnapshot} from './followMembership.mjs';
export const COVERAGE_KEY:string;
export type Coverage={dimension:'country'|'group'|'committee';value:string;enrolledAt:number;members:string[];dismissed:string[];pending:string[];last:Record<string,string|string[]|null>};
export type CoverageReason={context:string;reason:string};
export function coverageReason(coverage:Coverage,member:DirectoryMember,directory:Directory,events?:unknown[],language?:string):CoverageReason;
export function createCoverageStore(storage:Storage|null,notify?:()=>void,clock?:()=>number):{
 snapshot:()=>{version:number;coverages:Coverage[];followed:string[];storageError:boolean};syncFollows:(items:SavedItem[])=>void;retryStorage:()=>boolean;reload:()=>void;
 observe:(directory:Directory|null,items:SavedItem[],error?:boolean)=>void;observeMembership:(snapshot:MembershipSnapshot)=>void;
 suggestions:()=>{member:DirectoryMember;reasons:CoverageReason[]}[];dismiss:(id:string|number)=>boolean;
};
