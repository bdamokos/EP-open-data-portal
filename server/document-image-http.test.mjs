import {loopback} from './test-support/loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {publishDocumentImages} from './document-image-store.mjs';

test('image HTTP reads serve exact source-associated bytes with GET and HEAD and never fetch a URL',loopback,async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'document-image-http-'));
 process.env.ACTIVITY_INDEX_ENABLED='true';process.env.ACTIVITY_INDEX_DIR=directory;
 const {server}=await import('./index.mjs'),{activityIndex}=await import('./activity-index-worker.mjs');
 const {store,worker}=activityIndex();store.db.exec('PRAGMA query_only=ON');
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Image serving must not fetch any source'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.db.exec('PRAGMA query_only=OFF');store.close();await rm(directory,{recursive:true,force:true});delete process.env.ACTIVITY_INDEX_ENABLED;delete process.env.ACTIVITY_INDEX_DIR;});
 const body=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1cAAAAASUVORK5CYII=','base64'),imageHash=createHash('sha256').update(body).digest('hex'),sourceHash='a'.repeat(64);
 await publishDocumentImages({sourceHash,imageAssets:{[imageHash]:{data:body.toString('base64'),sha256:imageHash,mime:'image/png',width:1,height:1}}},{directory});
 const read=(route,method='GET')=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:server.address().port,path:route,method},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));}).on('error',reject);});
 const route='/api/document-image/'+sourceHash+'/'+imageHash,result=await read(route);
 assert.equal(result.status,200);assert.deepEqual(result.body,body);assert.equal(result.headers['content-type'],'image/png');assert.equal(result.headers['x-document-sha256'],sourceHash);assert.equal(result.headers['x-image-sha256'],imageHash);assert.equal(result.headers['x-content-type-options'],'nosniff');assert.equal(result.headers['cache-control'],'private, no-store');
 const head=await read(route,'HEAD');assert.equal(head.status,200);assert.equal(Number(head.headers['content-length']),body.length);assert.equal(head.body.length,0);
 assert.equal((await read(route+'?url=https://example.com/a.png')).status,400);
 assert.equal((await read('/api/document-image/not-a-hash/'+imageHash)).status,400);
 assert.equal((await read('/api/document-image/'+ 'b'.repeat(64)+'/'+imageHash)).status,404);
 assert.equal(worker.running,false);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0);
});
