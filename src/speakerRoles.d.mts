import type {SpeechSpeaker,SpeakerRoleLabel} from './explorerTypes';
export function speakerRoleLabel(person:Partial<SpeechSpeaker>|null|undefined,language:string):SpeakerRoleLabel|null;
export function contributorOffice(person:Partial<SpeechSpeaker>|null|undefined,language?:string, ui?: import('./uiI18n.mjs').UiFormatter):SpeakerRoleLabel;
