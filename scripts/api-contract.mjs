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

const versionPattern = /export const API_VERSION = ([1-9]\d*);/g;
const registryPattern = /export const API_CONTRACT_DIGESTS = Object\.freeze\(\{([\s\S]*?)\}\);/g;

// Parse data, never execute a registry read from a Git ref or conflict side.
export function parseRegistry(source) {
  const versionMatches = [...source.matchAll(versionPattern)];
  const registryMatches = [...source.matchAll(registryPattern)];
  if (versionMatches.length !== 1 || registryMatches.length !== 1) throw new Error('Expected one API_VERSION and one API_CONTRACT_DIGESTS declaration');
  const version = Number(versionMatches[0][1]);
  const entries = [];
  let remaining = registryMatches[0][1];
  while (remaining.trim()) {
    const match = /^\s*([1-9]\d*):\s*'([a-f0-9]{64})',/.exec(remaining);
    if (!match) throw new Error('Malformed API contract registry; expected integer keys and SHA-256 digests');
    entries.push([Number(match[1]), match[2]]);
    remaining = remaining.slice(match[0].length);
  }
  if (!Number.isSafeInteger(version) || !entries.length || entries.some(([key], i) => key !== i + 1) || entries.at(-1)[0] !== version) {
    throw new Error('API_VERSION must select the newest entry in a contiguous registry starting at 1');
  }
  return {version, entries};
}

export function renderRegistry(source, registry) {
  return source.replace(versionPattern, `export const API_VERSION = ${registry.version};`)
    .replace(registryPattern, `export const API_CONTRACT_DIGESTS = Object.freeze({\n${registry.entries.map(([key, digest]) => `  ${key}: '${digest}',`).join('\n')}\n});`);
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
  const registries = sources.map(parseRegistry);
  const skeletons = sources.map(text => renderRegistry(text, {version: 1, entries: [[1, '0'.repeat(64)]]}));
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
  return {version: entries.length, entries};
}

export function assertRecordedHistory(baseline, current) {
  for (const [version, digest] of baseline.entries) {
    if (current.entries[version - 1]?.[1] !== digest) throw new Error(`Recorded API contract ${version} was removed or replaced; run npm run api:bump to reconcile with main`);
  }
}

export function assertBranchHistory(main, branch, current) {
  assertRecordedHistory(main, current);
  // Unpublished stack entries may be renumbered, but their digest occurrences
  // must survive after main, including repeated semantic-only records.
  const available = new Map();
  for (const [, digest] of current.entries.slice(main.version)) available.set(digest, (available.get(digest) ?? 0) + 1);
  for (const [version, digest] of branch.entries) {
    if (main.entries[version - 1]?.[1] === digest) continue;
    const count = available.get(digest) ?? 0;
    if (!count) throw new Error(`Branch baseline contract ${version} was discarded; preserve its digest after main with npm run api:bump`);
    available.set(digest, count - 1);
  }
}
