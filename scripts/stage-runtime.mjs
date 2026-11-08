import {copyFile,mkdir,readdir,lstat,writeFile} from 'node:fs/promises';
import {contractDigest} from './api-contract.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=process.argv[2];
if(!destination)throw new Error('Pass a new runtime directory.');
await mkdir(destination,{recursive:false});
for(const name of await readdir(path.join(root,'server'))){
  const runtime=name.endsWith('.mjs')&&!name.endsWith('.test.mjs')&&!name.endsWith('.d.mts');
  const supporting=name.endsWith('.json')||name.endsWith('.LICENSE.txt');
  if(!runtime&&!supporting)continue;
  const source=path.join(root,'server',name);
  if(!(await lstat(source)).isFile())throw new Error('Runtime inputs must be ordinary files.');
  await copyFile(source,path.join(destination,name));
}
// Parsing every endpoint module for the contract digest takes seconds on a
// Raspberry Pi, so the image carries the digest of exactly these sources.
await writeFile(path.join(destination,'api-contract.json'),JSON.stringify({digest:contractDigest(root).digest})+'\n');
