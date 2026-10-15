export interface MemberSummary {
 id:number;
 firstName:string;
 lastName:string;
 sortName:string;
 gender:'m'|'f';
 countryCode:string;
 imageUrl:string;
 birthDate?:string;
}
