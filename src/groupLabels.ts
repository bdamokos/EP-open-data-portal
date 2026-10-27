export const groupLabel=(code:string)=>({PPE:'EPP','Verts/ALE':'Greens/EFA',NI:'Non-attached',TheLeft:'The Left',unavailable:'Unavailable'} as Record<string,string>)[code]||code;
// Political group colours are theme tokens (src/theme.css); both label and identifier forms map to them.
export const groupTokens:Record<string,string>={PPE:'ppe','S&D':'sd',S_D:'sd',Renew:'renew',RENEW:'renew','Verts/ALE':'greens',VERTS_ALE:'greens',ECR:'ecr',PfE:'pfe',PFE:'pfe',ESN:'esn','The Left':'left',TheLeft:'left',THE_LEFT:'left',NI:'ni'};
export const groupColor=(code:string)=>`var(--group-${groupTokens[code]||'unknown'})`;
