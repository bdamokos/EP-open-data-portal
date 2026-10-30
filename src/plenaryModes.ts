import {defaultUi} from './uiDefault.mjs';
export const plenaryModes=['agenda','participation','cloud','trends','dossier'] as const;
export type PlenaryMode=typeof plenaryModes[number];
export const plenaryModeTitles:Record<PlenaryMode,string>={
  agenda:'Plenary agenda',participation:'What’s hot',cloud:'Plenary word cloud',trends:'Topic timeline',dossier:'Dossiers',
};
export const plenaryModeTitlesUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof plenaryModeTitles => ({
  agenda:ui.t("plenarymodes.plenary_agenda"),participation:ui.t("plenarymodes.what_s_hot"),cloud:ui.t("plenarymodes.plenary_word_cloud"),trends:ui.t("plenarymodes.topic_timeline"),dossier:ui.t("plenarymodes.dossiers"),
});
