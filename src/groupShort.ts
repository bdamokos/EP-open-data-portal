import {groupLabel} from './groupLabels';

// Short forms only where the full group name is long; the full name stays available as a title or accessible label.
const shortIds:Record<string,string>={'Verts/ALE':'votegroups.countries.short.greens',TheLeft:'votegroups.countries.short.left',NI:'votegroups.countries.short.ni'};
export function groupShortLabel(code:string,ui:import('./uiI18n.mjs').UiFormatter) {
  const full=groupLabel(code,ui);
  return full.length<=7||!shortIds[code]?full:ui.t(shortIds[code]);
}
