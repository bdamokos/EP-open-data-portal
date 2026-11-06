import {defaultUi} from './uiDefault.mjs';

export const votePositionKeys = ['for', 'against', 'abstaining'] as const;
export type VotePosition = typeof votePositionKeys[number];

// The three recorded positions share one wording across the vote views.
export const positionsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi): Record<VotePosition, string> => ({
  for: ui.t('membervotespresentation.for'),
  against: ui.t('membervotespresentation.against'),
  abstaining: ui.t('membervotesummary.abstaining'),
});
