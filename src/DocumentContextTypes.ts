import type {PublicationDocument} from './explorerTypes';

export type DocumentContextRequest={documentId:string;amendmentId?:string;listId?:string;wordingLanguage?:string|null;view:'document'|'adopted';onBack:()=>void};
export type ContextSource={url:string;fetchedAt:string;contentHash:string;stale:boolean;refreshInProgress:boolean;refreshError:string|null;language?:string|null;resolvedSourceUrl?:string;retrievedByteSize?:number;sourceVersion?:{byteSize:number|null;issued:string|null}};
export type DocumentContextResponse={
  version:3;
  documentId:string;
  requestedLanguage:string;
  requestedWordingLanguage?:string|null;
  document:PublicationDocument|null;
  related:{status:'not-requested'|'available'|'partial'|'unavailable';items:(Omit<PublicationDocument,'selectedText'>&{relationship:{from:string;field:'adopts';to:string};source:ContextSource})[];gaps:string[]};
  amendment:null|{id:string;status:'available'|'unavailable';basis:'index'|'published-list'|null;variants:{listId:string;language:string|null;baseline?:'motion-resolution'|'other'|null;targetLabel:string|null;targetLabelLanguage?:string|null;targetLabelSource?:Partial<ContextSource>|null;fieldSources?:Record<string,unknown>|null;wordingStatus:'available'|'unavailable';originalText:string|null;proposedText:string|null;authors:{name:string;personId?:string|null;status?:string}[];source:Partial<ContextSource>|null;sourceFreshness?:{status:string}|null;parserVersion?:string;textParserVersion?:string|null;wordingRetained?:boolean|null;proposerRetained?:boolean|null;recordRetained?:boolean|null;listRelationship?:string|null;metadataSource?:Partial<ContextSource>|null;proposerSource?:Partial<ContextSource>|null;gaps:unknown[]}[];gaps:string[]};
  target:{status:'found'|'unavailable'|'ambiguous'|'not-requested';paragraphs:number[];basis:'quoted-original'|'published-reference'|null;relation:'at'|'before'|'after'|null;quoteMatches:boolean|null;reason:string|null;evidence?:{amendmentId:string;listId:string;wordingLanguage:string|null;wordingSource:Partial<ContextSource>|null;targetLabelLanguage?:string|null;targetLabelSource?:Partial<ContextSource>|null;fieldSources?:Record<string,unknown>|null;referenceDecisions:{id:string;reference:string;language:'en';source:Partial<ContextSource>}[]}|null};
  placement?:null|{operation:'insert'|'replace'|'delete'|null;status:'placed'|'unresolved';reason?:string;span?:{start:number;end:number};insertAfter?:number;insertBefore?:number;evidence:{basis:string;label?:string;anchor?:string;reference?:string}[]};
  sources:ContextSource[];
};
