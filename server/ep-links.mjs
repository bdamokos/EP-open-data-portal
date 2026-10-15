const languages = { BUL: "bg", SPA: "es", CES: "cs", CZE: "cs", DAN: "da", DEU: "de", GER: "de", EST: "et", ELL: "el", GRE: "el", ENG: "en", FRA: "fr", FRE: "fr", GLE: "ga", HRV: "hr", ITA: "it", LAV: "lv", LIT: "lt", HUN: "hu", MLT: "mt", NLD: "nl", DUT: "nl", POL: "pl", POR: "pt", RON: "ro", RUM: "ro", SLK: "sk", SLO: "sk", SLV: "sl", FIN: "fi", SWE: "sv" };
export function languageCode(uri) {
  const value = String(uri || "").split("/").at(-1);
  return languages[value?.toUpperCase()] || (/^[a-z]{2}$/.test(value || "") ? value : null);
}
export function speechWebsite(doc) {
  const match = String(doc.identifier || doc.id || "").match(/CRE-(\d+)-(\d{4}-\d{2}-\d{2})-(?:OTH|INT)-(\d+)$/);
  const value = doc.originalLanguage || doc.originalLanguageURI || [];
  const language = (Array.isArray(value) ? value : [value]).map(languageCode).find(Boolean);
  return match && language ? {
    websiteUrl: `https://www.europarl.europa.eu/doceo/document/CRE-${match[1]}-${match[2]}-INT-${match[3]}_${language.toUpperCase()}.html`,
    websiteLanguage: language,
  } : { websiteUrl: null, websiteLanguage: null };
}
