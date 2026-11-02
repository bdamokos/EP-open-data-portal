import type {StorySelection,StoryLine,StoryRecord} from './topicStoryModel.mjs';
export function storyFactsRoute(selection?:Partial<StorySelection>,browse?:Record<string,string>):string;
export function storyRecord(record:any,kind:string):StoryRecord;
export function buildExactTopicStories(payload:any,selection?:Partial<StorySelection>&{hasMessage?:(id:string)=>boolean}):StoryLine[];
export function storyVariant(id:string,period:string|undefined,scope:string,has?:(id:string)=>boolean):string;
