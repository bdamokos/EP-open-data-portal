import {UiMessage, useUiI18n} from './UiI18nReact';
import type {MemberAttendanceResponse,MemberAttendanceSitting} from './MemberAttendanceTypes';
import {memberAttendanceDetail,memberAttendanceLine} from './memberAttendancePresentation.mjs';

function LoadFailure({onRetry}:{onRetry:()=>void}) {
  return <><UiMessage id="batch5.memberattendance.tsx.5.52"/> <button type="button" onClick={onRetry}><UiMessage id="batch5.memberattendance.tsx.5.51"/></button></>;
}
export function AttendanceLine({data,loading,attempted,onRetry}:{data:MemberAttendanceResponse|null;loading:boolean;attempted:boolean;onRetry:()=>void}) {
  const ui = useUiI18n();
  if(!attempted)return null;
  return <p className="member-votes-attendance-line" role={(!data) ? 'status' : undefined}>{data ? memberAttendanceLine(data.sittings, ui) : (loading ? ui.t("memberattendance.loading_attendance_register.5384a2") : <LoadFailure onRetry={onRetry}/>)}</p>;
}
export function AttendanceDetail({day,loading,onRetry}:{day?:MemberAttendanceSitting;loading:boolean;onRetry:()=>void}) {
  const ui = useUiI18n();
  return <div className="member-votes-attendance">
    <p role={(!day) ? 'status' : undefined}>{day ? memberAttendanceDetail(day, ui) : (loading ? ui.t("memberattendance.loading_attendance_register.5384a2") : <LoadFailure onRetry={onRetry}/>)}</p>
  </div>;
}
