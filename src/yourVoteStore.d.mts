export const YOUR_VOTES_KEY:string;
export type Choice='for'|'against'|'abstaining';
export type VoteChoice={key:string;sittingId:string;documentId:string;agendaItemId:string;choice:Choice;savedAt:number;revision:string|null};
export type VoteStar={id:string;sittingId:string;documentId?:string|null;title?:string};
export function createYourVotesStore(storage:Storage|null,notify?:()=>void,clock?:()=>number):{snapshot:()=>{choices:VoteChoice[];stars:VoteStar[];storageError:boolean};reload:()=>void;choose:(value:Omit<VoteChoice,'savedAt'|'choice'>&{choice:Choice|null})=>void;toggleStar:(value:VoteStar)=>void};
export function starMatches(star:VoteStar,ballot:{id:string;sittingId:string;documentId?:string|null}):boolean;
export function choiceAgreement(choice:Choice|null|undefined,position:string|null|undefined):boolean|null;
export function outcomePosition(outcome:string|null):Choice|null;
