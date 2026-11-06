// Vite plugin for tests of the redesigned behaviour: serves the rollout constant as true.
export const rolloutLive={
  name:'plenary-rollout-live',
  enforce:'pre',
  transform(code,id){
    if(id.split('?')[0].endsWith('/src/plenaryRollout.mjs'))return 'export const PLENARY_REDESIGN_LIVE=true;\n';
  },
};
