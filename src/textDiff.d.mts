export type TextDiffSegment={type:'equal'|'insert'|'delete';text:string};
export type TextDiffResult={status:'too-large'}|{status:'ok';segments:TextDiffSegment[];similarity:number};
export const TEXT_DIFF_LIMITS:Readonly<{characters:number;tokens:number;editDistance:number;work:number}>;
export function textDiff(original:string,proposed:string,language?:string|null):TextDiffResult;
