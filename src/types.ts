export interface MemberSummary {
 id:number;
 firstName:string;
 lastName:string;
 sortName:string;
 gender:'m'|'f';
 countryCode:string|null;
 imageUrl:string;
 birthDate?:string;
}
