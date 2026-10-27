// Independent source-cell policy. Do not import the production operation
// classifier or its vocabulary: a shared mistake must fail verification.
// The 24 language editions of A-10-2025-0150-AM-001-129 AM5 supply the
// instructions below; bounded excerpts and provenance live in
// server/fixtures/amendment-operation-excerpts.json.
const instructions = new Set([
  'deleted', 'заличава се', 'vypouští se', 'udgår', 'entfällt',
  'διαγράφεται', 'suprimido', 'välja jäetud', 'poistetaan', 'supprimé',
  'scriosta', 'briše se', 'törölve', 'soppresso', 'išbraukta', 'svītrots',
  'imħassar', 'schrappen', 'skreśla się', 'eliminat', 'vypúšťa sa',
  'črtano', 'utgår',
  // Existing published spelling/gender variants remain whole-cell forms.
  'supprimée', 'gestrichen', 'soppressa', 'suprimida', 'geschrapt', 'eliminată',
]);

export function expectedOperation({originalText, proposedText} = {}) {
  if (typeof originalText !== 'string' || typeof proposedText !== 'string') return null;
  const original = originalText.trim(), proposed = proposedText.trim();
  // Only the observed terminal full stop and surrounding whitespace are
  // ignored. Prose, quotes, ellipses and other punctuation retain their meaning.
  const instruction = proposed.normalize('NFC').toLowerCase().replace(/\s*\.$/u, '').replace(/\s+/gu, ' ');
  const deleted = instructions.has(instruction);
  if (!original) return proposed && !deleted ? 'insert' : null;
  return !proposed || deleted ? 'delete' : 'replace';
}
