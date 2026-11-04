export type HemicycleSeat={seat:number;x:number;y:number;r:number;member?:number;name?:string;firstName?:string;group?:string;country?:string|null;institution?:'council'|'commission'};
export type HemicycleFilter={query?:string;group?:string|null;country?:string|null};
export function seatMatches(seat:HemicycleSeat,filter?:HemicycleFilter,matchesCountry?:(selected:string|null|undefined,country:string|null|undefined)=>boolean):boolean;
export function groupCounts(seats:HemicycleSeat[]):{group:string;count:number}[];
export function nearestSeat(seats:HemicycleSeat[],x:number,y:number,reach:number):HemicycleSeat|null;
