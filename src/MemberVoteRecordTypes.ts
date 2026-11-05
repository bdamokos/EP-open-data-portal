export type MemberVoteRecordAlignment={with:number;against:number;abstained:number;notComparable:number};
export type MemberVoteRecordDeparture={
  decisionId:string;sittingId:string;date:string;scope:'all'|'final';wholeText:boolean;
  position:'for'|'against'|'abstaining'|null;line:'for'|'against'|'abstaining'|null;
  text:string|null;language:string|null;
};
export type MemberVoteRecordResponse={
  version:1;
  member:{id:string;uri:string};
  period:{from:string;to:string|null};
  coverage:{sittings:number;included:number;missing:number;status:'complete'|'partial'|'unavailable'};
  group:{code:string|null;status:'attached'|'non-attached'|'unavailable'};
  alignment:null|{all:MemberVoteRecordAlignment;wholeText:MemberVoteRecordAlignment};
  ballots:{recorded:number;named:number;chaired:number};
  bySitting:{sittingId:string;date:string;withGroup:number|null;comparable:number|null}[];
  departures:{
    scope:'all'|'final';offset:number;limit:number;total:number;
    items:MemberVoteRecordDeparture[];nextOffset:number|null;
  };
  comparison:null|{group:{median:number;members:number};parliament:{median:number;members:number}};
  attribution:string;
};
