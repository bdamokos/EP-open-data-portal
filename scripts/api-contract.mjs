import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

// Shared by server startup, the client build and inventory tests.
export async function contractDigest(root) {
  const versions = [];
  const directory = path.join(root, 'server');
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.mjs') || name.endsWith('.test.mjs') || name === 'api-version.mjs') continue;
    const url = pathToFileURL(path.join(directory, name));
    const source = await readFile(url, 'utf8');
    if (!/\bexport\s+(?:const|let|var)\s+\w+_VERSION\b/.test(source)) continue;
    const exports = await import(/* @vite-ignore */ url.href);
    for (const key of Object.keys(exports).filter(key => key.endsWith('_VERSION')).sort()) {
      if (!['string', 'number'].includes(typeof exports[key])) throw new Error(`${name}:${key} must be a response version constant`);
      versions.push([name, key, exports[key]]);
    }
  }
  if (!versions.length) throw new Error('The endpoint version inventory must not be empty');
  return {digest: createHash('sha256').update(JSON.stringify(versions)).digest('hex'), versions};
}
