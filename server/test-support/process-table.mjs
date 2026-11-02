import childProcess from 'node:child_process';

// Process-group assertions read pgids with ps, which is setuid root on macOS;
// sandboxes that refuse setuid exec deny it. Probe once per test process.
// Simulation is only for testing skip/CI behaviour.
function probe() {
  if (process.env.TEST_SIMULATE_NO_PROCESS_TABLE === '1') return {code: 'EPERM'};
  try {childProcess.execFileSync('ps', ['-o', 'pid=,pgid=', '-p', String(process.pid)], {stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000});}
  catch (error) {return error;}
  return null;
}
const failure = process.platform === 'win32' ? null : probe();
if (failure && !['EPERM', 'EACCES'].includes(failure.code)) throw failure;
if (failure && process.env.CI) throw new Error(`CI requires reading process groups with ps (${failure.code ?? 'UNKNOWN'})`, {cause: failure});
export const processTable = process.platform === 'win32'
  ? {skip: 'POSIX process-group lifecycle probe'}
  : failure
    ? {skip: `running ps to read process groups is not permitted in this environment (${failure.code ?? 'UNKNOWN'}); CI runs this test`}
    : {};
