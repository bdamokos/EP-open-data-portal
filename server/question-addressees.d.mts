export type QuestionAddressee={id:string;uri:string;label:string;participationIds:string[]};
export function organizationId(value:unknown):string|null;
export function validAddresseeFilter(value:unknown):boolean;
export function addresseeLabel(id:string):string;
export function questionNumber(id:string):string;
export function questionAddressees(work:unknown):QuestionAddressee[];
export function matchesAddressee(addressees:QuestionAddressee[]|undefined,selected:string|null|undefined):boolean;
