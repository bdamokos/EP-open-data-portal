import type {LegislationResponse} from './LegislationTypes';
import type {InsightStats} from './InsightTypes';
import type {DirectoryMember} from './explorerTypes';
type Detail=NonNullable<LegislationResponse['detail']>;
export type SpeechSpeaker={id:string;name:string|null;role:string|null};
export type SpeechHeaders=Record<string,Record<string,{name:string|null;role:string|null}>>;
export function mergeSpeechSpeakers(previous:SpeechHeaders,speeches:{id:string;people:SpeechSpeaker[]}[]):SpeechHeaders;
export function orderLegislationPeople(people:Detail['people'],roles:{id:string;role:string}[],members?:Pick<DirectoryMember,'groupCode'>[]):Detail['people'];
export function legislationContributors(detail:Detail,headers:SpeechHeaders):{people:Detail['people'];roles:{id:string;role:string}[];stats:InsightStats;excludedCount:number};
