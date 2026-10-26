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
export function memberAttendanceDetail(day) {
  if(!day||['partial','unavailable'].includes(day.status))return 'Attendance register unavailable for this sitting.';
  if(day.status==='not-published')return "This sitting's attendance register is not yet published.";
  if(day.memberStatus==='not-listed'&&!day.excusedSupplied)return 'Not listed as present.';
  return {
    'listed-present':"Listed as present at this sitting.",
    'listed-excused':"Listed as excused in this sitting's attendance register.",
    'not-listed':"Not listed in this sitting's attendance register.",
    conflicting:'Listed as both present and excused in this register.',
  }[day.memberStatus]||'Attendance register unavailable for this sitting.';
}
const shortDate=value=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
export function memberAttendanceLine(sittings) {
  const labels={'listed-present':'listed present','listed-excused':'excused','not-listed':'not listed',conflicting:'conflicting entries','not-published':'not yet published',unavailable:'unavailable',partial:'unavailable'};
  return 'Attendance register: '+sittings.map(day=>(labels[day.status==='observed'?day.memberStatus:day.status]||'unavailable')+' '+shortDate(day.date)).join(' · ');
}
