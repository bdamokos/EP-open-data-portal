// Process entry point. EXPLORER_PROCESS_MODE=split starts the small front process,
// which starts the API process on demand; the default runs everything in one process.
// The mode is decided before either graph loads, so the front never loads the API.
import {EXPLORER_PROCESS_MODE} from './process-mode.mjs';

const start=EXPLORER_PROCESS_MODE==='split'
  ?import('./front.mjs').then(module=>module.startFront())
  :import('./index.mjs').then(module=>module.runServer());
start.catch(error=>{
  console.error('[parliament-explorer] startup failed:',error);
  process.exit(1);
});
