export type StoryOutcome={id?:string;date?:string;label?:string;outcome:string;for:number|null;against:number|null;abst:number|null;method?:string;decision_method?:string};
export type StoryRecord={id:string;kind:string;title:string;date?:string;url?:string;groups?:string[];outcome?:StoryOutcome};
export type StoryMessage={message:string;values:Record<string,StoryValue>;counts?:Record<string,number>};
export type StoryReference={text:string|StoryMessage;records:StoryRecord[];italic?:boolean;pageRecords?:boolean;period?:string;target?:string;browse?:Record<string,string>};
export type StoryValue=string|null|StoryReference|StoryMessage|StoryValue[];
export type StoryLine={id:string;values:Record<string,StoryValue>;counts?:Record<string,number>;priority:number;order:number;cost:number};
export type StoryFacts={questions:{id:string;d:string;t:string;oral?:boolean|number;authors?:string[];askers?:string|Record<string,string>;places:string[];home:string[]}[];debates:{id:string;date:string;q:string;title:string;rawTitle?:string;cre?:string|null;meps:number;speeches?:number;format?:string|null;places:Record<string,string[]>;docs:string[];procedures?:string[]}[];docs:{id:string;ref?:string;title:string;date:string;type:string;places:string[];keywords:string[];groups?:string[];procedures?:string[];derivedFrom?:string[];url?:string;groups?:string[];outcome?:StoryOutcome}[];topics:Record<string,{key?:string;label:string;members:[string,string,string,string][];groups:Record<string,number>}>;mepCountry?:Record<string,string>;press?:Record<string,{id:string;date:string;title:string;url:string}[]>};
export type StorySelection={periods:string[];partial?:string[];period?:string;place?:string;topic?:string;zoom?:string;mode?:string;excludeOwn?:boolean;unknownQuestions?:boolean;labels?:Record<string,string>;language?:string;proseLanguage?:string};
export function cleanStoryTitle(title:string):string;
export function storyNumber(n:number,language?:string):string;
export function buildReferenceTopicStories(facts:StoryFacts|null|undefined,selection:StorySelection):StoryLine[];
export function primaryStoryPlace(debate:StoryFacts['debates'][number]):string|null;
export function strongStoryPlace(debate:StoryFacts['debates'][number],place:string):boolean;

export function normalizeReferenceStoryFacts(payload:unknown):StoryFacts|null;
