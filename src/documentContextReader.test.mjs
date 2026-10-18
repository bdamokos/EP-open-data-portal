import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement as el,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const report='A-10-2026-0237',amendment=report+'-AM-40',list=report+'-AM-037-046';
const original='B-10-2026-0424',adopted='TA-10-2026-0342',otherAdopted='TA-10-2026-0343';
const source='https://data.europarl.europa.eu/distribution/doc/'+report+'_en.docx';
const sourceDocument=(id,paragraphs=['Official title.','Source recital.','Exact target passage.'],extra={})=>({
  id,titles:{en:'***II Official source title'},date:'2026-10-08',kind:'REPORT',roles:[],files:[],answers:[],selectedDocumentId:id,
  selectedText:{status:'available',paragraphs,textLanguage:'en',requestedLanguage:'en',availableTextLanguages:['en'],translationType:'original',sourceFormat:'DOCX',sourceUrl:source,fetchedAt:'2026-10-17T18:00:00Z',stale:false,refreshInProgress:false,refreshError:null,reason:null,extraction:'official-docx-paragraphs',notesStatus:'extracted',notes:[],noteAnchors:[],documentLinks:[],...extra},
});
const response=(id,doc=sourceDocument(id),extra={})=>({version:1,documentId:id,requestedLanguage:'en',document:doc,related:{status:'not-requested',items:[],gaps:[]},amendment:null,target:{status:'not-requested',paragraphs:[],basis:null,relation:null,quoteMatches:null,reason:null},sources:[],...extra});
const target={status:'found',paragraphs:[2],basis:'published-reference',relation:'at',quoteMatches:false,reason:null};
const amendmentSource={id:amendment,status:'available',basis:'index',variants:[{listId:list}],gaps:[]};
const choice=(id,to=original)=>({id,titles:{en:'***I Exact adopted resolution '+id.slice(-4)},date:'2026-10-08',kind:'TEXT_ADOPTED',roles:[],files:[],answers:[],relationship:{from:id,field:'adopts',to},source:{}});

async function harness(t,respond) {
  const window=new Window({url:'http://localhost/'}),requests=[],scrolls=[];
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,requestAnimationFrame:callback=>setTimeout(callback,0),cancelAnimationFrame:clearTimeout,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(window.HTMLElement.prototype,'scrollIntoView',function(options){scrolls.push({element:this,options});});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href),route=url.pathname.split('/api/')[1];
    assert(route,'Only mocked application routes are allowed');requests.push(route+url.search);
    if(route==='references')return Response.json({references:[]});
    const value=await respond(route,url.searchParams);assert.notEqual(value,undefined,'Unexpected request: '+route+url.search);
    return value instanceof Response?value:Response.json(value);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {DocumentContextReader}=await vite.ssrLoadModule('/src/DocumentContextReader.tsx');
  const {createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const settle=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,15)));
  const render=async(props,wait=true)=>{await act(async()=>root.render(el(DocumentContextReader,props)));if(wait)await settle();};
  const click=async element=>{assert(element,'Missing control');await act(async()=>element.click());await settle();};
  const change=async(element,value)=>{assert(element,'Missing selector');await act(async()=>{element.value=value;element.dispatchEvent(new window.Event('change',{bubbles:true}));});await settle();};
  return {window,container,requests,scrolls,render,click,change,settle};
}

test('context preserves exact source indices, inline text, note offsets and target focus',async t=>{
  const paragraph='Before\uFFFC after note.';
  const h=await harness(t,()=>response(report,sourceDocument(report,['***II Source heading.','Context before.',paragraph],{
    documentObjects:[{paragraph:2,offset:6,path:'document/p/2/r/1/drawing',kind:'drawing',status:'unresolved'}],
    notes:[{id:'1',label:'1',text:'Exact source note.',links:[]}],noteAnchors:[{paragraph:2,offset:7,note:'1',label:'1'}],
  }),{target,amendment:amendmentSource}));
  let backs=0;await h.render({request:{documentId:report,amendmentId:amendment,listId:list,view:'document',onBack:()=>backs++},language:'en'});
  assert.deepEqual(h.requests,[`document-context/${report}?lang=en&amendment=${amendment}&list=${list}`]);
  const chosen=h.container.querySelector('[data-context-target="true"]');assert.equal(chosen.dataset.sourceParagraph,'2');
  assert.equal(chosen.childNodes[0].textContent,'Before');
  const image=chosen.querySelector('a.document-context-object');assert.equal(image.textContent,'Image in original ↗');assert.equal(image.href,source);
  assert(chosen.textContent.includes(' after note.'));assert.equal(chosen.querySelector('sup').textContent,'1');
  assert.equal(chosen.childNodes[2].nodeName,'SUP','the note remains immediately after the unresolved object in source offsets');
  assert.equal(h.container.querySelector('h3').textContent,'Official source title');
  assert.equal(h.container.querySelector('[data-source-paragraph="0"]').textContent,'***II Source heading.','only the display title loses procedure markers');
  assert(h.container.textContent.includes('The published text differs from the amendment’s quotation.'));
  assert(h.container.textContent.includes('Exact source note.'));
  await h.click([...h.container.querySelectorAll('button')].find(button=>button.textContent==='Go to passage'));
  assert.equal(h.scrolls.at(-1).element,chosen);assert.equal(h.window.document.activeElement,chosen);
  await h.click(h.container.querySelector('.document-context-back'));assert.equal(backs,1);
});

test('missing target leaves the full official document readable with plain copy',async t=>{
  const h=await harness(t,()=>response(report,sourceDocument(report,['Context stays visible.','Exact <angle> text.']),{target:{...target,status:'unavailable',paragraphs:[],reason:'source-boundary-not-matched'}}));
  await h.render({request:{documentId:report,amendmentId:amendment,view:'document',onBack:()=>{}},language:'en'});
  assert(h.container.textContent.includes('Passage not found. The full document is below.'));
  assert(h.container.textContent.includes('Exact <angle> text.'));
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0);
  assert(!h.container.textContent.includes('source-boundary-not-matched'));
  assert(!h.container.textContent.includes('target could not be matched'));
  assert.equal(h.container.querySelectorAll('.document-context-source a').length,1);
});

test('fallback language is visible and choosing a language changes only the exact requested source',async t=>{
  const h=await harness(t,(_route,params)=>{
    const language=params.get('lang');
    const doc=sourceDocument(report,[language==='fr'?'Paragraphe français.':'English source paragraph.'],{textLanguage:language==='hu'?'en':language,requestedLanguage:language,availableTextLanguages:['en','fr']});
    doc.titles={fr:'***III Titre français',en:'***I Official title'};
    return response(report,doc,{requestedLanguage:language});
  });
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,view:'document',onBack:()=>{}},language:'hu'});
  assert(h.container.textContent.includes('Hungarian unavailable · showing English.'));
  assert.equal(h.container.querySelector('.document-context-text').lang,'en');
  await h.change(h.container.querySelector('select'),'fr');
  assert.equal(h.container.querySelector('.document-context-text').lang,'fr');
  assert.equal(h.container.querySelector('h3').lang,'fr');
  assert.equal(h.container.querySelector('h3').textContent,'Titre français');
  assert(h.requests.includes(`document-context/${report}?lang=fr&amendment=${amendment}&list=${list}`));
});

test('changing request identity clears prior text while the new request is pending',async t=>{
  let finish;const next='A-10-2026-0238';
  const h=await harness(t,route=>route.endsWith(report)?response(report,sourceDocument(report,['First document only.'])):new Promise(resolve=>finish=()=>resolve(response(next,sourceDocument(next,['Second document only.'])))));
  const request={documentId:report,view:'document',onBack:()=>{}};
  await h.render({request,language:'en'});assert(h.container.textContent.includes('First document only.'));
  await h.render({request:{...request,documentId:next},language:'en'},false);
  assert(!h.container.textContent.includes('First document only.'));assert(h.container.textContent.includes('Loading document…'));
  await act(async()=>finish());await h.settle();assert(h.container.textContent.includes('Second document only.'));
});

test('a mismatched returned document or language is never displayed',async t=>{
  const h=await harness(t,()=>response(report,sourceDocument(original,['Wrong document.']),{requestedLanguage:'fr'}));
  await h.render({request:{documentId:report,view:'document',onBack:()=>{}},language:'en'});
  assert(!h.container.textContent.includes('Wrong document.'));assert(h.container.textContent.includes('Document unavailable here.'));
});

test('adopted texts require an exact choice and load their own body without an amendment anchor',async t=>{
  const h=await harness(t,(route,params)=>params.has('adopted')?response(original,null,{related:{status:'partial',items:[choice(adopted),choice(otherAdopted),choice('TA-10-2026-0999','B-10-2026-9999')],gaps:['candidate-unavailable']}}):response(route.slice('document-context/'.length),sourceDocument(adopted,['Adopted wording only.'])));
  await h.render({request:{documentId:original,amendmentId:original+'-AM-13',listId:original+'-AM-013-020',view:'adopted',onBack:()=>{}},language:'en'});
  assert.deepEqual(h.requests,[`document-context/${original}?lang=en&adopted=1`]);
  const choices=h.container.querySelectorAll('.document-context-choices button');assert.equal(choices.length,2);
  assert(h.container.textContent.includes('Some linked texts could not be loaded.'));
  await h.click(choices[0]);assert(h.container.textContent.includes('Adopted wording only.'));
  assert(h.requests.includes(`document-context/${adopted}?lang=en`));
  assert(!h.requests.some(route=>route.includes(adopted)&&route.includes('amendment=')));
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0);
  await h.click(h.container.querySelector('.document-context-choices-back'));
  assert.equal(h.container.querySelectorAll('.document-context-choices button').length,2);
  assert(!h.container.textContent.includes('Adopted wording only.'));
});

test('controlled adopted selection preserves unavailable identity and never substitutes another text',async t=>{
  const h=await harness(t,(_route,params)=>params.has('adopted')?response(original,null,{related:{status:'available',items:[choice(adopted)],gaps:[]}}):assert.fail('An unverified selected document must not be fetched'));
  const changes=[];await h.render({request:{documentId:original,view:'adopted',onBack:()=>{}},language:'en',selectedDocumentId:otherAdopted,onSelectedDocumentIdChange:id=>changes.push(id)});
  assert(h.container.textContent.includes('This adopted text is unavailable here.'));
  assert.deepEqual(h.requests,[`document-context/${original}?lang=en&adopted=1`]);
  await h.click(h.container.querySelector('.document-context-choices-back'));assert.deepEqual(changes,[null]);
  assert(h.container.textContent.includes('This adopted text is unavailable here.'),'the controlled owner must restore the requested choices state');
});

test('a local reader failure has an explicit retry and does not claim a parliamentary absence',async t=>{
  let calls=0;const h=await harness(t,()=>++calls===1?Response.json({error:{message:'This data request took too long.'}},{status:503}):response(report,sourceDocument(report,['Readable after retry.'])));
  await h.render({request:{documentId:report,view:'document',onBack:()=>{}},language:'en'});
  assert(h.container.textContent.includes('Document could not be loaded.'));
  assert(!h.container.textContent.includes('Document unavailable here.'));
  await h.click([...h.container.querySelectorAll('button')].find(button=>button.textContent==='Try again'));
  assert(h.container.textContent.includes('Readable after retry.'));assert.equal(calls,2);
});

test('an extraction failure returned with HTTP 200 offers retry and never claims saved text',async t=>{
  let calls=0;
  const h=await harness(t,()=>++calls===1?response(report,sourceDocument(report,[],{
    status:'error',textLanguage:null,refreshError:'official-document-download-failed',reason:'source-error',
  })):response(report,sourceDocument(report,['Official text recovered after retry.'])));
  await h.render({request:{documentId:report,view:'document',onBack:()=>{}},language:'en'});
  const alert=h.container.querySelector('[role="alert"]');
  assert(alert?.textContent.includes('Document text could not be loaded.'));
  assert(!h.container.textContent.includes('Showing saved text.'));
  assert(!h.container.textContent.includes('Document text unavailable here.'));
  assert(!h.container.textContent.includes('official-document-download-failed'));
  assert.equal(h.container.querySelector('.document-context-text'),null);
  await h.click([...alert.querySelectorAll('button')].find(button=>button.textContent==='Try again'));
  assert.equal(calls,2);
  assert.deepEqual(h.requests,[`document-context/${report}?lang=en`,`document-context/${report}?lang=en`]);
  assert(h.container.textContent.includes('Official text recovered after retry.'));
  assert.equal(h.container.querySelector('[role="alert"]'),null);
  assert(!h.container.textContent.includes('Showing saved text.'));
});

test('a background extraction failure keeps the readable saved body and qualifies it',async t=>{
  const h=await harness(t,()=>response(report,sourceDocument(report,['Exact saved source paragraph.'],{
    stale:true,refreshError:'official-document-download-failed',
    notes:[{id:'1',label:'1',text:'Saved source note.',links:[]}],
  })));
  await h.render({request:{documentId:report,view:'document',onBack:()=>{}},language:'en'});
  assert.equal(h.container.querySelector('[data-source-paragraph="0"]').textContent,'Exact saved source paragraph.');
  assert(h.container.textContent.includes('Saved source note.'));
  assert(h.container.textContent.includes('Couldn’t update the document. Showing saved text.'));
  assert(!h.container.textContent.includes('Document text could not be loaded.'));
  assert(!h.container.textContent.includes('Document text unavailable here.'));
  assert(!h.container.textContent.includes('official-document-download-failed'));
  assert(h.container.querySelector('button[aria-label="Find in document"]'));
});

test('source hyperlinks spanning an unresolved object keep both visible linked fragments',async t=>{
  const paragraph='Before\uFFFC after note.',href='https://example.org/exact-source-link';
  const h=await harness(t,()=>response(report,sourceDocument(report,[paragraph],{
    documentObjects:[{paragraph:0,offset:6,kind:'drawing',status:'unresolved'}],
    documentLinks:[{paragraph:0,start:0,end:paragraph.length,url:href}],
  })));
  await h.render({request:{documentId:report,view:'document',onBack:()=>{}},language:'en'});
  const fragments=h.container.querySelectorAll('.document-context-text a[href="'+href+'"]');
  assert.deepEqual([...fragments].map(link=>link.textContent),['Before',' after note.']);
  assert.equal(h.container.querySelector('.document-context-object').href,source);
});

test('an amendment or pinned list mismatch withholds target highlighting while keeping the body',async t=>{
  const h=await harness(t,()=>response(report,sourceDocument(report),{target,amendment:{...amendmentSource,id:report+'-AM-41'}}));
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,view:'document',onBack:()=>{}},language:'en'});
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0);
  assert(h.container.textContent.includes('Exact target passage.'));
  assert(h.container.textContent.includes('Passage not found. The full document is below.'));
});

test('a failed adopted lookup offers retry without claiming that the selected text is unavailable',async t=>{
  const h=await harness(t,()=>Response.json({error:{message:'This data request took too long.'}},{status:503}));
  await h.render({request:{documentId:original,view:'adopted',onBack:()=>{}},language:'en',selectedDocumentId:adopted});
  assert(h.container.textContent.includes('Linked texts could not be loaded.'));
  assert(!h.container.textContent.includes('This adopted text is unavailable here.'));
  assert.equal(h.container.querySelectorAll('.document-context-notice button').length,1);
});

test('references keep the interface language when the source text language changes',async t=>{
  const h=await harness(t,(_route,params)=>response(report,sourceDocument(report,['Regulation (EU) 2021/2116.'],{textLanguage:params.get('lang'),availableTextLanguages:['en','fr']}),{requestedLanguage:params.get('lang')}));
  await h.render({request:{documentId:report,view:'document',onBack:()=>{}},language:'en'});
  await h.change(h.container.querySelector('select'),'fr');
  assert.equal(h.container.querySelector('.document-context-text').lang,'fr');
  const lookups=h.requests.filter(route=>route.startsWith('references?'));
  assert(lookups.length>0);assert(lookups.every(route=>new URLSearchParams(route.split('?')[1]).get('lang')==='en'));
});
