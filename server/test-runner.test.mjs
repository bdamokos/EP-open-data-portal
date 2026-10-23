import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, copyFile, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const root = new URL('../', import.meta.url);
// These are independent runner invocations, not children reporting to this file.
const environment = {...process.env, NODE_TEST_CONTEXT: undefined, CI: '', TEST_CONCURRENCY: '2', TEST_TIMEOUT_MS: '120000'};
async function fixture(t) {
  // Spaces in this path exercise NODE_OPTIONS URL handling as well.
  const directory = await mkdtemp(path.join(os.tmpdir(), 'test runner-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  for (const name of ['scripts', 'server', 'src']) await mkdir(path.join(directory, name));
  for (const name of ['run-tests.mjs', 'test-network-guard.mjs']) {
    await copyFile(new URL(`scripts/${name}`, root), path.join(directory, 'scripts', name));
  }
  await writeFile(path.join(directory, 'scripts/test-manifest.mjs'), "export const slow = [{file: 'server/slow.test.mjs', reason: 'subprocess fixture'}];\n");
  for (const name of ['src/frontend.test.mjs', 'server/fast.test.mjs', 'server/slow.test.mjs']) {
    await writeFile(path.join(directory, name), `import {test} from 'node:test'; test('${name}', () => {});\n`);
  }
  return {
    directory,
    run: (args = [], env = {}) => exec(process.execPath, ['scripts/run-tests.mjs', ...args, '--test-reporter=tap'], {
      cwd: directory, env: {...environment, ...env}, timeout: 30000,
    }),
  };
}

test('runner profiles, directory filters and explicit slow files select the intended tests', async t => {
  const {run} = await fixture(t);
  for (const [args, count] of [
    [[], 3], [['--fast'], 2], [['--slow'], 1], [['--server'], 2],
    [['--frontend'], 1], [['--fast', '--server'], 1],
    [['--fast', 'server/slow.test.mjs'], 1],
  ]) {
    const {stdout} = await run(args);
    assert.match(stdout, new RegExp(`files=${count} `));
    assert.match(stdout, new RegExp(`# tests ${count}\\n`));
    assert.match(stdout, /# fail 0\n/);
    if (args[0] === '--fast' && !args.includes('server/slow.test.mjs')) assert.match(stdout, /slow server\/slow.test.mjs: subprocess fixture/);
  }
});

test('runner preloads reach test children and fresh Node subprocesses while preserving NODE_OPTIONS', async t => {
  const {directory, run} = await fixture(t);
  await writeFile(path.join(directory, 'server/slow.test.mjs'), `
    import {test} from 'node:test';
    import assert from 'node:assert/strict';
    import {execFileSync} from 'node:child_process';
    test('guard inheritance', async () => {
      await assert.rejects(fetch('https://network-guard.invalid/'), /tests must not reach the network/);
      const script = "fetch('https://network-guard.invalid/').catch(error => console.log(error.message))";
      const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8', timeout: 10000});
      assert.match(output, /tests must not reach the network: network-guard.invalid/);
      assert.ok(process.env.NODE_OPTIONS.includes('--no-warnings'));
    });
  `);
  const {stdout} = await run(['server/slow.test.mjs'], {NODE_OPTIONS: '--no-warnings'});
  assert.match(stdout, /# pass 1\n/);
  assert.match(stdout, /# fail 0\n/);
});

test('runner preserves failure exits and environment concurrency precedence', async t => {
  const {directory, run} = await fixture(t);
  const {stdout} = await run(['server/fast.test.mjs', '--test-concurrency=9']);
  assert.match(stdout, /concurrency=2 /);
  await writeFile(path.join(directory, 'server/fast.test.mjs'), "import {test} from 'node:test'; test('failure', () => {throw new Error('fixture failure')});\n");
  await assert.rejects(run(['server/fast.test.mjs']), error => error.code === 1 && /fixture failure/.test(error.stdout));
  await assert.rejects(run([], {TEST_CONCURRENCY: 'bad'}), /TEST_CONCURRENCY must be a positive integer/);
  await assert.rejects(run([], {TEST_TIMEOUT_MS: '0'}), /TEST_TIMEOUT_MS must be a positive integer/);
  await writeFile(path.join(directory, 'server/fast.test.mjs'), "import {test} from 'node:test'; test('explicit timeout', {timeout: 10000}, () => new Promise(resolve => setTimeout(resolve, 100)));\n");
  assert.match((await run(['server/fast.test.mjs'], {TEST_TIMEOUT_MS: '20'})).stdout, /# pass 1\n/);
  await writeFile(path.join(directory, 'server/fast.test.mjs'), "import {test} from 'node:test'; test('default timeout', () => new Promise(resolve => setTimeout(resolve, 1000)));\n");
  await assert.rejects(run(['server/fast.test.mjs'], {TEST_TIMEOUT_MS: '20'}), error => error.code === 1 && /testTimeoutFailure/.test(error.stdout));
  const ci = await run(['server/slow.test.mjs'], {CI: '1', TEST_CONCURRENCY: undefined});
  assert.match(ci.stdout, /concurrency=Node default \(CI\)/);
});

test('loopback skips only permission errors and CI never accepts a denied probe', async () => {
  const helper = new URL('server/test-support/loopback.mjs', root).href;
  async function probe(code, env = {}) {
    const script = `
      import net from 'node:net';
      import {EventEmitter} from 'node:events';
      net.createServer = () => {
        const server = new EventEmitter();
        server.listen = () => {queueMicrotask(() => server.emit('error', Object.assign(new Error('probe failure'), {code: ${JSON.stringify(code)}}))); return server;};
        return server;
      };
      try {console.log(JSON.stringify((await import(${JSON.stringify(helper)})).loopback));}
      catch (error) {console.error(error.message + ' ' + error.code); process.exitCode = 1;}
    `;
    return exec(process.execPath, ['--input-type=module', '-e', script], {
      env: {...environment, TEST_SIMULATE_NO_LOOPBACK: '', ...env}, timeout: 10000,
    });
  }
  for (const code of ['EPERM', 'EACCES']) {
    assert.match((await probe(code)).stdout, new RegExp(`not permitted.*${code}.*CI runs this test`));
    await assert.rejects(probe(code, {CI: '1'}), /CI requires loopback listen/);
  }
  await assert.rejects(probe('EMFILE'), /probe failure EMFILE/);
  const simulated = await probe('EMFILE', {TEST_SIMULATE_NO_LOOPBACK: '1'});
  assert.match(simulated.stdout, /not permitted.*EPERM/);
  await assert.rejects(probe('EPERM', {CI: '1', TEST_SIMULATE_NO_LOOPBACK: '1'}), /CI requires loopback listen/);
});
