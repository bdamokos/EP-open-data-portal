export type JustificationRecord={
  justification?:string|null;language?:string|null;listId?:string|null;
  metadataSource?:{url?:string|null;language?:string|null}|null;
  wordingSource?:{url?:string|null;language?:string|null}|null;
  source?:{url?:string|null;language?:string|null}|null;
  fieldSources?:Record<string,unknown>|null;
};
export function amendmentJustification(record?:JustificationRecord|null):{text:string;language:string|null;source:unknown}|null;
