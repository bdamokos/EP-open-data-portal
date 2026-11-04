// Source categories only: an explicit other code is not a missing observation.
// Keep the original authority value in source records and demographic evidence.
export function sourceGender(value) {
  const supplied = [...new Set((Array.isArray(value) ? value : [value]).filter(v => v != null && v !== ''))];
  if (supplied.length !== 1 || typeof supplied[0] !== 'string') return null;
  const code = supplied[0].match(/\/([A-Z][A-Z0-9_]*)$/)?.[1];
  return !code ? null : code === 'FEMALE' ? 'f' : code === 'MALE' ? 'm' : 'other';
}
