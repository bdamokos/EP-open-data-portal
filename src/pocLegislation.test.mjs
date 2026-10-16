import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const people=Array.from({length:8},(_,i)=>({id:String(i+1),name:'Contributor '+(i+1),currentMep:false}));
const stats={uniquePeople:8,uniqueCurrentMeps:0,peopleOutsideCurrentRoster:8,denominator:0,referenceDate:'2026-10-07',dimensions:{country:[],group:[],gender:[],age:[]}};
const votes=['final-text','amendment','procedural'].map((scope,i)=>({id:'test-'+scope,date:'2026-10-07',scope,titles:{en:scope},subjects:{en:scope},outcome:'ADOPTED',aggregateTotals:{for:12-i,against:3,abstaining:1},namedVotersAvailable:false,intendedCorrections:{for:[],against:[],abstaining:[]}}));
const topic={id:'test-topic',title:'Test agenda item',date:'2026-10-07',kind:'PLENARY_VOTE',documentIds:['A-10-2026-0237']};
function legislation(params) {
  return {view:'legislation',sitting:{id:'MTG-PL-2026-10-07',phase:'past',date:'2026-10-07'},sittings:[{id:'MTG-PL-2026-10-07',phase:'past',date:'2026-10-07'}],topics:[topic],coverage:{agendaError:null},detail:params.has('topic')?{
    ...topic,phase:'past',procedures:[{id:'2025-2117',reference:'2025/2117(INI)'}],committeeWork:[],roles:people.map(person=>({...person,role:'RAPPORTEUR'})),people,stats,
    speeches:people.slice(0,2).map(person=>({sourceId:'test-speech-'+person.id,people:[person],kind:'PLENARY_DEBATE_WRITTEN_STATEMENT'})),
    votes:votes.map(vote=>({...vote,title:vote.titles.en,subject:vote.subjects.en})),selectedVote:votes.find(vote=>vote.id===params.get('vote'))||votes[0],
    voteCoverage:{truncated:false},coverage:{roleRowsTruncated:false,gaps:[],speechAssociations:{sources:[],truncated:false}}
  }:null};
}
const summary={reference:'2025/2117(INI)',language:'en',summaries:[{id:'test-summary',stage:'parliament-decision',date:'2026-10-07'}],summary:{id:'test-summary',stage:'parliament-decision',date:'2026-10-07',blocks:[1,2,3].map(n=>({kind:'paragraph',text:'Summary paragraph '+n})),source:{url:'https://example.test/summary'}},topics:[],subjects:[]};

test('vote changes preserve agenda readers and expansion through loading, failure, retry and history',async t=>{
  const window=new Window({url:'http://localhost/?view=legislation&pl-sitting=MTG-PL-2026-10-07&agenda-topic=test-topic'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,innerWidth:1440,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const pending=[],calls=[];
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>{root.unmount();for(const request of pending.splice(0))request.resolve(Response.json(legislation(request.params)));});if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href),params=url.searchParams;calls.push(url);
    if(url.pathname.endsWith('/insights/legislation')) {
      if(params.has('vote'))return new Promise(resolve=>pending.push({params,resolve}));
      return Response.json(legislation(params));
    }
    if(url.pathname.endsWith('/insights/procedure-context'))return Response.json(summary);
    if(url.pathname.includes('/document/'))return Response.json({selectedDocumentId:topic.documentIds[0],files:[],answers:[],selectedText:{status:'available',paragraphs:['Document text'],textLanguage:params.get('lang'),availableTextLanguages:['en','fr']}});
    if(url.pathname.includes('/speech/'))return Response.json({id:url.pathname.split('/').at(-1),xml:'<root><p>Speech text</p></root>',speakers:[],availableTextLanguages:['en'],textLanguage:'en'});
    throw new Error('Unexpected request: '+url);
  });
  // Use the existing TSX pipeline without a listening server or external data.
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocLegislation}=await vite.ssrLoadModule('/src/PocLegislation.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);
  root=createRoot(container);
  await act(async()=>root.render(createElement(PocLegislation,{language:'en',onBack(){}})));
  const find=selector=>{const node=container.querySelector(selector);assert(node,'Missing '+selector);return node;};
  const button=text=>{const node=[...container.querySelectorAll('button')].find(node=>node.textContent===text);assert(node,'Missing '+text);return node;};
  const click=async text=>act(async()=>button(text).click());
  const change=async(selector,value)=>act(async()=>{const node=find(selector);node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const shown=()=>find('.insight-vote-detail h3').textContent;
  const voteSection=()=>find('.insight-vote-select').closest('section');
  assert.equal(shown(),'final-text');
  await click('Continue reading');await click('All 8 people');await click('Read '+topic.documentIds[0]);
  await change('.insight-speech-select select','test-speech-2');
  await change('select[aria-label="Document language"]','fr');
  find('.insight-inline-reader[id] details').open=true;
  const nodes=['.insight-topic-detail h2','.insight-procedure-context','.insight-speech-panel','.insight-inline-reader[id]','.insight-participants'].map(selector=>[selector,find(selector)]);
  function preserved() {
    for(const [selector,node] of nodes){assert(node.isConnected,selector+' unmounted');assert.equal(find(selector),node);}
    assert.equal(button('Show less').getAttribute('aria-expanded'),'true');
    assert.equal(find('.insight-participants').querySelectorAll('article').length,8);
    assert.equal(find('.insight-speech-select select').value,'test-speech-2');
    assert.equal(find('select[aria-label="Document language"]').value,'fr');
    assert(find('.insight-inline-reader[id] details').open);
  }
  async function respond(status=200) {
    assert.equal(pending.length,1);const request=pending.shift();
    await act(async()=>request.resolve(Response.json(status===200?legislation(request.params):{error:{message:'Vote unavailable'}},{status})));
  }
  const before=calls.length;
  await change('.insight-vote-select select','test-amendment');
  assert.equal(voteSection().getAttribute('aria-busy'),'true');preserved();
  assert.equal(container.querySelector('.insight-vote-detail'),null,'old totals must not appear under a new selection');
  await respond();assert.equal(shown(),'amendment');preserved();
  assert.equal(calls.length,before+1,'only the vote request should run');
  assert.equal(window.location.search.includes('agenda-vote=test-amendment'),true);
  await change('.insight-vote-select select','test-procedural');await respond(503);
  assert(voteSection().querySelector('[role="alert"]'));preserved();
  await click('Reload');assert.equal(voteSection().getAttribute('aria-busy'),'true');preserved();
  await respond();assert.equal(shown(),'procedural');preserved();
  async function travel(direction) {
    await act(async()=>{const popped=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));window.history[direction]();await popped;});
    preserved();assert.equal(pending.length,0,'history should reuse the saved vote');
  }
  await travel('back');assert.equal(shown(),'amendment');
  await travel('back');assert.equal(shown(),'final-text');
  await travel('forward');assert.equal(shown(),'amendment');
});
