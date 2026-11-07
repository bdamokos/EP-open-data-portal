export type MemberVoteRecordAlignment={with:number;against:number;abstained:number;notComparable:number};
export type MemberVoteRecordDeparture={
  decisionId:string;sittingId:string;date:string;scope:'all'|'final';wholeText:boolean;
  position:'for'|'against'|'abstaining'|null;line:'for'|'against'|'abstaining'|null;
  text:string|null;language:string|null;
  subject:{text:string;language:string}|null;
};
export type MemberVoteRecordBreakdownRow={key:string;label:string;language:string;comparable:number;withGroup:number;share:number};
export type MemberVoteRecordBreakdownList={eligible:number;rows:MemberVoteRecordBreakdownRow[]};
export type MemberVoteRecordMedians=null|{group:{median:number;members:number}};
export type MemberVoteRecordResponse={
  version:5;
  member:{id:string;uri:string};
  period:{from:string;to:string|null};
  coverage:{sittings:number;included:number;missing:number;unprojectedDecisions:number;status:'complete'|'partial'|'pending'|'unavailable'};
  group:{code:string|null;status:'attached'|'non-attached'|'not-serving'|'unavailable'};
  alignment:null|{all:MemberVoteRecordAlignment;wholeText:MemberVoteRecordAlignment};
  ballots:{chaired:number};
  breakdown:null|{overall:number;topics:MemberVoteRecordBreakdownList;countries:MemberVoteRecordBreakdownList};
  departures:{
    scope:'all'|'final';tag:null|{key:string;label:string|null;language:string|null};offset:number;limit:number;total:number;
    items:MemberVoteRecordDeparture[];nextOffset:number|null;
  };
  comparison:null|{all:MemberVoteRecordMedians;final:MemberVoteRecordMedians};
  attribution:string;
};
