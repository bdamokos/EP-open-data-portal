// Display preference only: amendment placement requires independent source evidence.
export const LANGUAGE_FALLBACK_ORDER = Object.freeze(['en', 'fr', 'es', 'de']);

export function languagePreference(available, requested) {
  const remaining = new Set(available);
  const ordered = [];
  for (const code of [requested, ...LANGUAGE_FALLBACK_ORDER]) {
    if (remaining.delete(code)) ordered.push(code);
  }
  return [...ordered, ...[...remaining].sort()];
}
