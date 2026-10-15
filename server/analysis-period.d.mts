export type AnalysisPeriod=number|'term';
export const CURRENT_TERM_START:string;
export function brusselsDay(now?:number):string;
export function periodEndMinimum(period:AnalysisPeriod):string;
