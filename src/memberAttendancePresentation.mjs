import {defaultUi} from './uiDefault.mjs';
const languages=new Set('bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(' '));
const sitting=/^MTG-PL-(\d{4}-\d{2}-\d{2})$/;
const validSitting=id=>typeof id==='string'&&sitting.test(id)&&Number.isFinite(Date.parse(id.slice(7)+'T12:00:00Z'))&&new Date(id.slice(7)+'T12:00:00Z').toISOString().slice(0,10)===id.slice(7);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const source=value=>value===null||object(value)&&typeof value.url==='string'&&value.url.startsWith('https://data.europarl.europa.eu/api/v2/')&&typeof value.fetchedAt==='string'&&Number.isFinite(Date.parse(value.fetchedAt))&&/^[a-f0-9]{64}$/.test(value.contentHash)&&typeof value.stale==='boolean'&&typeof value.refreshInProgress==='boolean'&&(value.refreshError===null||typeof value.refreshError==='string');
export function memberAttendanceRoute(memberId,sittingIds,language='en') {
  if(!/^[1-9]\d*$/.test(String(memberId))||!Number.isSafeInteger(Number(memberId))||!Array.isArray(sittingIds)||sittingIds.length<1||sittingIds.length>5||sittingIds.some(id=>!validSitting(id))||new Set(sittingIds).size!==sittingIds.length||!languages.has(language))throw new RangeError('Invalid attendance request.');
  return 'member-attendance/'+memberId+'?'+new URLSearchParams({sittings:[...sittingIds].sort().join(','),lang:language});
}
function validPdf(pdf) {
  if(pdf===null)return true;
  if(!object(pdf)||!languages.has(pdf.language)||typeof pdf.url!=='string')return false;
  try{const url=new URL(pdf.url);return url.protocol==='https:'&&url.hostname==='data.europarl.europa.eu'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/distribution\/.+\.pdf$/i.test(url.pathname);}catch{return false;}
}
export function validateMemberAttendanceResponse(data,{memberId,sittingIds}) {
  if(!object(data)||data.version!==1||data.member?.id!==String(memberId)||data.member?.mandateStatus!=='not-assessed'||!Array.isArray(data.sittings)||data.sittings.length!==sittingIds.length)return false;
  const expected=[...sittingIds].sort();
  return data.sittings.every((day,index)=>{
    if(!object(day)||day.sittingId!==expected[index]||day.date!==day.sittingId.slice(7)||!['observed','partial','not-published','unavailable'].includes(day.status)||typeof day.excusedSupplied!=='boolean'||!source(day.source))return false;
    if(day.status==='observed'?!['listed-present','listed-excused','conflicting','not-listed'].includes(day.memberStatus):day.memberStatus!==null)return false;
    const counts=day.counts,register=day.register;
    if(!object(counts)||!['present','excused'].every(key=>counts[key]===null||integer(counts[key]))||!['duplicatePresent','duplicateExcused','malformedReferences'].every(key=>integer(counts[key]))||!Array.isArray(day.conflictingIds)||day.conflictingIds.some(id=>!(/^[1-9]\d*$/).test(id)))return false;
    if(day.status==='observed'&&(!day.source||!integer(counts.present)||counts.present===0||counts.malformedReferences!==0))return false;
    return object(register)&&register.documentId==='PV-10-'+day.date+'-ATT'&&['available','unavailable','not-published'].includes(register.status)&&validPdf(register.pdf)&&(register.issued===null||typeof register.issued==='string'&&Number.isFinite(Date.parse(register.issued)))&&source(register.source);
  });
}
export function memberAttendanceDetail(day, ui = defaultUi) {
  if(!day||['partial','unavailable'].includes(day.status))return ui.t("batch5.memberattendancepresentation.mjs.29.101");
  if(day.status==='not-published')return ui.t("batch5.memberattendancepresentation.mjs.30.102");
  if(day.memberStatus==='not-listed'&&!day.excusedSupplied)return ui.t("batch5.memberattendancepresentation.mjs.31.103");
  return {
    'listed-present':ui.t("batch5.memberattendancepresentation.mjs.33.104"),
    'listed-excused':ui.t("batch5.memberattendancepresentation.mjs.34.105"),
    'not-listed':ui.t("batch5.memberattendancepresentation.mjs.35.106"),
    conflicting:ui.t("batch5.memberattendancepresentation.mjs.36.107"),
  }[day.memberStatus]||ui.t("batch5.memberattendancepresentation.mjs.29.101");
}
const shortDate=(value,locale)=>new Intl.DateTimeFormat(locale==='en'?'en-GB':locale,{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
function attendanceDates(dates,locale) {
  const runs=[];
  for(const date of [...new Set(dates)].sort()){
    const previous=runs.at(-1);
    if(previous&&Date.parse(date)-Date.parse(previous.at(-1))===86400000)previous.push(date);
    else runs.push([date]);
  }
  const formatter=new Intl.DateTimeFormat(locale==='en'?'en-GB':locale,{day:'numeric',month:'short',timeZone:'UTC'});
  return runs.map(run=>run.length===1?shortDate(run[0],locale):formatter.formatRange(new Date(run[0]+'T12:00:00Z'),new Date(run.at(-1)+'T12:00:00Z')).replace(/\s*–\s*/g,'–')).join(', ');
}
export function memberAttendanceLine(sittings, ui = defaultUi) {
  const labels={'listed-present':ui.t("batch5.memberattendancepresentation.mjs.51.108"),'listed-excused':ui.t("batch5.memberattendancepresentation.mjs.51.109"),'not-listed':ui.t("batch5.memberattendancepresentation.mjs.51.110"),conflicting:ui.t("batch5.memberattendancepresentation.mjs.51.111"),'not-published':ui.t("batch5.memberattendancepresentation.mjs.51.112"),unavailable:ui.t("batch5.memberattendancepresentation.mjs.51.113"),partial:ui.t("batch5.memberattendancepresentation.mjs.51.113")};
  const groups=new Map();
  for(const day of sittings){
    const label=labels[day.status==='observed'?day.memberStatus:day.status]||'unavailable';
    if(!groups.has(label))groups.set(label,[]);
    groups.get(label).push(day.date);
  }
  return ui.t("batch5.memberattendancepresentation.mjs.58.114", {groups: String([...groups].map(([label,dates])=>label+' '+attendanceDates(dates,ui.locale)).join(' · '))});
}
