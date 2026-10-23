import type {MemberVoteSource} from './MemberVotesTypes';
export type MemberAttendanceSitting={
  sittingId:string;date:string;status:'observed'|'partial'|'not-published'|'unavailable';
  memberStatus:'listed-present'|'listed-excused'|'conflicting'|'not-listed'|null;
  excusedSupplied:boolean;
  counts:{present:number|null;excused:number|null;duplicatePresent:number;duplicateExcused:number;malformedReferences:number};
  conflictingIds:string[];source:MemberVoteSource|null;
  register:{documentId:string;pdf:{url:string;language:string}|null;issued:string|null;status:'available'|'not-published'|'unavailable';source:MemberVoteSource|null};
};
export type MemberAttendanceResponse={version:1;member:{id:string;mandateStatus:'not-assessed'};sittings:MemberAttendanceSitting[];attribution:string};
