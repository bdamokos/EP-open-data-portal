import type {MemberAttendanceResponse,MemberAttendanceSitting} from './MemberAttendanceTypes';
import {memberAttendanceDetail,memberAttendanceLine} from './memberAttendancePresentation.mjs';

export function AttendanceLine({data,loading,attempted}:{data:MemberAttendanceResponse|null;loading:boolean;attempted:boolean}) {
  if(!attempted)return null;
  return <p className="member-votes-attendance-line">{data?memberAttendanceLine(data.sittings):loading?'Loading attendance register…':'Attendance register unavailable'}</p>;
}
export function AttendanceDetail({day,loading}:{day?:MemberAttendanceSitting;loading:boolean}) {
  return <div className="member-votes-attendance">
    <p>{!day&&loading?'Loading attendance register…':memberAttendanceDetail(day)}</p>
    {day?.memberStatus==='not-listed'&&<p>Not listed doesn’t mean absent.</p>}
  </div>;
}
