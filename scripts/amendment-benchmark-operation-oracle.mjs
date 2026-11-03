// Independent source-cell policy. Do not import the production operation
// classifier or its vocabulary: a shared mistake must fail verification.
// The 24 language editions of A-10-2025-0150-AM-001-129 AM5 supply the
// instructions below; bounded excerpts and provenance live in
// server/fixtures/amendment-operation-excerpts.json.
import {expectedLanguageScope} from './amendment-benchmark-scope-oracle.mjs';
import {oracleAddress,oracleFold} from './amendment-oracle-grammar.mjs';
import {LANGUAGE_SECTIONS} from './amendment-language-vocabulary.mjs';
const instructions = new Set([
  'deleted', 'заличава се', 'vypouští se', 'udgår', 'entfällt',
  'διαγράφεται', 'suprimido', 'välja jäetud', 'poistetaan', 'supprimé',
  'scriosta', 'briše se', 'törölve', 'soppresso', 'išbraukta', 'svītrots',
  'imħassar', 'schrappen', 'skreśla się', 'eliminat', 'vypúšťa sa',
  'črtano', 'utgår',
  // Existing published spelling/gender variants remain whole-cell forms.
  'supprimée', 'gestrichen', 'soppressa', 'suprimida', 'geschrapt', 'eliminată',
]);

export function expectedOperation({originalText, proposedText, language, targetLabel, baseline, sectionKind, documentReferences=[]} = {}) {
  if (typeof originalText !== 'string' || typeof proposedText !== 'string') return null;
  if(expectedLanguageScope({originalText,proposedText,language}))return 'not-applicable';
  const original = originalText.trim(), proposed = proposedText.trim();
  // Only the observed terminal full stop and surrounding whitespace are
  // ignored. Prose, quotes, ellipses and other punctuation retain their meaning.
  const instruction = proposed.normalize('NFC').toLowerCase().replace(/\s*\.$/u, '').replace(/\s+/gu, ' ');
  const deleted = instructions.has(instruction);
  if (!original) return proposed && !deleted ? 'insert' : null;
  const classes=new Set((LANGUAGE_SECTIONS[language]?.classes||[]).map(value=>oracleFold(value).toLowerCase()));
  const resolution=baseline==='motion-resolution'||sectionKind==='resolution'||(baseline==null||baseline==='unknown')
    &&documentReferences.some(ref=>ref.field==='DocAmend'&&classes.has(oracleFold(ref.raw).toLowerCase()));
  const target=resolution&&proposed&&!deleted?oracleAddress(targetLabel,language,{resolution:true}):null;
  // In resolutions an explicitly new paragraph can quote its predecessor as
  // context. Verification separately proves that original against the base.
  if(target?.length===1&&target[0].kind==='paragraph'&&target[0].isNew&&target[0].suffix)return 'insert';
  return !proposed || deleted ? 'delete' : 'replace';
}
