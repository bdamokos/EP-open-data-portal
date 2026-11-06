import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parsePressRelease,pressExcerpt,pressReleaseUrl} from './press-releases-model.mjs';
import {PressStore,PressFollower,PRESS_LIMITS} from './press-releases.mjs';

const fixtures=JSON.parse(readFileSync(new URL('./fixtures/press-leads-public.json',import.meta.url)));
const now=Date.parse('2026-11-06T12:00:00Z');
const release=(id,fields={})=>({id,url:pressReleaseUrl(id),title:id,feeds:[],listed:true,publishedAt:'2026-10-22T10:26:00.000Z',...fields});
function put(store,body,links=[{kind:'procedure',value:'2025/0222(COD)'}]) {
  store.discover(body,{feed:'press-releases',now:now-1000});
  store.record(body.id,body,{now:now-1000,links});
}
function withStore(fn) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'press-leads-')),store=new PressStore(directory);
  store.initialize();
  return Promise.resolve().then(()=>fn(store,directory)).finally(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
}

test('public release fixtures preserve the lead and first two paragraphs; robots withholds text',()=>{
  for(const [id,fixture] of Object.entries(fixtures)) {
    const page=parsePressRelease(fixture.html,id);
    assert.ok(page.lead);assert.equal(page.paragraphs.length,2);assert.equal(page.paragraphs[0],page.lead);
    const {lead,second}=pressExcerpt(page);assert.equal(lead,page.lead);assert.ok(page.paragraphs[1].includes(second));
    assert.match(page.links.map(link=>link.value).join(' '),id==='20261018IPR48265'?/2025\/0222/:/2026\/0325/);
    for(const directive of ['noindex','nofollow','none']) {
      const denied=parsePressRelease(fixture.html,id,{robotsHeader:directive});
      assert.equal(denied.lead,null);assert.deepEqual(denied.paragraphs,[]);
    }
  }
});

test('excerpt extends common abbreviations, preserves characters and omits a heading',()=>{
  for(const abbreviation of ['Mr.','Dr.','No.','Art.','e.g.','i.e.']) {
    const sentence=`${abbreviation} Smith spoke.`,paragraph=sentence+' Next sentence.';
    assert.deepEqual(pressExcerpt({lead:' Lead. ',paragraphs:['Lead.',paragraph]}),{lead:'Lead.',second:sentence});
  }
  assert.deepEqual(pressExcerpt({lead:'Lead.',paragraphs:['Lead.','Next steps']}),{lead:'Lead.',second:null});
  assert.deepEqual(pressExcerpt(),{lead:null,second:null});
  assert.equal(pressExcerpt({paragraphs:['','One sentence! Another sentence.']}).second,'One sentence!');
});

test('one-time migration schedules only checked, listed, linked pages and respects six-page runs',()=>withStore(async(store,directory)=>{
  for(let i=0;i<8;i++)put(store,release('20261018IPR'+String(48000+i)));
  put(store,release('20261018IPR48020',{listed:false}));
  put(store,release('20261018IPR48021'),[]);
  put(store,release('20261018IPR48022',{leadVersion:1}));
  store.discover(release('20261018IPR48023'),{feed:'press-releases',now:now+999999});
  store.set('follow',{nextPollAt:now+999999});store.db.prepare("DELETE FROM meta WHERE key='leadBackfillVersion'").run();
  store.close();store.initialize({now});
  assert.equal(store.due(now,100).length,8);
  const linkedAt=store.release('20261018IPR48000').linked_at,mark=store.get('linkedMark'),calls=[];
  const follower=new PressFollower(store,{clock:()=>now,fetchText:async url=>{
    calls.push(url);
    return `<link rel="canonical" href="${url}"><ul><span class="ep_name">Further information</span><a href="https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2025%2F0222(COD)">Procedure</a></ul>`;
  }});
  await follower.run();assert.equal(calls.length,PRESS_LIMITS.pagesPerRun);
  assert.ok(calls.every(url=>url.includes('/press-room/')),'no feed or listing reads');
  assert.equal(store.release('20261018IPR48000').linked_at,linkedAt,'Following never resurfaces this release');
  assert.ok(store.get('linkedMark')>mark,'the watermark can advance without changing first-link time');
  assert.equal(store.release('20261018IPR48000').body.leadVersion,1,'missing text is still marked read');
  assert.equal(store.release('20261018IPR48000').body.lead,null);
  await follower.run();assert.equal(calls.length,8);
  store.close();store.initialize({now:now+100});assert.deepEqual(store.due(now+100,100),[]);
  const reader=new PressStore(directory,{readOnly:true});
  try{assert.deepEqual(reader.forWeek({procedureIds:['2025/0222(COD)'],from:'2026-10-19',to:'2026-10-25'}).map(row=>row.id),['20261018IPR48022'],'missing publication dates stay absent');}finally{reader.close();}
}));

test('week lookup uses indexed exact identifiers, Brussels date boundaries, listing and newest order',()=>withStore((store,directory)=>{
  const cases=[
    ['48000','2026-10-18T22:00:00.000Z','2025/0222(COD)',true],
    ['48001','2026-10-18T21:59:59.999Z','2025/0222(COD)',true],
    ['48002','2026-10-25T22:59:59.999Z','2025/0222(INI)',true],
    ['48003','2026-10-25T23:00:00.000Z','2025/0222(COD)',true],
    ['48004','2026-10-22T10:00:00.000Z','2025/0223(COD)',true],
    ['48005','2026-10-22T10:00:00.000Z','2025/0222(COD)',false],
  ];
  for(const [id,publishedAt,value,listed] of cases)put(store,release('20261018IPR'+id,{publishedAt,listed}),[{kind:'procedure',value}]);
  put(store,release('20261018IPR48006'),[{kind:'summary',value:'1910000'}]);
  put(store,release('20261018IPR48007'),[{kind:'document',value:'A-10-2026-0276'}]);
  put(store,release('20261018IPR48008'),[{kind:'document',value:'A-10-2026-0277'}]);
  const reader=new PressStore(directory,{readOnly:true});
  try{
    const query={procedureIds:['2025/0222(COD)'],documentIds:['A-10-2026-0276'],from:'2026-10-19',to:'2026-10-25'};
    assert.deepEqual(reader.forWeek(query).map(row=>row.id),['20261018IPR48002','20261018IPR48007','20261018IPR48000']);
    assert.deepEqual(reader.forWeek({...query,procedureIds:[],documentIds:[]}),[]);
    const plan=reader.db.prepare("EXPLAIN QUERY PLAN SELECT release FROM links WHERE kind='procedure' AND value>=? AND value<?").all('2025/0222(','2025/0222)');
    assert.ok(plan.some(row=>/SEARCH.*PRIMARY KEY|SEARCH.*COVERING INDEX/.test(row.detail)));
  }finally{reader.close();}
}));

test('a nofollow re-read removes links and stored text without changing its first-link mark',()=>withStore(async store=>{
  const id='20261018IPR48265';
  put(store,release(id,{lead:'Held lead.',paragraphs:['Held lead.','Held paragraph.']}));
  const first=store.release(id).linked_at;
  await new PressFollower(store,{clock:()=>now,fetchText:async()=>({text:fixtures[id].html,robotsHeader:'nofollow'})}).read(id);
  const row=store.release(id);
  assert.equal(row.linked_at,first);assert.equal(row.body.leadVersion,1);
  assert.equal(row.body.lead,null);assert.deepEqual(row.body.paragraphs,[]);
  assert.deepEqual(store.mentions('2025/0222(COD)').items,[]);
}));
