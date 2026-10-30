import type {Amendment,AmendmentCounts,AmendmentScope,AmendmentStage} from './AmendmentTypes';
import type {MemberVote} from './MemberVotesTypes';

export type DossierSource={url:string;fetchedAt:string|null;language:string|null;stale?:boolean;refreshInProgress?:boolean;refreshError?:string|null};
export type DossierCoverage={status:'complete'|'partial'|'unavailable';gaps:string[];sources:DossierSource[];checkedComplete?:boolean;checkedTargets?:string[];uncheckedTargets?:string[];retryable?:boolean;failedDebates?:string[];missingSpeechIds?:string[];retained?:boolean;discovery?:{pending:boolean;refreshGaps:boolean;capacityGaps:string[]}|null};
export type DossierReference={id:string;reference:string;title:string;titleLanguage:string|null;source:DossierSource};
type ActivityBase={id:string;date:string|null;stage:string|null;source:DossierSource};
export type DossierRole=ActivityBase&{kind:'role';participationId?:string|null;personId:string;role:string;committee:string|null;dateBasis:'recorded'|'document';documentId?:string};
export type DossierSpeech=ActivityBase&{kind:'speech';personId:string;start:string|null;title:string;titleLanguage:string|null;debateId:string;jointDebate:boolean};
export type DossierAmendment=ActivityBase&{kind:'amendment';dateBasis:'tabling'|'document';tabling:{status:'recorded'|'conflicting'|'unavailable';date:string|null;observations:{id:string;date:string|null;stage:string|null;source:DossierSource}[]};amendment:Amendment};
export type DossierVote=ActivityBase&{kind:'vote';vote:MemberVote};
export type DossierItem=DossierRole|DossierSpeech|DossierAmendment|DossierVote;
export type DossierSection='roles'|'speeches'|'amendments'|'votes';
export type DossierFilter='all'|DossierSection;
export type DossierCursor={offset:number;targetOffset:number};
export type DossierAmendmentEvidence={id:string;scope?:AmendmentScope;listId?:string|null;targetDocumentId?:string|null;date?:string|null;source?:DossierSource};
export type DossierParticipant={id:string;name:string|null;roles:DossierRole[];speeches?:Pick<DossierSpeech,'id'|'debateId'|'date'|'source'>[];amendmentCounts?:AmendmentCounts;amendments?:DossierAmendmentEvidence[]};
export type DossierActivityResponse={version:number;stage?:AmendmentStage;committee?:string|null;procedure:DossierReference;memberId:string|null;participants:DossierParticipant[];participantCoverage?:DossierCoverage;section:DossierSection;items:DossierItem[];pagination:DossierCursor&{limit:number;next:DossierCursor|null};coverage:DossierCoverage;generation:number;amendmentGeneration?:number;checkedTarget?:string};
export type DossierReferencesResponse={items:DossierReference[];coverage:{status:DossierCoverage['status'];gaps:({code?:string;message?:string;id?:string}|string)[]}};
