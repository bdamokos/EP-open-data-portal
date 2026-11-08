// Vite plugin for tests of the pre-redesign plenary pages: serves the rollout
// constant as false. Those pages stay as the one-line revert until P12 deletes
// them, and the tests pinned here go with them.
export const rolloutOff={
  name:'plenary-rollout-off',
  enforce:'pre',
  transform(code,id){
    if(id.split('?')[0].endsWith('/src/plenaryRollout.mjs'))return 'export const PLENARY_REDESIGN_LIVE=false;\n';
  },
};
// freshLoader arguments with the switch off. The plugin is stateless, so the
// transform server is shared per option set.
export const withRolloutOff=options=>[{...options,plugins:[...(options.plugins||[]),rolloutOff]},{sharedServerKey:'plenary-rollout-off:'+JSON.stringify(options)}];
