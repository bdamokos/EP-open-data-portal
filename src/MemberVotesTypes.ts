export type MemberVotePosition = 'for' | 'against' | 'abstaining';

export type MemberVoteSource = {
  httpStatus?:404;
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
  stopReason:'end'|'no-content'|'not-found'|'repeated-page'|'page-budget'|'row-budget'|'error'|'not-scanned';
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
    basis:'exact-component-reference'|'english-reference-label'|'invalid-component-reference'|'unclassified';
  };
  actualPosition:{
    status:'recorded'|'no-record'|'unavailable'|'conflicting'|'not-conducted';
    position:MemberVotePosition|null;
  };
  intention:{status:'reported'|'not-reported'|'unavailable';positions:MemberVotePosition[]};
  sourceConflicts:MemberVoteSourceConflicts|null;
  totals:Record<MemberVotePosition,number|null>;
  namedVoters:{
    available:boolean;
    counts:Record<MemberVotePosition,number>|null;
    totalsMatch:boolean|null;
    conflictingPersonIds:string[];
    malformedReferences:number;
  };
  subjectId:string|null;
  resultRelationship:{inverseResultIds:string[];forwardResultIds:string[];binding:'consistent'|'single-direction'|'ambiguous'|'unlinked'};
  parts:MemberVotePart[];
  rollCallRequesters:MemberVoteRequester[];
  evidenceGaps:MemberVoteEvidenceGap[];
  evidencePaths:MemberVoteEvidencePath[];
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
  version:2;
  member:{id:string;uri:string;mandateStatus:'not-assessed';historicalGroupStatus:'not-collected'};
  period:{kind:'week'|'sitting';week:string|null;sittingId:string|null;from:string|null;to:string|null};
  snapshotId:string;
  positions:'all'|'recorded';
  subjects:MemberVoteSubject[];
  pagination:{offset:number;limit:number;returned:number;observedTotal:number;filteredTotal:number;nextOffset:number|null};
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


export type MemberVoteEvidencePath = {
  sourceUrl:string;
  contentHash:string;
  jsonPointer:string|null;
};
export type MemberVoteEvidenceGap = {
  code:string;
  id?:string;
  field?:string;
  index?:number;
  language?:string;
  details?:MemberVoteEvidenceGap[];
};
export type MemberVoteComponent = {
  componentId:string;
  uri:string;
  requestUri:string|null;
  number:string|number|null;
  contentByLanguage:Record<string,{sourceLiteral:string;text:string|null}>;
  gaps:MemberVoteEvidenceGap[];
  evidencePaths:MemberVoteEvidencePath[];
};
export type MemberVotePart = MemberVoteComponent & {
  requestId:string;
  resultId:string;
  requestScopeByLanguage:Record<string,string>;
  contextComponents:MemberVoteComponent[];
};
export type MemberVoteRequester = {
  id:string;
  uri:string;
  type:string;
  scopeByLanguage:Record<string,string>;
  organizationLabels:Record<string,string>;
  organizationReferences:string[];
  organizationAliasReferences:string[];
  binding:'exact-decision-was_motivated_by';
  evidencePaths:MemberVoteEvidencePath[];
};
export type MemberVoteWholeTextDecision = Pick<MemberVote,'id'|'uri'|'date'|'scope'|'method'|'outcome'|'ballotStatus'|'actualPosition'|'intention'|'totals'|'evidencePaths'|'evidenceGaps'>;
export type MemberVoteSubject = {
  id:string;
  uri:string;
  titles:Record<string,string>;
  title:string|null;
  titleLanguage:string|null;
  documentIds:string[];
  agendaItemIds:string[];
  declaredDecisionIds:string[];
  observedDecisionIds:string[];
  counts:{observed:number;filtered:number;page:number};
  wholeTextDecisions:MemberVoteWholeTextDecision[];
  gaps:MemberVoteEvidenceGap[];
  evidencePaths:MemberVoteEvidencePath[];
  sources:{results:MemberVoteSource[];decisions:MemberVoteSource[]};
};


export type MemberVoteSourceConflicts = {
  fields:string[];
  census:Record<string,unknown>;
  named:Record<string,unknown>;
  observations:{stream:'census'|'named';values:Record<string,unknown>;evidencePaths:MemberVoteEvidencePath[]}[];
};
