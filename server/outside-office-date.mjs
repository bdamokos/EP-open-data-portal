import {validDay} from './source-availability.mjs';
export const GREGORIAN='http://www.wikidata.org/entity/Q1985727';
// Preserve qualifier state and precision. Only these conservative bounds can
// establish tenure on a speech day; legacy dates without precision cannot.
export function outsideOfficeDate(value,precision,calendar=GREGORIAN,state='known'){
 if(state!=='known')return {state};
 const raw=String(value||''),m=raw.match(/^\+?(\d{4})-(\d{2})-(\d{2})T/),p=Number(precision);
 if(!m||!/^\+?\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/.test(raw)||!Number.isInteger(p)||p<9||p>14||calendar!==GREGORIAN)return {state:'invalid',raw,precision,calendar};
 const year=+m[1],month=p===9?1:+m[2],day=p<=10?1:+m[3],lower=`${m[1]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
 if(!validDay(lower))return {state:'invalid',raw,precision:p,calendar};
 const upper=p===9?m[1]+'-12-31':p===10?`${m[1]}-${String(month).padStart(2,'0')}-${[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][month-1]}`:lower;
 return {state:'known',raw,precision:p,calendar,lower,upper};
}
export function outsideOfficeOnDay(position,date){
 const {start,end}=position;
 return start?.state==='known'&&validDay(start.upper)&&start.upper<=date&&(end?.state==='absent'||end?.state==='known'&&validDay(end.lower)&&end.lower>=date);
}
