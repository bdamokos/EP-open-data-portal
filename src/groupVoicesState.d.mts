export type GroupVoiceState={group:string;period:string;person:string|null;subject:string|null;tab:string;q:string;peopleLimit:number;offset:number};
export type GroupVoicePerson={id:string;name:string|null;nameVariants?:{value:string;script:string;language:string|null;source:string}[];total:number;subjects:Record<string,number>};
export const GROUP_VOICE_DEFAULTS:Readonly<GroupVoiceState>;
export function readGroupVoicesState(params:URLSearchParams):GroupVoiceState;
export function groupVoicesUrl(input:string,state:GroupVoiceState):URL;
export function changeGroupVoicesState(state:GroupVoiceState,patch:Partial<GroupVoiceState>):GroupVoiceState;
export function visibleGroupPeople<T extends GroupVoicePerson>(people:T[],state:GroupVoiceState):{rows:(T&{count:number})[];visible:(T&{count:number})[];hasMore:boolean};
