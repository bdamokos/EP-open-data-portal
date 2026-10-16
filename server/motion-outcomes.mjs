import { array, tail } from './activity-index-model.mjs';

const API = 'https://data.europarl.europa.eu/api/v2';
const STATUSES = { ADOPTED:'adopted', REJECTED:'rejected', LAPSED:'lapsed', WITHDRAWN:'withdrawn' };
const canonical = value => {
  const ref = String(value?.id || value || '').replace(/^https?:\/\/data\.europarl\.europa\.eu\//, '');
  return /^eli\/dl\/(?:doc|event)\/[A-Z0-9-]+$/.test(ref) ? ref : null;
};
const refs = value => [...new Set(array(value).map(canonical).filter(Boolean))];
const english = value => typeof value?.en === 'string' ? { en:value.en.slice(0,2000) } : {};
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value ? value : null;
const count = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export const isMotion = work => ['RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT'].includes(tail(work?.work_type));
export const motionSourceKey = sittingId => 'motion-outcomes:' + sittingId;
export function motionSittings(work) {
  return [...new Set(refs(work.inverse_based_on_a_realization_of).flatMap(ref => {
    const match = ref.match(/^eli\/dl\/event\/(MTG-PL-(\d{4}-\d{2}-\d{2}))-(?:VOT-ITM-\d+|OJ-ITM-V-\d+)$/);
    return match && date(match[2]) ? [match[1]] : [];
  }))];
}
export function motionReference(id) {
  const match = id?.match(/^(B|RC)-(10)-(\d{4})-(\d+)$/);
  return match ? `${match[1] === 'RC' ? 'RC-' : ''}B${match[2]}-${match[4]}/${match[3]}` : id;
}
function documentReferences(text) {
  return [...String(text || '').matchAll(/\b(RC-)?B(10)-(\d{4,6})\/(\d{4})\b/g)]
    .map(([,joint,term,number,year]) => `${joint ? 'RC' : 'B'}-${term}-${year}-${number}`);
}
export function projectMotionResults(nodes,sittingId) {
  return nodes.filter(node => tail(node.had_activity_type) === 'PLENARY_VOTE_RESULTS' && canonical(node.id)?.startsWith('eli/dl/event/'+sittingId+'-VOT-ITM-')).map(node => ({
    id:canonical(node.id), activity_date:date(node.activity_date), based_on_a_realization_of:refs(node.based_on_a_realization_of),
    executed:refs(node.executed), consists_of:refs(node.consists_of),
    sittingResultIds:array(node.inverse_consists_of).filter(parent => canonical(parent?.id) === 'eli/dl/event/'+sittingId).flatMap(parent => refs(parent.consists_of)),
  }));
}
export function projectMotionDecisions(nodes,sittingId) {
  return nodes.filter(node => tail(node.had_activity_type) === 'PLENARY_OUTCOME' && canonical(node.id)?.startsWith('eli/dl/event/'+sittingId+'-DEC-')).map(node => ({
    id:canonical(node.id), activity_date:date(node.activity_date), decision_outcome:node.decision_outcome, decision_method:node.decision_method,
    inverse_consists_of:refs(node.inverse_consists_of), headingLabel:english(node.headingLabel), referenceText:english(node.referenceText), activity_label:english(node.activity_label),
    number_of_votes_favor:count(node.number_of_votes_favor), number_of_votes_against:count(node.number_of_votes_against), number_of_votes_abstention:count(node.number_of_votes_abstention),
  }));
}
export function motionVoteCoverage(results,decisions) {
  const resultIds = new Set(results.map(node => node.id)), decisionIds = new Set(decisions.map(node => node.id));
  return {
    missingResultIds:[...new Set(results.flatMap(node => node.sittingResultIds || []))].filter(id => !resultIds.has(id)),
    missingDecisionIds:[...new Set(results.flatMap(node => node.consists_of))].filter(id => !decisionIds.has(id)),
  };
}
export function motionOutcome(work,documentFetchedAt,sourceForSitting) {
  const id = work.identifier || tail(work.id), links = new Set(refs(work.inverse_based_on_a_realization_of));
  const candidates = new Map();
  let incomplete = false;
  for (const sittingId of motionSittings(work)) {
    const record = sourceForSitting(sittingId);
    if (!record) { incomplete = true; continue; }
    const { results = [], decisions = [] } = record.work;
    const resultIds = new Set(results.map(result => result.id));
    if ([...links].some(ref => ref.startsWith('eli/dl/event/'+sittingId+'-VOT-ITM-') && !resultIds.has(ref)) ||
        results.some(result => array(result.sittingResultIds).some(ref => !resultIds.has(ref)))) {
      incomplete = true; continue;
    }
    const parents = results.filter(result => links.has(result.id) || result.based_on_a_realization_of.includes(canonical(work.id)) || result.executed.some(ref => links.has(ref)));
    const byId = new Map(decisions.map(decision => [decision.id,decision]));
    for (const parent of parents) {
      if(parent.activity_date!==sittingId.slice(7))continue;
      // A topic may contain several competing motions and hundreds of amendments.
      // Require every declared child before choosing a final decision for this text.
      if (!parent.consists_of.length || parent.consists_of.some(child => !byId.has(child))) { incomplete = true; continue; }
      for (const decision of decisions) {
        if (!decision.inverse_consists_of.includes(parent.id) || !parent.consists_of.includes(decision.id)) continue;
        const subject = decision.referenceText?.en?.trim() || '';
        const whole = /^Motion for a resolution(?: \(as a whole\))?$/i.test(subject);
        const standalone = /^(?:RC-)?B10-\d{4,6}\/\d{4}$/.test(subject);
        if (!whole && !standalone) continue;
        const exactIds = [...new Set(documentReferences(standalone ? subject : [decision.headingLabel?.en,decision.activity_label?.en].join('\n')))];
        if (exactIds.length !== 1 || exactIds[0] !== id || decision.activity_date!==parent.activity_date) continue;
        const status = STATUSES[tail(decision.decision_outcome)];
        if (!status) continue;
        candidates.set(decision.id,{
          status, date:decision.activity_date, method:tail(decision.decision_method), decisionId:tail(decision.id), sittingId,
          refreshFailure:record.work.lastRefreshFailure || null,
          totals:[decision.number_of_votes_favor,decision.number_of_votes_against,decision.number_of_votes_abstention].every(value => value == null) ? null : {
            for:decision.number_of_votes_favor ?? null, against:decision.number_of_votes_against ?? null, abstaining:decision.number_of_votes_abstention ?? null,
          },
          sources:[
            {url:API+'/plenary-documents/'+id,fetchedAt:documentFetchedAt,language:null},
            ...array(record.work.sources),
          ],
        });
      }
    }
  }
  const values = [...candidates.values()].sort((a,b) => b.date.localeCompare(a.date));
  const latest = values.filter(value => value.date === values[0]?.date);
  if (!incomplete && latest.length === 1) return latest[0];
  return { status:'unavailable', reason:incomplete ? 'incomplete-source' : latest.length > 1 ? 'ambiguous-decisions' : 'no-matching-decision' };
}
