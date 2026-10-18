import type {MemberVotesState} from './MemberVotes';
export type MemberVotesJourney={memberId:number|null;state:MemberVotesState;adoptedId:string|null;invalid:boolean};
export function isMemberVotesParam(key:string):boolean;
export function readMemberVotesJourney(query:URLSearchParams,memberId:number|null):MemberVotesJourney;
export function memberVotesJourneyParams(journey:MemberVotesJourney):URLSearchParams;
export function memberVotesHistoryMode(previous:MemberVotesState,next:MemberVotesState,requestedReplace?:boolean):'push'|'replace';
export function memberVotesScrollKey(journey:MemberVotesJourney):string;
export function captureMemberJourneyScroll(root:Document):number[];
export function restoreMemberJourneyScroll(root:Document,positions:unknown):void;
