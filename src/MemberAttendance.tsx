import type {MemberAttendanceResponse,MemberAttendanceSitting} from './MemberAttendanceTypes';
import {memberAttendanceDetail,memberAttendanceLine} from './memberAttendancePresentation.mjs';

function LoadFailure({onRetry}:{onRetry:()=>void}) {
  return <>Attendance couldn’t be loaded. <button type="button" onClick={onRetry}>Retry attendance</button></>;
}
export function AttendanceLine({data,loading,attempted,onRetry}:{data:MemberAttendanceResponse|null;loading:boolean;attempted:boolean;onRetry:()=>void}) {
  if(!attempted)return null;
  return <p className="member-votes-attendance-line" role={!data?'status':undefined}>{data?memberAttendanceLine(data.sittings):loading?'Loading attendance register…':<LoadFailure onRetry={onRetry}/>}</p>;
}
export function AttendanceDetail({day,loading,onRetry}:{day?:MemberAttendanceSitting;loading:boolean;onRetry:()=>void}) {
  return <div className="member-votes-attendance">
    <p role={!day?'status':undefined}>{day?memberAttendanceDetail(day):loading?'Loading attendance register…':<LoadFailure onRetry={onRetry}/>}</p>
  </div>;
}
