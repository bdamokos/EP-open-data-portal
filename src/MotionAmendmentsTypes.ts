import type {Amendment, AmendmentDecision, AmendmentOutcome, AmendmentSource, AmendmentSplit, AmendmentVariant} from './AmendmentTypes';
import type {DocumentFile} from './explorerTypes';

/** The server validates the complete term-10 identifier, including its numeric widths. */
export type MotionAmendmentsDocumentId = `${'B' | 'RC'}-10-${number}-${string}`;
export type MotionAmendmentsScope = 'all' | 'member';
export type MotionAmendmentsQuery = {
  document:MotionAmendmentsDocumentId;
  language:string;offset:number;limit:number;
} & ({scope:'all';member:string|null}|{scope:'member';member:string});
export type MotionAmendmentsFile = DocumentFile & {
  translationType:'original'|'unspecified';humanReviewStatus:'unspecified';
};
export type MotionAmendmentsText = {
  id:MotionAmendmentsDocumentId;reference:string;status:'indexed'|'unavailable';kind:'original'|'joint'|null;
  title:string;titleLanguage:string|null;date:string|null;
  files:MotionAmendmentsFile[];availableLanguages:string[];preferredFile:MotionAmendmentsFile|null;languageFallback:boolean|null;
  authors:{id:number;relationships:string[]}[];
  /** Authorship of this text only; neither joint-text nor amendment authorship is inherited. */
  memberAuthorship:{
    memberId:string|null;status:'not-requested'|'recorded'|'not-recorded'|'unavailable';
    relationships:string[];sources:AmendmentSource[];
  };
  sources:AmendmentSource[];generation:number|null;
};
export type MotionAmendmentsRelationship = {
  type:'is_derivative_of';from:MotionAmendmentsDocumentId;to:MotionAmendmentsDocumentId;sources:AmendmentSource[];
};
export type MotionAmendmentsRelatedText = MotionAmendmentsText & {relationship:MotionAmendmentsRelationship};

export type MotionAmendmentMemberMatch = {
  memberId:string|null;matched:boolean;aggregateMatched:boolean;
  basis:'aggregate'|'variant'|'aggregate-and-variant'|null;variantListIds:string[];
  /** not-recorded means checked proposers do not match, not a complete history of the member. */
  status:'not-requested'|'recorded'|'not-recorded'|'unavailable';
};
export type MotionAmendmentWording = {
  language:string|null;requestedLanguage:string;languageFallback:boolean|null;
  originalStatus:'available'|'withheld'|'unavailable';proposedStatus:'available'|'withheld'|'unavailable';
};
export type MotionAmendmentDistribution = {url:string;language:string|null;byteSize:number|null};
export type MotionAmendmentEvidence = {
  textParserVersion?:string|null;justification?:string|null;gaps?:unknown[];
  fieldSources?:Record<string,AmendmentSource|null>;
  sourceFreshness?:{
    version:number;status:'fresh'|'failed'|'unverified'|'pending';
    distributionState:'available'|'empty'|'unavailable'|'unknown';
    descriptor:MotionAmendmentDistribution|null;sourceDescriptor:MotionAmendmentDistribution|null;
    failedAt?:string|number|null;retryAfter?:string|number|null;error?:unknown;
  }|null;
};
export type MotionAmendmentVariant = AmendmentVariant & MotionAmendmentEvidence & {
  memberMatch:MotionAmendmentMemberMatch;wording:MotionAmendmentWording;
};
export type MotionAmendmentDecision = AmendmentDecision & {
  scope:'whole-amendment'|'split-part'|'unresolved-split';
};
export type MotionAmendmentSplit = AmendmentSplit & {wordingGrounding:'not-validated'};
export type MotionAmendment = Omit<Amendment,'variants'|'decisions'|'splitParts'> & MotionAmendmentEvidence & {
  requestedLanguage:string;memberMatch:MotionAmendmentMemberMatch;wording:MotionAmendmentWording;
  variants?:MotionAmendmentVariant[];decisions:MotionAmendmentDecision[];splitParts:MotionAmendmentSplit[];
  /** Uses whole-amendment decisions only; never promotes one split-part decision to the whole. */
  wholeAmendmentOutcome:AmendmentOutcome;
};
export type MotionAmendmentsCoverage = {
  complete:boolean;observationComplete:boolean;indexed:boolean;
  indexStatus:'indexed'|'not-indexed';
  resultState:'records'|'not-indexed'|'no-indexed-member-matches'|'observed-empty'|'unavailable';
  /** Background work anywhere in the index, not a processing claim for this target. */
  backgroundPending:boolean;backgroundPendingScope:'index';targetProcessing:'unknown';
  /** Completeness covers accepted indexed sources, never a parliamentary census. */
  observationScope:'indexed-plenary-amendment-sources';
  gaps:unknown[];lastUpdated:string|null;parserVersion:string;scope:'plenary';
  servingGeneration:number;workingGeneration:boolean;
};
export type MotionAmendmentsPage = {
  schemaVersion:1;text:MotionAmendmentsText;
  relations:{originalMotions:MotionAmendmentsRelatedText[];jointMotions:MotionAmendmentsRelatedText[];complete:false;limit:5};
  scope:{documentId:MotionAmendmentsDocumentId;memberId:string|null;results:MotionAmendmentsScope;requestedLanguage:string};
  items:MotionAmendment[];total:number;totals:{allIndexed:number;memberMatched:number|null};offset:number;limit:number;
  coverage:MotionAmendmentsCoverage;snapshots:{amendments:number;text:number|null};
};
