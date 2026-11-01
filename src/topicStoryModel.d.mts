export type StoryRecord={id:string;kind:string;title:string;date?:string};
export type StoryReference={text:string;records:StoryRecord[];italic?:boolean;numeric?:number};
export type StoryLine={id:string;counts?:Record<string,number>;values:Record<string,string|StoryReference|StoryReference[]>};
export type StoryFacts={questions:{id:string;d:string;t:string;places:string[];home:string[]}[];debates:{id:string;date:string;q:string;title:string;rawTitle?:string;meps:number;format?:string|null;places:Record<string,string[]>;docs:string[]}[];docs:{id:string;title:string;date:string;type:string;places:string[];keywords:string[];derivedFrom?:string[];outcome?:{outcome:string;for:number|null;against:number|null;abst:number|null}}[];topics:Record<string,{key:string;label:string;members:[string,string,string,string][];groups:Record<string,number>}>};
export type StorySelection={periods:string[];partial?:string[];period?:string;place?:string;topic?:string;zoom?:string;mode?:string;excludeOwn?:boolean;labels?:Record<string,string>;language?:string};
export function cleanStoryTitle(title:string):string;
export function storyNumber(n:number,language?:string):string;
export function buildTopicStories(facts:StoryFacts|null|undefined,selection:StorySelection):StoryLine[];

export function primaryStoryPlace(debate:StoryFacts["debates"][number]):string|null;
export function strongStoryPlace(debate:StoryFacts["debates"][number],place:string):boolean;
