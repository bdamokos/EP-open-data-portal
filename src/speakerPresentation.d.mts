import type {SpeechSpeaker,Intervention} from './explorerTypes';
export type SpeakerTerm={text:string;language:string};
export function speakerTerm(key:string,language?:string):SpeakerTerm;
export function speakerPresentation(person:Partial<SpeechSpeaker>|null|undefined,language?:string,options?:{chair?:boolean;intervention?:Pick<Intervention,'speaker'|'onBehalfOf'>}):{name:SpeakerTerm;roles:SpeakerTerm[];nameUnavailable:boolean};
