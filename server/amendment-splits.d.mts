export const SPLIT_PARSER_VERSION: string;

export type SplitFailureReason = {code:string; message:string};
export type SplitOccurrences = {occurrences?:number[]; expectedCount?:number};
export type SplitSelector = (
  | {type:'all'}
  | ({type:'text'; quote:string} & SplitOccurrences)
  | {type:'delete_operation'; quote:string}
  | ({type:'character'; character:string; characterOccurrence:number; within:string} & SplitOccurrences)
  | {type:'difference'; base:SplitSelector; except:SplitSelector}
  | {type:'union'; items:SplitSelector[]}
) & {
  scope?:SplitSelector;
  binding?:{kind:'previous_part_exclusion'|'earlier_part_exclusion'; partId:string};
};
export type SplitPlan = SplitSelector & {
  grounding:'not_attempted';
  selectionDomain:'text'|'amendment_operations'|'mixed'|'unspecified';
};
export type SplitPart = {
  id:string|null;
  number:number|null;
  description:string|null;
  rawDescription:string|null;
  language:string;
  plan:SplitPlan|null;
  status:'parsed'|'unresolved';
  failure:SplitFailureReason|null;
  sourceDescriptions?:Record<string,unknown>;
  conflictingDescriptions?:Array<string|null>;
};
export type SplitFailure = SplitFailureReason & {
  requestId:string|null;
  partId:string|null;
  description:string|null;
  language:string;
  parserVersion:string;
  sourceUrl:string|null;
  fetchedAt:string|null;
  rawDescription?:string;
  sourceDescriptions?:Record<string,unknown>;
};
export function parseSplitRequest(
  request:unknown,
  options?:{sourceUrl?:string|null; fetchedAt?:string|null; language?:string},
): {requestId:string|null; parts:SplitPart[]; failures:SplitFailure[]};
