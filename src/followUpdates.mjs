export const NEW_WINDOW_MS=24*60*60*1000;
export const LIST_LIMIT=10;
const HISTORY_LIMIT=5;
const kinds=['activity','answer'];

const withinWindow=(at,now)=>Number.isFinite(at)&&at+NEW_WINDOW_MS>now;
const newest=(left,right)=>right.discoveredAt-left.discoveredAt||String(right.date||'').localeCompare(String(left.date||''));
const omittedCount=value=>Number.isSafeInteger(value)&&value>0?value:0;

export function isNewEntry(entry,now) {
  return entry.readAt===null&&withinWindow(entry.discoveredAt,now);
}

// Stores may signal the two kinds separately; a scalar covers a single signal.
function signalTimes(item) {
  if(!item.unresolved)return [];
  if(typeof item.signalledAt==='number')return item.unresolved===true||kinds.some(kind=>item.unresolved[kind])?[item.signalledAt]:[];
  return kinds.flatMap(kind=>(item.unresolved===true||item.unresolved[kind])&&Number.isFinite(item.signalledAt?.[kind])?[item.signalledAt[kind]]:[]);
}

export function followEntries(item,now) {
  const fresh=[],history=[];
  for(const entry of item.entries||[])(isNewEntry(entry,now)?fresh:history).push(entry);
  fresh.sort(newest);history.sort(newest);
  return {fresh,history:history.slice(0,HISTORY_LIMIT),historyOmitted:omittedCount(item.historyOmitted)+Math.max(0,history.length-HISTORY_LIMIT),
    unresolved:signalTimes(item).some(at=>withinWindow(at,now))};
}

export function itemHasNew(item,now) {
  return (item.entries||[]).some(entry=>isNewEntry(entry,now))||signalTimes(item).some(at=>withinWindow(at,now));
}

export function nextExpiry(items,now) {
  let next=null;
  for(const item of items) {
    const times=[...(item.entries||[]).filter(entry=>isNewEntry(entry,now)).map(entry=>entry.discoveredAt),...signalTimes(item)];
    for(const at of times)if(withinWindow(at,now)) {
      const expiry=at+NEW_WINDOW_MS;
      if(next===null||expiry<next)next=expiry;
    }
  }
  return next;
}

// The caller accumulates historyOmitted across compactions and tracks fresh
// overflow separately as unreadOmitted, so it never becomes a history count.
export function compactEntries(entries,now,{historyLimit=HISTORY_LIMIT,newLimit=200}={}) {
  const fresh=[],history=[];
  for(const entry of entries)(isNewEntry(entry,now)?fresh:history).push(entry);
  fresh.sort(newest);history.sort(newest);
  const keptHistory=history.slice(0,historyLimit).map(entry=>({...entry,title:entry.title.slice(0,300)}));
  return {entries:[...fresh.slice(0,newLimit),...keptHistory],historyOmitted:Math.max(0,history.length-keptHistory.length)};
}

// Known profile categories from server/activity-index-model.mjs, expressed as
// count labels. Unknown categories never acquire an inferred activity type.
const categoryLabels={
  'plenary-contributions':['plenary contribution','plenary contributions'],
  'reports-rapporteur':['report as rapporteur','reports as rapporteur'],
  'reports-shadow':['report as shadow rapporteur','reports as shadow rapporteur'],
  'opinions-rapporteur':['opinion as rapporteur','opinions as rapporteur'],
  'opinions-shadow':['opinion as shadow rapporteur','opinions as shadow rapporteur'],
  motions:['motion','motions'],
  'written-questions':['written question','written questions'],
  'oral-questions':['oral question','oral questions'],
  'written-vote-explanations':['written explanation of vote','written explanations of vote'],
  'individual-motions':['individual motion','individual motions'],
  'union-act-proposals':['proposal for a Union act','proposals for a Union act'],
};
const typeLabels={...categoryLabels,speech:['speech','speeches'],answer:['answer','answers'],other:['other activity','other activities']};

/** A ready-to-display English summary, in first-occurrence order. */
export function summarizeByType(entries,omitted=0) {
  const counts=new Map();
  for(const entry of entries) {
    const type=entry.kind==='answer'||entry.recordKind==='answer'?'answer':entry.recordKind==='speech'?'speech':
      Object.hasOwn(categoryLabels,entry.category)?entry.category:'other';
    counts.set(type,(counts.get(type)||0)+1);
  }
  const parts=[...counts].map(([type,count])=>`${count} ${typeLabels[type][count===1?0:1]}`);
  if(omittedCount(omitted))parts.push(`and ${omitted} more`);
  return parts.join(' · ');
}

export function markEntryRead(entries,kind,id,now) {
  return entries.map(entry=>entry.kind===kind&&entry.id===id&&entry.readAt===null?{...entry,readAt:now}:entry);
}

export function markAllRead(entries,now) {
  return entries.map(entry=>isNewEntry(entry,now)?{...entry,readAt:now}:entry);
}

export function migrateUnread(unreadList,now) {
  return unreadList.map(entry=>({...entry,kind:entry.kind||(entry.recordKind==='answer'?'answer':'activity'),discoveredAt:now,readAt:null}));
}
