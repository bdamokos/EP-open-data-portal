import {execFileSync} from 'node:child_process';
import {assertRecordedHistory, parseRegistry} from './api-contract.mjs';

const equal = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
const prefix = (a, b) => a.length <= b.length && equal(a, b.slice(0, a.length));

// An explicit recovery may restore a proven append-only prefix, never invent
// an authority from an arbitrary branch. All displaced records are then checked
// as branch histories and receive revisions above the published main tip.
export function historyAuthority(root, mainSha, main, repairs) {
  const published = main.repairs ?? [];
  if (equal(published, repairs)) return {main, histories: []};
  if (repairs.length !== published.length + 1 || !prefix(published, repairs)) throw new Error('Published API history repair provenance must be preserved');
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const chain = git('rev-list', '--first-parent', '--reverse', mainSha).split('\n');
  const positions = new Map(chain.map((sha, i) => [sha, i]));
  const {base, tip} = repairs.at(-1);
  if (!positions.has(base) || !positions.has(tip) || positions.get(base) >= positions.get(tip)) throw new Error('API history repair must name an ordered first-parent main range');
  const read = sha => parseRegistry(git('show', `${sha}:server/api-version.mjs`));
  const anchor = read(base), brokenTip = read(tip);
  if (!equal(anchor.repairs, published)) throw new Error('Repair base must belong to the current published provenance era');
  if (anchor.revision > main.revision) throw new Error('History recovery cannot truncate a published revision');
  assertRecordedHistory(brokenTip, main); // Do not extend an undeclared corruption past tip.
  const refs = git('rev-list', '--first-parent', '--reverse', mainSha, '--', 'server/api-version.mjs').split('\n');
  let started = false;
  const states = [];
  for (const sha of refs) {
    if (!positions.has(sha)) throw new Error('Registry history left the first-parent main chain');
    const text = git('show', `${sha}:server/api-version.mjs`);
    if (!text.includes('API_CONTRACT_DIGESTS')) {
      if (started) throw new Error('Published API registry was removed');
      continue; // Refs from before the registry was introduced.
    }
    started = true;
    const registry = parseRegistry(text);
    if (!prefix(registry.repairs ?? [], published)) throw new Error('Unexpected published history repair provenance');
    if (!equal(registry.repairs, published)) {
      if (positions.get(sha) > positions.get(base)) throw new Error('Published repair provenance was removed inside the repair range');
      continue; // Earlier recovery eras are already attested.
    }
    if (positions.get(sha) <= positions.get(base)) assertRecordedHistory(registry, anchor);
    else states.push({sha, registry});
  }
  let stable = anchor, collided = false;
  const histories = [];
  for (const {sha, registry} of states) {
    if (registry.revision > main.revision) throw new Error('History recovery cannot truncate a published revision');
    if (positions.get(sha) <= positions.get(tip)) {
      if (!collided) {
        try { assertRecordedHistory(stable, registry); stable = registry; }
        catch { collided = true; }
      }
      histories.push(registry);
    } else assertRecordedHistory(brokenTip, registry);
  }
  if (!collided) throw new Error('No replaced main mappings in the declared repair range');
  const entries = main.entries.map(entry => [...entry]);
  for (const [revision, digest] of stable.entries) entries[revision - 1] = [revision, digest];
  return {main: {...main, entries, repairs}, histories};
}

export function requestedRepairs(main, branches, added) {
  const published = main.repairs ?? [];
  let requested = published;
  for (const branch of branches) {
    const records = branch.repairs ?? [];
    if (prefix(records, published)) continue;
    if (records.length !== published.length + 1 || !prefix(published, records)
      || requested !== published && !equal(requested, records)) throw new Error('Conflicting API history repair provenance');
    requested = records;
  }
  if (added) {
    const explicit = [...published, added];
    if (requested !== published && !equal(requested, explicit)) throw new Error('Conflicting API history repair request');
    requested = explicit;
  }
  return requested;
}
