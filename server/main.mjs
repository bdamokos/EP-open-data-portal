// Process entry point. EXPLORER_PROCESS_MODE=split starts the small front process,
// which starts the API process on demand; the default runs everything in one process.
// The mode is decided before either graph loads, so the front never loads the API.
import {EXPLORER_PROCESS_MODE} from './process-mode.mjs';

if(EXPLORER_PROCESS_MODE==='split')(await import('./front.mjs')).startFront();
else (await import('./index.mjs')).runServer();
