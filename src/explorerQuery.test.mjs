import test from 'node:test';
import assert from 'node:assert/strict';
import {explorerParams,readExplorerParam} from './explorerQuery.mjs';

test('speech summary categories belong to the selected member only',()=>{
  const query=new URLSearchParams('member=42&mep-speech-category=written');
  assert.equal(explorerParams(query,null,42).get('mep-speech-category'),'written');
  assert.equal(explorerParams(query,null,43).has('mep-speech-category'),false);
  assert.equal(explorerParams(query,'questions',42).has('mep-speech-category'),false);
});

test('legacy and scoped Greek links migrate only into their owning explorer',()=>{
  for(const code of ['GR','EL']){
    const question=new URLSearchParams({view:'questions',country:code,'hot-country':'IT'});
    assert.equal(readExplorerParam(question,'q-country',null),'EL');
    assert.equal(explorerParams(question,'questions').toString(),'q-country=EL');
    assert.equal(explorerParams(new URLSearchParams({'q-country':code}),'questions').get('q-country'),'EL');
    assert.equal(explorerParams(new URLSearchParams({view:'legislation',country:code}),'legislation').get('agenda-country'),'EL');
    assert.equal(explorerParams(question,null).toString(),'');
  }
});
test('a direct question intersection survives serialization without carrying wall or plenary filters',()=>{
  const query=new URLSearchParams('q-country=IT&q-word=fishing&q-days=365&q-range=2026-10-05_2026-10-11&q-view=time&country=EL&member=42&agenda-country=BE');
  const scoped=explorerParams(query,'questions');
  assert.equal(scoped.get('q-country'),'IT');assert.equal(scoped.get('q-word'),'fishing');
  assert.equal(scoped.get('q-range'),'2026-10-05_2026-10-11');assert.equal(scoped.get('q-days'),'365');
  assert.equal(scoped.has('country'),false);assert.equal(scoped.has('member'),false);assert.equal(scoped.has('agenda-country'),false);
});
test('plenary modes retain distinct country state and timeline context',()=>{
  const query=new URLSearchParams('pl-mode=trends&agenda-country=EL&hot-country=IT&cloud-country=BE&trend-topic=1234&trend-days=365&trend-week=2026-10-05&q-country=HU');
  const scoped=explorerParams(query,'legislation');
  for(const key of ['agenda-country','hot-country','cloud-country','trend-topic','trend-days','trend-week'])assert.equal(scoped.get(key),query.get(key));
  assert.equal(scoped.has('q-country'),false);
});
test('plenary week and single-sitting URLs survive saved links and reject invalid weeks',()=>{
  for(const key of ['agenda-period','hot-period','cloud-period']) {
    for(const period of ['week:2026-10-05','sitting:MTG-PL-2026-10-08']) {
      const params=explorerParams(new URLSearchParams({[key]:period}),'legislation');
      assert.equal(readExplorerParam(params,key,''),period);
    }
    for(const period of ['week:2026-10-06','week:2026-02-30','broken'])assert.equal(readExplorerParam(new URLSearchParams({[key]:period}),key,'fallback'),'fallback');
  }
});
test('malformed links cannot create invalid country names, unbounded pagination or impossible dates',()=>{
  for(const value of ['not-a-country','XX',''])assert.equal(readExplorerParam(new URLSearchParams({'q-country':value}),'q-country',null),null);
  for(const value of ['-25','1.5','Infinity','5001'])assert.equal(readExplorerParam(new URLSearchParams({'q-offset':value}),'q-offset',0),0);
  for(const value of ['2026-02-30','2026-99-01','oops'])assert.equal(readExplorerParam(new URLSearchParams({'q-until':value}),'q-until',''),'');
  for(const value of ['2026-10-12_2026-10-05','2026-02-30_2026-03-01','broken'])assert.equal(readExplorerParam(new URLSearchParams({'q-range':value}),'q-range',''),'');
  assert.equal(readExplorerParam(new URLSearchParams({'hot-period':'unexpected:value'}),'hot-period','sitting:MTG-PL-2026-10-08'),'sitting:MTG-PL-2026-10-08');
  assert.equal(readExplorerParam(new URLSearchParams({'q-days':'123'}),'q-days',90,[7,30,90,180,365]),90);
});
test('current-term periods survive saved question and timeline links alongside numeric presets',()=>{
  for(const [key,view,fallback,allowed] of [['q-days','questions',90,[7,30,90,180,365,'term']],['trend-days','legislation',180,[90,180,365,'term']]]) {
    const saved=explorerParams(new URLSearchParams({[key]:'term'}),view);
    assert.equal(readExplorerParam(saved,key,fallback,allowed),'term');
    assert.equal(readExplorerParam(new URLSearchParams({[key]:'365'}),key,fallback,allowed),365);
    assert.equal(readExplorerParam(new URLSearchParams({[key]:'all'}),key,fallback,allowed),fallback);
  }
});
test('outside-speaker links retain their own filters and validate identity and month',()=>{
  const params=new URLSearchParams('ov-term=all&ov-person=227855&ov-tab=appearances&ov-month=2025-03&ov-repeat=1&q-country=IT&member=42');
  const saved=explorerParams(params,'outside');assert.equal(saved.get('ov-person'),'227855');assert.equal(saved.has('q-country'),false);assert.equal(saved.has('member'),false);
  assert.equal(readExplorerParam(saved,'ov-month',null),'2025-03');
  assert.equal(readExplorerParam(new URLSearchParams('ov-person=0'),'ov-person',null),null);
  assert.equal(readExplorerParam(new URLSearchParams('ov-month=2025-13'),'ov-month',null),null);
});
test('amendment links retain their own dossier filters and reject malformed author or page values',()=>{
  const params=new URLSearchParams('am-procedure=2025%2F0407(COD)&am-document=A-10-2026-0254&am-member=197818&am-outcome=mixed&am-offset=20&q-country=IT&member=42');
  const saved=explorerParams(params,'amendments');
  assert.equal(saved.get('am-procedure'),'2025/0407(COD)');
  assert.equal(saved.get('am-member'),'197818');
  assert.equal(saved.has('q-country'),false);
  assert.equal(saved.has('member'),false);
  assert.equal(explorerParams(params,'legislation').has('am-document'),false);
  assert.equal(readExplorerParam(saved,'am-offset',0),20);
  for(const value of ['0','-2','not-an-id'])assert.equal(readExplorerParam(new URLSearchParams({'am-member':value}),'am-member',''),'');
  assert.equal(readExplorerParam(new URLSearchParams({'am-offset':'1000000'}),'am-offset',0),1000000);
  for(const value of ['-1','20.5','1000001'])assert.equal(readExplorerParam(new URLSearchParams({'am-offset':value}),'am-offset',0),0);
});
test('global full-text navigation survives every explorer while contextual searches stay with their owner',()=>{
  const query=new URLSearchParams('global-fts-search=climate&global-fts-text-lang=fr&global-fts-page=2&global-fts-offset=37&global-fts-read=MTG-PL-example&global-fts-kind=question&global-fts-sort=newest&global-fts-closed=1&q-fts-search=water&q-fts-read=P-10-2025-000001&agenda-fts-search=energy&dossier-fts-search=emissions&mep-speech-fts-search=transport&mep-activity-fts-search=rail');
  for(const view of [null,'questions','legislation','outside','saved','amendments']){
    const saved=explorerParams(query,view);
    for(const key of ['global-fts-search','global-fts-text-lang','global-fts-page','global-fts-offset','global-fts-read','global-fts-kind','global-fts-sort','global-fts-closed'])assert.equal(saved.get(key),query.get(key));
    assert.equal(saved.has('q-fts-search'),view==='questions');
    assert.equal(saved.has('agenda-fts-search'),view==='legislation');
    assert.equal(saved.has('dossier-fts-search'),view==='legislation');
    assert.equal(saved.has('mep-speech-fts-search'),view===null);
    assert.equal(saved.has('mep-activity-fts-search'),view===null);
  }
});
test('full-text pagination rejects invalid or unbounded URL pages',()=>{
  for(const prefix of ['global-fts','q-fts','agenda-fts','dossier-fts','mep-speech-fts','mep-activity-fts']){
    assert.equal(readExplorerParam(new URLSearchParams({[prefix+'-offset']:'37'}),prefix+'-offset',-1),37);
    assert.equal(readExplorerParam(new URLSearchParams({[prefix+'-offset']:'1000'}),prefix+'-offset',-1),1000);
    for(const value of ['-1','1.5','Infinity','1001','broken'])assert.equal(readExplorerParam(new URLSearchParams({[prefix+'-offset']:value}),prefix+'-offset',-1),-1);
    assert.equal(readExplorerParam(new URLSearchParams({[prefix+'-page']:'3'}),prefix+'-page',0),3);
    assert.equal(readExplorerParam(new URLSearchParams({[prefix+'-page']:'50'}),prefix+'-page',0),50);
    for(const value of ['-1','1.5','Infinity','51','10000','broken'])assert.equal(readExplorerParam(new URLSearchParams({[prefix+'-page']:value}),prefix+'-page',0),0);
  }
});
test('member full-text state is cleared when navigating to a different member or the wall',()=>{
  const query=new URLSearchParams('member=42&mep-speech-fts-search=transport&mep-speech-fts-read=MTG-PL-example&mep-activity-fts-search=rail&global-fts-search=climate');
  assert.equal(explorerParams(query,null,42).get('mep-speech-fts-search'),'transport');
  for(const member of [43,null]){
    const saved=explorerParams(query,null,member);
    assert.equal(saved.has('mep-speech-fts-search'),false);
    assert.equal(saved.has('mep-speech-fts-read'),false);
    assert.equal(saved.has('mep-activity-fts-search'),false);
    assert.equal(saved.get('global-fts-search'),'climate');
  }
});

test('Votes fields belong to the exact member alongside both existing MEP searches',()=>{
  const query=new URLSearchParams('member=42&mv-week=2026-03-23&mv-sitting=MTG-PL-2026-03-25&mv-positions=all&mv-offset=50&mv-decision=MTG-PL-2026-03-25-DEC-7&mv-snapshot='+('a'.repeat(64))+'&mv-expanded=%5B%22exact-subject%22%5D&mv-document=B-10-2026-0001&mv-amendment=B-10-2026-0001-AM-7&mv-list=B-10-2026-0001-AM-001-050&mv-view=document&ma-document=B-10-2026-0001&ma-view=adopted&ma-adopted=TA-10-2026-0007&mep-speech-fts-search=transport&mep-activity-fts-search=rail&global-fts-search=climate&mv-constructor=bad');
  const owned=explorerParams(query,null,42);
  for(const [key,value] of query)if(key!=='member'&&key!=='mv-constructor')assert.equal(owned.get(key),value,key);
  assert.equal(owned.has('mv-constructor'),false,'only own allowlisted fields survive');
  for(const [view,member] of [[null,43],[null,null],['questions',42],['saved',42]]){
    const scoped=explorerParams(query,view,member);
    assert.equal([...scoped.keys()].some(key=>key.startsWith('mv-')),false);
    assert.equal([...scoped.keys()].some(key=>key.startsWith('ma-')),false);
    assert.equal(scoped.get('global-fts-search'),'climate');
  }
});
