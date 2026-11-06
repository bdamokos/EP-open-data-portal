export type PassageRange={start:number;end:number};
export function proposalPassage(proposal:import('./proposalTypes').ProposalDocument,placement:NonNullable<import('./DocumentContextTypes').DocumentContextResponse['placement']>,around?:number):PassageRange|null;
export function paragraphPassage(placement:NonNullable<import('./DocumentContextTypes').DocumentContextResponse['placement']>,document:{start?:number;count:number;tables?:import('./DocumentFormatting').DocumentTable[]},around?:number):PassageRange|null;
export function documentContents(paragraphs:string[],formats:{heading?:number}[],start?:number):{paragraph:number;level:number;label:string}[];
export function inPassage(range:PassageRange|null|undefined,index:number):boolean;
export function passageNotes<T extends {id:string}>(notes:T[],anchors:{paragraph:number;note:string}[],range:PassageRange|null|undefined):T[];
