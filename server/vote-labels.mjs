// ODP publishes a sitting's vote decisions with French labels only on the vote
// day (referenceText, headingLabel, activity_label, comment) and adds English
// and the other languages days later. Code that recognises a vote by its label
// matches English wording, so until English arrives the French label stands in
// through this fixed table. Each pair is the English text ODP published for the
// same field in multilingual sittings. The result is for matching only: display
// keeps the published text and its language.
const PAIRS = [
  ['Proposition de résolution (ensemble du texte)', 'Motion for a resolution (as a whole)'],
  ['Proposition de résolution', 'Motion for a resolution'],
  ['Proposition de resolution', 'Motion for a resolution'],
  ['Proposition de résolution de remplacement', 'Alternative motion for a resolution'],
  ['Propositions de résolution de remplacement', 'Alternative motions for a resolution'],
  ['Autres propositions de résolution', 'Other motions for resolutions'],
  ['Proposition de la Commission', 'Commission proposal'],
  ['Proposition de la Commission au Conseil', 'Commission proposal to the Council'],
  ['Proposition de la Commission et amendements', 'Commission proposal and amendments'],
  ['Proposition de la Commission et amendement', 'Commission proposal and amendment'],
  ['Proposition de décision', 'Proposal for a decision'],
  ['Proposition de décision (ensemble du texte)', 'Proposal for a decision (as a whole)'],
  ['Propositions de décision', 'Proposals for decisions'],
  ['Proposition de décision du Conseil', 'Proposal for a Council decision'],
  ['Projet de décision du Conseil', 'Draft Council decision'],
  ['Projet de règlement du Conseil', 'Draft Council regulation'],
  ['Projet du Conseil', 'Council draft'],
  ['Projet commun', 'Joint text'],
  ["Projet d'acte législatif", 'Draft legislative act'],
  ['Projet de résolution législative', 'Draft legislative resolution'],
  ['Projet de recommandation (ensemble du texte)', 'Draft recommendation (as a whole)'],
  ['Accord provisoire', 'Provisional agreement'],
  ['Ensemble du texte', 'Text as a whole'],
  ['Proposition de rejet', 'Proposal for rejection'],
  ['Proposition de rejet de la proposition de la Commission', 'Proposal to reject the Commission proposal'],
  ['Proposition de rejet de la position du Conseil', 'Proposal to reject the Council position'],
  ['Rejet', 'Rejection'],
  ['Amendement de compromis', 'Compromise amendment'],
  ['Amendements de la commission compétente', 'Amendments by the committee responsible'],
  ['Amendements de la commission responsable', 'Amendments by the committee responsible'],
  ['Amendements de la commission', 'Amendments by the committee responsible'],
  ['vote séparé', 'separate vote'],
  ['votes séparés', 'separate votes'],
  ['vote en bloc', 'put to the vote collectively'],
  ['votes séparés et votes par division', 'separate and split votes'],
  ['Demande de renvoi en commission', 'Request for referral back to committee'],
  ['Demande de renvoi', 'Request for referral back'],
  ["Demande d'ajournement du vote", 'Motion for adjournment of the vote'],
  ["Demande de décision d'urgence", 'Request for an urgent decision'],
  ["Demandes de décision d'urgence", 'Requests for an urgent decision'],
  ['Demande de procéder au vote sur les amendements', 'Proposal to vote on amendments'],
  ["Décision d'engager des négociations interinstitutionnelles", 'Decision to enter into interinstitutional negotiations'],
  ['Approbation sans vote', 'Approval without vote'],
  ['Adopté sans vote', 'Adopted without vote'],
];
const fold = value => value.normalize('NFC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const FRENCH = new Map(PAIRS.map(([fr, en]) => [fold(fr), en]));
// Patterned labels, each with the English form ODP published for it.
const PATTERNS = [
  // "Demande de renvoi (article 60, paragraphe 4, du règlement)" → "Request for referral back (Rule 60(4))"
  [/^(.+?) \(article (\d+), paragraphe (\d+), du règlement\)$/, (m, head) => FRENCH.has(head) ? `${FRENCH.get(head)} (Rule ${m[2]}(${m[3]}))` : null],
  // Agenda requests: "Demande du groupe The Left" → "Request by the The Left Group"
  [/^Demande du groupe (.+)$/, m => `Request by the ${m[1]} Group`],
  [/^Demande des groupes (.+)$/, m => `Request by the ${m[1]} Groups`],
  [/^Demande d'ajournement du groupe (.+)$/, m => `Request for adjournment from ${m[1]}`],
  // "Accord provisoire (Proposition de la Commission - non modifiée)"
  [/^Accord provisoire \((.+)\)$/, m => `Provisional agreement (${m[1]})`],
  // "Article 54 (correspond à l'article 70 dans l'amendement 2)" → "… in Am 2)"
  [/^(.+) \(correspond à (.+) dans l'amendement (\d+)\)$/, m => `${m[1]} (corresponds to ${m[2]} in Am ${m[3]})`],
];
const segment = part => {
  const known = FRENCH.get(part);
  if (known) return known;
  for (const [pattern, english] of PATTERNS) {
    const match = pattern.exec(part);
    const value = match && english(match, match[1]);
    if (value) return value;
  }
  return part;
};

/** The label's English text, or its French text through the table above.
 * Compound labels ("A10-0211/2026 - Rapporteur - Accord provisoire - Am 36")
 * are mapped segment by segment; names, references and unknown segments pass
 * unchanged, so they cannot match an English label they were not. */
export function englishVoteLabel(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  if (typeof value.en === 'string') return value.en;
  const source = typeof value.fr === 'string' ? value.fr : typeof value.mul === 'string' ? value.mul : null;
  if (source === null) return null;
  const text = fold(source);
  if (FRENCH.has(text)) return FRENCH.get(text);
  const rule = segment(text);
  if (rule !== text) return rule;
  const motion = /^Proposition de résolution (commune )?((?:RC-)?B\d+-\d+\/\d{4}\b.*)$/.exec(text);
  if (motion) return `${motion[1] ? 'Joint motion' : 'Motion'} for a resolution ${motion[2]}`;
  const parts = text.split(/ [-–—] /);
  return parts.length > 1 ? parts.map(segment).join(' – ') : text;
}

/** The English label, or the English equivalent of a standard French label
 * from the table; never French text. For fields that later code also reads as
 * an English location reference. */
export function standardVoteLabel(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.en === 'string') return value.en;
  const source = typeof value.fr === 'string' ? value.fr : typeof value.mul === 'string' ? value.mul : null;
  return source === null ? null : FRENCH.get(fold(source)) ?? null;
}
