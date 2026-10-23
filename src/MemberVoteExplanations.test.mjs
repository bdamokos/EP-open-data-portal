import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const sitting='MTG-PL-2026-03-26',decision=sitting+'-DEC-189210',speech=sitting+'-OTH-2017069542706',subject=sitting+'-VOT-ITM-987011',snapshot='a'.repeat(64);
function result(patch={}) {
  const contribution={id:speech,kind:'oral',matchScope:'subject',subjectId:subject,presentationAnchorDecisionId:decision,parentId:sitting+'-PVCRE-ITM-9-3',documentIds:['A-10-2026-0045'],agendaItemId:sitting+'-OJ-ITM-V-46',
    speech:{id:speech,date:'2026-03-26',kind:'PLENARY_DEBATE_SPEECH',start:'2026-03-26T11:47:51+01:00',end:'2026-03-26T11:49:14+01:00',websiteUrl:'https://www.europarl.europa.eu/doceo/document/CRE-10-2026-03-26-INT-2017069542706_RO.html'},classification:{basis:'speech-header-and-explanation-chapter',sources:[]},sources:[]};
  return {version:1,memberId:'197655',decisionId:decision,sittingId:sitting,snapshotId:snapshot,subjectId:subject,matchScope:'subject',presentationAnchorDecisionId:decision,written:{status:'unsupported',count:null},items:[contribution],coverage:{status:'searched',searchComplete:true,gaps:[]},...patch};
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
  return {container,calls,selected,async update(patch){props={...props,...patch};await act(async()=>render());},async click(label){const button=[...container.querySelectorAll('button')].find(button=>button.textContent.trim()===label);assert(button,label);await act(async()=>button.click());}};
}

test('a final vote loads metadata first, then reads the explanation and video independently',async t=>{
  const view=await mount(t);
  assert.match(view.container.textContent,/Explanation of vote/);assert.equal(view.calls.length,1);
  assert.equal(view.calls.some(call=>call.url.includes('speech-transcript/')),false);
  await view.click('Read explanation');
  assert.equal(view.container.querySelector('i')?.textContent,'explanation',view.container.innerHTML);
  assert.match(view.container.textContent,/English unavailable · showing French/);assert.match(view.container.textContent,/Machine translation/);
  assert.equal(view.calls.some(call=>call.url.includes('speech-media/')),false);
  await view.click('Video');assert(view.calls.some(call=>call.url.includes('speech-media/')));
  assert.match(view.container.textContent,/Recording unavailable/);
  await view.click('Close explanation');assert.equal(view.container.querySelector('[aria-label="Speech video"]'),null);
});

test('other decisions show a subject explanation with a final-vote link, never an amendment explanation claim',async t=>{
  const other=sitting+'-DEC-189209',response=result({decisionId:other});
  const view=await mount(t,{response,handler:url=>url.includes('member-vote-explanations/')?Response.json({...response,decisionId:new URL(url,'http://localhost').searchParams.get('decision')}):null});
  await view.update({vote:{id:other,sittingId:sitting,subjectId:subject}});
  assert.match(view.container.textContent,/Explanation about this text/);assert.match(view.container.textContent,/About the text as a whole/);
  await view.click('View final vote');assert.deepEqual(view.selected,[decision]);
});

test('failed and mismatched responses preserve the vote and cannot supply stale attachments',async t=>{
  const view=await mount(t,{response:result({memberId:'42'})});
  assert.match(view.container.textContent,/Explanations unavailable/);assert.doesNotMatch(view.container.textContent,/Read explanation|No matching/);
  assert(view.container.querySelector('button')?.textContent.includes('Retry'));
  await view.update({vote:{id:sitting+'-DEC-999',sittingId:sitting,subjectId:subject}});
  assert.doesNotMatch(view.container.textContent,/Read explanation/);
});

test('incomplete searches and written-source gaps are not presented as zero explanations',async t=>{
  const view=await mount(t,{response:result({items:[],coverage:{status:'partial',searchComplete:false,gaps:[{code:'source-unavailable'}]}})});
  assert.match(view.container.textContent,/could not be fully checked/);assert.match(view.container.textContent,/Written explanations are not available here/);
  assert.doesNotMatch(view.container.textContent,/No matching|0 explanations/);
  assert([...view.container.querySelectorAll('button')].some(button=>button.textContent==='Retry explanations'));
  assert.match(view.container.querySelector('a').href,/\/197655\/NAME\/other-activities\/written-explanations$/);
});
