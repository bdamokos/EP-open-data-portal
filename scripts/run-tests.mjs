import {spawn} from 'node:child_process';
import {readdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {slow} from './test-manifest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let profile = 'full';
const directories = new Set();
const focused = [];
const forwarded = [];
// Node flags with separate values must not be mistaken for focused test paths.
const valueFlags = new Set(['--test-reporter', '--test-reporter-destination', '--test-name-pattern', '--test-skip-pattern', '--test-shard', '--test-timeout', '--test-concurrency', '--test-isolation']);
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--') continue;
  if (['--full', '--fast', '--slow'].includes(arg)) profile = arg.slice(2);
  else if (arg === '--server') directories.add('server');
  else if (arg === '--frontend') directories.add('src');
  else if (arg.startsWith('-')) {
    forwarded.push(arg);
    if (valueFlags.has(arg)) {
      if (!args[i + 1]) throw new Error(`Missing value for ${arg}`);
      forwarded.push(args[++i]);
    }
  } else focused.push(path.relative(root, path.resolve(arg)).split(path.sep).join('/'));
}
const all = ['src', 'server'].flatMap(dir => readdirSync(path.join(root, dir))
  .filter(name => name.endsWith('.test.mjs')).map(name => `${dir}/${name}`)).sort();
for (const file of focused) {
  if (!all.includes(file)) throw new Error(`Not a suite test file: ${file}`);
}
const excluded = [];
let files = focused.length ? [...new Set(focused)] : all;
if (directories.size) {
  const omitted = files.filter(file => !directories.has(file.split('/')[0]));
  if (omitted.length) excluded.push(`directory (${omitted.length} files): restricted to ${[...directories].join(', ')}`);
  files = files.filter(file => directories.has(file.split('/')[0]));
}
// Explicit files override the profile so a focused slow file is never silently omitted.
if (!focused.length && profile === 'fast') {
  for (const entry of slow) if (files.includes(entry.file)) excluded.push(`slow ${entry.file}: ${entry.reason}`);
  files = files.filter(file => !slow.some(entry => entry.file === file));
} else if (!focused.length && profile === 'slow') {
  const omitted = files.filter(file => !slow.some(entry => entry.file === file));
  if (omitted.length) excluded.push(`fast (${omitted.length} files): only manifest slow files requested`);
  files = files.filter(file => slow.some(entry => entry.file === file));
}
function positiveInteger(value, name) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}
const concurrency = process.env.TEST_CONCURRENCY !== undefined
  ? positiveInteger(process.env.TEST_CONCURRENCY, 'TEST_CONCURRENCY')
  : process.env.CI ? undefined : Math.max(2, Math.floor(os.availableParallelism() / 2));
const timeout = positiveInteger(process.env.TEST_TIMEOUT_MS ?? 120000, 'TEST_TIMEOUT_MS');
console.log(`[tests] profile=${profile}${focused.length ? ' (focused)' : ''} files=${files.length} concurrency=${concurrency ?? 'Node default (CI)'} timeout=${timeout}ms excluded=${excluded.length ? excluded.join('; ') : 'none'}`);
if (!files.length) throw new Error('No test files selected');
const guard = new URL('./test-network-guard.mjs', import.meta.url).href;
const flags = ['--test', `--test-timeout=${timeout}`, '--import', guard, ...forwarded];
// Environment selection wins over a forwarded concurrency flag, too.
if (concurrency !== undefined) flags.push(`--test-concurrency=${concurrency}`);
// execFile/spawn of fresh Node processes does not inherit execArgv. Keep the
// preload in NODE_OPTIONS as well so isolated cache/restart scripts are guarded.
const env = {...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${guard}`].filter(Boolean).join(' ')};
const child = spawn(process.execPath, [...flags, ...files], {cwd: root, stdio: 'inherit', env});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => {console.error(error); process.exitCode = 1;});
child.on('exit', (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  }
  else process.exitCode = code;
});
