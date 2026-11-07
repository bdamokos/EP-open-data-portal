import {defaultUi} from './uiDefault.mjs';
export const plenaryModes=['agenda','participation','cloud','topics','dossier','read','vote','week'] as const;
export type PlenaryMode=typeof plenaryModes[number];
export const plenaryModeTitles:Record<PlenaryMode,string>={
  agenda:'Plenary agenda',participation:'What’s hot',cloud:'Plenary word cloud',topics:'Topics',dossier:'Dossiers',read:'Document',vote:'Vote',week:'Plenary agenda',
};
export const plenaryModeTitlesUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof plenaryModeTitles => ({
  agenda:ui.t("plenarymodes.plenary_agenda"),participation:ui.t("plenarymodes.what_s_hot"),cloud:ui.t("plenarymodes.plenary_word_cloud"),topics:ui.t("topics.plenaryMode"),dossier:ui.t("plenarymodes.dossiers"),read:ui.t("searchreference.document"),vote:ui.t("legislation.vote.64f872"),week:ui.t("plenarymodes.plenary_agenda"),
});
