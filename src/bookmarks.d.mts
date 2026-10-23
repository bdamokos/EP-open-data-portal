import type {FollowEntry,FollowSignals} from './followUpdates.mjs';
export type SavedActivity={kind?:'activity'|'answer';mark?:number|null;id:string;date:string;title:string;titleLanguage?:string|null;recordKind?:string;category?:string;relatedQuestionId?:string};
export type SavedItem={seen?:{activity:number|null;answer:number|null}|null;entries?:FollowEntry[];historyOmitted?:number;signals?:FollowSignals;signalledAt?:number|Partial<Record<'activity'|'answer',number>>;changedAt?:number;legacyAt?:number;unreadOmittedAt?:number;unreadOmitted?:number;legacyUpdated?:boolean;legacy?:SavedItem['baseline'];unresolved?:Partial<Record<'activity'|'answer',boolean>>;kind:'question'|'mep';id:string;title:string;titleLanguage?:string|null;memberId?:string|null;date?:string|null;savedAt?:number;updated?:boolean;newAnswer?:boolean;newActivity?:boolean;availability?:string;checkedAt?:number;baseline?:{activityVersion?:number;activityIdsComplete?:boolean;revision?:string;answerIds?:string[];total?:number;latestIds?:string[]};current?:SavedItem['baseline'];latest?:SavedActivity[];unreadAnswers?:SavedActivity[];unreadActivities?:SavedActivity[];indexComplete?:boolean};
export type SavedStates={questions:any[];members?:any[];checkedAt:string;coverage:{indexComplete:boolean}};
export type FollowingStatus={epoch:string;generation:number;marksReady:boolean;membershipReady?:boolean;groupsReady?:boolean;indexComplete:boolean;publishedAt:string|null};
export type FollowingManifest={epoch:string;generation:number;indexComplete:boolean;rosterBasis:string;members:Record<string,[number|null,number|null,number,number]>};
export type FollowingMember={epoch:string;generation:number;member:string;status:string;rosterBasis:string;ids:[string,0|1,number][];entries:SavedActivity[];truncated:number};
export const LEGACY_KEY:string;
export const SAVED_KEY:string;
export function savedKey(item:SavedItem):string;
export function readSaved(raw:string|null):SavedItem[];
export function savedObservation(item:SavedItem,state:any):SavedItem;
export function savedLinks(item:SavedItem):SavedActivity[];
export function createSavedStore(storage:Storage|null,notify?:()=>void):{
 snapshot:()=>{items:SavedItem[];persistent:boolean;storageError:null|'quota'|'unavailable';unsavedSince:number|null;restarted:boolean;checkState:string;questionCheckState:string;epoch:string|null;manifest:FollowingManifest|null};
 publish:(mirror?:boolean)=>boolean;reload:(key?:string|null)=>void;retryStorage:()=>boolean;setCheckState:(state:string,kind?:'mep'|'question')=>void;
 toggle:(item:SavedItem)=>void;applyManifest:(manifest:FollowingManifest)=>boolean;materialize:(data:FollowingMember,expected?:SavedItem)=>boolean;
 observe:(states:SavedStates,expected?:SavedItem[])=>boolean;markRead:(key:string)=>boolean;markEntryRead:(key:string,kind:'activity'|'answer',id:string)=>boolean;openQuestion:(key:string)=>boolean;
};
