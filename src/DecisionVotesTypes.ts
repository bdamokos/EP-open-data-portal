import type {MemberVoteSource} from './MemberVotesTypes';
export type DecisionVoter={personId:string;position:'for'|'against'|'abstaining'|null;status:'recorded'|'conflicting';group:{code:string;orgId:string;groupId:string}|null;groupStatus:string;groupSource:{url:string|null;retrievedAt:string|null;stale:boolean;membershipIds:string[]}|null};
export type DecisionVotesResponse={
  version:1;decisionId:string;sittingId:string;snapshotId:string;coverage:'complete'|'partial'|'unavailable';status:'found'|'unavailable';integrity:'complete'|'partial'|'conflicting'|'unavailable';voters:DecisionVoter[];
  groupHistory:{epoch:string;generation:number;catalogue:unknown}|null;
  decision:null|{id:string;date:string;method:string|null;outcome:string|null;ballotStatus:'conducted'|'not-conducted'|'unknown';totals:{for:number|null;against:number|null;abstaining:number|null};amendmentIds:string[];componentIds:string[];decidedIds:string[];referencesValid:boolean;namedVoters:{available:boolean;counts:{for:number;against:number;abstaining:number}|null;totalsMatch:boolean|null;conflictingPersonIds:string[];malformedReferences:number};sourceConflicts:unknown;evidencePaths:unknown[];sources:{decisions:MemberVoteSource[];results:MemberVoteSource[];agenda:MemberVoteSource[]}};
};
