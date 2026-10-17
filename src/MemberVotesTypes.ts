export type MemberVotePosition = 'for' | 'against' | 'abstaining';

export type MemberVoteSource = {
  url:string;
  fetchedAt:string;
  contentHash:string;
  stale:boolean;
  refreshInProgress:boolean;
  refreshError:string|null;
};

export type MemberVoteSourcePageCoverage = {
  state:'complete'|'partial'|'unavailable';
  pages:number;
  rows:number;
  stopReason:'end'|'no-content'|'repeated-page'|'page-budget'|'row-budget'|'error'|'not-scanned';
  error:{code:string;message:string}|null;
  sources:MemberVoteSource[];
};

export type MemberVote = {
  id:string;
  uri:string;
  sittingId:string;
  date:string;
  titles:Record<string,string>;
  referenceTexts:Record<string,string>;
  title:string|null;
  titleLanguage:string|null;
  method:string|null;
  outcome:string|null;
  ballotStatus:'conducted'|'not-conducted'|'unknown';
  scope:{
    kind:'whole-text'|'amendment'|'split-part'|'procedural'|'unclassified';
    basis:'exact-component-reference'|'english-reference-label'|'unclassified';
  };
  actualPosition:{
    status:'recorded'|'no-record'|'unavailable'|'conflicting'|'not-conducted';
    position:MemberVotePosition|null;
  };
  intention:{status:'reported'|'not-reported'|'unavailable';positions:MemberVotePosition[]};
  sourceConflicts:{fields:string[];census:Record<string,unknown>;named:Record<string,unknown>}|null;
  totals:Record<MemberVotePosition,number|null>;
  namedVoters:{
    available:boolean;
    counts:Record<MemberVotePosition,number>|null;
    totalsMatch:boolean|null;
    conflictingPersonIds:string[];
    malformedReferences:number;
  };
  historicalGroup:null;
  context:{
    resultIds:string[];
    agendaItemIds:string[];
    documentIds:string[];
    procedureIds:string[];
    amendmentIds:string[];
    componentIds:string[];
    missingResultIds:string[];
    missingAgendaItemIds:string[];
    relationships:{from:string;field:string;to:string}[];
  };
  sources:{decisions:MemberVoteSource[];results:MemberVoteSource[];agenda:MemberVoteSource[]};
};

export type MemberVoteSittingCoverage = {
  sittingId:string;
  date:string;
  state:'complete'|'partial'|'unavailable';
  decisions:MemberVoteSourcePageCoverage;
  namedDecisions:MemberVoteSourcePageCoverage;
  results:MemberVoteSourcePageCoverage;
  agenda:MemberVoteSourcePageCoverage;
  completeness:{
    missingResultIds:string[];
    missingDecisionIds:string[];
    missingNamedDecisionIds:string[];
    unresolvedAgendaItemIds:string[];
    conflictingDecisionIds:string[];
    invalidSourceIds:string[];
    undeclaredChildResultIds:string[];
    declaredResultCount:number|null;
    declaredDecisionCount:number;
    complete:boolean;
  };
  observedDecisionCount:number;
};

export type MemberVotesResponse = {
  version:1;
  member:{id:string;uri:string;mandateStatus:'not-assessed';historicalGroupStatus:'not-collected'};
  period:{kind:'week'|'sitting';week:string|null;sittingId:string|null;from:string|null;to:string|null};
  snapshotId:string;
  pagination:{offset:number;limit:number;returned:number;observedTotal:number;nextOffset:number|null};
  items:MemberVote[];
  selected:{status:'found'|'not-found-in-scanned-data'|'unavailable'|'not-requested';item:MemberVote|null};
  coverage:{
    status:'complete'|'partial'|'unavailable';
    collectionComplete:boolean;
    termWide:false;
    expectedSittingIds:string[];
    scannedSittingIds:string[];
    failedSittingIds:string[];
    incompleteSittingIds:string[];
    catalogue:MemberVoteSourcePageCoverage;
    sittings:MemberVoteSittingCoverage[];
    basis:string;
  };
  attribution:string;
};
