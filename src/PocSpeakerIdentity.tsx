import type {SpeechSpeaker,Intervention} from './pocTypes';
import {speakerPresentation} from './pocSpeakerPresentation.mjs';
type RoleProps={person?:SpeechSpeaker|null;language:string;chair?:boolean;intervention?:Intervention};

export function SpeakerName({person,language,chair=false}:{person?:SpeechSpeaker|null;language:string;chair?:boolean}) {
  const {name}=speakerPresentation(person,language,{chair});
  return <span lang={name.language}>{name.text}</span>;
}
export function SpeakerRoles({person,language,chair=false,intervention}:RoleProps) {
  const {roles}=speakerPresentation(person,language,{chair,intervention});
  return <>{roles.map((role,index)=><span key={index} lang={role.language}>{index?' · ':''}{role.text}</span>)}</>;
}
export function SpeakerRoleLine({person,language,chair=false,intervention,className}:RoleProps&{className:string}) {
  if(!speakerPresentation(person,language,{chair,intervention}).roles.length)return null;
  return <p className={className}><SpeakerRoles person={person} language={language} chair={chair} intervention={intervention}/></p>;
}
