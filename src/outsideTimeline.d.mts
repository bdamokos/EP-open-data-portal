import type {OutsidePerson} from './OutsideTypes';
export type OutsideDay={date:string;contributions:number;itemIds:string[];items?:{id:string;kind:string|null;legislative:boolean}[];formal:boolean;legislative:boolean};
export type OutsideTarget={date:string;itemId?:string};
export function clusterOutsideDays(days:OutsideDay[],start:string,end:string,width:number,gap?:number):{x:number;dates:string[];items:number;contributions:number;formal:boolean;legislative:boolean;target:OutsideTarget}[];

export function filterOutsidePeople(people:OutsidePerson[],options?:{kind?:string;group?:string;repeat?:boolean;search?:string}):OutsidePerson[];
