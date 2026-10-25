import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PRESS_FEEDS,doceoDocument,furtherInformation,parsePressFeed,parsePressRelease,pressReleaseUrl,robots} from './press-releases-model.mjs';
import {PressFollower,PressMentions,PressStore,brusselsInstant,leaseFencedWrite,pressMentionsQuery} from './press-releases.mjs';
import {parseProcedurePage} from './official-context.mjs';
import {apiCachePolicy} from './response-cache.mjs';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/press-releases-public-20261020.json',import.meta.url),'utf8'));
const rss=items=>`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Feed</title>${items.join('')}</channel></rss>`;
const temp=()=>mkdtempSync(path.join(os.tmpdir(),'press-releases-test-'));
const DAY=24*60*60_000;
// A minimal OEIL procedure page: the real file links summary 1910288 and report A-10-2026-0276.
const procedurePage='<main><h2 class="es_title-h1">2026/0211(COD)</h2><h2>Free allocation of emission allowances</h2><table><tr><td>17/07/2026</td><td>Legislative proposal published</td><td>COM(2026)0619</td><td><a href="/oeil/en/document-summary?id=1910288">Summary</a></td></tr><tr><td>20/10/2026</td><td>Committee report tabled for plenary</td><td><a href="https://www.europarl.europa.eu/doceo/document/A-10-2026-0276_EN.html">A10-0276/2026</a></td></tr><tr><td>22/10/2026</td><td>Minutes</td><td><a href="https://www.europarl.europa.eu/doceo/document/PV-10-2026-10-22-VOT_EN.html?item=3">PV</a></td></tr></table></main>';
const official={get:async url=>{
  const reference=new URL(url).searchParams.get('reference');
  return {url,fetchedAt:'2026-10-20T11:00:00.000Z',html:reference==='2026/0211(COD)'?procedurePage:`<main><h2 class="es_title-h1">${reference}</h2><h2>Procedure</h2></main>`};
}};

test('press feeds announce exact press release identities, not page text',()=>{
  const press=parsePressFeed(rss(fixture.feeds['press-releases']));
  assert.deepEqual(press.map(item=>[item.id,item.url]),[['20261016IPR48238',pressReleaseUrl('20261016IPR48238')],['20261016IPR48226',pressReleaseUrl('20261016IPR48226')]]);
  assert.equal(press[0].title,'Global Europe: MEPs push for expanded budget to match the EU’s global ambitions');
  assert.equal(press[0].publishedAt,'2026-10-19T17:33:01.000Z');assert.deepEqual(press[0].committees,['AFET','DEVE']);
  assert.deepEqual(PRESS_FEEDS.map(feed=>feed.id),['press-releases','press-releases-plenary','press-releases-committees']);
  assert.throws(()=>parsePressFeed('<!DOCTYPE rss><rss/>'));assert.throws(()=>parsePressFeed('<html/>'));
  assert.deepEqual(parsePressFeed(rss(['https://example.test/news/en/press-room/20261016IPR48238/','https://www.europarl.europa.eu/news/en/agenda/plenary-news/2026-10-19','https://www.europarl.europa.eu/news/en/press-room/../meps/'].map(link=>`<item><link>${link}</link></item>`))),[]);
});

test('only the Further information list links a release to procedures, summaries or single-subject documents',()=>{
  const ets=parsePressRelease(fixture.pages['20261016IPR48237'],'20261016IPR48237');
  assert.equal(ets.title,'ETS: MEPs want extra free allowances to shield industry from carbon leakage');
  assert.equal(ets.publishedLocal,'2026-10-19T19:08:00');
  assert.deepEqual(ets.links,[{kind:'summary',value:'1910288',label:'Procedure file'}],'the eMeeting voting-list link is not an identifier');
  assert.equal(ets.robots.listed,false,'Parliament marks this page noindex, nofollow');
  const budget=parsePressRelease(fixture.pages['20261016IPR48226'],'20261016IPR48226');
  assert.equal(budget.robots.listed,true);assert.deepEqual(budget.links.map(link=>link.kind+':'+link.value),['procedure:2026/0196(BUD)'],'linked earlier press releases are not identifiers');
  const global=parsePressRelease(fixture.pages['20261016IPR48238'],'20261016IPR48238');
  assert.equal(global.furtherInformation,true);assert.deepEqual(global.links,[],'an EPRS briefing is not a dossier document');
  assert.throws(()=>parsePressRelease(fixture.pages['20261016IPR48226'],'20261016IPR48238'),/does not match/);
  const list=links=>'<p><a href="https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2024/0001(COD)">Body mention</a></p><span class="ep_name">Further information</span><ul>'+links.map(href=>`<li><a href="${href}"><span class="ep_name">Link</span></a></li>`).join('')+'</ul>';
  assert.deepEqual(furtherInformation(list([
    'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2025%2F0407(COD) ','https://oeil.europarl.europa.eu/oeil/popups/ficheprocedure.do?lang=en&amp;reference=2023/0123(COD)','https://oeil.europarl.europa.eu/oeil/fr/document-summary?id=42',
    'https://www.europarl.europa.eu/doceo/document/A-10-2026-0276_EN.html','/doceo/document/TA-10-2026-0241_EN.pdf','https://www.europarl.europa.eu/doceo/document/PV-10-2026-10-22-VOT_EN.html','https://www.europarl.europa.eu/doceo/document/O-10-2026-000031_EN.html',
    'https://example.test/oeil/en/procedure-file?reference=2025/0001(COD)','https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=not-a-reference',
  ])).map(link=>link.kind+':'+link.value),['procedure:2025/0407(COD)','procedure:2023/0123(COD)','summary:42','document:A-10-2026-0276','document:TA-10-2026-0241']);
  assert.equal(furtherInformation('<p>No list</p>'),null);
  for(const [html,header] of [["<meta name='robots' content='noindex'>",null],['<meta name=robots content="index nofollow">',null],['<meta name="robots" content="index, follow"><meta content="noindex" name="ROBOTS">',null],['<meta name="robots" content="index, follow">','noindex']])
    assert.equal(robots(html,header).listed,false,html+' '+header);
  assert.equal(robots('<meta name="robotsx" content="noindex"><meta name="robots" content="index, follow">').listed,true);
  assert.equal(parsePressRelease(fixture.pages['20261016IPR48226'],'20261016IPR48226',{robotsHeader:'none'}).robots.listed,false,'an X-Robots-Tag header applies');
  assert.equal(doceoDocument('https://www.europarl.europa.eu/doceo/document/ENVI-AM-792188_EN.pdf'),'ENVI-AM-792188');
  assert.equal(doceoDocument('https://www.europarl.europa.eu/doceo/document/OJQ-10-2026-10-22_EN.html'),null,'agendas cover many files');
});

test('procedure files list their summaries and single-subject documents',()=>{
  const procedure=parseProcedurePage(procedurePage,'2026/0211(COD)');
  assert.deepEqual(procedure.summaries.map(summary=>summary.id),['1910288']);
  assert.deepEqual(procedure.documents,['A-10-2026-0276']);
});

test('Brussels page times become UTC instants across daylight-saving changes',()=>{
  assert.equal(brusselsInstant('2026-10-19T19:08:00'),'2026-10-19T17:08:00.000Z');
  assert.equal(brusselsInstant('2026-12-01T10:00:00'),'2026-12-01T09:00:00.000Z');
  assert.equal(brusselsInstant('invalid'),null);
});

function follower({pages={},now}) {
  const dir=temp(),store=new PressStore(dir),calls=[],responses=new Map([
    [PRESS_FEEDS[0].url,rss(fixture.feeds['press-releases'])],[PRESS_FEEDS[1].url,rss(fixture.feeds['press-releases-plenary'])],
    ...['20261016IPR48226','20261016IPR48237','20261016IPR48238'].map(id=>[pressReleaseUrl(id),fixture.pages[id]]),
    ...Object.entries(pages).map(([id,html])=>[pressReleaseUrl(id),html]),
  ]);
  const fetchText=async url=>{
    calls.push(url);
    if(url===PRESS_FEEDS[2].url&&!responses.has(url))throw Object.assign(new Error('Parliament returned 503.'),{status:503});
    if(!responses.has(url))throw Object.assign(new Error('Parliament returned 404.'),{status:404});
    return responses.get(url);
  };
  return {dir,store,calls,responses,follower:new PressFollower(store,{clock:()=>now.value,fetchText}),close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
// The example release left the feeds before following began; it stands for one announced earlier.
const announceEts=(store,now)=>{store.initialize();store.transaction(()=>store.discover({id:'20261016IPR48237',url:pressReleaseUrl('20261016IPR48237'),title:null,publishedAt:null,committees:['ENVI']},{feed:'press-releases-committees',now}));};

test('completed RSS polls wait a full day, including after reopening the store',async()=>{
  const directory=temp();let now=Date.parse('2026-10-21T07:00:00Z'),reads=0,store=new PressStore(directory);
  const options={clock:()=>now,fetchText:async()=>{reads++;return rss([]);}};
  try {
    await new PressFollower(store,options).run();
    assert.equal(reads,3);
    store.close();store=new PressStore(directory);
    const following=new PressFollower(store,options);
    now+=DAY-1;
    assert.equal(following.due(),false);
    await following.run();assert.equal(reads,3,'no feed is read before the daily poll is due');
    now++;
    assert.equal(following.due(),true);
    await following.run();assert.equal(reads,6);
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

test('following reads each announced release once, withholds unlisted pages and reports partial coverage',async()=>{
  const now={value:Date.parse('2026-10-20T12:00:00Z')},setup=follower({now});
  const {store,calls}=setup;
  try {
    assert.equal(setup.follower.due(),true);
    announceEts(store,now.value);
    await setup.follower.run();
    assert.deepEqual(calls.slice(0,3),PRESS_FEEDS.map(feed=>feed.url),'each feed is read once per poll');
    assert.deepEqual(calls.slice(3).sort(),['20261016IPR48226','20261016IPR48237','20261016IPR48238','20261018IPR48249'].map(pressReleaseUrl),'only announced releases are read');
    const follow=store.get('follow');
    assert.equal(follow.since,'2026-10-20T12:00:00.000Z');assert.match(follow.feeds['press-releases-committees'].error,/503/);
    assert.equal(follow.nextPollAt,now.value+DAY);
    assert.equal(store.release('20261018IPR48249').attempts,1,'a failed read is retried later');
    const mentions=new PressMentions(store,official);
    const ets=await mentions.query(pressMentionsQuery(new URLSearchParams({reference:'2026/0211(COD)',lang:'en'})));
    assert.deepEqual(ets.items,[],'the noindex release is withheld');
    assert.equal(ets.coverage.unlistedReleases,1);assert.equal(ets.coverage.complete,false);
    const budget=await mentions.query(pressMentionsQuery(new URLSearchParams({reference:'2026/0196(BUD)'})));
    assert.deepEqual(budget.items.map(item=>[item.id,item.title,item.publishedAt]),[['20261016IPR48226','2027 EU budget: press conference with lead MEPs on Wednesday at 14.30','2026-10-19T08:00:00.000Z']]);
    assert.deepEqual(budget.items[0].links,[{kind:'procedure',value:'2026/0196(BUD)',label:'Details of the procedure'}],'labels vary; the exact reference matters');
    const request={method:'GET',headers:{}},route=new URL('https://example.test/api/insights/press-releases?reference=2026%2F0196(BUD)&lang=en');
    assert.equal(apiCachePolicy(request,route,budget).cdnCacheControl,'no-store','a failed feed keeps the answer uncached');
    setup.responses.set(PRESS_FEEDS[2].url,rss([]));
    const read=calls.length;now.value+=DAY;await setup.follower.run();
    assert.deepEqual(calls.slice(read),[...PRESS_FEEDS.map(feed=>feed.url),pressReleaseUrl('20261018IPR48249')],'successfully read releases are not read again');
    const healthy=await mentions.query(pressMentionsQuery(new URLSearchParams({reference:'2026/0196(BUD)'})));
    assert.equal(apiCachePolicy(request,route,healthy).cdnCacheControl,'public, max-age=900, stale-if-error=0');
    const unavailable=await new PressMentions(store,{get:async()=>{throw new Error('OEIL unavailable');}}).query(pressMentionsQuery(new URLSearchParams({reference:'2026/0196(BUD)'})));
    assert.deepEqual(unavailable.items.map(item=>item.id),['20261016IPR48226'],'direct procedure links remain without the procedure file');
    assert.equal(unavailable.coverage.procedureLinks.status,'unavailable');
    assert.equal(apiCachePolicy(request,route,unavailable).cdnCacheControl,'no-store');
    for(const bad of [{reference:'2026/0211'},{reference:'2026/0211(COD)',other:'1'}])assert.throws(()=>pressMentionsQuery(new URLSearchParams(bad)));
  } finally {setup.close();}
});

test('summary and document links match only through the dossier’s own procedure file',async()=>{
  // Variants of the fixture pages: the ETS page listed, and a report link added to another release.
  const listed=fixture.pages['20261016IPR48237'].replace('noindex, nofollow','index, follow');
  const report=fixture.pages['20261016IPR48238'].replace('<ul class="ep_list">','<ul class="ep_list"><li><a href="https://www.europarl.europa.eu/doceo/document/A-10-2026-0276_EN.html"><span class="ep_name">Report</span></a></li><li><a href="https://www.europarl.europa.eu/doceo/document/PV-10-2026-10-22-VOT_EN.html?item=3"><span class="ep_name">Minutes</span></a></li>');
  const now={value:Date.parse('2026-10-20T12:00:00Z')},setup=follower({now,pages:{'20261016IPR48237':listed,'20261016IPR48238':report}});
  try {
    announceEts(setup.store,now.value);
    await setup.follower.run();
    const result=await new PressMentions(setup.store,official).query(pressMentionsQuery(new URLSearchParams({reference:'2026/0211(COD)',lang:'en'})));
    assert.deepEqual(result.items.map(item=>[item.id,item.links.map(link=>link.kind+':'+link.value)]),[['20261016IPR48238',['document:A-10-2026-0276']],['20261016IPR48237',['summary:1910288']]],'newest first');
    assert.equal(result.items[1].publishedAt,'2026-10-19T17:08:00.000Z');
    assert.equal(result.coverage.procedureLinks.status,'available');
    const other=await new PressMentions(setup.store,official).query(pressMentionsQuery(new URLSearchParams({reference:'2025/0407(COD)'})));
    assert.deepEqual(other.items,[],'a procedure file for another dossier does not share these IDs');
  } finally {setup.close();}
});

test('a lost writer lease stops press writes',async()=>{
  const dir=temp(),store=new PressStore(dir);
  const press=new PressFollower(store,{clock:()=>Date.parse('2026-10-20T12:00:00Z'),fetchText:async()=>rss(fixture.feeds['press-releases']),write:()=>{throw new Error('Activity-index writer lease was lost.');}});
  try {
    await assert.rejects(press.run(),/lease was lost/);
    assert.equal(store.get('follow'),null);assert.equal(store.release('20261016IPR48238'),null);
    assert.equal(existsSync(store.filename),false,'nothing is created without the writer');
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('press following runs only for the activity-index lease holder',async()=>{
  const dir=temp(),instant=()=>Date.parse('2026-10-13T14:00:00Z'),store=new ActivityStore(dir,{clock:instant});let runs=0,other;
  const fetchRecord=async(endpoint,params)=>({payload:{data:params.offset===0?[{id:'person/257043',label:'MEP'}]:[]},fetchedAt:new Date(instant()).toISOString()});
  let admitted=0;
  const press={due:()=>true,run:async({admit})=>{store.assertWriter();runs++;while(admit())admitted++;}};
  try {
    const worker=new ActivityWorker(store,{clock:instant,fetchRecord,budget:20,press});
    await worker.run();assert.equal(runs,1);
    assert.equal(admitted,2,'while index work is due, press takes a tenth of the request budget');
    assert.equal(worker.requests>admitted,true,'index work still receives requests');
    other=new ActivityStore(dir,{clock:instant});assert(other.acquire());
    await worker.run();assert.equal(runs,1,'another writer holds the lease');
  } finally {other?.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('with a one-request budget, press and index work alternate',async()=>{
  const dir=temp(),instant=()=>Date.parse('2026-10-13T14:00:00Z'),store=new ActivityStore(dir,{clock:instant});let core=0,admitted=0;
  const fetchRecord=async(endpoint,params)=>{core++;return {payload:{data:params.offset===0?[{id:'person/257043',label:'MEP'}]:[]},fetchedAt:new Date(instant()).toISOString()};};
  const press={due:()=>true,run:async({admit})=>{while(admit())admitted++;}};
  try {
    const worker=new ActivityWorker(store,{clock:instant,fetchRecord,budget:1,press});
    for(let iteration=0;iteration<4;iteration++)await worker.run();
    assert.equal(admitted,2,'press takes every other request while index work is due');
    assert.equal(core,2,'index work receives the others');
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('press writes are fenced by the activity-index lease and readers never create the store',async()=>{
  const dir=temp();let now=Date.parse('2026-10-20T12:00:00Z');
  const activity=new ActivityStore(dir,{clock:()=>now}),press=new PressStore(dir);let other;
  try {
    assert.equal(press.get('follow'),null);assert.deepEqual(press.mentions('2026/0196(BUD)'),{items:[],total:0,watermark:null});assert.equal(press.due(now,6).length,0);
    assert.equal(existsSync(press.filename),false,'reads create nothing');
    assert(activity.acquire());
    other=new ActivityStore(dir,{clock:()=>now});other.db.exec('PRAGMA busy_timeout=0');
    const write=leaseFencedWrite(activity,press);
    write(()=>{
      assert.throws(()=>other.acquire(),/locked|busy/i,'no takeover between the lease check and the press commit');
      press.set('follow',{since:'2026-10-20T12:00:00.000Z',feeds:{}});
    });
    assert.equal(press.get('follow').since,'2026-10-20T12:00:00.000Z');
    now+=91_000;assert(other.acquire(),'an expired lease can be taken over');
    assert.throws(()=>write(()=>press.set('follow',{since:'late',feeds:{}})),/lease was lost/);
    assert.equal(press.get('follow').since,'2026-10-20T12:00:00.000Z','the former owner cannot write');
    const reopened=new PressStore(dir);
    try{assert.equal(reopened.get('follow').since,'2026-10-20T12:00:00.000Z');assert.equal(reopened.db.prepare('PRAGMA synchronous').get().synchronous,1,'a reopened connection keeps NORMAL synchronisation');}
    finally{reopened.close();}
  } finally {other?.close();press.close();activity.close();rmSync(dir,{recursive:true,force:true});}
});

test('an exhausted request budget stops following and leaves the poll due',async()=>{
  const now={value:Date.parse('2026-10-20T12:00:00Z')},setup=follower({now});
  try {
    let left=2;
    await setup.follower.run({admit:()=>left-->0});
    assert.deepEqual(setup.calls,PRESS_FEEDS.slice(0,2).map(feed=>feed.url));
    assert.equal(setup.store.get('follow').nextPollAt,undefined,'an incomplete poll stays due');
    assert.equal(setup.follower.due(),true);
    await setup.follower.run();
    assert.equal(setup.calls[2],PRESS_FEEDS[2].url,'the poll resumes with the remaining feed');
    assert.equal(setup.calls.filter(url=>url===PRESS_FEEDS[0].url).length,1);
    assert.equal(setup.store.get('follow').nextPollAt,now.value+DAY);
  } finally {setup.close();}
});

test('consecutive one-request runs complete the poll, then read releases',async()=>{
  const now={value:Date.parse('2026-10-20T12:00:00Z')},setup=follower({now});
  try {
    const start=now.value,perRun=[];
    for(let run=0;run<5;run++){const before=setup.calls.length;let left=1;await setup.follower.run({admit:()=>left-->0});perRun.push(setup.calls.slice(before));now.value+=60_000;}
    assert.deepEqual(perRun.slice(0,3),PRESS_FEEDS.map(feed=>[feed.url]),'each run reads the next feed');
    assert.equal(perRun[3].length,1);assert.match(perRun[3][0],/\/press-room\/\d{8}IPR\d{5}\/$/,'then pending releases are read');
    const follow=setup.store.get('follow');
    assert.equal(follow.since,new Date(start).toISOString());assert.equal(follow.poll,undefined);
    assert.equal(follow.nextPollAt,start+2*60_000+DAY,'the next poll is timed from its last feed');
  } finally {setup.close();}
});

test('a cancelled poll keeps each finished feed with its releases and following start',async()=>{
  const now={value:Date.parse('2026-10-20T12:00:00Z')},setup=follower({now}),controller=new AbortController();
  try {
    const fetchText=setup.follower.fetchText;
    setup.follower.fetchText=async(url,options)=>{if(url===PRESS_FEEDS[1].url&&!controller.signal.aborted){now.value+=60_000;controller.abort();throw controller.signal.reason;}return fetchText(url,options);};
    await assert.rejects(setup.follower.run({signal:controller.signal}));
    let follow=setup.store.get('follow');
    assert.equal(follow.since,'2026-10-20T12:00:00.000Z');assert.deepEqual(follow.poll.done,['press-releases']);
    assert.equal(follow.feeds['press-releases'].lastSuccessAt,'2026-10-20T12:00:00.000Z');
    assert(setup.store.release('20261016IPR48226'),'the finished feed’s releases remain');
    now.value+=60_000;await setup.follower.run();
    follow=setup.store.get('follow');
    assert.equal(follow.since,'2026-10-20T12:00:00.000Z','resuming does not move the following start');
    assert.equal(setup.calls.filter(url=>url===PRESS_FEEDS[0].url).length,1);
  } finally {setup.close();}
});

test('stale procedure files stay visible and uncached, and totals are exact',async()=>{
  const dir=temp(),store=new PressStore(dir),now=Date.parse('2026-10-20T12:00:00Z');
  try {
    store.initialize();
    store.transaction(()=>{
      for(let index=0;index<201;index++) {
        const id='20261016IPR'+String(index).padStart(5,'0');
        store.discover({id,url:pressReleaseUrl(id),title:'Release '+index,publishedAt:null,committees:[]},{feed:'press-releases',now});
        store.record(id,{id,url:pressReleaseUrl(id),title:'Release '+index,publishedAt:new Date(now+index*60_000).toISOString(),feeds:['press-releases'],listed:true},{now,links:[{kind:'procedure',value:'2026/0196(BUD)',label:'Procedure file'}]});
      }
      store.set('follow',{since:'2026-10-20T12:00:00.000Z',feeds:{}});
    });
    const stale={get:async url=>({url,fetchedAt:'2026-10-19T11:00:00.000Z',html:'<main><h2 class="es_title-h1">2026/0196(BUD)</h2><h2>Budget</h2></main>',viewCache:{stale:true,refreshInProgress:false,refreshError:'The official source is temporarily unavailable.'}})};
    const result=await new PressMentions(store,stale).query(pressMentionsQuery(new URLSearchParams({reference:'2026/0196(BUD)'})));
    assert.equal(result.total,201,'the total counts every matching release');
    assert.deepEqual(result.items.map(item=>item.title),['Release 200','Release 199','Release 198','Release 197','Release 196']);
    assert.deepEqual(result.coverage.procedureLinks.source,{url:'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2026%2F0196%28BUD%29',fetchedAt:'2026-10-19T11:00:00.000Z',stale:true,refreshInProgress:false,refreshError:'The official source is temporarily unavailable.'});
    const request={method:'GET',headers:{}},route=new URL('https://example.test/api/insights/press-releases?reference=2026%2F0196(BUD)&lang=en');
    assert.equal(apiCachePolicy(request,route,result).cdnCacheControl,'no-store','a stale procedure file is not cached as a healthy answer');
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('follow mode returns more than five identities with durable first-link marks and preserves unavailable OEIL state',async()=>{
  const dir=temp(),store=new PressStore(dir),now=Date.parse('2026-10-23T10:00:00Z');
  try {
    store.initialize();store.set('follow',{since:'2026-10-20T12:00:00Z',feeds:{}});
    for(let i=0;i<8;i++) {
      const id='20261023IPR'+String(i).padStart(5,'0'),body={id,url:pressReleaseUrl(id),title:'Release '+i,publishedAt:'2020-01-01T00:00:00Z',listed:true};
      store.discover(body,{feed:'press-releases',now});store.record(id,body,{now,links:[{kind:'procedure',value:'2026/0211(COD)'}]});
    }
    const service=new PressMentions(store,official),query=pressMentionsQuery(new URLSearchParams({reference:'2026/0211(COD)',following:'1'})),result=await service.query(query);
    assert.equal(result.items.length,8);assert.equal(new Set(result.items.map(item=>item.linkedAt)).size,8,'same-clock writes are ordered');
    assert(result.items.every(item=>item.linkedAt<=result.watermark));assert.equal(result.dossier.summaries[0].id,'1910288');
    const first=store.release(result.items[0].id);store.record(first.id,first.body,{now:now+1000,links:[{kind:'procedure',value:'2026/0211(COD)'}]});
    assert.equal(store.release(first.id).linked_at,first.linked_at,'a refresh does not reannounce a release');
    const failure=await new PressMentions(store,{get(){throw Error('OEIL unavailable');}}).query(query);assert.equal(failure.dossier,null);assert.equal(failure.coverage.procedureLinks.status,'unavailable');
    assert.equal((await service.query({reference:query.reference,language:'en'})).items.length,5,'reader preview stays bounded');
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('press matches and watermark are read from one snapshot while a separate writer publishes',async()=>{
  const dir=temp(),reader=new PressStore(dir),writer=new PressStore(dir),reference='2026/0211(COD)',now=100;
  const put=(store,n)=>{const id='20261023IPR'+String(n).padStart(5,'0'),body={id,url:pressReleaseUrl(id),title:'Release '+n,publishedAt:'2026-10-23T10:00:00Z'};store.transaction(()=>{store.discover(body,{feed:'press-releases',now});store.record(id,body,{now,links:[{kind:'procedure',value:reference,label:null}]});});};
  try {
    reader.initialize();reader.set('follow',{since:'2026-10-23',feeds:{}});put(reader,1);writer.initialize();
    const get=reader.get.bind(reader);let published=false;
    reader.get=key=>{const result=get(key);if(key==='linkedMark'&&!published){published=true;put(writer,2);}return result;};
    reader.db.exec('PRAGMA query_only=ON');
    const result=await new PressMentions(reader,official).query({reference,language:'en',following:true});
    assert.equal(result.watermark,100);assert.equal(result.items.length,1);assert.equal(result.total,1);
    assert.equal(writer.get('linkedMark'),101);assert.equal(reader.db.isTransaction,false);
  }finally{reader.db.exec('PRAGMA query_only=OFF');reader.close();writer.close();rmSync(dir,{recursive:true,force:true});}
});
