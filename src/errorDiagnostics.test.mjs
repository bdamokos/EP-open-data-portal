import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installErrorDiagnostics,reportUiError} from './errorDiagnostics.mjs';

test('captures HTTP and network failures without changing responses or recursive logging',async()=>{
 const calls=[],listeners={};let fail=false;
 const response=new Response('{}',{status:502,headers:{'X-Request-Id':'123'}});
 const target={location:{href:'https://example.org/?q=private',origin:'https://example.org'},addEventListener:(name,fn)=>listeners[name]=fn,fetch:async(url,options)=>{calls.push({url,options});if(String(url).endsWith('client-errors'))throw Error('logger down');if(fail)throw new TypeError('secret network error');return response;}};
 installErrorDiagnostics(target,'/api/client-errors');
 assert.equal(await target.fetch('/api/profile/12?token=secret&lang=hu'),response);
 let report=JSON.parse(calls[1].options.body);assert.equal(report.status,502);assert.equal(report.request,'/api/profile/12?lang=hu');assert.equal(report.requestId,'123');
 fail=true;await assert.rejects(target.fetch('/api/profile/12'),TypeError);assert.equal(JSON.parse(calls.at(-1).options.body).kind,'network');
 const error=Object.assign(new Error('private'),{uiMessageId:'error.message'});reportUiError(error);const count=calls.length;reportUiError(error);assert.equal(calls.length,count);assert(!calls.at(-1).options.body.includes('private'));
 await assert.rejects(target.fetch('https://external.example/api/x'));assert.equal(calls.length,count+1);
 const before=calls.length;for(let i=0;i<100;i++)reportUiError(new Error('private'));assert(calls.length-before<=30);
});
