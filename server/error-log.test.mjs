import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createErrorLog,clientErrorEvent,serverErrorEvent} from './error-log.mjs';
import {HttpError} from './http-utils.mjs';

test('diagnostics exclude search, private bodies and untrusted free text',()=>{
 const event=clientErrorEvent({kind:'http',request:'/api/corpus/search?q=private&token=secret&lang=hu&v=425',method:'POST',status:502,message:'secret',body:{saved:['secret']},requestId:'bad'});
 assert.equal(event.request,'/api/corpus/search?lang=hu&v=425');assert.equal(event.status,502);assert(!JSON.stringify(event).includes('secret'));
 assert.equal(clientErrorEvent({kind:'network',request:'/other'}),null);
 const failure=serverErrorEvent({url:'/api/profile/123?token=secret',method:'GET'},new HttpError(503,'upstream_busy','Source unavailable'),{requestId:'id',elapsedMs:12});
 assert.equal(failure.code,'upstream_busy');assert.equal(failure.message,'Source unavailable');assert.equal(failure.request,'/api/profile/123');
 assert.equal(serverErrorEvent({url:'/api/x'},new Error('private'),{}).message,undefined);
});
test('serialized rotation bounds retained files and preserves readable JSONL',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'error-log-'));
 try {
  const log=createErrorLog({directory,maxBytes:220,files:4});
  for(let i=0;i<12;i++)log.write({source:'server',code:'test',index:i});
  await log.flush();const files=await readdir(directory);assert.equal(files.length,4);
  const current=(await readFile(path.join(directory,'errors.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(current.at(-1).index,11);assert(current[0].time);
 }finally{await rm(directory,{recursive:true,force:true});}
});
