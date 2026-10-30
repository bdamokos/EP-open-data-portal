export type FinalTextSelection={
  documentId:string;amendmentId:string;listId:string;wordingLanguage:string|null;language:string;
};
export type FinalTextSource={url:string;contentHash?:string;sha256?:string;language?:string;[key:string]:unknown};
export type FinalTextDestination={
  kind:'parliament-adopted-text'|'final-eu-act';id:string;date:string|null;language:string;
  sourceUrls:string[];source:FinalTextSource;
};
export type FinalTextWording={
  status:'same-wording'|'some-wording-matches'|'different-wording'|'change-retained'|'unavailable';
  wholeProvision:'same'|'different'|null;operation:'insert'|'replace'|'delete'|null;
  mapping:null|{basis:string;from:string;to:string;officialLineage:false};
  passages:null|{original:string;proposed:string;baseline:{text:string;address:string;complete:true};destination:{text:string;address:string;complete:true}};
  components:unknown[];gaps:string[];
};
export type FinalTextStage={destination:FinalTextDestination;wording:FinalTextWording};
export type FinalTextResponse={
  version:number;comparisonVersion:number;
  selection:FinalTextSelection&{source:FinalTextSource|null;parserVersion:string|null};
  vote:{status:'available'|'unavailable';stage:string;scope:'individual-amendment';outcome:string|null;decisions:unknown[]};
  wording:FinalTextWording;destination:FinalTextDestination|null;stages:FinalTextStage[];
  lineage:{status:string;relationships:unknown[];gaps:string[]};provenance:unknown[];gaps:string[];
};
