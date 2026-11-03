import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {assertBranchHistory, assertHistoricalOccurrences, contractDigest, parseRegistry, reconcileRegistry, registrySides, renderRegistry} from './api-contract.mjs';
import {historyAuthority, requestedRepairs} from './api-history-repair.mjs';

function git(root, ...args) {
  return execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']}).trimEnd();
}

async function run(args) {
  const check = args.includes('--check');
  const force = args.includes('--force');
  const mainBase = process.env.API_VERSION_MAIN_BASE || 'origin/main';
  let base = process.env.API_VERSION_BASE || mainBase;
  let repairBase;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && check && args[i + 1] && !args[i + 1].startsWith('-')) base = args[++i];
    else if (args[i] === '--repair-history' && !check && args[i + 1] && !args[i + 1].startsWith('-')) repairBase = args[++i];
    else if (!['--check', '--force'].includes(args[i])) throw new Error('Usage: npm run api:bump [-- --force | --repair-history <known-green-main-ref>] | npm run api:check [-- --base <ref>]');
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
    const authority = historyAuthority(root, mainSha, main, current.repairs ?? []);
    assertBranchHistory(authority.main, branch, current);
    if (authority.histories.length) {
      // A baseline with the same recovery provenance already represents its
      // aliases; its full branch count is checked above, without double credit.
      const legacy = JSON.stringify(branch.repairs ?? []) === JSON.stringify(current.repairs ?? []) ? [] : [branch];
      assertHistoricalOccurrences(authority.main, [...authority.histories, ...legacy], current);
    }
    if (current.entries.at(-1)[1] !== digest) throw new Error(`Unbumped API contract change. Run npm run api:bump. Expected digest: ${digest}`);
    const provenance = authority.histories.length ? `verified main-history recovery from ${current.repairs.at(-1).base}; displaced digests retained`
      : `main mappings preserved from ${mainSha}`;
    console.log(`API contract ${current.version} (revision ${current.revision}) matches; ${provenance}; branch digests preserved from ${baselineSha}.`);
    return;
  }
  const {source, registries} = registrySides(original);
  const added = repairBase ? {base: git(root, 'rev-parse', '--verify', '--end-of-options', `${repairBase}^{commit}`), tip: mainSha} : undefined;
  const authority = historyAuthority(root, mainSha, main, requestedRepairs(main, registries, added));
  let bumpMain = authority.main, bumpBranches = [...authority.histories, ...registries];
  // A regenerated, still-unpublished recovery already contains these aliases.
  // Reuse it only after proving the canonical prefix and every displaced count;
  // otherwise normal reconciliation restores the missing history instead.
  if (authority.histories.length && registries.length === 1) {
    try {
      assertHistoricalOccurrences(authority.main, [main, ...authority.histories], registries[0]);
      bumpMain = registries[0]; bumpBranches = registries;
    } catch { /* Incomplete recoveries must be reconciled, not trusted. */ }
  }
  const next = reconcileRegistry(bumpMain, bumpBranches, digest, force);
  const updated = renderRegistry(source, next);
  // All fetching, parsing, imports and validation complete before the sole write.
  if (await readFile(filename, 'utf8') !== original) throw new Error('API version file changed while computing the digest; retry');
  if (updated !== original) await writeFile(filename, updated);
  console.log(`API_VERSION=${next.version}; revision=${next.revision}; baseline origin/main ${mainSha}; digest ${digest}.${updated === original ? ' No changes.' : ' Review and stage server/api-version.mjs.'}`);
}

run(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
