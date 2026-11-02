export const LANGUAGE_FALLBACK_ORDER: readonly string[];
export function languagePreference(available: Iterable<string>, requested: string): string[];
export const EU_PROTOCOL_ORDER: readonly string[];
export function protocolOrder(codes: Iterable<string>): string[];
