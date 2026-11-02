// Display preference only: amendment placement requires independent source evidence.
export const LANGUAGE_FALLBACK_ORDER = Object.freeze(['en', 'fr', 'es', 'de']);

// Order for showing language lists: the EU protocol order, which sorts the
// official languages by their own names (Interinstitutional Style Guide).
export const EU_PROTOCOL_ORDER = Object.freeze(['bg', 'es', 'cs', 'da', 'de', 'et', 'el', 'en', 'fr', 'ga', 'hr', 'it', 'lv', 'lt', 'hu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'fi', 'sv']);

export function protocolOrder(codes) {
  const rank = code => {const index = EU_PROTOCOL_ORDER.indexOf(code); return index < 0 ? EU_PROTOCOL_ORDER.length : index;};
  return [...new Set(codes)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function languagePreference(available, requested) {
  const remaining = new Set(available);
  const ordered = [];
  for (const code of [requested, ...LANGUAGE_FALLBACK_ORDER]) {
    if (remaining.delete(code)) ordered.push(code);
  }
  return [...ordered, ...[...remaining].sort()];
}

// Wording must share a published document language before placement can run.
export function amendmentLanguagePreference(available, requested, originals = []) {
  const remaining = new Set(available), ordered = [];
  for (const code of [requested, 'en', ...originals, ...languagePreference(available, requested)]) {
    if (remaining.delete(code)) ordered.push(code);
  }
  return ordered;
}
