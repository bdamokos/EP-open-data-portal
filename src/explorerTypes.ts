import type { MemberSummary } from "./types";
export interface Membership {
  id: string;
  role: string;
  classification: string;
  start: string | null;
  end: string | null;
  current: boolean;
}
export interface DirectoryMember extends MemberSummary {
  groupCode: string;
  memberships: Membership[] | null;
}
export interface Committee {
  id: string;
  code: string;
  names: Record<string, string>;
  classification: string;
}
export interface Directory {
  day: string;
  fetchedAt: string;
  members: DirectoryMember[];
  committees: Committee[];
  sync?: {
    lastSuccess: string | null;
    lastAttempt: string | null;
    changedMeps: number;
    changedCommittees: number;
    error: string | null;
  };
  index: {
    complete: boolean;
    loaded: number;
    total: number;
    failed: number;
    error: string | null;
  };
}
export interface MemberProfile extends DirectoryMember {
  birthDate?: string;
  birthPlace?: string;
  email?: string;
  accounts: string[];
  fetchedAt: string;
}
export interface SpeechSpeaker {
  id:string;
  name:string;
  role?:string|null;
  roleLanguage?:string|null;
  nameSource?:string;
  sittingRole?:'chair';
  nameVariants?:{value:string;script:string|null;language:string|null;source:string}[];
  roleLabels?:Record<string,{text:string;language:string}>;
  office?:{code:'president-parliament'|'vice-president-parliament';membershipId:string;start:string;end:string|null}|null;
  identitySources?:{url:string;fetchedAt:string;stale:boolean}[];
  identityIssues?:string[];
}
export interface Intervention {
  type:'speech'|'written'|'chair'|'procedure'|'oral-explanation-of-vote'|'catch-the-eye'|'blue-card-question'|'blue-card-intervention'|'blue-card-answer'|'blue-card-reaction'|'blue-card'|'unclassified';
  process:string|null;
  speaker:SpeechSpeaker|null;
  onBehalfOf:{id:string;uri:string;label:string;politicalGroup:boolean;source:string}[];
  headerAvailable:boolean;
  catchMarker:'start'|'end'|null;
  narrative:string|null;
  procedureKind:'note'|'chair-change'|null;
  chair:SpeechSpeaker|null;
  numbering:number|null;
  parentIds:string[];
  evidence:string|null;
  classificationSources?:{url:string;fetchedAt:string;interfaceLanguage:string;textLanguage:string;sha256:string;selector:string;basis:string}[];
}
export interface Speech {
  id: string;
  date: string;
  start: string | null;
  end: string | null;
  titles: Record<string, string>;
  kind: string;
  reference: string;
  originalLanguages: string[];
  participants: string[];
  websiteUrl: string | null;
  websiteLanguage: string | null;
  intervention?:Intervention;
}
export interface SpeechExchange {id:string;originalId:string;ids:string[];pairs:{questionId:string;answerId:string;questionerId:string;respondentId:string}[];basis:string}
export interface SpeechSequenceRow extends Speech {intervention:Intervention;exchangeId:string|null;replyTo:string|null}
export interface SpeechContext {
  speechId:string;intervention:Intervention;unavailable:boolean;sources:{url:string;fetchedAt:string;stale:boolean}[];
  debates:{id:string;titles:Record<string,string>;records:SpeechSequenceRow[];exchanges:SpeechExchange[];error?:string;retryAt?:number;coverage:{complete:boolean;expected:number|null;available:number;missingIds:string[];reassignedIds?:string[]};sources?:{url:string;fetchedAt:string;stale:boolean}[]}[];
}
export interface InterventionStatistics {
  restarted?:boolean;
  memberId:string;items:Speech[];counts:{groupOrations:number|null;blueQuestions:number|null;blueAnswers:number|null;blueReactions:number|null;catchTheEye:number|null};
  groups:{id:string;label:string;count:number}[];coverage:{complete:boolean;available:number;total:number|null;headers:number;unclassified:number;issues:string[]};
  nextPage:number|null;sources:{url:string;fetchedAt:string;stale:boolean}[];
}
export interface Publication {
  id: string;
  title: string;
  category: string;
  origin: string;
  url: string;
  documentId: string | null;
  detailsAvailable: boolean;
  publishedAt: string;
}
export interface ActivityPage {
  items: Publication[];
  limit: number;
  sourceUrl: string;
  fetchedAt: string;
}
export interface DocumentFile { url: string; language: string | null; format: string; byteSize?: number | null }
export interface CoAuthor { id:number; name:string|null; personUri:string; profileAvailable:boolean; role:'AUTHOR'|'QUESTION_AUTHOR'; sourceDocumentId:string; relationships:string[] }
export interface DocumentNote { id: string; label: string; text: string; links: string[]; linkSpans?: { start: number; end: number; url: string }[] }
export interface DocumentLink { paragraph: number; start: number; end: number; url: string }
export interface NoteAnchor { paragraph: number; offset: number; note: string; label: string }
export interface DocumentParagraphSource {
  path: string;
  ordinal: number;
  container: 'body' | 'table-cell' | 'other';
  containerPath: string;
  segment: number;
  complete: boolean;
}
export interface DocumentObject {
  paragraph: number;
  offset: number;
  path: string;
  kind: 'symbol' | 'drawing' | 'object' | 'math' | 'unsupported';
  status: 'mapped' | 'unresolved';
  replacement: string;
  role: 'leading-marker' | 'content';
  font?: string;
  code?: string;
}
export interface PublicationDocument {
  coAuthors?: CoAuthor[];
  coAuthorSource?: { documentApiUrl:string; documentFetchedAt:string; rosterApiUrl:string; rosterFetchedAt:string|null };
  id: string;
  titles: Record<string, string>;
  date: string | null;
  kind: string;
  roles: string[];
  files: DocumentFile[];
  answers: { id: string; date: string | null; titles: Record<string, string>; files: DocumentFile[] }[];
  selectedDocumentId?: string;
  selectedText?: {
    status: 'available' | 'unavailable' | 'error';
    paragraphs: string[];
    extractionWarnings?: string[];
    textLanguage: string | null;
    requestedLanguage: string;
    availableTextLanguages: string[];
    translationType: 'original' | 'unspecified' | null;
    sourceFormat: 'DOCX' | null;
    sourceUrl: string | null;
    fetchedAt: string | null;
    stale: boolean;
    refreshInProgress: boolean;
    refreshError: string | null;
    reason: string | null;
    extraction: 'official-docx-paragraphs' | null;
    nextRetryAt?: string | null;
    notesStatus?: 'extracted' | 'not-extracted';
    notes?: DocumentNote[];
    noteAnchors?: NoteAnchor[];
    documentLinks?: DocumentLink[];
    structureStatus?: 'extracted' | 'not-extracted';
    paragraphSources?: DocumentParagraphSource[];
    documentObjects?: DocumentObject[];
    extractionVersion?: number | null;
    sourceVersion?: { byteSize: number | null; issued: string | null } | null;
  };
}
export interface SpeechPage {
  items: Speech[];
  total: number;
  offset: number;
}
export interface SpeechDetail extends Speech {
  metadataSource?:{url:string;fetchedAt:string;headerSources?:{url:string;fetchedAt:string}[]};
  sourceFragmentKey?:string;
  speakers?:SpeechSpeaker[];
  xml: string | null;
  textLanguage: string | null;
  languageTags: string[];
  translationType: "original" | "machine" | "unspecified" | null;
  availableTextLanguages: string[];
  video: { available: false; reason: string };
  fetchedAt: string;
  textCache?: { sourceFetchedAt: string; stale: boolean; refreshInProgress: boolean; refreshError: string | null; availableLanguages: string[]; coverage: 'returned-languages-only' };
}

export interface StoredSpeechTranscript {
  id:string;
  available:boolean;
  xml?:string;
  textLanguage?:string;
  sourceFragmentKey?:string;
  translationType?:'original'|'machine'|'unspecified';
  availableTextLanguages?:string[];
  sourceUrl?:string;
  fetchedAt?:string;
  checkedAt?:string;
  metadata?:SpeechDetail;
  metadataUnavailable?:boolean;
}
export interface MotionOutcome {
  status: 'adopted' | 'rejected' | 'lapsed' | 'withdrawn' | 'unavailable';
  reason?: string;
  date?: string;
  method?: string;
  decisionId?: string;
  sittingId?: string;
  totals?: { for:number|null; against:number|null; abstaining:number|null } | null;
  sources?: { url:string; fetchedAt:string; language:string|null }[];
  refreshFailure?: { attemptedAt:string; coverage:{missingResultIds:string[];missingDecisionIds:string[]}; sources:{url:string;fetchedAt:string;language:string|null}[] } | null;
}
export interface RelatedJointMotion {
  sourceId:string;
  reference:string;
  title:string;
  url:string|null;
  outcome:MotionOutcome;
  memberAuthorship?:'recorded'|'not-recorded';
  documentFormat?:'PDF'|'DOCX'|null;
  documentLanguage?:string|null;
}
export interface JoinedActivity {
  id: string;
  sourceId: string;
  category: string;
  categoryLabel: string;
  recordKind: 'document' | 'answer' | 'speech';
  speechKind?: string;
  start?: string | null;
  end?: string | null;
  titles?: Record<string,string>;
  originalLanguages?: string[];
  websiteLanguage?: string | null;
  date: string;
  title: string;
  titleLanguage: string | null;
  reference: string;
  files: DocumentFile[];
  answerStatus?: 'answered' | 'awaiting';
  answerIds?: string[];
  resolutionOutcome?: MotionOutcome;
  relatedJointMotions?: RelatedJointMotion[];
  relatedQuestionId?: string;
  relatedQuestionTitle?:string;
  relatedQuestionTitles?:Record<string,string>;
  websiteUrl?: string | null;
  provenance: { apiUrl: string; sourceFetchedAt: string; role: string; relationship: string; procedureApiUrl?: string; stage?: string };
}
export interface JoinedActivityPage {
  categories: Record<string,string>;
  categoryGroups: {label:string;categories:string[]}[];
  categoryCoverage: Record<string,{status:'available'|'backfilling'|'incomplete-joins'|'source-not-verified';indexedCount:number;total:number|null;reason:string|null}>;
  unclassifiedMotionCount: number;
  items: JoinedActivity[];
  selectedItems: JoinedActivity[];
  offset: number;
  nextOffset: number | null;
  total: number | null;
  indexedTotal: number;
  cache: { complete:boolean; stale:boolean; lastSuccessfulRefresh:string|null; lastError:string|null; phase:string; currentMeps:number };
}
export interface ActivityIndexStatus {
  enabled: boolean;
  complete: boolean;
  phase: string;
  currentMeps: number;
  sourceCounts?: { speech:number; document:number; procedure:number };
  pendingSpeechRecoveries?: { count:number };
  progress?: { total: number; completed: number; retrying: number };
  lastSuccessfulRefresh: string | null;
  lastError: string | null;
}
export interface SpeechMedia {
  speechId: string;
  status: 'matched' | 'catalogue-missing' | 'catalogue-invalid' | 'missing-times' | 'invalid-duration' | 'not-recorded-speech' | 'metadata-unavailable' | 'outside-recording' | 'ambiguous' | 'audio-unverified' | 'audio-selection-unverified' | 'audio-unavailable';
  available: boolean;
  reason: string | null;
  embedUrl: string | null;
  originalEmbedUrl: string | null;
  requestedAudio: string;
  availableAudioLanguages: string[];
  audioVerification: string;
  initialAudio?: 'or';
  requiresAudioCheck?: boolean;
  audioMapping?: { schemaVersion: 1; channels: { slot:number; language:string; providerCode:string }[]; source:{ url:string; namespace:string; event:string; recordingId:string; sourceFetchedAt:string; stale:boolean; refreshError:string|null; payloadSha256:string }; codeOrderSource:{ url:string; sha256:string } } | null;
  selectionMethod?: string;
  selectionVerifiedLanguages?: string[];
  recording: null | { id: string; start: string; end: string; websiteUrl: string; officialEmbedUrl: string; sourceUrl: string; sourceFetchedAt: string; stale: boolean };
  clip: null | { startUtc: string; endUtc: string; speechStart: string; speechEnd: string; precision: string };
  provenance: { documentedSpeechApi: boolean; documentedMediaApi: boolean; htmlScraping: boolean; catalogueRefresh: unknown; catalogue?: unknown };
}
