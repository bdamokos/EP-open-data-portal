import net from 'node:net';

// Probe once per test process. Simulation is only for testing skip/CI behaviour.
const failure = process.env.TEST_SIMULATE_NO_LOOPBACK === '1' ? {code: 'EPERM'} : await new Promise(resolve => {
  const server = net.createServer();
  server.once('error', resolve);
  server.listen(0, '127.0.0.1', () => server.close(() => resolve(null)));
});
if (failure && process.env.CI) throw new Error(`CI requires loopback listen on 127.0.0.1 (${failure.code ?? 'UNKNOWN'})`, {cause: failure});
export const loopback = failure
  ? {skip: `loopback listen on 127.0.0.1 is not permitted in this environment (${failure.code ?? 'UNKNOWN'}); CI runs this test`}
  : {};
