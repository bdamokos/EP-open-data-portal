import type {LegislationResponse} from './LegislationTypes';
export function brusselsDate(now?:number):string;
export function plenaryAvailability(detail:NonNullable<LegislationResponse['detail']>,kind:'speech'|'vote',today?:string, ui?: import('./uiI18n.mjs').UiFormatter):{state:'scheduled'|'today'|'awaiting'|'unknown'|'error';message:string}|null;
