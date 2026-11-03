import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

// Shared by the read-only contract test and the explicit developer command.
export async function contractDigest(root) {
  const versions = [];
  const directory = path.join(root, 'server');
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.mjs') || name.endsWith('.test.mjs') || name === 'api-version.mjs') continue;
    const url = pathToFileURL(path.join(directory, name));
    const source = await readFile(url, 'utf8');
    if (!/\bexport\s+(?:const|let|var)\s+\w+_VERSION\b/.test(source)) continue;
    const exports = await import(url.href);
    for (const key of Object.keys(exports).filter(key => key.endsWith('_VERSION')).sort()) {
      if (!['string', 'number'].includes(typeof exports[key])) throw new Error(`${name}:${key} must be a response version constant`);
      versions.push([name, key, exports[key]]);
    }
  }
  if (!versions.length) throw new Error('The endpoint version inventory must not be empty');
  return {digest: createHash('sha256').update(JSON.stringify(versions)).digest('hex'), versions};
}

const revisionPattern = /export const API_CONTRACT_REVISION = ([1-9]\d*);/g;
const revisionDeclaration = /\bexport\s+(?:const|let|var)\s+API_CONTRACT_REVISION\b/g;
const versionPattern = /export const API_VERSION = ([1-9]\d*);/g;
const versionDeclaration = /\bexport\s+(?:const|let|var)\s+API_VERSION\b/g;
const registryPattern = /export const API_CONTRACT_DIGESTS = Object\.freeze\(\{([\s\S]*?)\}\);/g;
const repairPattern = /export const API_CONTRACT_HISTORY_REPAIRS = Object\.freeze\((\[[\s\S]*?\])\);/g;
const repairComment = '// Verified main-history recovery; displaced digests remain at higher revisions.';

function repairRecords(source) {
  const matches = [...source.matchAll(repairPattern)];
  const declarations = source.match(/\bexport\s+(?:const|let|var)\s+API_CONTRACT_HISTORY_REPAIRS\b/g) ?? [];
  if (!declarations.length) return [];
  if (matches.length !== 1 || declarations.length !== 1) throw new Error('Malformed API history repair provenance');
  const records = JSON.parse(matches[0][1]);
  if (!records.length || records.some(record => !record || Object.keys(record).sort().join() !== 'base,tip'
    || !/^[a-f0-9]{40}$/.test(record.base) || !/^[a-f0-9]{40}$/.test(record.tip) || record.base === record.tip)
    || (matches[0][1].match(/"base"\s*:/g) ?? []).length !== records.length
    || (matches[0][1].match(/"tip"\s*:/g) ?? []).length !== records.length) throw new Error('Malformed API history repair provenance');
  const normalized = records.map(({base, tip}) => ({base, tip}));
  if (new Set(normalized.map(record => JSON.stringify(record))).size !== records.length) throw new Error('Duplicate API history repair provenance');
  return normalized;
}

// Parse data, never execute a registry read from a Git ref or conflict side.
export function parseRegistry(source, {allowMergedEntries = false} = {}) {
  const versionMatches = [...source.matchAll(versionPattern)];
  const registryMatches = [...source.matchAll(registryPattern)];
  if (versionMatches.length !== 1 || [...source.matchAll(versionDeclaration)].length !== 1 || registryMatches.length !== 1) throw new Error('Expected one API_VERSION and one API_CONTRACT_DIGESTS declaration');
  const version = Number(versionMatches[0][1]);
  const revisions = [...source.matchAll(revisionPattern)];
  const declarations = [...source.matchAll(revisionDeclaration)];
  if (declarations.length > 1 || declarations.length !== revisions.length) throw new Error('Expected one positive integer API_CONTRACT_REVISION declaration');
  // Old Git refs predate wrapping and use the version as the history key.
  const revision = revisions.length ? Number(revisions[0][1]) : version;
  const entries = [];
  let remaining = registryMatches[0][1];
  while (remaining.trim()) {
    const match = /^\s*([1-9]\d*):\s*'([a-f0-9]{64})',/.exec(remaining);
    if (!match) throw new Error('Malformed API contract registry; expected integer keys and SHA-256 digests');
    entries.push([Number(match[1]), match[2]]);
    remaining = remaining.slice(match[0].length);
  }
  // Git can merge appended entries outside the declaration conflict. Preserve
  // that shared history while resolving; ordinary reads still require equality.
  const latest = entries.length;
  if (!Number.isSafeInteger(revision) || version !== (revision - 1) % 999 + 1 || !latest || entries.some(([key], i) => key !== i + 1)
      || revision !== latest && !(allowMergedEntries && revision < latest)) {
    throw new Error('API_CONTRACT_REVISION must select the newest contiguous entry; API_VERSION must wrap from 999 to 1');
  }
  const repairs = repairRecords(source);
  return {version: (latest - 1) % 999 + 1, revision: latest, entries, ...(repairs.length ? {repairs} : {})};
}

export function renderRegistry(source, registry) {
  const revision = registry.revision;
  const declaration = `export const API_CONTRACT_REVISION = ${revision};`;
  const withRevision = source.match(revisionPattern)
    ? source.replace(revisionPattern, declaration)
    : source.replace(versionPattern, `${declaration}\n$&`);
  let result = withRevision.replace(versionPattern, `export const API_VERSION = ${registry.version};`)
    .replace(registryPattern, `export const API_CONTRACT_DIGESTS = Object.freeze({\n${registry.entries.map(([key, digest]) => `  ${key}: '${digest}',`).join('\n')}\n});`);
  if (registry.repairs?.length) {
    const provenance = `export const API_CONTRACT_HISTORY_REPAIRS = Object.freeze(${JSON.stringify(registry.repairs, null, 2)});`;
    result = [...result.matchAll(repairPattern)].length ? result.replace(repairPattern, provenance)
      : result.replace(versionPattern, `$&\n\n${repairComment}\n${provenance}`);
  }
  return result;
}

// Both ordinary and diff3/zdiff3 Git conflicts are supported. Edits outside
// conflict hunks survive; conflicting helper code must be resolved by a person.
export function registrySides(source) {
  const sides = ['', ''];
  let state = 'outside';
  let conflicts = 0;
  for (const line of source.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (/^<{7}(?: |\r?$)/.test(line)) {
      if (state !== 'outside') throw new Error('Nested API version conflict');
      state = 'ours'; conflicts++;
    } else if (/^\|{7}(?: |\r?$)/.test(line)) {
      if (state !== 'ours') throw new Error('Malformed API version conflict');
      state = 'base';
    } else if (/^={7}\r?\n?$/.test(line)) {
      if (!['ours', 'base'].includes(state)) throw new Error('Malformed API version conflict');
      state = 'theirs';
    } else if (/^>{7}(?: |\r?$)/.test(line)) {
      if (state !== 'theirs') throw new Error('Malformed API version conflict');
      state = 'outside';
    } else {
      if (state === 'outside' || state === 'ours') sides[0] += line;
      if (state === 'outside' || state === 'theirs') sides[1] += line;
    }
  }
  if (state !== 'outside') throw new Error('Unterminated API version conflict');
  const sources = conflicts ? sides : [source];
  const registries = sources.map(text => parseRegistry(text, {allowMergedEntries: conflicts > 0}));
  const skeletons = sources.map(text => {
    const metadata = [...text.matchAll(repairPattern)][0];
    if (metadata) {
      let before = text.slice(0, metadata.index);
      const generated = `\n\n${repairComment}\n`;
      if (before.endsWith(generated)) before = before.slice(0, -generated.length);
      text = before + text.slice(metadata.index + metadata[0].length);
    }
    return renderRegistry(text, {version: 1, revision: 1, entries: [[1, '0'.repeat(64)]]});
  });
  if (skeletons.some(text => text !== skeletons[0])) throw new Error('Resolve conflicting code outside the API version declarations first');
  return {source: sources[0], registries};
}

export function reconcileRegistry(main, branches, digest, force = false) {
  const entries = main.entries.map(entry => [...entry]);
  const recorded = new Set(entries.map(entry => JSON.stringify(entry)));
  // Keep repeated digest values at different versions: they can represent
  // deliberate semantic-only bumps. Collapse only identical version/digest pairs.
  const pending = branches.flatMap(branch => branch.entries).sort((a, b) => a[0] - b[0]);
  for (const entry of pending) {
    const identity = JSON.stringify(entry);
    if (recorded.has(identity)) continue;
    recorded.add(identity);
    entries.push([entries.length + 1, entry[1]]);
  }
  if (force || entries.at(-1)[1] !== digest) entries.push([entries.length + 1, digest]);
  return {version: (entries.length - 1) % 999 + 1, revision: entries.length, entries, ...(main.repairs?.length ? {repairs: main.repairs} : {})};
}

export function assertRecordedHistory(baseline, current) {
  for (const [version, digest] of baseline.entries) {
    if (current.entries[version - 1]?.[1] !== digest) throw new Error(`Recorded API contract ${version} was removed or replaced; run npm run api:bump to reconcile with main`);
  }
}

export function assertBranchHistory(main, branch, current) {
  if (JSON.stringify(main.repairs ?? []) !== JSON.stringify(current.repairs ?? [])) throw new Error('API history repair provenance was changed or not verified');
  assertRecordedHistory(main, current);
  // Unpublished stack entries may be renumbered, but their digest occurrences
  // must survive after main, including repeated semantic-only records.
  const available = new Map();
  for (const [, digest] of current.entries.slice(main.revision)) available.set(digest, (available.get(digest) ?? 0) + 1);
  for (const [version, digest] of branch.entries) {
    if (main.entries[version - 1]?.[1] === digest) continue;
    const count = available.get(digest) ?? 0;
    if (!count) throw new Error(`Branch baseline contract ${version} was discarded; preserve its digest after main with npm run api:bump`);
    available.set(digest, count - 1);
  }
}

// A digest can move between revisions in successive corrupt snapshots. Count
// every distinct displaced (revision,digest) pair across the whole range once,
// rather than letting snapshots share a single retained occurrence.
export function assertHistoricalOccurrences(main, histories, current) {
  assertBranchHistory(main, main, current);
  const pairs = new Map();
  for (const history of histories) for (const [revision, digest] of history.entries) {
    if (main.entries[revision - 1]?.[1] !== digest) pairs.set(JSON.stringify([revision, digest]), digest);
  }
  const needed = new Map(), available = new Map();
  for (const digest of pairs.values()) needed.set(digest, (needed.get(digest) ?? 0) + 1);
  for (const [, digest] of current.entries.slice(main.revision)) available.set(digest, (available.get(digest) ?? 0) + 1);
  for (const [digest, count] of needed) {
    if ((available.get(digest) ?? 0) < count) throw new Error(`Historical API digest ${digest} occurrence was discarded: need ${count}, retained ${available.get(digest) ?? 0} after revision ${main.revision}`);
  }
}
