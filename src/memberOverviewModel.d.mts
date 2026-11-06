export type MemberOverviewItem={key:string;target:'speeches'|'activities'|'votes';category?:string;week?:string;one:string;other:string;count:number;against?:number;zero?:boolean};
export function memberOverviewItems(sources:{activities?:{categoryCoverage?:Record<string,{status:string;indexedCount:number}>}|null;votes?:{coverage?:{status:string};period?:{week:string|null};alignmentCounts?:{against:number}|null;pagination?:{recordedTotal:number|null}}|null}):MemberOverviewItem[];
export function memberOverviewVotesRoute(memberId:number|string):string;
