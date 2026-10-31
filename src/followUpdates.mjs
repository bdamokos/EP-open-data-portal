import {defaultUi} from './uiDefault.mjs';
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

// Only the latest rise keeps an unresolved kind new; older scalar stores still load.
function unresolvedTimes(item) {
  if(!item.unresolved)return [];
  if(typeof item.signalledAt==='number')return item.unresolved===true||kinds.some(kind=>item.unresolved[kind])?[item.signalledAt]:[];
  return kinds.flatMap(kind=>{
    const at=item.signals?.[kind]?.at(-1)?.[1]??item.signalledAt?.[kind];
    return (item.unresolved===true||item.unresolved[kind])&&Number.isFinite(at)?[at]:[];
  });
}

function signalTimes(item) {
  return [...unresolvedTimes(item),...(item.legacyUpdated?[item.legacyAt]:[]),item.changedAt,...(item.unreadOmitted?[item.unreadOmittedAt]:[])].filter(Number.isFinite);
}

export function followEntries(item,now) {
  const fresh=[],history=[];
  for(const entry of item.entries||[])(isNewEntry(entry,now)?fresh:history).push(entry);
  fresh.sort(newest);history.sort(newest);
  return {fresh,history:history.slice(0,HISTORY_LIMIT),historyOmitted:omittedCount(item.historyOmitted)+Math.max(0,history.length-HISTORY_LIMIT),
    unresolved:unresolvedTimes(item).some(at=>withinWindow(at,now))};
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
export const categoryLabelsUi = (ui = defaultUi) => ({
  'plenary-contributions':[ui.t("followUpdates.type_plenary_contribution"),'plenary contributions'],
  'reports-rapporteur':[ui.t("followUpdates.type_report_as_rapporteur"),'reports as rapporteur'],
  'reports-shadow':[ui.t("followUpdates.type_report_as_shadow_rapporteur"),'reports as shadow rapporteur'],
  'opinions-rapporteur':[ui.t("followUpdates.type_opinion_as_rapporteur"),'opinions as rapporteur'],
  'opinions-shadow':[ui.t("followUpdates.type_opinion_as_shadow_rapporteur"),'opinions as shadow rapporteur'],
  motions:['motion','motions'],
  'written-questions':[ui.t("followUpdates.type_written_question"),'written questions'],
  'oral-questions':[ui.t("followUpdates.type_oral_question"),'oral questions'],
  'written-vote-explanations':[ui.t("followUpdates.type_written_explanation_of_vote"),'written explanations of vote'],
  'individual-motions':[ui.t("followUpdates.type_individual_motion"),'individual motions'],
  'union-act-proposals':[ui.t("followUpdates.type_proposal_for_a_Union_act"),'proposals for a Union act'],
});

const typeLabels={...categoryLabels,speech:['speech','speeches'],answer:['answer','answers'],other:['other activity','other activities']};
export const typeLabelsUi = (ui = defaultUi) => ({...categoryLabelsUi(ui),speech:['speech','speeches'],answer:['answer','answers'],other:[ui.t("followUpdates.type_other_activity"),'other activities']});


/** A summary of app-owned activity categories; record wording is never translated. */
const summaryMessages={
  "plenary-contributions": "followUpdates.count_plenary_contributions",
  "reports-rapporteur": "followUpdates.count_reports_as_rapporteur",
  "reports-shadow": "followUpdates.count_reports_as_shadow_rapporteur",
  "opinions-rapporteur": "followUpdates.count_opinions_as_rapporteur",
  "opinions-shadow": "followUpdates.count_opinions_as_shadow_rapporteur",
  "motions": "followUpdates.count_motions",
  "written-questions": "followUpdates.count_written_questions",
  "oral-questions": "followUpdates.count_oral_questions",
  "written-vote-explanations": "followUpdates.count_written_explanations_of_vote",
  "individual-motions": "followUpdates.count_individual_motions",
  "union-act-proposals": "followUpdates.count_proposals_for_a_union_act",
  "speech": "followUpdates.count_speeches",
  "answer": "followUpdates.count_answers",
  "other": "followUpdates.count_other_activities"
};
export function summarizeByType(entries,omitted=0, ui=defaultUi) {
  const counts=new Map();
  for(const entry of entries) {
    const type=entry.kind==='answer'||entry.recordKind==='answer'?'answer':entry.recordKind==='speech'?'speech':Object.hasOwn(categoryLabelsUi(ui),entry.category)?entry.category:'other';
    counts.set(type,(counts.get(type)||0)+1);
  }
  const parts=[...counts].map(([type,count])=>ui.t(summaryMessages[type],{count}));
  if(omittedCount(omitted))parts.push(ui.t('followUpdates.and_count_more',{count:omitted}));
  return parts.join(' · ');
}

export function markEntryRead(entries,kind,id,now) {
  return entries.map(entry=>entry.kind===kind&&entry.id===id&&entry.readAt===null?{...entry,readAt:now}:entry);
}

export function markAllRead(entries,now) {
  return entries.map(entry=>isNewEntry(entry,now)?{...entry,readAt:now}:entry);
}

export function migrateUnread(unreadList,now, ui = defaultUi) {
  return unreadList.map(entry=>({...entry,kind:entry.kind||(entry.recordKind==='answer'?'answer':'activity'),discoveredAt:now,readAt:null}));
}
