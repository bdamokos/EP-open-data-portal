import type {VotePeriodWeek} from './plenaryPeriods.mjs';
import type {AgendaTopic} from './LegislationTypes';

export function isHomeQuery(query:URLSearchParams):boolean;
export function headlineState(today:string,weeks?:VotePeriodWeek[],upcoming?:VotePeriodWeek[]):{case:string;city?:string|null;nextDate?:string};
export function defaultAgendaWeek(today:string,weeks?:VotePeriodWeek[],upcoming?:VotePeriodWeek[]):string|null;
export function agendaDays(topics:AgendaTopic[]|undefined,today:string,perDay?:number):{day:string;rows:AgendaTopic[];more:number;sittingId:string|null}[];
export function votePicks<T extends {id:string;date:string;totals:{for:number;against:number;abstaining:number};differing?:number|null}>(votes:T[]|undefined):{rule:'closest'|'split'|'recent';vote:T}[];
export function unreadRows(items:any[],now:number):{item:any;entry:any}[];
export const HOME_COUNTRIES:string[];
export function procedureReference(ids:string[]|undefined):string|null;
