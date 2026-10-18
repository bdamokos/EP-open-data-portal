import type {PublicationDocument} from './explorerTypes';

export type DocumentContextRequest={documentId:string;amendmentId?:string;listId?:string;view:'document'|'adopted';onBack:()=>void};
export type ContextSource={url:string;fetchedAt:string;contentHash:string;stale:boolean;refreshInProgress:boolean;refreshError:string|null;language?:string;resolvedSourceUrl?:string};
export type DocumentContextResponse={
  version:1;
  documentId:string;
  requestedLanguage:string;
  document:PublicationDocument|null;
  related:{status:'not-requested'|'available'|'partial'|'unavailable';items:(Omit<PublicationDocument,'selectedText'>&{relationship:{from:string;field:'adopts';to:string};source:ContextSource})[];gaps:string[]};
  amendment:null|{id:string;status:'available'|'unavailable';basis:'index'|'published-list'|null;variants:{listId:string;language:string;targetLabel:string|null;originalText:string;proposedText:string;authors:{name:string;personId?:string|null;status?:string}[];source:Partial<ContextSource>|null;sourceFreshness?:{status:string}|null;parserVersion?:string;gaps:unknown[]}[];gaps:string[]};
  target:{status:'found'|'unavailable'|'ambiguous'|'not-requested';paragraphs:number[];basis:'quoted-original'|'published-reference'|null;relation:'at'|'before'|'after'|null;quoteMatches:boolean|null;reason:string|null;evidence?:{amendmentId:string;listId:string;wordingSource:Partial<ContextSource>|null;referenceDecisions:{id:string;reference:string;language:'en';source:Partial<ContextSource>}[]}|null};
  sources:ContextSource[];
};
