import type {LegislationResponse} from './PocLegislationTypes';
import type {InsightStats} from './PocInsightTypes';
type Detail=NonNullable<LegislationResponse['detail']>;
export type SpeechSpeaker={id:string;name:string|null;role:string|null};
export type SpeechHeaders=Record<string,Record<string,{name:string|null;role:string|null}>>;
export function mergeSpeechSpeakers(previous:SpeechHeaders,speeches:{id:string;people:SpeechSpeaker[]}[]):SpeechHeaders;
export function legislationContributors(detail:Detail,headers:SpeechHeaders):{people:Detail['people'];roles:{id:string;role:string}[];stats:InsightStats;excludedCount:number};
