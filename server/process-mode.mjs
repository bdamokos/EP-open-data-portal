const mode=process.env.EXPLORER_PROCESS_MODE||'single';
if(!['single','split'].includes(mode))throw new Error('EXPLORER_PROCESS_MODE must be single or split');
export const EXPLORER_PROCESS_MODE=mode;
