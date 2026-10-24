export type ProposalSourceStatus='available'|'partial'|'unavailable'|'unresolved'|'language-unavailable'|'format-unavailable';
export type ProposalBaselineRequest={reportId?:string;celex?:string;language?:string;documentReferences?:{field:string;raw:string}[]};
export type ProposalItem={kind:'act'|'annex';index:number;itemId:string;expressionId:string;manifestationId:string;languageUri:string;aliases:string[];buffer:Uint8Array;source:{url:string;resolvedSourceUrl:string;celex:string;language:string;itemId:string;expressionId:string;manifestationId:string;format:'DOCX';sha256:string;etag:string|null;lastModified:string|null;fetchedAt:string;checkedAt:string;stale:boolean;refreshError:string|null}};
export type ProposalBaseline={status:ProposalSourceStatus;celex:string|null;workId:string|null;language:string;items:ProposalItem[];gaps:(string|{code:string;itemId?:string;refreshError?:string|null})[];evidence:Record<string,unknown>[]};
export function proposalBaseline(request:ProposalBaselineRequest):Promise<ProposalBaseline>;
export function createProposalBaseline(options?:{documents?:unknown;request?:unknown}):(request:ProposalBaselineRequest)=>Promise<ProposalBaseline>;
