import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {renderContext} from './context-view.mjs';

const source={url:'https://data.europarl.europa.eu/api/v2/procedures/2025-0001',fetchedAt:'2026-10-23T12:00:00Z',language:null};
function sample(){
  const d={id:'2025-0001',reference:'2025/0001(COD)',title:'A dossier',source,roles:[{personId:'42'},{personId:'43'}],coverage:{roleRecords:2,ballots:2,declaredBallots:2,debates:0}};
  const vote={id:'eli/dl/event/decision-1',kind:'vote',date:'2026-09-16',stage:null,title:'Agreement',position:{position:'For',status:'recorded'},outcome:'ADOPTED',intentions:[],source};
  const amendment={id:'document-AM-1@list-1',kind:'amendment',date:'2026-09-08',stage:'RDG1',source,amendment:{number:1,listId:'list-1',documentDate:'2026-09-09',metadataDate:'2026-09-08',tablingDate:'2026-09-08',dateDiscrepancy:true,source,authors:[{name:'Person One',personId:42,status:'resolved'}],onBehalfOf:'on behalf of The Left Group',tablingObservations:[{id:'eli/dl/event/tabling-1',date:'2026-09-08',source}],outcomes:[{id:vote.id,outcome:'ADOPTED'}]}};
  const first={id:d.id+':42',dossierId:d.id,person:{id:'42',name:'Person One'},roles:[{role:'RAPPORTEUR_CO',committee:'ENVI'}],events:[{id:'role-1',kind:'role',date:'2026-02-11',stage:'RDG1',title:'Co-rapporteur recorded',detail:'ENVI',source},amendment,vote]};
  const second={id:d.id+':43',dossierId:d.id,person:{id:'43',name:'Person Two'},roles:[{role:'RAPPORTEUR_SHADOW',committee:null}],events:[{...vote,id:'eli/dl/event/decision-2',position:{position:null,status:'unavailable'}}]};
  return {dossiers:[d],examples:[first,second],context:{people:{42:{givenName:'Person',familyName:'One'},43:{givenName:'Person',familyName:'Two'}},milestones:{[d.id]:[]}}};
}
const header='<header class="parliament-header"><nav><button>Members</button><button>Plenary agenda</button></nav><button class="explorer-scheme-toggle">Theme</button><button class="explorer-search-icon">Search</button></header>';
async function open(t,query='',data=sample(),base='http://prototype.test/'){
  const window=new Window({url:base+query,settings:{enableJavaScriptEvaluation:true,suppressInsecureJavaScriptEnvironmentWarning:true}});
  t.after(()=>window.happyDOM.close());
  window.document.write(renderContext(data,{theme:'',header,headerCss:''}));
  await window.happyDOM.waitUntilComplete();
  const settle=()=>window.happyDOM.waitUntilComplete();
  return {window,document:window.document,settle};
}
test('participant entry keeps the dossier route and links an amendment to its exact decision once',async t=>{
  const {document,window,settle}=await open(t);
  document.getElementById('participant-42').click();await settle();
  assert.equal(new URLSearchParams(window.location.search).get('view'),'legislation');
  assert.equal(new URLSearchParams(window.location.search).get('pl-mode'),'dossier');
  assert.equal(new URLSearchParams(window.location.search).get('person'),'42');
  assert.equal(document.querySelector('h1').textContent,'A dossier');
  assert.equal(document.querySelectorAll('#decision-decision-1').length,1);
  assert.equal(document.querySelectorAll('.vote-table').length,0,'the same ballot is not repeated as an unrelated vote');
  assert.match(document.querySelector('.decision').textContent,/Stage not recorded/);
  assert.match(document.querySelector('.decision').textContent,/Recorded positionForParliament’s outcomeAdopted/);
  assert.match(document.getElementById('amendment-1').textContent,/Tabled 8 Sept 2026; DOCX dated 9 Sept 2026/);
});
test('participant names retain their profile destination while the secondary link selects a dossier scope',async t=>{
  const {document}=await open(t);
  const name=new URL(document.querySelector('.participant .name').href);
  const work=new URL(document.querySelector('.participant .work-link').href);
  assert.equal(name.searchParams.get('member'),'42');assert.equal(name.searchParams.get('module'),'profile');
  assert.equal(work.searchParams.get('person'),'42');assert.equal(work.searchParams.get('pl-mode'),'dossier');
  assert.match(document.querySelector('.route-map').textContent,/Plenary agenda › 15 September 2026/);
});
test('Back restores profile category, page offset and keyboard focus after filtering the person view',async t=>{
  const query='?member=42&dossier-id=2025-0001&module=activities&activity-category=amendment&activity-offset=10';
  const {window,document,settle}=await open(t,query);
  const entry=document.querySelector('.work-link');entry.focus();const id=entry.id;entry.click();await settle();
  document.querySelector('[data-filter="vote"]').click();await settle();
  assert.equal(window.history.state.from,query);
  document.getElementById('back-entry').click();await settle();
  assert.equal(window.location.search,query);assert.equal(document.activeElement.id,id);
  assert.equal(document.querySelector('#category option[selected]').getAttribute('value'),'amendment');
});
test('following stays on the canonical dossier when switching people',async t=>{
  const {document,settle}=await open(t,'?view=legislation&pl-mode=dossier&dossier-ref=2025/0001(COD)&person=42');
  document.getElementById('follow').click();
  const select=document.getElementById('example');select.value='2025-0001:43';select.dispatchEvent(new document.defaultView.Event('change'));await settle();
  assert.equal(document.getElementById('follow').getAttribute('aria-pressed'),'true');
  assert.match(document.querySelector('.person-chip').textContent,/Person Two/);
  assert.match(document.querySelector('.vote-table').textContent,/Unavailable/);
  assert.doesNotMatch(document.querySelector('.vote-table').textContent,/Not recorded/);
});
test('sparse categories are unavailable rather than a claim of zero personal work',async t=>{
  const {document}=await open(t,'?view=legislation&pl-mode=dossier&dossier-ref=2025/0001(COD)&person=43&show=amendment');
  assert.match(document.querySelector('[data-filter="amendment"]').textContent,/—/);
  assert.match(document.querySelector('.empty').textContent,/No amendments linked to this person in the available records/);
});
test('an unknown exact person or dossier never silently opens another member',async t=>{
  for(const query of ['?view=legislation&pl-mode=dossier&dossier-ref=2025/0001(COD)&person=999','?view=legislation&pl-mode=dossier&dossier-ref=2025/9999(COD)&person=42']){
    const {document}=await open(t,query);
    assert.equal(document.querySelector('h1').textContent,'Example unavailable');
    assert.equal(document.querySelectorAll('.person-chip').length,0);
  }
});
test('public labels remain escaped in the self-contained page',async t=>{
  const data=sample();data.examples[0].person.name='<img src=x onerror="window.injected=true">';
  const {document,window}=await open(t,'',data);
  assert.match(document.querySelector('.participant .name').textContent,/<img/);
  assert.equal(document.querySelectorAll('.participant img').length,0);assert.equal(window.injected,undefined);
});
test('the inline embedded view supports the same scope and Back without an HTTP URL',async t=>{
  const {document,settle}=await open(t,'',sample(),'about:blank');
  const entry=document.getElementById('participant-42');entry.focus();entry.click();await settle();
  assert.match(document.querySelector('.person-chip').textContent,/Person One/);
  document.getElementById('back-entry').click();await settle();
  assert.equal(document.querySelector('h1').textContent,'Plenary agenda');assert.equal(document.activeElement.id,'participant-42');
});
