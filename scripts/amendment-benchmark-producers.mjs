import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {digest} from './amendment-benchmark-cache.mjs';

// Source producers, not placement consumers or the document-context wrapper.
// Include their local dependency closure and locked third-party dependencies.
const roots=['server/amendment-documents.mjs','server/amendments.mjs','server/document-text.mjs','server/proposal-structure.mjs'];
export async function producerFingerprint(read) {
  const files={},pending=[...roots,'package-lock.json'];
  while(pending.length) {
    const file=pending.pop();if(Object.hasOwn(files,file))continue;
    const content=await read(file);files[file]=digest(content);
    if(!file.endsWith('.mjs'))continue;
    for(const match of content.toString().matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+\.mjs)['"]/g)) {
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1]));
      if(dependency.startsWith('../'))throw new Error('Producer dependency escapes the repository.');
      pending.push(dependency);
    }
  }
  const ordered=Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')));
  return {schemaVersion:1,sha256:digest(JSON.stringify(ordered)),files:ordered};
}
export const checkoutProducers=root=>producerFingerprint(file=>readFile(path.join(root,file)));

// Older clean reports already identify an immutable Git revision and hash the
// three main producers. Recover its complete fingerprint without editing the
// report or checking out another branch. Missing history fails closed.
export async function baselineProducers(baseline,root) {
  if(baseline.code?.producerFingerprint)return;
  const code=baseline.code;
  if(code?.dirty!==false||!/^[0-9a-f]{40}$/.test(code.head||''))throw new Error('Placement-only mode needs recorded producer fingerprints or a clean baseline Git revision.');
  const fingerprint=await producerFingerprint(file=>execFileSync('git',['show',code.head+':'+file],{cwd:root,stdio:['ignore','pipe','pipe']}));
  for(const file of roots.filter(file=>file!=='server/amendments.mjs'))
    if(code.files?.[file]!==fingerprint.files[file])throw new Error('Baseline producer hash disagrees with its Git revision: '+file);
  code.producerFingerprint=fingerprint;
  code.producerFingerprintBasis='recorded-clean-git-revision';
}
