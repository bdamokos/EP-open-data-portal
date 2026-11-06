import type {MemberVoteRecordAlignment,MemberVoteRecordResponse} from './MemberVoteRecordTypes';

export const MEMBER_VOTE_RECORD_LIMIT:5;
export function memberVoteRecordRoute(memberId:number|string,options?:{language?:string;scope?:'all'|'final';limit?:number;offset?:number;tag?:string|null}):string;
export function validateMemberVoteRecordResponse(data:unknown,request:{memberId?:number|string}):data is MemberVoteRecordResponse;
export type MemberVoteRecordFigures=MemberVoteRecordAlignment&{total:number;comparable:number;withShare:number|null;againstShare:number|null};
export function recordAlignment(data:MemberVoteRecordResponse,scope?:'all'|'final'):MemberVoteRecordFigures|null;
export type MemberVoteRecordComparison=NonNullable<MemberVoteRecordResponse['comparison']>['all'];
export function recordComparison(data:MemberVoteRecordResponse,scope?:'all'|'final'):MemberVoteRecordComparison;
export function recordShare(value:number|null|undefined):number|null;
export function memberVoteRecordTag(value:unknown):value is string;
