import type {StoryLine,StoryReference,StorySelection} from './topicStoryModel.mjs';
export function storyLinkClaims(lines:StoryLine[],selection:Partial<StorySelection>):StoryLine[];
export function storySetKey(ref:StoryReference,selection?:Partial<StorySelection>):string;
export function parseStorySetKey(key:string):{list:string;scope:string;period:string;askers:string;ids?:string;zoom?:string;mode?:string;kind?:string;expected?:number}|null;
