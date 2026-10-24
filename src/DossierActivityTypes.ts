import type {Amendment} from './AmendmentTypes';
import type {MemberVote} from './MemberVotesTypes';

export type DossierSource={url:string;fetchedAt:string|null;language:string|null;stale?:boolean;refreshInProgress?:boolean;refreshError?:string|null};
export type DossierCoverage={status:'complete'|'partial'|'unavailable';gaps:string[];sources:DossierSource[];discovery?:{pending:boolean;refreshGaps:boolean;capacityGaps:string[]}|null};
export type DossierReference={id:string;reference:string;title:string;titleLanguage:string|null;source:DossierSource};
type ActivityBase={id:string;date:string|null;stage:string|null;source:DossierSource};
export type DossierRole=ActivityBase&{kind:'role';participationId?:string|null;personId:string;role:string;committee:string|null;dateBasis:'recorded'|'document';documentId?:string};
export type DossierSpeech=ActivityBase&{kind:'speech';start:string|null;title:string;titleLanguage:string|null;debateId:string;jointDebate:boolean};
export type DossierAmendment=ActivityBase&{kind:'amendment';dateBasis:'tabling'|'document';tabling:{status:'recorded'|'conflicting'|'unavailable';date:string|null;observations:{id:string;date:string|null;stage:string|null;source:DossierSource}[]};amendment:Amendment};
export type DossierVote=ActivityBase&{kind:'vote';vote:MemberVote};
export type DossierItem=DossierRole|DossierSpeech|DossierAmendment|DossierVote;
export type DossierSection='roles'|'speeches'|'amendments'|'votes';
export type DossierFilter='all'|DossierSection;
export type DossierCursor={offset:number;targetOffset:number};
export type DossierActivityResponse={version:1;procedure:DossierReference;memberId:string|null;participants:{id:string;name:string|null;roles:DossierRole[]}[];section:DossierSection;items:DossierItem[];pagination:DossierCursor&{limit:number;next:DossierCursor|null};coverage:DossierCoverage;generation:number;amendmentGeneration?:number;checkedTarget?:string};
export type DossierReferencesResponse={items:DossierReference[];coverage:{status:DossierCoverage['status'];gaps:({code?:string;message?:string;id?:string}|string)[]}};
