import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {acquireAdoptedSnapshot,loadAdoptedSnapshot,xmlDeclaration} from './amendment-adopted-snapshot.mjs';
const work={id:'eli/dl/doc/TA-10-2026-0001',adopts:['eli/dl/doc/A-10-2026-0001'],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'http://publications.europa.eu/resource/authority/file-type/XML',is_exemplified_by:'distribution/doc/TA-10-2026-0001_en.xml'}]}]};
test('acquisition paces requests and seals immutable listing and declared XML',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ta-seal-')),directory=path.join(root,'sealed'),pauses=[],urls=[];
 try {
  const snapshot=await acquireAdoptedSnapshot({directory,documents:['A-10-2026-0001'],years:['2026'],pause:async ms=>pauses.push(ms),fetcher:async url=>{urls.push(url);return new Response(url.endsWith('.xml')?'<SDOCTA/>':JSON.stringify({data:[work]}));}});
  assert.deepEqual(pauses,[2100]);assert.equal(urls.length,2);assert.equal(snapshot.requests,2);assert.equal((await loadAdoptedSnapshot(directory)).works.length,1);
  await assert.rejects(acquireAdoptedSnapshot({directory,documents:[],years:[]}),/EEXIST/);
  await writeFile(path.join(directory,'TA-10-2026-0001_en.xml'),'changed');await assert.rejects(loadAdoptedSnapshot(directory),/hash mismatch/);
 } finally {await rm(root,{recursive:true,force:true});}
});
test('429 pauses three minutes then aborts without a seal',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ta-rate-')),pauses=[];
 try {await assert.rejects(acquireAdoptedSnapshot({directory:path.join(root,'sealed'),documents:[],years:['2026'],pause:async ms=>pauses.push(ms),fetcher:async()=>new Response('',{status:429})}),/429/);assert.deepEqual(pauses,[180000]);}
 finally {await rm(root,{recursive:true,force:true});}
});
test('XML must have one approved declared English distribution',()=>{
 assert.ok(xmlDeclaration(work));assert.equal(xmlDeclaration({...work,is_realized_by:[]}),null);
 const other=structuredClone(work);other.is_realized_by[0].is_embodied_by[0].is_exemplified_by='https://example.com/file.xml';assert.equal(xmlDeclaration(other),null);
});
