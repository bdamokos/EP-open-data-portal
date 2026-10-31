import {defaultUi} from './uiDefault.mjs';
const groupMessageIds:Record<string,string>={PPE:'grouplabels.ts.epp','Verts/ALE':'grouplabels.ts.greens.efa',NI:'grouplabels.ts.non.attached',TheLeft:'grouplabels.ts.the.left',unavailable:'grouplabels.ts.unavailable'};
export const groupLabel=(code:string,ui:import('./uiI18n.mjs').UiFormatter=defaultUi)=>Object.hasOwn(groupMessageIds,code)?ui.t(groupMessageIds[code]):code;
export const groupLabelLanguage=(code:string,ui:import('./uiI18n.mjs').UiFormatter=defaultUi)=>Object.hasOwn(groupMessageIds,code)?ui.language:'';
// Political group colours are theme tokens (src/theme.css); both label and identifier forms map to them.
export const groupTokens:Record<string,string>={PPE:'ppe','S&D':'sd',S_D:'sd',Renew:'renew',RENEW:'renew','Verts/ALE':'greens',VERTS_ALE:'greens',ECR:'ecr',PfE:'pfe',PFE:'pfe',ESN:'esn','The Left':'left',TheLeft:'left',THE_LEFT:'left',NI:'ni'};
export const groupColor=(code:string)=>`var(--group-${groupTokens[code]||'unknown'})`;
