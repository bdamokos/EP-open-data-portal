import type {TopicOverview,TopicItem,TopicSeries} from './TopicsTypes';
export function point(item:Pick<TopicItem,'series'>|null|undefined,period:string):Partial<TopicSeries>;
export function mapCode(iso3:string|null|undefined):string|null|undefined;
export function quarterBounds(period:string):{from:string;to:string}|null;
export function partialQuarter(period:string,partial:TopicOverview['partial']):boolean;
export function lastFullQuarter(data:TopicOverview):string;
export function placeValue(s:Partial<TopicSeries>,mode?:string,own?:boolean):number;
export function riser(data:TopicOverview,index:number,mode:string,own:boolean):{item:TopicItem;count:number;ratio:number}|null;
export function titleParts(title:string,language?:string|null):[string,string];
export function topicsHref(key:string,filters?:Record<string,string>):string;
export function legacyTopics(query:URLSearchParams):string|null;

export function agendaTitle(title:string):string;

export function isEuPlace(iso3:string|null|undefined):boolean;

export function withBoundaryTies<T>(rows:T[],limit:number,score:(row:T)=>number):T[];
