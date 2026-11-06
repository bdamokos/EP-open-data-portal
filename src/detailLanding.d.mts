export function createDetailLanding(topic:string|null|undefined):{seen(next:string|null|undefined):void;movesFocus(next:string|null|undefined):boolean};
export function landedOnVotePage(search:string):boolean;
export function votePageActive(state:{landed:boolean;hasTopic:boolean;loadedVoteCount:number|null|undefined}):boolean;
