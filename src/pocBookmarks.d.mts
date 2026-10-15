export type SavedItem={kind:'question'|'mep';id:string;title:string;memberId?:string|null;date?:string|null;savedAt?:number;updated?:boolean;newAnswer?:boolean;newActivity?:boolean;availability?:string;checkedAt?:number;baseline?:{revision?:string;answerIds?:string[];total?:number;latestIds?:string[]};current?:SavedItem['baseline'];latest?:{id:string;date:string;title:string}[]};
export type SavedStates={questions:any[];members:any[];checkedAt:string;coverage:{indexComplete:boolean}};
export const SAVED_KEY:string;
export function savedKey(item:SavedItem):string;
export function readSaved(raw:string|null):SavedItem[];
export function savedObservation(item:SavedItem,state:any):SavedItem;
export function createSavedStore(storage:Storage|null,notify?:()=>void):{snapshot:()=>{items:SavedItem[];persistent:boolean};reload:()=>void;toggle:(item:SavedItem)=>void;observe:(states:SavedStates)=>void;markRead:(key:string)=>void};
