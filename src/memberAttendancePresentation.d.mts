import type {MemberAttendanceResponse,MemberAttendanceSitting} from './MemberAttendanceTypes';
export function memberAttendanceRoute(memberId:number|string,sittingIds:string[],language?:string):string;
export function validateMemberAttendanceResponse(data:unknown,request:{memberId:number|string;sittingIds:string[]}):data is MemberAttendanceResponse;
export function memberAttendanceDetail(day:MemberAttendanceSitting|null|undefined, ui?: import('./uiI18n.mjs').UiFormatter):string;
export function memberAttendanceLine(sittings:MemberAttendanceSitting[], ui?: import('./uiI18n.mjs').UiFormatter):string;
