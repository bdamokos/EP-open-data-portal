export const plenaryModes=['agenda','participation','cloud','trends','dossier'] as const;
export type PlenaryMode=typeof plenaryModes[number];
export const plenaryModeTitles:Record<PlenaryMode,string>={
  agenda:'Plenary agenda',participation:'What’s hot',cloud:'Plenary word cloud',trends:'Topic timeline',dossier:'Dossiers',
};
