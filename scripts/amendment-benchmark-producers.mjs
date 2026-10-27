import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {digest} from './amendment-benchmark-cache.mjs';

// Fingerprint producer implementation AND endpoint wiring/returned projections.
// Only the wrapper version literal and its placement-consumer edges are excluded.
const roots=['server/amendment-documents.mjs','server/amendments.mjs','server/document-text.mjs','server/proposal-structure.mjs','server/proposal-baseline.mjs','server/document-context.mjs'];
const placementConsumers=new Set(['server/document-context-model.mjs','server/document-context-placement.mjs','server/proposal-placement.mjs']);
function producerSource(file,content) {
  let source=content.toString();
  if(file==='server/document-context.mjs')source=source.replace(/^export const DOCUMENT_CONTEXT_VERSION=\d+;$/m,'export const DOCUMENT_CONTEXT_VERSION=<wrapper-version>;');
  if(file==='server/proposal-structure.mjs') {
    // Canonicalise the older import+consumer-only re-export for clean-report
    // migration. If the producer actually uses this name, retain its dependency.
    const imported=/^import \{normaliseForMatching\} from '\.\/proposal-matching\.mjs';\n/m;
    const exported='export {parseTargetLabel,unitLabel,normaliseForMatching};';
    if(imported.test(source)&&source.includes(exported)&&(source.match(/\bnormaliseForMatching\b/g)||[]).length===2)
      source=source.replace(imported,'').replace(exported,'export {parseTargetLabel,unitLabel};');
    source=source.replace(/^export \{normaliseForMatching\} from '\.\/proposal-matching\.mjs';\n/m,'');
  }
  return source;
}
export async function producerFingerprint(read) {
  const files={},pending=[...roots,'package-lock.json'];
  while(pending.length) {
    const file=pending.pop();if(Object.hasOwn(files,file))continue;
    const content=producerSource(file,await read(file));files[file]=digest(content);
    if(!file.endsWith('.mjs'))continue;
    for(const match of content.toString().matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+\.mjs)['"]/g)) {
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1]));
      if(dependency.startsWith('../'))throw new Error('Producer dependency escapes the repository.');
      if(file==='server/document-context.mjs'&&placementConsumers.has(dependency))continue;
      pending.push(dependency);
    }
  }
  const ordered=Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')));
  return {schemaVersion:2,sha256:digest(JSON.stringify(ordered)),files:ordered};
}
export const checkoutProducers=root=>producerFingerprint(file=>readFile(path.join(root,file)));

// Older clean reports already identify an immutable Git revision and hash the
// three main producers. Recover its complete fingerprint without editing the
// report or checking out another branch. Missing history fails closed.
export async function baselineProducers(baseline,root) {
  if(baseline.code?.producerFingerprint?.schemaVersion===2)return;
  const code=baseline.code;
  if(code?.dirty!==false||!/^[0-9a-f]{40}$/.test(code.head||''))throw new Error('Placement-only mode needs current producer fingerprints or a clean baseline Git revision.');
  const blobs=new Map(),read=file=>{
    if(!blobs.has(file))blobs.set(file,execFileSync('git',['show',code.head+':'+file],{cwd:root,stdio:['ignore','pipe','pipe']}));
    return blobs.get(file);
  };
  // Validate recorded raw hashes before extending an older report's coverage.
  for(const [file,hash] of Object.entries({...code.files,...code.producerFingerprint?.files}))
    if(digest(read(file))!==hash)throw new Error('Baseline source hash disagrees with its Git revision: '+file);
  code.producerFingerprint=await producerFingerprint(read);
  code.producerFingerprintBasis='recorded-clean-git-revision';
}
