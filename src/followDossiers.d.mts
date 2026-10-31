import type {FollowEntry} from './followUpdates.mjs';
export type DossierEntry=FollowEntry&{eventKind:string;sourceId?:string;documentId?:string|null;url?:string;summaryId?:string;change?:string;previousDate?:string|null;source?:{url:string;fetchedAt:string}};
export type FollowedDossier={kind:'dossier';id:string;title:string;titleLanguage:string|null;savedAt:number;entries:DossierEntry[];observations:Record<string,any>;gaps:Record<string,boolean>;checkedAt?:number;lastAttempt?:number;historyOmitted?:number;unreadOmitted?:number;unreadOmittedAt?:number};
export const DOSSIERS_KEY:string;
export function dossierReference(value:unknown):boolean;
export function dossierHref(reference:string,language?:string):string;
export function createDossiersStore(storage:Storage|null,notify?:()=>void,clock?:()=>number, ui?: import('./uiI18n.mjs').UiFormatter):{
 snapshot:()=>{items:FollowedDossier[];persistent:boolean;storageError:boolean;restarted:boolean};reload:()=>void;retryStorage:()=>boolean;
 toggle:(item:{id:string;title?:string;titleLanguage?:string|null})=>void;
 unavailable:(id:string,expected:FollowedDossier,source:string)=>boolean;
 observeIndex:(data:any,expected:FollowedDossier[])=>boolean;
 observeProgress:(id:string,data:any,expected:FollowedDossier)=>boolean;
 observePress:(id:string,data:any,expected:FollowedDossier)=>boolean;
 markRead:(id:string)=>boolean;markEntryRead:(id:string,entryId:string)=>boolean;finishCheck:(id:string,expected:FollowedDossier)=>boolean;
};
export {followEntries,itemHasNew} from './followUpdates.mjs';
