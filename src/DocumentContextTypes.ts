import type {ProposalDocument} from './proposalTypes';
import type {PublicationDocument} from './explorerTypes';

export type DocumentContextRequest={documentId:string;amendmentId?:string;listId?:string;wordingLanguage?:string|null;view:'document'|'adopted';onBack:()=>void};
export type ContextSource={url:string;fetchedAt:string;contentHash:string;stale:boolean;refreshInProgress:boolean;refreshError:string|null;language?:string|null;resolvedSourceUrl?:string;retrievedByteSize?:number;sourceVersion?:{byteSize:number|null;issued:string|null}};
export type DocumentContextResponse={
  version:4;
  baseline?:null|{kind:'commission-proposal';celex:string|null;workId:string|null;language:string;status:string;items:{kind:'act'|'annex';index:number;source:{url:string;resolvedSourceUrl?:string;fetchedAt:string;sha256:string;stale:boolean;refreshError:string|null}}[];gaps:unknown[];attribution:string};
  proposal?:null|{items:{kind:'act'|'annex';index:number;proposal:ProposalDocument}[]};
  documentId:string;
  requestedLanguage:string;
  requestedWordingLanguage?:string|null;
  document:PublicationDocument|null;
  related:{status:'not-requested'|'available'|'partial'|'unavailable';items:(Omit<PublicationDocument,'selectedText'>&{relationship:{from:string;field:'adopts';to:string};source:ContextSource})[];gaps:string[]};
  amendment:null|{id:string;status:'available'|'unavailable';basis:'index'|'published-list'|null;variants:{listId:string;language:string|null;baseline?:'commission-proposal'|'present-text'|'council-position'|'motion-resolution'|'other'|'unknown'|null;baselineSource?:{category:string;headings:{left:{raw:string|null;category:string};right:{raw:string|null;category:string}}[];conflicted:boolean;language:string|null;sourceUrl:string|null;fetchedAt:string|null}|null;documentReferences?:{field:string;raw:string;sourceRaw?:string;scope?:string}[]|null;targetPath?:{proposal:{raw:string;labels:{raw:string}[]}[];underlying:{document:string|null;raw:string;labels:{raw:string}[]}[];language?:string|null;sourceUrl?:string|null;fetchedAt?:string|null}|null;targetLabel:string|null;targetLabelLanguage?:string|null;targetLabelSource?:Partial<ContextSource>|null;fieldSources?:Record<string,unknown>|null;wordingStatus:'available'|'unavailable';originalText:string|null;proposedText:string|null;authors:{name:string;personId?:string|null;status?:string}[];source:Partial<ContextSource>|null;sourceFreshness?:{status:string}|null;parserVersion?:string;textParserVersion?:string|null;wordingRetained?:boolean|null;proposerRetained?:boolean|null;recordRetained?:boolean|null;listRelationship?:string|null;metadataSource?:Partial<ContextSource>|null;proposerSource?:Partial<ContextSource>|null;gaps:unknown[]}[];gaps:string[]};
  target:{status:'found'|'unavailable'|'ambiguous'|'not-requested';paragraphs:number[];basis:'quoted-original'|'published-reference'|null;relation:'at'|'before'|'after'|null;quoteMatches:boolean|null;reason:string|null;evidence?:{amendmentId:string;listId:string;wordingLanguage:string|null;wordingSource:Partial<ContextSource>|null;targetLabelLanguage?:string|null;targetLabelSource?:Partial<ContextSource>|null;fieldSources?:Record<string,unknown>|null;referenceDecisions:{id:string;reference:string;language:'en';source:Partial<ContextSource>}[]}|null};
  placement?:null|{operation:'insert'|'replace'|'delete'|null;status:'placed'|'unresolved';reason?:string;itemIndex?:number;originalText?:string;splice?:{start:{paragraph:number;offset:number};end:{paragraph:number;offset:number}};span?:{start:number;end:number};insertAfter?:number;insertBefore?:number;evidence:{basis:string;label?:string;anchor?:string;reference?:string}[]};
  sources:ContextSource[];
};
