import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseProcedurePage,OfficialContextSources} from './official-context.mjs';
import {validTopicKey} from './record-topics.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';
test('OEIL retains the published single-level subject code 8.20',async()=>{
 const html=await readFile(new URL('./fixtures/oeil-procedure-2025-2110-subjects.html',import.meta.url),'utf8');
 assert.deepEqual(parseProcedurePage(html,'2025/2110(INI)').subjects,[{code:'8.20',label:'Enlargement of the Union'}]);assert(validTopicKey('oeil:8.20'));
 const source=new OfficialContextSources({directory:null});assert.equal(source.cache.maxEntries,512);assert.equal(source.cache.maxDiskEntries,1000000);assert.equal(source.cache.maxDiskBytes,32768*1024*1024);
});
test('lowest background admission follows visitors and ordinary background recovery',async()=>{
 const q=new UpstreamQueue({maximum:1}),release=await q.acquire('interactive'),order=[];
 const low=q.run(()=>order.push('collector'),{priority:'background',backgroundRank:1}),gap=q.run(()=>order.push('gap'),{priority:'background'}),visitor=q.run(()=>order.push('visitor'));
 release();await Promise.all([low,gap,visitor]);assert.deepEqual(order,['visitor','gap','collector']);
});

test('successful procedure reads remain on disk beyond the former 512-entry limit',async t=>{
 const {mkdtemp,rm,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{default:path}=await import('node:path');const dir=await mkdtemp(path.join(tmpdir(),'oeil-retention-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
 const first='https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2023%2F0284(COD)',html='<main>'+('x'.repeat(180000))+'</main>';
 const reader=new OfficialContextSources({directory:dir,writable:true,run:operation=>operation(),fetchSource:async url=>new Response(url===first?html:'<main>Retained</main>',{headers:{'content-type':'text/html'}})});
 await reader.get(first,{priority:'background',freshMs:90*86400_000,waitForFresh:true});
 for(let n=0;n<512;n++){t.mock.timers.tick(1000);await reader.get('https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2025%2F'+String(n).padStart(4,'0')+'(INI)',{priority:'background'});}
 const key=reader.cache.key(['official-context-v1',first]);assert((await readFile(path.join(dir,key+'.json'),'utf8')).includes('2023%2F0284'));
 const reopened=new OfficialContextSources({directory:dir,run:()=>assert.fail('retained source needs no request'),fetchSource:()=>assert.fail('mock only')});assert.equal((await reopened.get(first)).html,html);
});
