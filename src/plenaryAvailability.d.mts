import type {LegislationResponse} from './LegislationTypes';
export function brusselsDate(now?:number):string;
export function plenaryAvailability(detail:NonNullable<LegislationResponse['detail']>,kind:'speech'|'vote',today?:string):{state:'scheduled'|'today'|'awaiting'|'unknown'|'error';message:string}|null;
