import type {Choice} from './yourVoteStore.mjs';
export type ComparisonData={integrity:string;voters:{personId:string;position:string|null;status?:string}[];majorities:{id:string;position:string|null}[]};
export type ComparisonEntry={choice:Choice;outcome:string|null;decisionId:string|null};
export type Person={id:string;name:string};
export function ballotGroups<T extends {subject:string[]}>(rows:T[]):{key:string;subject:string[];rows:T[]}[];
export function summarizeVotes(entries:ComparisonEntry[],comparisons:Record<string,ComparisonData>,people:Person[]):{result:{agreed:number;total:number};groups:{id:string;agreed:number;total:number}[];members:(Person&{agreed:number;total:number})[]};
export function sessionDateRange(dates:string[],language:string):string;

export function brusselsToday(now?:number):string;
export function ballotVisible(sitting:string,source:string,now?:number):boolean;
