import type {VotePeriodWeek} from './plenaryPeriods.mjs';
import type {AgendaTopic,VoteSummary} from './LegislationTypes';

export function isHomeQuery(query:URLSearchParams):boolean;
export function headlineState(today:string,weeks?:VotePeriodWeek[],upcoming?:VotePeriodWeek[]):{case:string;city?:string|null;nextDate?:string};
export function defaultAgendaWeek(today:string,weeks?:VotePeriodWeek[],upcoming?:VotePeriodWeek[]):string|null;
export function agendaRows(topics:AgendaTopic[]|undefined,today:string,limit?:number):{day:string;topic:AgendaTopic}[];
export function votePicks(votes:VoteSummary[]|undefined,finalTextVoteIds?:string[]):{rule:'closest'|'divergent'|'recent';vote:VoteSummary;totals:{for:number;against:number;abstaining:number}}[];
export function unreadRows(items:any[],now:number):{item:any;entry:any}[];
export const HOME_COUNTRIES:string[];
export function procedureReference(ids:string[]|undefined):string|null;
