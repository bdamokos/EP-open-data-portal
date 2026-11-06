export type MemberVoteRecordAlignment={with:number;against:number;abstained:number;notComparable:number};
export type MemberVoteRecordDeparture={
  decisionId:string;sittingId:string;date:string;scope:'all'|'final';wholeText:boolean;
  position:'for'|'against'|'abstaining'|null;line:'for'|'against'|'abstaining'|null;
  text:string|null;language:string|null;
  subject:{text:string;language:string}|null;
};
export type MemberVoteRecordMedians=null|{group:{median:number;members:number}};
export type MemberVoteRecordResponse={
  version:2;
  member:{id:string;uri:string};
  period:{from:string;to:string|null};
  coverage:{sittings:number;included:number;missing:number;status:'complete'|'partial'|'pending'|'unavailable'};
  group:{code:string|null;status:'attached'|'non-attached'|'unavailable'};
  alignment:null|{all:MemberVoteRecordAlignment;wholeText:MemberVoteRecordAlignment};
  ballots:{chaired:number};
  departures:{
    scope:'all'|'final';offset:number;limit:number;total:number;
    items:MemberVoteRecordDeparture[];nextOffset:number|null;
  };
  comparison:null|{all:MemberVoteRecordMedians;final:MemberVoteRecordMedians};
  attribution:string;
};
