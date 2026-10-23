export type FollowEntry={id:string;kind:'activity'|'answer';recordKind?:string;category?:string;title:string;titleLanguage?:string|null;date:string;relatedQuestionId?:string;mark?:number;discoveredAt:number;readAt:number|null};
export type FollowSignals=Partial<Record<FollowEntry['kind'],[mark:number,at:number][]>>;
export type FollowItem={entries?:FollowEntry[];legacyUpdated?:boolean;legacyAt?:number;changedAt?:number;unreadOmitted?:number;unreadOmittedAt?:number;historyOmitted?:number;unresolved?:boolean|Partial<Record<FollowEntry['kind'],boolean>>;signals?:FollowSignals;signalledAt?:number|Partial<Record<FollowEntry['kind'],number>>};
export const NEW_WINDOW_MS:number;
export const LIST_LIMIT:number;
export function isNewEntry(entry:FollowEntry,now:number):boolean;
export function followEntries(item:FollowItem,now:number):{fresh:FollowEntry[];history:FollowEntry[];historyOmitted:number;unresolved:boolean};
export function itemHasNew(item:FollowItem,now:number):boolean;
export function nextExpiry(items:FollowItem[],now:number):number|null;
/** Add historyOmitted to the store's existing count; track dropped fresh entries as unreadOmitted. */
export function compactEntries(entries:FollowEntry[],now:number,options?:{historyLimit?:number;newLimit?:number}):{entries:FollowEntry[];historyOmitted:number};
export function summarizeByType(entries:FollowEntry[],omitted?:number):string;
export function markEntryRead(entries:FollowEntry[],kind:FollowEntry['kind'],id:string,now:number):FollowEntry[];
export function markAllRead(entries:FollowEntry[],now:number):FollowEntry[];
export function migrateUnread(unreadList:(Omit<FollowEntry,'kind'|'discoveredAt'|'readAt'>&{kind?:FollowEntry['kind']})[],now:number):FollowEntry[];
