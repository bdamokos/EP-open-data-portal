import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {assertBranchHistory, contractDigest, parseRegistry, reconcileRegistry, registrySides, renderRegistry} from './api-contract.mjs';

function git(root, ...args) {
  return execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trimEnd();
}

async function run(args) {
  const check = args.includes('--check');
  const force = args.includes('--force');
  const mainBase = process.env.API_VERSION_MAIN_BASE || 'origin/main';
  let base = process.env.API_VERSION_BASE || mainBase;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && check && args[i + 1] && !args[i + 1].startsWith('-')) base = args[++i];
    else if (!['--check', '--force'].includes(args[i])) throw new Error('Usage: npm run api:bump [-- --force] | npm run api:check [-- --base <ref>]');
  }
  if (check && force) throw new Error('--force is only valid for api:bump');
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
  if (!check) {
    // Fail closed when main cannot be refreshed. Never fetch or write in CI checks.
    git(root, 'fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main');
    base = 'origin/main';
  }
  const mainSha = git(root, 'rev-parse', '--verify', `${check ? mainBase : 'origin/main'}^{commit}`);
  const baselineSha = git(root, 'rev-parse', '--verify', `${base}^{commit}`);
  const main = parseRegistry(git(root, 'show', `${mainSha}:server/api-version.mjs`));
  const filename = path.join(root, 'server/api-version.mjs');
  const original = await readFile(filename, 'utf8');
  const {digest} = await contractDigest(root);
  if (check) {
    const current = parseRegistry(original);
    const branch = parseRegistry(git(root, 'show', `${baselineSha}:server/api-version.mjs`));
    assertBranchHistory(main, branch, current);
    if (current.entries.at(-1)[1] !== digest) throw new Error(`Unbumped API contract change. Run npm run api:bump. Expected digest: ${digest}`);
    console.log(`API contract ${current.version} matches; main mappings preserved from ${mainSha}; branch digests preserved from ${baselineSha}.`);
    return;
  }
  const {source, registries} = registrySides(original);
  const next = reconcileRegistry(main, registries, digest, force);
  const updated = renderRegistry(source, next);
  // All fetching, parsing, imports and validation complete before the sole write.
  if (await readFile(filename, 'utf8') !== original) throw new Error('API version file changed while computing the digest; retry');
  if (updated !== original) await writeFile(filename, updated);
  console.log(`API_VERSION=${next.version}; baseline origin/main ${mainSha}; digest ${digest}.${updated === original ? ' No changes.' : ' Review and stage server/api-version.mjs.'}`);
}

run(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
