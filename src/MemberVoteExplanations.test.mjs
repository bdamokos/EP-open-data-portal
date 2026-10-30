import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const sitting='MTG-PL-2026-03-26',decision=sitting+'-DEC-189210',speech=sitting+'-OTH-2017069542706',subject=sitting+'-VOT-ITM-987011',snapshot='a'.repeat(64);
function result(patch={}) {
  const contribution={id:speech,kind:'oral',matchScope:'subject',subjectId:subject,presentationAnchorDecisionId:decision,parentId:sitting+'-PVCRE-ITM-9-3',documentIds:['A-10-2026-0045'],agendaItemId:sitting+'-OJ-ITM-V-46',
    speech:{id:speech,date:'2026-03-26',kind:'PLENARY_DEBATE_SPEECH',start:'2026-03-26T11:47:51+01:00',end:'2026-03-26T11:49:14+01:00',websiteUrl:'https://www.europarl.europa.eu/doceo/document/CRE-10-2026-03-26-INT-2017069542706_RO.html'},classification:{basis:'speech-header-and-explanation-chapter',sources:[]},sources:[]};
  return {version:2,memberId:'197655',decisionId:decision,sittingId:sitting,snapshotId:snapshot,subjectId:subject,matchScope:'subject',presentationAnchorDecisionId:decision,written:{status:'unsupported',count:null},items:[contribution],coverage:{status:'searched',searchComplete:true,gaps:[]},...patch};
}
async function mount(t,{response=result(),handler}={}) {
  const window=new Window({url:'http://localhost/'});
  class ReaderDOMParser extends window.DOMParser {
    parseFromString(source,type) {const doc=super.parseFromString(source,type);doc.getElementsByTagNameNS=(_namespace,name)=>doc.getElementsByTagName(name);return doc;}
  }
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,DOMParser:ReaderDOMParser,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let load,root;const calls=[],selected=[];
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url:String(url),signal:options?.signal});const custom=await handler?.(String(url),options);if(custom)return custom;
    if(String(url).includes('member-vote-explanations/'))return Response.json(response);
    if(String(url).includes('speech-transcript/'))return Response.json({id:speech,available:true,metadata:result().items[0].speech,xml:'<oralStatements><speech><p>Published <inline name="i">explanation</inline>.</p></speech></oralStatements>',textLanguage:'fr',translationType:'machine',availableTextLanguages:['en','fr']});
    if(String(url).includes('speech-media/'))return Response.json({available:false,status:'unavailable',reason:'Recording unavailable.'});
    assert.fail('Unexpected read '+url);
  });
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {MemberVoteExplanations}=await load('/src/MemberVoteExplanations.tsx');
  const {createRoot}=await import('react-dom/client');const container=window.document.createElement('div');window.document.body.append(container);root=createRoot(container);
  let props={vote:{id:decision,sittingId:sitting,subjectId:subject},data:{snapshotId:snapshot,period:{kind:'sitting'}},memberId:'197655',language:'en',onDecision:id=>selected.push(id)};
  const render=()=>root.render(createElement(MemberVoteExplanations,{...props,key:props.vote.id+':'+props.memberId+':'+props.language}));
  await act(async()=>render());
  return {container,calls,selected,async update(patch){props={...props,...patch};await act(async()=>render());},async click(label){const button=[...container.querySelectorAll('button')].find(button=>button.textContent.replace(/^[▸▾]\s*/, '').trim()===label);assert(button,label);await act(async()=>button.click());}};
}

test('a final vote loads metadata first, then reads the explanation and video independently',async t=>{
  const view=await mount(t);
  assert.match(view.container.textContent,/Read oral explanation of vote/);assert.equal(view.calls.length,1);
  assert.equal(view.calls.some(call=>call.url.includes('speech-transcript/')),false);
  await view.click('Read oral explanation of vote');
  assert.equal(view.container.querySelector('i')?.textContent,'explanation',view.container.innerHTML);
  assert.match(view.container.textContent,/English unavailable · showing French/);assert.match(view.container.textContent,/Machine translation/);
  assert.equal(view.calls.some(call=>call.url.includes('speech-media/')),false);
  await view.click('Video');assert(view.calls.some(call=>call.url.includes('speech-media/')));
  assert.match(view.container.textContent,/Recording unavailable/);
  await view.click('Close oral explanation');assert.equal(view.container.querySelector('[aria-label="Speech video"]'),null);
});

test('other decisions show a subject explanation with a final-vote link, never an amendment explanation claim',async t=>{
  const other=sitting+'-DEC-189209',response=result({decisionId:other});
  const view=await mount(t,{response,handler:url=>url.includes('member-vote-explanations/')?Response.json({...response,decisionId:new URL(url,'http://localhost').searchParams.get('decision')}):null});
  await view.update({vote:{id:other,sittingId:sitting,subjectId:subject}});
  assert.match(view.container.textContent,/Read oral explanation on the whole text/);
  assert.doesNotMatch(view.container.textContent,/Final vote/);
  await view.click('Read oral explanation on the whole text');
  await view.click('Final vote');assert.deepEqual(view.selected,[decision]);
});

for(const [name,response] of Object.entries({
  mismatched:result({memberId:'42'}),
  incomplete:result({items:[],coverage:{status:'partial',searchComplete:false,gaps:[{code:'speech-source-unavailable'}]}}),
  unavailable:result({items:[],coverage:{status:'unavailable',searchComplete:false,gaps:[{code:'odp_unavailable'}]}}),
  empty:result({items:[]}),
  structural:result({items:[],coverage:{status:'partial',searchComplete:false,gaps:[{code:'parent-read-limit'}]}}),
  malformed:result({items:[],coverage:{status:'partial',searchComplete:false,gaps:{code:'speech-source-unavailable'}}}),
}))test(name+' discovery shows no explanation message without a known match',async t=>{
  const view=await mount(t,{response});
  assert.equal(view.container.textContent,'');
  assert.equal(view.container.querySelectorAll('button,p').length,0);
});

test('a failed discovery request stays quiet',async t=>{
  const view=await mount(t,{handler:url=>url.includes('member-vote-explanations/')?new Response('',{status:503}):null});
  assert.equal(view.container.textContent,'');
});

test('a known explanation keeps its transcript failure and retry',async t=>{
  let attempts=0;
  const view=await mount(t,{handler:url=>url.includes('speech-transcript/')&&++attempts===1?new Response('',{status:503}):null});
  await view.click('Read oral explanation of vote');
  assert.match(view.container.textContent,/Transcript unavailable/);
  await view.click('Retry transcript');
  assert.match(view.container.textContent,/Published explanation/);
});

test('multiple disclosures have unique mounted targets and keep external attribution out of the reader',async t=>{
  const response=result();response.items.push({...response.items[0],id:sitting+'-OTH-999',speech:{...response.items[0].speech,id:sitting+'-OTH-999'}});
  const view=await mount(t,{response,handler:url=>url.includes('speech-transcript/'+sitting+'-OTH-999')?Response.json({id:sitting+'-OTH-999',available:true,metadata:response.items[1].speech,xml:'<oralStatements><speech><p>Another explanation.</p></speech></oralStatements>',textLanguage:'en',availableTextLanguages:['en']}):null});
  const toggles=()=>[...view.container.querySelectorAll('.vote-explanation-toggle')];
  assert(toggles().every(button=>!button.hasAttribute('aria-controls')));
  await act(async()=>toggles()[0].click());
  const first=toggles()[0].getAttribute('aria-controls');assert(first);assert(view.container.querySelector('[id="'+first+'"]'));
  await act(async()=>toggles()[1].click());
  const second=toggles()[1].getAttribute('aria-controls');assert(second);assert.notEqual(first,second);
  assert.equal(toggles()[0].hasAttribute('aria-controls'),false);
  assert.equal(view.container.querySelector('[id="'+first+'"]'),null);
  assert(view.container.querySelector('[id="'+second+'"]'));
  assert.equal(view.container.querySelectorAll('a,h3,section:not([hidden])').length,0);
  assert.doesNotMatch(view.container.textContent,/Written explanations|Member’s page|Source ↗/);
  await act(async()=>toggles()[1].click());assert.equal(view.container.querySelectorAll('[aria-controls]').length,0);
});

test('known matches remain readable without unrelated search warnings',async t=>{
  const view=await mount(t,{response:result({coverage:{status:'partial',searchComplete:false,gaps:[{code:'parent-source-stale'}]}})});
  assert.match(view.container.textContent,/Read oral explanation of vote/);
  assert.doesNotMatch(view.container.textContent,/Search incomplete/);
  assert.equal([...view.container.querySelectorAll('button')].filter(button=>button.textContent==='Retry').length,0);
});
