import type {LegislationResponse} from './LegislationTypes';
export function brusselsDate(now?:number):string;
export function speechAvailability(detail:NonNullable<LegislationResponse['detail']>,today?:string, ui?: import('./uiI18n.mjs').UiFormatter):{state:'scheduled'|'today'|'awaiting'|'unknown'|'error';message:string}|null;
