import type {SourceAvailability} from '../server/source-availability.mjs';
export type CoverageNotice={kind:'speech-records';count:number;dates:string[]}|{kind:'question'|'document';id:string;sourceUrl:string;retained?:boolean}|{kind:'speaker-list'|'question-list'|'speech-list'|'dossier-list'|'records';start:string|null;end:string|null};
export function coverageNotices(evidence:SourceAvailability|SourceAvailability[],scope?:{start?:string|null;end?:string|null}):CoverageNotice[];
