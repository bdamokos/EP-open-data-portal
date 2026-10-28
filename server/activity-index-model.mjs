import {sourceTitle} from './source-titles.mjs';
import {languagePreference} from './language-order.mjs';
import { languageCode, speechWebsite } from './ep-links.mjs';

export const AMENDMENT_LINKS_VERSION = 3;

export const CATEGORIES = Object.freeze({
  'plenary-contributions': 'Contributions to plenary debates',
  'reports-rapporteur': 'Reports - as rapporteur',
  'reports-shadow': 'Reports - as shadow rapporteur',
  'opinions-rapporteur': 'Opinions - as rapporteur',
  'opinions-shadow': 'Opinions - as shadow rapporteur',
  motions: 'Motions for resolutions',
  'written-questions': 'Questions for written answer (including answers)',
  'oral-questions': 'Oral questions',
  'written-vote-explanations': 'Written explanations of vote',
  'individual-motions': 'Individual motions for resolutions',
  'union-act-proposals': 'Proposals for a Union act',
});
export const CATEGORY_GROUPS = Object.freeze([
  {label:'Main parliamentary activities',categories:['plenary-contributions','reports-rapporteur','reports-shadow','opinions-rapporteur','opinions-shadow','motions','oral-questions']},
  {label:'Other parliamentary activities',categories:['written-vote-explanations','written-questions','individual-motions','union-act-proposals']},
]);
export const CATEGORY_GAPS = Object.freeze({
  'written-vote-explanations':'A documented per-MEP source has not been verified. Oral vote explanations and written debate statements are different activities.',
  'union-act-proposals':'A verified API source is missing for this website category; the checked Union-act document returned 404.',
});
export const array = v => v == null ? [] : Array.isArray(v) ? v : [v];
export const tail = v => String(v?.id || v || '').split('/').at(-1);
const personId = v => String(v).match(/(?:^|\/)person\/([1-9]\d*)$/)?.[1];
const term10 = w => array(w.parliamentary_term).some(t => /(?:^|\/)org\/ep-10$/.test(String(t)));
const ids = ps => [...new Set(array(ps).flatMap(p => array(p.had_participant_person).map(personId)).filter(Boolean))];
const referenceId = v => String(v?.id || v || '').replace(/^https:\/\/data\.europarl\.europa\.eu\//,'');
function safeFile(value) {
  try {
    const u = new URL(value, 'https://data.europarl.europa.eu/');
    return u.protocol === 'https:' && u.hostname === 'data.europarl.europa.eu' && !u.port && !u.username && !u.password && u.pathname.startsWith('/distribution/') ? u.href : null;
  } catch { return null; }
}
export function documentFiles(work) {
  const originals = array(work.originalLanguage).map(languageCode).filter(Boolean);
  return array(work.is_realized_by).flatMap(e => array(e.is_embodied_by).flatMap(m => {
    const url = typeof m.is_exemplified_by === 'string' && safeFile(m.is_exemplified_by);
    const language = languageCode(e.language);
    return url ? [{ url, language, format: tail(m.format), byteSize: Number.isFinite(Number(m.byteSize)) ? Number(m.byteSize) : null,
      translationType: originals.includes(language) ? 'original' : 'unspecified', humanReviewStatus: 'unspecified' }] : [];
  }));
}
export function projectDocument(w) {
  const result = Object.fromEntries(['id','identifier','label','work_type','parliamentary_term','document_date','title_dcterms','workHadParticipation','creator','inverse_created_a_realization_of','adopts','based_on','originalLanguage','foresees_change_of','itemNumberBegin','itemNumberEnd','numbering','is_about','isAboutSubjectMatter','isAboutDirectoryCode'].filter(k => w[k] !== undefined).map(k => [k,w[k]]));
  result.languageVersionsObserved=w.languageVersionsObserved ?? (Object.hasOwn(w,'is_realized_by') && w.is_realized_by!=null);
  result.answersObserved=w.answersObserved ?? (Object.hasOwn(w,'inverse_answers_to') && w.inverse_answers_to!=null);
  if(tail(w.work_type)==='AMENDMENT_LIST')result.amendmentDistributionDeclared=typeof w.amendmentDistributionDeclared==='boolean'?w.amendmentDistributionDeclared:Object.hasOwn(w,'is_realized_by')&&w.is_realized_by!=null;
  result.is_realized_by = array(w.is_realized_by).map(e => ({ language:e.language, title:e.title,
    is_embodied_by:array(e.is_embodied_by).map(m => ({format:m.format,byteSize:m.byteSize,...(m.issued!==undefined?{issued:m.issued}:{}),is_exemplified_by:m.is_exemplified_by})) }));
  result.inverse_answers_to = array(w.inverse_answers_to).filter(a => a && typeof a === 'object').map(projectDocument);
  if (['REPORT_PLENARY','RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT'].includes(tail(w.work_type))) {
    // Reprojecting an older cache cannot recover observations it discarded.
    result.amendmentLinksVersion = Object.hasOwn(w,'amendmentLinksVersion')?w.amendmentLinksVersion:AMENDMENT_LINKS_VERSION;
    // An omitted or unavailable relationship is not an observed empty set.
    // Keep exact URI-only references as well as expanded list documents.
    if(w.inverse_foresees_change_of!=null)result.inverse_foresees_change_of=array(w.inverse_foresees_change_of)
      .map(ref=>ref&&typeof ref==='object'&&!Array.isArray(ref)&&typeof ref.id==='string'?projectDocument(ref):ref);
    result.inverse_based_on_a_realization_of = array(w.inverse_based_on_a_realization_of).map(ref => ref?.id || ref);
    result.inverse_decided_on_a_realization_of = array(w.inverse_decided_on_a_realization_of).map(ref => ref?.id || ref);
  }
  if (['RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT'].includes(tail(w.work_type))) {
    result.motionLinksVersion = 1;
    result.inverse_based_on_a_realization_of = array(w.inverse_based_on_a_realization_of).map(ref => ref?.id || ref);
    result.is_derivative_of = array(w.is_derivative_of).map(ref => ref?.id || ref);
  }
  return result;
}
export function projectProcedure(p) {
  return { id: p.id, process_type:p.process_type||p.procedure_type||p.had_procedure_type||null, process_title: p.process_title ?? null, had_participation: array(p.had_participation), consists_of: array(p.consists_of).map(a => Object.fromEntries(['id','had_activity_type','occured_at_stage','based_on_a_realization_of','created_a_realization_of','involved_work','decided_on_a_realization_of','activity_date'].filter(k => a[k] !== undefined).map(k => [k,a[k]]))) };
}
export function procedureIds(w) {
  return [...new Set(array(w.inverse_created_a_realization_of).map(tail).filter(v => /^\d{4}-\d{4}[A-Z]?$/.test(v)))];
}
function evidence(endpoint, fetchedAt, path, role, additional = {}) {
  return { apiUrl: 'https://data.europarl.europa.eu/api/v2'+endpoint, sourceFetchedAt: fetchedAt, relationship: path, role, ...additional };
}
export function documentRows(work, endpoint, fetchedAt, procedures = new Map()) {
  if (!term10(work)) return { rows: [], unresolved: [] };
  const kind = tail(work.work_type), sourceId = work.identifier || tail(work.id);
  if (!sourceId || !/^\d{4}-\d{2}-\d{2}$/.test(work.document_date || '')) throw new Error('Document identifier/date missing.');
  const titles = work.title_dcterms || Object.assign({}, ...array(work.is_realized_by).map(e => e.title || {}));
  const base = { id: sourceId, sourceId, term: 10, recordKind: 'document', date: work.document_date, titles, reference: work.label || sourceId,
    files: documentFiles(work), originalLanguages: array(work.originalLanguage), procedureIds: procedureIds(work), rulesBasis: array(work.based_on) };
  const rows = [], unresolved = [];
  const add = (persons, category, role, path, more = {}, proof = {}) => persons.forEach(mepId => rows.push({ ...base, ...more, mepId, category, categoryLabel: CATEGORIES[category] || 'Motion - category not established', provenance: evidence(endpoint, fetchedAt, path, role, proof) }));
  const roles = role => ids(array(work.workHadParticipation).filter(p => tail(p.participation_role) === role));
  const authors = [...new Set([...roles('AUTHOR'), ...array(work.creator).map(personId).filter(Boolean)])];
  if (kind === 'REPORT_PLENARY') {
    add(roles('RAPPORTEUR'), 'reports-rapporteur', 'RAPPORTEUR', 'report.workHadParticipation → person');
    for (const pid of procedureIds(work)) {
      const stored = procedures.get(pid);
      if (!stored) { unresolved.push({ sourceId, category:'reports-shadow', procedureId: pid, reason: 'Procedure not loaded' }); continue; }
      const procedure = stored.work || stored;
      const stageActivities = array(procedure.consists_of).filter(a => tail(a.had_activity_type) === 'TABLING_PLENARY' && array(a.based_on_a_realization_of).some(ref => referenceId(ref) === referenceId(work.id)));
      const stages = new Set(stageActivities.flatMap(a => array(a.occured_at_stage).map(tail)));
      if (!stages.size) { unresolved.push({ sourceId, category:'reports-shadow', procedureId: pid, reason: 'No report-specific procedure stage supplied' }); continue; }
      const shadows = array(procedure.had_participation).filter(p => term10(p) && tail(p.participation_role) === 'RAPPORTEUR_SHADOW' && stages.has(tail(p.occured_at_stage)));
      for (const p of shadows) add(ids([p]), 'reports-shadow', 'RAPPORTEUR_SHADOW', 'report.inverse_created_a_realization_of → procedure.consists_of (report/stage) → procedure.had_participation → person', {},
        { procedureId: pid, procedureApiUrl: 'https://data.europarl.europa.eu/api/v2/procedures/'+pid, procedureFetchedAt: stored.fetchedAt || null, stage: tail(p.occured_at_stage), participationId: p.id });
    }
  } else if (['OPINION_PARLIAMENTARY_COMMITTEE','OPINION_LETTER_PARLIAMENTARY_COMMITTEE'].includes(kind)) {
    add(roles('RAPPORTEUR_OPINION'), 'opinions-rapporteur', 'RAPPORTEUR_OPINION', 'opinion.workHadParticipation → person');
    add(roles('RAPPORTEUR_SHADOW_OPINION'), 'opinions-shadow', 'RAPPORTEUR_SHADOW_OPINION', 'opinion.workHadParticipation → person');
  } else if (['RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT'].includes(kind)) {
    const rules = array(work.based_on).map(tail);
    const motionType = rules.some(r => /^RULES-10-.*-ITM-A149$/.test(r)) ? 'individual' : rules.some(r => /^RULES-10-.*-ITM-A114$/.test(r)) ? 'institutional' : 'unspecified';
    const category=motionType==='individual'?'individual-motions':motionType==='institutional'?'motions':'unclassified-motions';
    add(authors, category, 'AUTHOR', 'motion.workHadParticipation/creator → person', { motionType });
  } else if (['QUESTION_WRITTEN','QUESTION_WRITTEN_PRIORITY'].includes(kind)) {
    add(authors, 'written-questions', 'AUTHOR', 'question.workHadParticipation/creator → person', { addressees: array(work.workHadParticipation).filter(p => tail(p.participation_role) === 'ADDRESSEE').flatMap(p => array(p.had_participant_organization)) });
    for (const answer of array(work.inverse_answers_to).filter(a => a && typeof a === 'object')) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(answer.document_date || '')) { unresolved.push({ sourceId, category:'written-questions', reason: 'Answer date missing' }); continue; }
      const aid = answer.identifier || tail(answer.id);
      if(!/^[A-Z0-9-]{1,100}$/.test(aid)){unresolved.push({sourceId,category:'written-questions',reason:'Answer identifier missing or invalid'});continue;}
      add(authors, 'written-questions', 'QUESTION_AUTHOR', 'question author → question.inverse_answers_to → answer', { id: aid, sourceId: aid, date: answer.document_date, recordKind: 'answer', relatedQuestionId: sourceId, relatedQuestionTitles:titles, titles, reference: answer.label || aid, files: documentFiles(answer), originalLanguages: array(answer.originalLanguage) });
    }
  } else if (kind === 'QUESTION_ORAL') add(authors, 'oral-questions', 'AUTHOR', 'question.workHadParticipation/creator → person');
  const unique = new Map(rows.map(r => [[r.sourceId,r.mepId,r.category].join('|'),r]));
  return { rows: [...unique.values()], unresolved };
}
export function speechRows(activity, fetchedAt) {
  if (!['PLENARY_DEBATE_SPEECH','PLENARY_DEBATE_WRITTEN_STATEMENT'].includes(tail(activity.had_activity_type))) return [];
  const doc = array(activity.recorded_in_a_realization_of).find(w => w && typeof w === 'object') || {};
  const participation = array(activity.had_participation);
  return ids(participation).map(mepId => ({ mepId, id: activity.activity_id, sourceId: activity.activity_id, term: 10, category: 'plenary-contributions', categoryLabel: CATEGORIES['plenary-contributions'], recordKind: 'speech', speechKind: tail(activity.had_activity_type), date: activity.activity_date, start: activity.activity_start_date || null, end: activity.activity_end_date || null, titles: activity.activity_label || {}, reference: doc.number || activity.activity_id, files: [], originalLanguages: array(doc.originalLanguage), ...speechWebsite(doc),
    provenance: evidence('/speeches/'+activity.activity_id, fetchedAt, 'speech.had_participation → person', 'SPEAKER') }));
}
export function localize(row, language) {
  const code = languagePreference(Object.keys(row.titles).filter(code=>row.titles[code]?.trim()),language)[0], titleLanguage=code||null;
  return { ...row, id: `${row.category}:${row.sourceId}`, title: code!==undefined ? sourceTitle(row.titles[code]) : row.reference, titleLanguage, requestedLanguage: language, availableFileLanguages: [...new Set(row.files.map(f => f.language).filter(Boolean))],
    transcriptPath: row.recordKind === 'speech' ? `../speech/${row.sourceId}?lang=${language}` : null };
}
