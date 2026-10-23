import type {MemberAttendanceResponse,MemberAttendanceSitting} from './MemberAttendanceTypes';
import {memberAttendanceDetail,memberAttendanceLine} from './memberAttendancePresentation.mjs';

export function AttendanceLine({data,loading}:{data:MemberAttendanceResponse|null;loading:boolean}) {
  return <p className="member-votes-attendance-line">{data?memberAttendanceLine(data.sittings):loading?'Loading attendance register…':'Attendance register unavailable'}</p>;
}
function Provenance({label,source}:{label:string;source:MemberAttendanceSitting['source']}) {
  return source?<p>{label}: <a href={source.url} target="_blank" rel="noreferrer">Public source ↗</a> · retrieved <time dateTime={source.fetchedAt}>{source.fetchedAt}</time><br/>Content hash: <code>{source.contentHash}</code>{source.stale?' · saved source is stale':''}{source.refreshInProgress?' · refresh in progress':''}{source.refreshError?' · last refresh failed':''}</p>:null;
}
export function AttendanceDetail({day,loading}:{day?:MemberAttendanceSitting;loading:boolean}) {
  const pdf=day?.register.pdf;
  const language=pdf?new Intl.DisplayNames(['en'],{type:'language'}).of(pdf.language)||pdf.language:null;
  return <div className="member-votes-attendance">
    <p>{!day&&loading?'Loading attendance register…':memberAttendanceDetail(day)}</p>
    {day?.memberStatus==='not-listed'&&<p>This does not establish absence: members can vote without being listed, and mandate dates are not checked here.</p>}
    {pdf&&<p><a href={pdf.url} target="_blank" rel="noreferrer">Attendance register (PDF, {language}) ↗</a></p>}
    <details><summary>About the attendance register and sources</summary>
      <p>This is the sitting’s signature register under Rule 162. Excused members are those excused by the President. The register does not establish presence at an individual vote. Corrections can appear in later minutes. Mandate eligibility is not assessed here.</p>
      <p>Attendance is retrieved independently of the vote snapshot and never determines a member’s position or the vote counts.</p>
      <Provenance label="Sitting register" source={day?.source??null}/>
      <Provenance label="Register document" source={day?.register.source??null}/>
      {day?.register.issued&&<p>PDF issued: <time dateTime={day.register.issued}>{day.register.issued}</time></p>}
    </details>
  </div>;
}
