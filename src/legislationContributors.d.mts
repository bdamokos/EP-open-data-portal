import type {LegislationResponse} from './LegislationTypes';
import type {InsightStats} from './InsightTypes';
import type {SpeechSpeaker as DetailedSpeechSpeaker,SpeakerRoleLabel} from './explorerTypes';
import type {DirectoryMember} from './explorerTypes';
type Detail=NonNullable<LegislationResponse['detail']>;
export type SpeechSpeaker=Pick<DetailedSpeechSpeaker,'id'|'roleLanguage'|'roleLabels'|'roleSource'>&{name:string|null;role:string|null};
export type SpeechHeaders=Record<string,Record<string,Omit<SpeechSpeaker,'id'>>>;
export function mergeSpeechSpeakers(previous:SpeechHeaders,speeches:{id:string;people:SpeechSpeaker[]}[]):SpeechHeaders;
export function orderLegislationPeople(people:Detail['people'],roles:{id:string;role:string}[],members?:Pick<DirectoryMember,'groupCode'>[]):Detail['people'];
export function legislationContributors(detail:Detail,headers:SpeechHeaders):{people:Detail['people'];roles:{id:string;role:string}[];stats:InsightStats;excludedCount:number};

export function legislationOffice(detail:Detail,headers:SpeechHeaders,personId:string,language?:string):SpeakerRoleLabel|null;
