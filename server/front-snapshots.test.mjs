import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readdirSync,readFileSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loopback} from './test-support/loopback.mjs';

const root=mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'front-snapshots-test-'));
mkdirSync(path.join(root,'dist'),{recursive:true});
writeFileSync(path.join(root,'dist','index.html'),'<!doctype html><title>Explorer</title>');
process.env.EXPLORER_DIST_DIR=path.join(root,'dist');
process.env.ERROR_LOG_DIR=path.join(root,'diagnostics');
const {createFront}=await import('./front.mjs');
const {FrontSnapshots,SNAPSHOT_HEADER}=await import('./front-snapshots.mjs');
test.after(()=>rmSync(root,{recursive:true,force:true}));

const V='abcdef012345',NEXT='012345abcdef';
const DAY=Date.parse('2026-11-04T10:00:00Z'),HOUR=3600_000;
const etagOf=text=>`"${createHash('sha256').update(text).digest('base64url')}"`;
const directoryBody=JSON.stringify({members:[{id:1}],index:{complete:true}})+'\n';
const periodsBody=JSON.stringify({weeks:[],coverage:{status:'complete'}})+'\n';
const upcomingBody=JSON.stringify({items:[]})+'\n';
const liveBody=(validUntil)=>JSON.stringify({status:'off-air',checkedAt:'2026-11-04T09:59:00Z',validUntil})+'\n';

// The API process as the front sees it: JSON with the headers sendJson sets.
function jsonReply(request,response,status,text,{cdn='no-store'}={}) {
  const etag=etagOf(text);
  response.statusCode=status;
  response.setHeader('Content-Type','application/json; charset=utf-8');
  response.setHeader('Cache-Control','public, max-age=0');response.setHeader('CDN-Cache-Control',cdn);
  response.setHeader('ETag',etag);response.setHeader('Vary','Origin');response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Server-Timing','app;dur=1.0');response.setHeader('X-Request-Id','api-id');
  if(status===200&&request.headers['if-none-match']===etag){response.statusCode=304;response.removeHeader('Content-Type');response.end();return;}
  response.setHeader('Content-Length',Buffer.byteLength(text));response.end(text);
}
async function fixture(t,{answers={},clock,directory,options={}}={}) {
  const seen=[];
  const bodies={'/api/directory':directoryBody,'/api/vote-periods':periodsBody,'/api/plenary-live':liveBody('2026-11-04T10:01:00Z'),'/api/upcoming-votes':upcomingBody,'/api/profile/1':'{"id":1}\n',...answers};
  const api=http.createServer((request,response)=>{
    seen.push({url:request.url,headers:request.headers});
    const pathname=request.url.split('?')[0];
    if(bodies[pathname]===undefined){jsonReply(request,response,404,'{"error":{"code":"not_found"}}\n');return;}
    jsonReply(request,response,200,bodies[pathname],{cdn:pathname==='/api/directory'?'public, max-age=21600, stale-if-error=0':'no-store'});
  });
  api.listen(0,'127.0.0.1');await once(api,'listening');
  const calls={acquire:0,wake:0,release:0},state={ready:true,port:api.address().port};
  const supervisor={calls,get ready(){return state.ready;},wake:()=>{calls.wake++;},acquire:async()=>{calls.acquire++;return {port:state.port,release:()=>{calls.release++;}};}};
  const snapshots=new FrontSnapshots({directory,currentVersion:()=>V,clock,persistIntervalMs:3600_000,...options});
  const {server,agent}=createFront({supervisor,snapshots});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await snapshots.close();agent.destroy();server.closeAllConnections();server.close();api.closeAllConnections();api.close();});
  const get=(target,headers={},method='GET')=>new Promise((resolve,reject)=>{
    const request=http.request({host:'127.0.0.1',port:server.address().port,path:target,method,headers,agent:false},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>resolve({response,body:Buffer.concat(chunks).toString()}));
    });
    request.on('error',reject);request.end();
  });
  return {get,seen,calls,state,snapshots,supervisor};
}
const clockAt=start=>{const clock=()=>clock.now;clock.now=start;return clock;};
// The API process is up for the first read and gone afterwards.
const warm=async(f,target,headers)=>{f.state.ready=true;const reply=await f.get(target,headers);f.state.ready=false;return reply;};

test('a stored copy answers while the process is down, wakes it and marks the reply',loopback,async t=>{
  const clock=clockAt(DAY),f=await fixture(t,{clock});
  const first=await warm(f,`/api/directory?v=${V}`);
  assert.equal(first.body,directoryBody);assert.equal(first.response.headers[SNAPSHOT_HEADER.toLowerCase()],undefined);
  assert.equal(f.calls.acquire,1);
  clock.now+=2*HOUR;
  const {response,body}=await f.get(`/api/directory?v=${V}`);
  assert.equal(response.statusCode,200);
  assert.equal(body,directoryBody,'the body is exactly what the API sent');
  assert.equal(response.headers['content-length'],String(Buffer.byteLength(directoryBody)));
  assert.equal(response.headers.etag,etagOf(directoryBody));
  assert.equal(response.headers['content-type'],'application/json; charset=utf-8');
  assert.equal(response.headers.vary,'Origin');assert.equal(response.headers['x-content-type-options'],'nosniff');
  assert.equal(response.headers[SNAPSHOT_HEADER.toLowerCase()],'stored; age=7200');
  assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['cdn-cache-control'],'no-store');
  assert.match(response.headers['x-request-id'],/^[a-f0-9-]{36}$/);assert.notEqual(response.headers['x-request-id'],'api-id');
  assert.equal(response.headers['server-timing'],undefined);
  assert.equal(f.calls.wake,1);assert.equal(f.calls.acquire,1,'the stored reply does not wait for the process');
  assert.equal(f.seen.length,1);
});

test('while the process is up the API answers and refreshes the copy',loopback,async t=>{
  const clock=clockAt(DAY),f=await fixture(t,{clock});
  await warm(f,`/api/directory?v=${V}`);
  f.state.ready=true;clock.now+=HOUR;
  const live=await f.get(`/api/directory?v=${V}`);
  assert.equal(live.response.headers[SNAPSHOT_HEADER.toLowerCase()],undefined);
  assert.equal(f.seen.length,2);
  f.state.ready=false;clock.now+=5.5*HOUR;
  const stored=await f.get(`/api/directory?v=${V}`);
  assert.match(stored.response.headers[SNAPSHOT_HEADER.toLowerCase()],/^stored; age=19800$/,'6 h counts from the latest API answer');
});

test('conditional requests keep their meaning',loopback,async t=>{
  const clock=clockAt(DAY),f=await fixture(t,{clock});
  await warm(f,`/api/directory?v=${V}`);
  const same=await f.get(`/api/directory?v=${V}`,{'If-None-Match':etagOf(directoryBody)});
  assert.equal(same.response.statusCode,304);assert.equal(same.body,'');
  assert.equal(same.response.headers.etag,etagOf(directoryBody));assert.equal(same.response.headers['content-type'],undefined);
  assert.equal(same.response.headers['cache-control'],'no-store');
  const other=await f.get(`/api/directory?v=${V}`,{'If-None-Match':'"something-else"'});
  assert.equal(other.response.statusCode,200);assert.equal(other.body,directoryBody);
  assert.equal(f.calls.acquire,1);
});

test('a 304 from the API renews the copy for the same body only',loopback,async t=>{
  const clock=clockAt(DAY),f=await fixture(t,{clock});
  await warm(f,`/api/directory?v=${V}`);
  f.state.ready=true;clock.now+=5*HOUR;
  assert.equal((await f.get(`/api/directory?v=${V}`,{'If-None-Match':etagOf(directoryBody)})).response.statusCode,304);
  f.state.ready=false;clock.now+=4*HOUR;
  assert.equal((await f.get(`/api/directory?v=${V}`)).response.headers[SNAPSHOT_HEADER.toLowerCase()],'stored; age=14400');
  f.state.ready=true;clock.now+=HOUR;
  assert.equal((await f.get(`/api/directory?v=${V}`,{'If-None-Match':'"unrelated"'})).response.statusCode,200);
});

test('a copy past its bound is not used and the request waits for the process',loopback,async t=>{
  const clock=clockAt(DAY),f=await fixture(t,{clock});
  await warm(f,`/api/directory?v=${V}`);
  clock.now+=6*HOUR-1000;
  assert.ok((await f.get(`/api/directory?v=${V}`)).response.headers[SNAPSHOT_HEADER.toLowerCase()]);
  const acquired=f.calls.acquire;
  clock.now+=2000;
  const late=await f.get(`/api/directory?v=${V}`);
  assert.equal(late.response.headers[SNAPSHOT_HEADER.toLowerCase()],undefined);
  assert.equal(f.calls.acquire,acquired+1);
  assert.equal(f.snapshots.entries.get(`/api/directory?v=${V}`).meta.storedAt,clock.now,'the API answer replaces the expired copy');
});

test('each route follows its own bound',loopback,async t=>{
  const sitting='MTG-PL-2026-10-20',clock=clockAt(Date.parse('2026-11-04T08:00:00Z'));
  const f=await fixture(t,{clock,answers:{'/api/plenary-live':liveBody('2026-11-04T08:01:15Z')}});
  const routes=[`/api/vote-periods?v=${V}`,`/api/plenary-live?v=${V}`,`/api/upcoming-votes?sitting=${sitting}&lang=en&v=${V}`];
  for(const route of routes)await warm(f,route);
  assert.equal(f.snapshots.entries.size,3);
  // plenary-live ends with its own validUntil; the others last longer.
  clock.now+=74_000;
  for(const route of routes)assert.ok((await f.get(route)).response.headers[SNAPSHOT_HEADER.toLowerCase()],route);
  clock.now+=2000;
  assert.equal((await f.get(routes[1])).response.headers[SNAPSHOT_HEADER.toLowerCase()],undefined,'plenary-live is past validUntil');
  assert.ok((await f.get(routes[0])).response.headers[SNAPSHOT_HEADER.toLowerCase()]);
  // upcoming-votes: one hour.
  clock.now+=HOUR;
  assert.equal((await f.get(routes[2])).response.headers[SNAPSHOT_HEADER.toLowerCase()],undefined);
  // vote-periods: the Brussels day it was stored on (UTC+1 in November).
  clock.now=Date.parse('2026-11-04T22:30:00Z');
  assert.ok((await warm(f,routes[0])).response.headers);
  clock.now=Date.parse('2026-11-04T22:59:00Z');
  assert.ok((await f.get(routes[0])).response.headers[SNAPSHOT_HEADER.toLowerCase()]);
  clock.now=Date.parse('2026-11-04T23:01:00Z');
  assert.equal((await f.get(routes[0])).response.headers[SNAPSHOT_HEADER.toLowerCase()],undefined,'a new Brussels day starts at 23:00 UTC in November');
});

test('answers the API marks as incomplete or unfinished are not kept',loopback,async t=>{
  const clock=clockAt(DAY),sitting='MTG-PL-2026-10-20';
  const f=await fixture(t,{clock,answers:{'/api/vote-periods':JSON.stringify({coverage:{status:'partial'}})+'\n'}});
  await warm(f,`/api/vote-periods?v=${V}`);
  assert.equal(f.snapshots.entries.size,0,'a partial calendar is not kept');
  // A sitting that is today or later is live.
  clock.now=Date.parse('2026-10-20T10:00:00Z');
  await warm(f,`/api/upcoming-votes?sitting=${sitting}&v=${V}`);
  assert.equal(f.snapshots.entries.size,0,'the current sitting is not kept');
  clock.now=Date.parse('2026-10-21T10:00:00Z');
  await warm(f,`/api/upcoming-votes?sitting=${sitting}&v=${V}`);
  assert.equal(f.snapshots.entries.size,1);
  // Error answers are not kept.
  f.state.ready=true;
  await f.get(`/api/upcoming-votes?sitting=MTG-PL-2026-10-21&v=${V}`);
  const missing=await fixture(t,{clock,answers:{'/api/directory':undefined}});
  missing.state.ready=true;
  assert.equal((await missing.get(`/api/directory?v=${V}`)).response.statusCode,404);
  assert.equal(missing.snapshots.entries.size,0);
});

test('a directory answer without a CDN lifetime is not kept',()=>{
  const snapshots=new FrontSnapshots({currentVersion:()=>V,clock:()=>DAY});
  const body=Buffer.from(directoryBody),headers=extra=>['Content-Type','application/json; charset=utf-8','ETag',etagOf(directoryBody),...extra];
  const candidate={key:`/api/directory?v=${V}`,route:'directory',version:V,sitting:null};
  snapshots.record(candidate,{status:200,rawHeaders:headers(['CDN-Cache-Control','no-store']),body});
  assert.equal(snapshots.entries.size,0);
  snapshots.record(candidate,{status:200,rawHeaders:headers(['CDN-Cache-Control','public, max-age=0']),body});
  assert.equal(snapshots.entries.size,0);
  snapshots.record(candidate,{status:200,rawHeaders:headers(['CDN-Cache-Control','public, max-age=600']),body:Buffer.from('{}\n')});
  assert.equal(snapshots.entries.size,0,'the ETag has to describe the body');
  snapshots.record(candidate,{status:200,rawHeaders:headers(['CDN-Cache-Control','public, max-age=600','Content-Encoding','gzip']),body});
  assert.equal(snapshots.entries.size,0,'encoded bodies are not replayed');
  snapshots.record(candidate,{status:200,rawHeaders:headers(['CDN-Cache-Control','public, max-age=600']),body});
  assert.equal(snapshots.entries.size,1);
});

test('a version change misses and clears the older copies',loopback,async t=>{
  const clock=clockAt(DAY),f=await fixture(t,{clock});
  await warm(f,`/api/directory?v=${V}`);
  const acquired=f.calls.acquire;
  const other=await f.get(`/api/directory?v=${NEXT}`);
  assert.equal(other.response.headers[SNAPSHOT_HEADER.toLowerCase()],undefined);
  assert.equal(f.calls.acquire,acquired+1,'an old client still reaches the API, which answers it');
  assert.equal((await f.get('/api/directory')).response.headers[SNAPSHOT_HEADER.toLowerCase()],undefined,'no v, no copy');
  assert.equal((await f.get(`/api/directory?v=${V}&v=${V}`)).response.headers[SNAPSHOT_HEADER.toLowerCase()],undefined);
  // The API now runs another version; its answer replaces and purges the old one.
  f.snapshots.currentVersion=()=>NEXT;
  f.state.ready=true;await f.get(`/api/directory?v=${NEXT}`);f.state.ready=false;
  assert.deepEqual([...f.snapshots.entries.keys()],[`/api/directory?v=${NEXT}`]);
  assert.equal((await f.get(`/api/directory?v=${V}`)).response.headers[SNAPSHOT_HEADER.toLowerCase()],undefined);
});

test('only the listed routes, and only anonymous reads, are ever served from a copy',loopback,async t=>{
  const clock=clockAt(DAY),f=await fixture(t,{clock});
  await warm(f,`/api/directory?v=${V}`);
  await warm(f,`/api/profile/1?v=${V}`);
  assert.equal(f.snapshots.entries.size,1,'a route outside the list is not even kept');
  const marker=SNAPSHOT_HEADER.toLowerCase();
  const stored=async(target,headers,method)=>(await f.get(target,headers,method)).response.headers[marker];
  assert.ok(await stored(`/api/directory?v=${V}`));
  assert.equal(await stored(`/api/profile/1?v=${V}`),undefined);
  assert.equal(await stored(`/api/directory?v=${V}&retry=committee-details`),undefined,'the committee retry is a different question');
  assert.equal(await stored(`/api/directory?v=${V}&extra=1`),undefined);
  assert.equal(await stored(`/api/directory/extra?v=${V}`),undefined);
  assert.equal(await stored(`/api/directory?v=${V}`,{Authorization:'Bearer x'}),undefined);
  assert.equal(await stored(`/api/directory?v=${V}`,{Cookie:'a=b'}),undefined);
  assert.equal(await stored(`/api/directory?v=${V}`,{Origin:'http://elsewhere.test'}),undefined);
  assert.equal(await stored(`/api/directory?v=${V}`,{Range:'bytes=0-9'}),undefined);
  assert.equal(await stored(`/api/directory?v=${V}`,{},'HEAD'),undefined);
  assert.equal(await stored(`/api/upcoming-votes?sitting=bad&v=${V}`),undefined);
  assert.equal(await stored(`/api/directory?lang=english&v=${V}`),undefined);
  // The same key with credentials never fills a copy either.
  const before=f.seen.length;f.state.ready=true;
  await f.get(`/api/vote-periods?v=${V}`,{Authorization:'Bearer x'});
  assert.equal(f.snapshots.entries.has(`/api/vote-periods?v=${V}`),false);
  assert.equal(f.seen.length,before+1);
});

test('copies persist across a front restart and are checked when read',loopback,async t=>{
  const clock=clockAt(DAY),directory=path.join(root,'persist'),first=await fixture(t,{clock,directory});
  await warm(first,`/api/directory?v=${V}`);
  await warm(first,`/api/vote-periods?v=${V}`);
  await first.snapshots.close();
  const files=readdirSync(directory);
  assert.equal(files.length,2);assert.ok(files.every(name=>name.endsWith('.snap')));
  // A new front over the same directory, with no API process at all.
  const restarted=await fixture(t,{clock,directory});
  restarted.snapshots.load(V);
  restarted.state.ready=false;
  clock.now+=HOUR;
  const {response,body}=await restarted.get(`/api/directory?v=${V}`);
  assert.equal(body,directoryBody);assert.equal(response.headers[SNAPSHOT_HEADER.toLowerCase()],'stored; age=3600');
  assert.equal(restarted.calls.acquire,0);assert.equal(restarted.calls.wake,1);
  assert.ok(restarted.snapshots.entries.get(`/api/directory?v=${V}`).body===null,'the body stays on disk');
  // Another version's files are removed on load.
  const upgraded=new FrontSnapshots({directory,currentVersion:()=>NEXT,clock});
  upgraded.load(NEXT);
  assert.equal(upgraded.entries.size,0);assert.deepEqual(readdirSync(directory),[]);
});

test('a damaged copy is dropped instead of served',loopback,async t=>{
  const clock=clockAt(DAY),directory=path.join(root,'damaged'),first=await fixture(t,{clock,directory});
  await warm(first,`/api/directory?v=${V}`);await first.snapshots.close();
  const [name]=readdirSync(directory),file=path.join(directory,name);
  const data=readFileSync(file);
  // Same length, different bytes: the stored checksum no longer matches.
  await first.snapshots.writing;
  const damaged=Buffer.from(data);damaged[damaged.length-3]^=1;writeFileSync(file,damaged);
  const restarted=await fixture(t,{clock,directory});restarted.snapshots.load(V);restarted.state.ready=false;
  const reply=await restarted.get(`/api/directory?v=${V}`);
  assert.equal(reply.response.headers[SNAPSHOT_HEADER.toLowerCase()],undefined);assert.equal(restarted.calls.acquire,1);
  // A truncated file and a stray file are removed on load.
  await restarted.snapshots.writing;
  writeFileSync(file,data.subarray(0,data.length-5));writeFileSync(path.join(directory,'notes.txt'),'x');
  const third=new FrontSnapshots({directory,currentVersion:()=>V,clock});third.load(V);
  assert.equal(third.entries.size,0);assert.deepEqual(readdirSync(directory),[]);
});

test('stored bytes stay within the bounds',loopback,async t=>{
  const clock=clockAt(DAY),directory=path.join(root,'bounds'),big='x'.repeat(3000);
  const sittings=['2026-10-01','2026-10-02','2026-10-03','2026-10-04'].map(day=>`MTG-PL-${day}`);
  const answers={'/api/upcoming-votes':JSON.stringify({big})+'\n'};
  const f=await fixture(t,{clock,directory,answers,options:{maxBytes:9000,maxEntryBytes:4000}});
  for(const sitting of sittings){clock.now+=1000;await warm(f,`/api/upcoming-votes?sitting=${sitting}&v=${V}`);}
  await f.snapshots.flush();
  assert.ok(f.snapshots.bytes<=9000,`kept ${f.snapshots.bytes} bytes`);
  assert.ok(f.snapshots.entries.size<4&&f.snapshots.entries.size>0);
  assert.ok(f.snapshots.entries.has(`/api/upcoming-votes?sitting=${sittings[3]}&v=${V}`),'the newest copy stays');
  assert.ok(!f.snapshots.entries.has(`/api/upcoming-votes?sitting=${sittings[0]}&v=${V}`),'the oldest copy goes first');
  const onDisk=readdirSync(directory).reduce((total,name)=>total+statSync(path.join(directory,name)).size,0);
  assert.ok(onDisk<=9000,`${onDisk} bytes on disk`);
  assert.equal(readdirSync(directory).length,f.snapshots.entries.size,'evicted copies are removed from disk');
  // One answer larger than the per-entry bound is never kept.
  const huge=await fixture(t,{clock,directory:path.join(root,'huge'),answers:{'/api/directory':JSON.stringify({big:'y'.repeat(5000)})+'\n'},options:{maxBytes:9000,maxEntryBytes:4000}});
  await warm(huge,`/api/directory?v=${V}`);
  assert.equal(huge.snapshots.entries.size,0);
  // The entry count is bounded too, and zero bytes turns the feature off.
  const many=await fixture(t,{clock,options:{maxEntries:2}});
  for(const sitting of sittings){clock.now+=1000;await warm(many,`/api/upcoming-votes?sitting=${sitting}&v=${V}`);}
  assert.equal(many.snapshots.entries.size,2);
  const off=await fixture(t,{clock,options:{maxBytes:0}});
  await warm(off,`/api/directory?v=${V}`);
  assert.equal(off.snapshots.entries.size,0);assert.equal((await off.get(`/api/directory?v=${V}`)).response.headers[SNAPSHOT_HEADER.toLowerCase()],undefined);
});

test('writes are throttled: a body already on disk is not rewritten within the hour',loopback,async t=>{
  const clock=clockAt(DAY),directory=path.join(root,'throttle'),f=await fixture(t,{clock,directory});
  await warm(f,`/api/directory?v=${V}`);await f.snapshots.flush();
  const file=path.join(directory,readdirSync(directory)[0]),first=statSync(file).mtimeMs;
  await new Promise(resolve=>setTimeout(resolve,20));
  f.state.ready=true;clock.now+=30*60_000;await f.get(`/api/directory?v=${V}`);await f.snapshots.flush();
  assert.equal(statSync(file).mtimeMs,first);
  clock.now+=HOUR;await f.get(`/api/directory?v=${V}`);await f.snapshots.flush();
  assert.ok(statSync(file).mtimeMs>first,'older than an hour: written again');
  assert.equal(readdirSync(directory).filter(name=>name.includes('.tmp')).length,0);
});
