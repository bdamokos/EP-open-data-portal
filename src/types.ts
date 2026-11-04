export interface MemberSummary {
 id:number;
 firstName:string;
 lastName:string;
 sortName:string;
 gender:'m'|'f'|'other'|null;
 countryCode:string|null;
 imageUrl:string;
 birthDate?:string;
}
