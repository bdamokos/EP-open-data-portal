export type ActivityBuckets={unit:'month'|'day';keys:string[]};
export function activityBuckets(window:{from:string;to:string}|undefined,period:string,people:{days?:Record<string,number>}[]):ActivityBuckets;
export function activityCounts(days:Record<string,number>|undefined,buckets:ActivityBuckets):number[];
export function sumActivity(people:{days?:Record<string,number>}[]):Record<string,number>;
export function activityLevel(count:number,max:number):number;
