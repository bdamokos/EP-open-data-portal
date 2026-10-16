export type AmendmentOutcome = 'ADOPTED' | 'REJECTED' | 'LAPSED' | 'WITHDRAWN' | 'mixed' | 'unavailable';
export type AmendmentSource = {url:string;fetchedAt?:string|number|null;language?:string|null;date?:string|null;dateBasis?:string|null};
export type AmendmentAuthor = {name:string;personId:string|number|null;method?:string|null;status?:string|null;evidence?:unknown};
export type AmendmentDecision = {
  id:string;sittingId?:string|null;date?:string|null;outcome?:string|null;method?:string|null;
  partId?:string|null;partNumber?:number|string|null;reference?:string|null;
  totals?:{for?:number|null;against?:number|null;abstaining?:number|null}|null;
  source?:string|AmendmentSource|null;sourceCandidates?:AmendmentSource[];provenance?:'exact'|'single-page'|'unavailable'|null;collective?:boolean;amendmentIds?:string[];
};
export type AmendmentSplitProvenance = {source?:AmendmentSource|null;sourceUrl?:string|null;fetchedAt?:string|number|null;sourceCandidates?:AmendmentSource[];provenance?:'exact'|'single-page'|'unavailable'|null};
export type AmendmentSplit = AmendmentSplitProvenance & {id:string|null;requestId?:string|null;componentIndex?:number|null;number?:number|string|null;description:string|null;language?:string|null;rawDescription?:string|null;sourceDescriptions?:Record<string,string>;plan?:Record<string,unknown>|null;status?:string;failure?:{code?:string;message?:string}|string|null};
export type AmendmentVariant = {
  listId?:string|null;date?:string|null;documentDate?:string|null;dateBasis?:string|null;language?:string|null;
  targetLabel?:string|null;originalText?:string|null;proposedText?:string|null;authors?:AmendmentAuthor[];
  committeeProposer?:string|null;onBehalfOf?:string|string[]|null;sources?:AmendmentSource[];justification?:string|null;
  wordingSource?:AmendmentSource|null;metadataSource?:AmendmentSource|null;proposerSource?:AmendmentSource|null;wordingRetained?:boolean;proposerRetained?:boolean;
};
export type Amendment = {
  id:string;number:number|string|null;listId?:string|null;targetDocumentId?:string|null;title?:string|null;date?:string|null;
  documentDate?:string|null;dateBasis?:string|null;committeeProposer?:string|null;conflicted?:boolean;variants?:AmendmentVariant[];
  wordingSource?:AmendmentSource|null;metadataSource?:AmendmentSource|null;proposerSource?:AmendmentSource|null;wordingRetained?:boolean;proposerRetained?:boolean;
  identifierBasis?:string;officialIds?:string[];
  procedureIds?:string[];targetLabel?:string|null;originalText?:string|null;proposedText?:string|null;language?:string|null;
  authors?:AmendmentAuthor[];onBehalfOf?:string|string[]|null;decisions?:AmendmentDecision[];splitParts?:AmendmentSplit[];
  outcome:AmendmentOutcome;topics?:{id:string;label:string;basis:'dossier'|'target'}[];sources?:AmendmentSource[];gaps?:unknown[];
};
export type AmendmentPage = {
  items:Amendment[];total:number;offset:number;limit:number;
  coverage:{complete:boolean;pending:boolean;gaps?:unknown[];lastUpdated?:string|null;parserVersion?:string|null};
  failures?:{total:number;unresolved:number};
};
export type AmendmentFailure = AmendmentSplitProvenance & {
  requestId:string|null;partId:string|null;registryRequestKey?:string;registryPartKey?:string;observationKey?:string|null;recordKind?:'request'|'component';componentIndex?:number|null;scope?:'request'|'component';description:string|null;language?:string|null;rawDescription?:string|null;sourceDescriptions?:Record<string,string>;parserVersion?:string|null;code?:string;message?:string;
  firstSeen?:string|null;lastSeen?:string|null;occurrences?:number;status?:string;
  firstOccurrence?:string|null;lastOccurrence?:string|null;count?:number;reason?:string|null;
};
export type AmendmentFailurePage = {items:AmendmentFailure[];total:number;offset:number;limit:number};
