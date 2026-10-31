import {wordingText} from './test-support/wordingText.mjs';
import {parseProposal,proposalCandidates} from '../server/proposal-structure.mjs';
import {resolveProposalPlacement} from '../server/proposal-placement.mjs';
import {parsePublicLegalXhtml} from '../server/public-legal-xhtml.mjs';
import {readFileSync} from 'node:fs';
import {proposalContextResponse} from './test-support/proposalContext.mjs';
import test from 'node:test';
import {API_VERSION} from '../server/api-version.mjs';
import assert from 'node:assert/strict';
import {createElement as el,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const report='A-10-2026-0237',amendment=report+'-AM-40',list=report+'-AM-037-046';
const original='B-10-2026-0424',adopted='TA-10-2026-0342',otherAdopted='TA-10-2026-0343';
const source='https://data.europarl.europa.eu/distribution/doc/'+report+'_en.docx';
const sourceDocument=(id,paragraphs=['Official title.','Source recital.','Exact target passage.'],extra={})=>({
  id,titles:{en:'***II Official source title'},date:'2026-10-08',kind:'REPORT',roles:[],files:[],answers:[],selectedDocumentId:id,
  selectedText:{status:'available',paragraphs,textLanguage:'en',requestedLanguage:'en',availableTextLanguages:['en'],translationType:'original',sourceFormat:'DOCX',sourceUrl:source,fetchedAt:'2026-10-17T18:00:00Z',stale:false,refreshInProgress:false,refreshError:null,reason:null,extraction:'official-docx-paragraphs',notesStatus:'extracted',notes:[],noteAnchors:[],documentLinks:[],...extra},
});
const response=(id,doc=sourceDocument(id),extra={})=>({version:4,documentId:id,requestedLanguage:'en',document:doc,related:{status:'not-requested',items:[],gaps:[]},amendment:null,target:{status:'not-requested',paragraphs:[],basis:null,relation:null,quoteMatches:null,reason:null},sources:[],...extra});
const target={status:'found',paragraphs:[2],basis:'published-reference',relation:'at',quoteMatches:false,reason:null};
const amendmentSource={id:amendment,status:'available',basis:'index',variants:[{listId:list}],gaps:[]};
const wordingVariant=(language,extra={})=>({listId:list,language,wordingStatus:'available',originalText:'Original wording.',proposedText:'Proposed wording.',...extra});
const pinnedEvidence=(wordingLanguage,extra={})=>({amendmentId:amendment,listId:list,wordingLanguage,wordingSource:null,referenceDecisions:[],...extra});
const choice=(id,to=original)=>({id,titles:{en:'***I Exact adopted resolution '+id.slice(-4)},date:'2026-10-08',kind:'TEXT_ADOPTED',roles:[],files:[],answers:[],relationship:{from:id,field:'adopts',to},source:{}});

test('embedded dossier readers can omit original-document links while preserving reproduced text',async t=>{
  let current=response(report);
  const h=await harness(t,()=>current);
  const request={documentId:report,view:'document',onBack:()=>{}};
  await h.render({request,language:'en',showOriginalLink:false});
  assert.match(h.container.textContent,/Exact target passage/);
  assert.equal(h.container.querySelector('.document-context-source a'),null);
  await h.render({request,language:'en'});
  assert(h.container.querySelector('.document-context-source a'),'other readers keep their existing source link');
  current=proposalContextResponse(report,amendment,list);
  await h.render({request:{...request,amendmentId:amendment,listId:list,wordingLanguage:'en'},language:'en',showOriginalLink:false});
  assert(h.container.querySelector('[data-proposal-item]'));
  assert.equal(h.container.querySelector('.document-context-source a,.proposal-context-summary a'),null);
});

test('document and legal-proposal context keep the justification with the selected amendment',async t=>{
  const text='Published rationale.\nAnother paragraph & <literal text>.';
  const legal=proposalContextResponse(report,amendment,list);
  legal.amendment.variants[0].justification=text;
  const ordinary=response(report,sourceDocument(report,[]),{amendment:{...amendmentSource,variants:[wordingVariant('en',{justification:text})]}});
  let current=ordinary;
  const h=await harness(t,()=>current);
  const request={documentId:report,amendmentId:amendment,listId:list,view:'document',onBack:()=>{}};
  await h.render({request,language:'en'});
  assert.equal(h.container.querySelector('.amendment-justification p').textContent,text);
  assert.equal(h.container.querySelector('.amendment-justification p').lang,'en');
  current=legal;
  await h.render({request:{...request,wordingLanguage:'en'},language:'en'});
  assert.equal(h.container.querySelectorAll('.amendment-justification').length,1);
  assert.equal(h.container.querySelector('.amendment-justification p').textContent,text);
  assert.equal(h.container.querySelector('.amendment-justification literal'),null);
  current=response(report,null,{requestedLanguage:'fr',requestedWordingLanguage:'fr',amendment:{...amendmentSource,status:'unavailable',variants:[wordingVariant('fr',{wordingStatus:'unavailable',originalText:null,proposedText:null,justification:'Motif lisible.'})]}});
  await h.render({request:{...request,wordingLanguage:'fr'},language:'en'});
  assert.equal(h.container.querySelector('.amendment-justification p').textContent,'Motif lisible.');
  assert.equal(h.container.querySelector('.amendment-justification p').lang,'fr');
  assert.equal(h.container.querySelector('[data-amendment-block]'),null);
});

for(const [textLanguage,status,hasBody] of [['en','available',true],['fr','available',true],[null,'unavailable',false],['en','error',false],['en','unavailable',false],['en','available',false]])test('a French scope note needs actual body text for a language mismatch: '+textLanguage+' / '+status+' / '+hasBody,async t=>{
  const note='(Ne concerne pas la version française.)',mismatch=textLanguage==='en'&&hasBody;
  const paragraphs=hasBody?['The published document stays intact.']:[];
  const doc=sourceDocument(report,paragraphs,{textLanguage,availableTextLanguages:['en','fr'],status});
  const value=response(report,doc,{requestedLanguage:'fr',requestedWordingLanguage:'fr',amendment:{...amendmentSource,variants:[wordingVariant('fr',{proposedText:note})]},
    target:{...target,status:'unavailable',paragraphs:[],evidence:pinnedEvidence('fr')},
    placement:{status:mismatch?'unresolved':'not-applicable',operation:null,reason:mismatch?'different_text_languages':'language_version_unaffected',evidence:[]}});
  const h=await harness(t,()=>value);
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'fr',view:'document',onBack:()=>{}},language:'en'});
  assert.equal(h.container.textContent.includes('No change in this language version.'),!mismatch);
  assert.equal(h.container.textContent.includes(note),!mismatch);
  assert.equal(h.container.querySelectorAll('[data-amendment-block]').length,mismatch?0:1);
  assert.equal(h.container.querySelectorAll('[data-context-target="true"]').length,0);
  if(hasBody)assert(h.container.textContent.includes(paragraphs[0]));
  if(mismatch)assert(h.container.textContent.includes('The document and amendment wording are in different languages.'));
  else assert(!h.container.textContent.includes('The document and amendment wording are in different languages.'));
});

test('mixed note and changed footnote wording stays separate from the intact document',async t=>{
  const example=JSON.parse(readFileSync(new URL('../server/fixtures/amendment-language-layouts.json',import.meta.url))).examples.find(row=>row.language==='sk'&&row.number===53);
  const doc=sourceDocument(report,['Original document body.'],{textLanguage:'sk',availableTextLanguages:['sk']});
  const value=response(report,doc,{requestedLanguage:'sk',requestedWordingLanguage:'sk',amendment:{...amendmentSource,variants:[wordingVariant('sk',{originalText:example.originalText,proposedText:example.proposedText})]},
    target:{...target,status:'unavailable',paragraphs:[],evidence:pinnedEvidence('sk')},placement:{status:'unresolved',operation:null,reason:'language_scope_mixed',evidence:[]}});
  const h=await harness(t,()=>value);
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'sk',view:'document',onBack:()=>{}},language:'en'});
  assert(h.container.textContent.includes('This comparison is shown separately from the document.'));
  assert(h.container.textContent.includes('Original document body.'));
  assert(!h.container.textContent.includes('No change in this language version.'));
  assert.equal(h.container.querySelector('ins, del'),null);assert.equal(h.container.querySelectorAll('[data-context-target="true"]').length,0);
  assert.equal(wordingText(h.container,'original'),example.originalText);assert.equal(wordingText(h.container,'proposed'),example.proposedText);
});

async function harness(t,respond,followups=()=>({status:'none-listed',items:[],gaps:[]})) {
  const window=new Window({url:'http://localhost/'}),requests=[],scrolls=[];
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,requestAnimationFrame:callback=>setTimeout(callback,0),cancelAnimationFrame:clearTimeout,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(window.HTMLElement.prototype,'scrollIntoView',function(options){scrolls.push({element:this,options});});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);assert.equal(url.searchParams.get('v'),String(API_VERSION));url.searchParams.delete('v');const route=url.pathname.split('/api/')[1];
    assert(route,'Only mocked application routes are allowed');requests.push(route+url.search);
    if(route==='references')return Response.json({references:[]});
    if(route.startsWith('commission-followups/')){const result=await followups(route,url.searchParams);return result instanceof Response?result:Response.json({documentId:route.slice('commission-followups/'.length),requestedLanguage:url.searchParams.get('lang'),...result});}
    const value=await respond(route,url.searchParams);assert.notEqual(value,undefined,'Unexpected request: '+route+url.search);
    return value instanceof Response?value:Response.json(value);
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {DocumentContextReader}=await loadModule('/src/DocumentContextReader.tsx');
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
  assert(h.container.textContent.includes('The passage this amendment changes could not be found.'));
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
  assert(h.container.textContent.includes('magyar unavailable · showing angol'));
  assert.equal(h.container.querySelector('.document-context-text').lang,'en');
  await h.change(h.container.querySelector('select'),'fr');
  assert.equal(h.container.querySelector('.document-context-text').lang,'fr');
  assert.equal(h.container.querySelector('h3').lang,'fr');
  assert.equal(h.container.querySelector('h3').textContent,'Titre français');
  assert(h.requests.includes(`document-context/${report}?lang=fr&amendment=${amendment}&list=${list}`));
});

test('a pinned wording language opens its matching body and stays pinned when the reader language changes',async t=>{
  const h=await harness(t,(_route,params)=>{
    const language=params.get('lang'),wordingLanguage=params.get('wording-lang');
    return response(report,sourceDocument(report,['Source heading.','Source context.','Exact target passage.'],{textLanguage:language,requestedLanguage:language,availableTextLanguages:['en','hu','fr']}),{
      requestedLanguage:language,requestedWordingLanguage:wordingLanguage,
      amendment:{...amendmentSource,variants:[wordingVariant('en'),wordingVariant('hu')]},
      target:{...target,quoteMatches:true,evidence:pinnedEvidence(wordingLanguage)},
    });
  });
  const request={documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'hu',view:'document',onBack:()=>{}};
  await h.render({request,language:'en'});
  assert.deepEqual(h.requests,[`document-context/${report}?lang=hu&amendment=${amendment}&list=${list}&wording-lang=hu`]);
  assert.equal(h.container.querySelector('.document-context-text').lang,'hu');
  assert.equal(h.container.querySelector('[data-context-target="true"]').dataset.sourceParagraph,'2');
  await h.change(h.container.querySelector('select'),'fr');
  assert(h.requests.includes(`document-context/${report}?lang=fr&amendment=${amendment}&list=${list}&wording-lang=hu`));
  assert.equal(h.container.querySelector('.document-context-text').lang,'fr');
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0,'a different body language cannot use the Hungarian quotation');
  assert(h.container.textContent.includes('The passage this amendment changes could not be found.'));
  await h.render({request:{...request,wordingLanguage:'en'},language:'en'});
  assert.equal(h.container.querySelector('.document-context-text').lang,'en','changing the wording pin starts a new reading session');
  assert(h.requests.includes(`document-context/${report}?lang=en&amendment=${amendment}&list=${list}&wording-lang=en`));
  assert.equal(h.container.querySelectorAll('[data-context-target="true"]').length,1);
});

test('a pinned available wording can anchor the body while other retained variants remain unavailable',async t=>{
  const h=await harness(t,()=>response(report,sourceDocument(report,undefined,{textLanguage:'hu',requestedLanguage:'hu'}),{
    requestedLanguage:'hu',requestedWordingLanguage:'hu',
    amendment:{...amendmentSource,status:'unavailable',variants:[wordingVariant('en',{wordingStatus:'unavailable',originalText:null,proposedText:null}),wordingVariant('hu')]},
    target:{...target,evidence:pinnedEvidence('hu')},
  }));
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'hu',view:'document',onBack:()=>{}},language:'en'});
  assert.equal(h.container.querySelectorAll('[data-context-target="true"]').length,1);
});

for(const [name,echo] of [['missing',undefined],['different','en'],['unknown',null]])test(`a pinned context response rejects the ${name} wording-selector echo`,async t=>{
  const h=await harness(t,()=>response(report,sourceDocument(report,undefined,{textLanguage:'hu',requestedLanguage:'hu'}),{
    requestedLanguage:'hu',...(echo===undefined?{}:{requestedWordingLanguage:echo}),
    amendment:{...amendmentSource,variants:[wordingVariant('hu')]},target:{...target,evidence:pinnedEvidence('hu')},
  }));
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'hu',view:'document',onBack:()=>{}},language:'en'});
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0);
  assert.equal(h.container.querySelector('.document-context-text'),null);
  assert(h.container.textContent.includes('Document unavailable here.'));
});

for(const [name,evidence] of [
  ['missing',undefined],['wrong amendment',pinnedEvidence('hu',{amendmentId:report+'-AM-41'})],
  ['wrong list',pinnedEvidence('hu',{listId:report+'-AM-047-056'})],['wrong language',pinnedEvidence('en')],
])test(`a pinned context with ${name} target evidence keeps the body without highlighting`,async t=>{
  const h=await harness(t,()=>response(report,sourceDocument(report,undefined,{textLanguage:'hu',requestedLanguage:'hu'}),{
    requestedLanguage:'hu',requestedWordingLanguage:'hu',amendment:{...amendmentSource,variants:[wordingVariant('hu')]},target:{...target,evidence},
  }));
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'hu',view:'document',onBack:()=>{}},language:'en'});
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0);
  assert(h.container.textContent.includes('Exact target passage.'));
});

test('an unknown wording pin stays unknown and cannot borrow an English quotation or reference',async t=>{
  const h=await harness(t,()=>response(report,sourceDocument(report),{
    requestedWordingLanguage:null,amendment:{...amendmentSource,variants:[wordingVariant(null),wordingVariant('en')]},
    target:{...target,basis:'published-reference',evidence:pinnedEvidence(null)},
  }));
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:null,view:'document',onBack:()=>{}},language:'en'});
  assert.deepEqual(h.requests,[`document-context/${report}?lang=en&amendment=${amendment}&list=${list}&wording-lang=unknown`]);
  assert.equal(h.container.querySelector('.document-context-text').lang,'en','the body can use the interface language without assigning it to the wording');
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0);
});

for(const [name,variants] of [
  ['duplicate same-language versions',[wordingVariant('hu'),wordingVariant('hu',{originalText:'Competing wording.'})]],
  ['unavailable pinned wording',[wordingVariant('hu',{wordingStatus:'unavailable',originalText:null,proposedText:null})]],
])test(`${name} cannot receive an automatic context target`,async t=>{
  const h=await harness(t,()=>response(report,sourceDocument(report,undefined,{textLanguage:'hu',requestedLanguage:'hu'}),{
    requestedLanguage:'hu',requestedWordingLanguage:'hu',amendment:{...amendmentSource,variants},target:{...target,evidence:pinnedEvidence('hu')},
  }));
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'hu',view:'document',onBack:()=>{}},language:'en'});
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0);
  assert(h.container.textContent.includes('Exact target passage.'));
});

test('changing request identity clears prior text while the new request is pending',async t=>{
  let finish;const next='A-10-2026-0238';
  const h=await harness(t,route=>route.endsWith(report)?response(report,sourceDocument(report,['First document only.'])):new Promise(resolve=>finish=()=>resolve(response(next,sourceDocument(next,['Second document only.'])))));
  const request={documentId:report,view:'document',onBack:()=>{}};
  await h.render({request,language:'en'});assert(h.container.textContent.includes('First document only.'));
  await h.render({request:{...request,documentId:next},language:'en'},false);
  assert(!h.container.textContent.includes('First document only.'));assert(h.container.textContent.includes('Loading document…'));
  assert.equal(h.container.querySelector('.document-context-document').getAttribute('data-context-pending'),'true');
  await act(async()=>finish());await h.settle();assert(h.container.textContent.includes('Second document only.'));
  assert.equal(h.container.querySelector('[data-context-pending]'),null);
});

test('an uncached document body stays pending until a terminal unavailable response',async t=>{
  let finish;
  const h=await harness(t,()=>new Promise(resolve=>finish=()=>resolve(response(report,sourceDocument(report,[],{status:'unavailable',textLanguage:null,reason:'no-file'})))));
  await h.render({request:{documentId:report,view:'document',onBack:()=>{}},language:'en'},false);
  assert.equal(h.container.querySelector('.document-context-document').getAttribute('data-context-pending'),'true');
  await act(async()=>finish());await h.settle();
  assert(h.container.textContent.includes('Document text unavailable here.'));
  assert.equal(h.container.querySelector('[data-context-pending]'),null);
});

for(const [name,data] of [
  ['returned document',response(report,sourceDocument(original,['Wrong document.']))],
  ['requested language',response(report,sourceDocument(report,['Wrong document.']),{requestedLanguage:'fr'})],
])test(`a mismatched ${name} is never displayed when the other identity matches`,async t=>{
  const h=await harness(t,()=>data);
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
  assert.deepEqual(h.requests.filter(route=>route.startsWith('commission-followups/')),[`commission-followups/${adopted}?lang=en`],'only the selected adopted text requests follow-ups');
  assert(!h.requests.some(route=>route.includes(adopted)&&route.includes('amendment=')));
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0);
  await h.click(h.container.querySelector('.document-context-choices-back'));
  assert.equal(h.container.querySelectorAll('.document-context-choices button').length,2);
  assert(!h.container.textContent.includes('Adopted wording only.'));
});

test('adopted choices stay pending until their uncached lookup finishes',async t=>{
  let finish;
  const h=await harness(t,()=>new Promise(resolve=>finish=()=>resolve(response(original,null,{related:{status:'available',items:[choice(adopted)],gaps:[]}}))));
  await h.render({request:{documentId:original,view:'adopted',onBack:()=>{}},language:'en'},false);
  assert.equal(h.container.querySelector('.document-context-reader').getAttribute('data-context-pending'),'true');
  await act(async()=>finish());await h.settle();
  assert.equal(h.container.querySelectorAll('.document-context-choices button').length,1);
  assert.equal(h.container.querySelector('[data-context-pending]'),null);
});

test('a selected adopted text stays pending through its relationship lookup and uncached body',async t=>{
  let finishRelated,finishBody;
  const h=await harness(t,(_route,params)=>params.has('adopted')?
    new Promise(resolve=>finishRelated=()=>resolve(response(original,null,{related:{status:'available',items:[choice(adopted)],gaps:[]}}))):
    new Promise(resolve=>finishBody=()=>resolve(response(adopted,sourceDocument(adopted,['Exact adopted body.'])))));
  await h.render({request:{documentId:original,view:'adopted',onBack:()=>{}},language:'en',selectedDocumentId:adopted},false);
  assert.equal(h.container.querySelector('.document-context-reader').getAttribute('data-context-pending'),'true');
  await act(async()=>finishRelated());await h.settle();
  assert.equal(h.container.querySelector('.document-context-reader').hasAttribute('data-context-pending'),false);
  assert.equal(h.container.querySelector('.document-context-document').getAttribute('data-context-pending'),'true');
  assert.deepEqual(h.requests,[`document-context/${original}?lang=en&adopted=1`,`document-context/${adopted}?lang=en`]);
  await act(async()=>finishBody());await h.settle();
  assert(h.container.textContent.includes('Exact adopted body.'));
  assert.equal(h.container.querySelector('[data-context-pending]'),null);
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
  assert.equal(h.container.querySelector('[data-context-pending]'),null);
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
  assert.equal(h.container.querySelector('[data-context-pending]'),null);
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
  assert.equal(h.container.querySelector('[data-context-pending]'),null);
});

test('retained readable text does not become pending while its expired client cache revalidates',async t=>{
  let calls=0,finish;
  const h=await harness(t,route=>route.endsWith(report)&&++calls===2?
    new Promise(resolve=>finish=()=>resolve(Response.json({error:{message:'Request failed.'}},{status:503}))):
    response(route.slice('document-context/'.length),sourceDocument(route.slice('document-context/'.length),['Readable saved body.'],{stale:true,refreshInProgress:true})));
  const request={documentId:report,view:'document',onBack:()=>{}};
  await h.render({request,language:'en'});
  await h.render({request:{...request,documentId:original},language:'en'});
  const now=Date.now();t.mock.method(Date,'now',()=>now+31_000);
  await h.render({request,language:'en'},false);
  assert.equal(calls,2,'the expired cache starts a real client revalidation');
  assert(h.container.querySelector('.document-context-text').textContent.includes('Readable saved body.'));
  assert.equal(h.container.querySelector('[data-context-pending]'),null);
  await act(async()=>finish());await h.settle();
  assert(h.container.textContent.includes('Couldn’t update the document. Showing saved text.'));
  assert(h.container.querySelector('.document-context-text').textContent.includes('Readable saved body.'));
  assert.equal(h.container.querySelector('[data-context-pending]'),null);
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

for(const [name,selected] of [
  ['amendment',{...amendmentSource,id:report+'-AM-41'}],
  ['pinned list',{...amendmentSource,variants:[{listId:report+'-AM-047-056'}]}],
])test(`a ${name} mismatch withholds target highlighting while keeping the body`,async t=>{
  const h=await harness(t,()=>response(report,sourceDocument(report),{target,amendment:selected}));
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,view:'document',onBack:()=>{}},language:'en'});
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0);
  assert(h.container.textContent.includes('Exact target passage.'));
  assert(h.container.textContent.includes('The passage this amendment changes could not be found.'));
});

test('a failed adopted lookup offers retry without claiming that the selected text is unavailable',async t=>{
  const h=await harness(t,()=>Response.json({error:{message:'This data request took too long.'}},{status:503}));
  await h.render({request:{documentId:original,view:'adopted',onBack:()=>{}},language:'en',selectedDocumentId:adopted});
  assert(h.container.textContent.includes('Linked texts could not be loaded.'));
  assert(!h.container.textContent.includes('This adopted text is unavailable here.'));
  assert.equal(h.container.querySelectorAll('.document-context-notice button').length,1);
  assert.equal(h.container.querySelector('[data-context-pending]'),null);
});

test('references keep the interface language when the source text language changes',async t=>{
  const h=await harness(t,(_route,params)=>response(report,sourceDocument(report,['Regulation (EU) 2021/2116.'],{textLanguage:params.get('lang'),availableTextLanguages:['en','fr']}),{requestedLanguage:params.get('lang')}));
  await h.render({request:{documentId:report,view:'document',onBack:()=>{}},language:'en'});
  await h.change(h.container.querySelector('select'),'fr');
  assert.equal(h.container.querySelector('.document-context-text').lang,'fr');
  const lookups=h.requests.filter(route=>route.startsWith('references?'));
  assert(lookups.length>0);assert(lookups.every(route=>new URLSearchParams(route.split('?')[1]).get('lang')==='en'));
});


function overlayResponse({operation='insert',status='placed',reason,span,insertAfter=2,insertBefore=3}={}) {
  return response(report,sourceDocument(report,['The European Parliament,','19. Main provision:', '(a) final point;', '20. Following provision;']),{
    requestedWordingLanguage:'en',amendment:{...amendmentSource,variants:[wordingVariant('en',{originalText:operation==='insert'?'':'19. Main provision: (a) final point;',proposedText:operation==='delete'?'deleted':'19a. New proposed provision;'})]},
    target:{...target,evidence:pinnedEvidence('en')},placement:{operation,status,reason,span,insertAfter,insertBefore,evidence:[]},
  });
}
const overlayRequest={documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}};

test('a verified matching-document translation renders its own wording and actual text language',async t=>{
  const value=overlayResponse();
  value.document.selectedText.textLanguage='fr';value.document.selectedText.availableTextLanguages=['fr','es'];
  value.wordingLanguageFallback={listId:list,requestedLanguage:'en',language:'fr'};
  value.amendment.variants=[wordingVariant('en'),wordingVariant('fr',{originalText:'19. Texte original;',proposedText:'19. Texte proposé;'})];
  value.target.evidence=pinnedEvidence('fr');
  const h=await harness(t,()=>value);await h.render({request:overlayRequest,language:'en'});
  const block=h.container.querySelector('[data-amendment-block="true"][data-context-target="true"]');
  assert(block);assert(block.textContent.includes('Texte proposé'));assert(!block.textContent.includes('Proposed wording.'));
  assert(h.container.querySelector('.document-context-language').textContent.includes('French'));
  assert.equal(h.container.querySelector('.document-context-text').lang,'fr');
});

test('a translation cannot replace an available explicitly requested wording language',async t=>{
  const value=overlayResponse();value.document.selectedText.textLanguage='fr';value.document.selectedText.availableTextLanguages=['en','fr'];
  value.wordingLanguageFallback={listId:list,requestedLanguage:'en',language:'fr'};
  value.amendment.variants=[wordingVariant('en'),wordingVariant('fr')];value.target.evidence=pinnedEvidence('fr');
  const h=await harness(t,()=>value);await h.render({request:overlayRequest,language:'en'});
  assert.equal(h.container.querySelector('[data-amendment-block="true"][data-context-target="true"]'),null);
});
test('placed insertion renders a framed WordingDiff between complete paragraph 19 and paragraph 20, with focus',async t=>{
  const h=await harness(t,()=>overlayResponse());await h.render({request:overlayRequest,language:'en'});
  const reader=h.container.querySelector('.document-context-text'),children=[...reader.children],block=reader.querySelector('[data-amendment-block]');
  assert.equal(children[children.indexOf(block)-1].dataset.sourceParagraph,'2');
  assert.equal(children[children.indexOf(block)+1].dataset.sourceParagraph,'3');
  assert.equal(block.querySelector('h4').textContent,'Amendment 40');assert(block.querySelector('.wording-diff ins'));
  assert.equal(block.querySelector('del'),null);assert.equal(h.container.querySelectorAll('[data-context-target]').length,1);
  assert.equal(block.querySelector('.wording-diff__note').textContent,'New text');
  assert.equal([...block.querySelectorAll('button')].find(b=>b.textContent==='Side by side').getAttribute('aria-pressed'),'true');
  assert.equal(block.querySelector('.wording-diff__legend'),null);
  assert(!block.textContent.includes('Mostly rewritten'));
  await h.click([...h.container.querySelectorAll('button')].find(button=>button.textContent==='Go to amendment'));
  assert.equal(h.scrolls.at(-1).element,block);assert.equal(document.activeElement,block);
});
test('replacement and deletion substitute the entire span with WordingDiff in source order',async t=>{
  for(const operation of ['replace','delete'])await t.test(operation,async t=>{
    const h=await harness(t,()=>overlayResponse({operation,span:{start:1,end:2}}));await h.render({request:overlayRequest,language:'en'});
    const block=h.container.querySelector('[data-amendment-block]');assert(block.querySelector('.wording-diff del'));
    assert.equal([...block.querySelectorAll('button')].find(b=>b.textContent==='Side by side').getAttribute('aria-pressed'),'true');
    assert.equal(block.querySelectorAll('.wording-diff__columns section').length,2);
    assert.equal(block.querySelector('.wording-diff__legend'),null);
    assert(!block.textContent.includes('Mostly rewritten'));
    assert.equal(h.container.querySelector('[data-source-paragraph="1"]'),null);assert.equal(h.container.querySelector('[data-source-paragraph="2"]'),null);
    assert.equal(block.nextElementSibling.dataset.sourceParagraph,'3');
    if(operation==='delete'){assert.equal(block.querySelector('ins'),null);assert(![...block.querySelectorAll('.wording-diff__passage')].some(p=>p.textContent==='deleted'));}
  });
});
test('unresolved placement shows wording above the full unchanged baseline without a false location',async t=>{
  const h=await harness(t,()=>overlayResponse({operation:'replace',status:'unresolved',reason:'baseline_unavailable'}));await h.render({request:overlayRequest,language:'en'});
  assert.equal(h.container.querySelector('[role="status"]').textContent,'The text this amendment changes is not included in this document.');
  const reader=h.container.querySelector('.document-context-text');assert(reader.firstElementChild.querySelector('.wording-diff'));
  assert.equal(reader.querySelectorAll('[data-source-paragraph]').length,4);assert.equal(reader.querySelectorAll('[data-context-target]').length,0);
  assert(![...h.container.querySelectorAll('button')].some(button=>button.textContent==='Go to amendment'));
});

test('conflicting baselines show a short reason and preserve the full source without a placed diff',async t=>{
  const h=await harness(t,()=>overlayResponse({operation:'replace',status:'unresolved',reason:'conflicting_baselines'}));await h.render({request:overlayRequest,language:'en'});
  assert.match(h.container.textContent,/Conflicting comparison texts\./);
  const reader=h.container.querySelector('.document-context-text');assert(reader.firstElementChild.querySelector('.wording-diff'));
  assert.equal(reader.querySelectorAll('[data-source-paragraph]').length,4);assert.equal(reader.querySelectorAll('[data-context-target]').length,0);
  assert(![...h.container.querySelectorAll('button')].some(button=>button.textContent==='Go to amendment'));
});

for(const [suffix,label] of [['-AM-040','Amendment 40'],['-AM-040a','Amendment 40a'],['-AM-000','Amendment 0'],['-other','Amendment']])
  test(`amendment label handles ${suffix} without leaking the identifier`,async t=>{
    const amendmentId=report+suffix,data=overlayResponse();data.amendment.id=amendmentId;data.target.evidence.amendmentId=amendmentId;
    const h=await harness(t,()=>data);await h.render({request:{...overlayRequest,amendmentId},language:'en'});
    const block=h.container.querySelector('[data-amendment-block]'),heading=block.querySelector('h4');
    assert.equal(heading.textContent,label);assert.equal(heading.lang,'en');
    assert.equal(block.getAttribute('aria-labelledby'),heading.id);assert.equal(block.hasAttribute('lang'),false);
  });

test('amendment passage keeps its wording language in both diff views',async t=>{
  const data=overlayResponse();data.requestedWordingLanguage='hu';data.document.selectedText.textLanguage='hu';
  data.amendment.variants[0].language='hu';data.target.evidence.wordingLanguage='hu';
  const h=await harness(t,()=>({...data,requestedLanguage:'hu'}));
  await h.render({request:{...overlayRequest,wordingLanguage:'hu'},language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');assert.equal(block.querySelector('h4').lang,'en');
  for(const view of ['Changes','Side by side']) {
    await h.click([...block.querySelectorAll('button')].find(button=>button.textContent===view));
    const passages=[...block.querySelectorAll('.wording-diff__passage')];assert(passages.length);assert(passages.every(p=>p.lang==='hu'));
  }
});

for(const operation of ['insert','replace','delete'])test(`${operation} before an extracted body retains the full source and a reachable amendment`,async t=>{
  // Question headers exercise an exact nonzero start; committee extraction is also checked below.
  const id='E-10-2026-0001',amendmentId=id+'-AM-40',data=overlayResponse({operation,span:operation==='insert'?undefined:{start:0,end:1},insertAfter:0,insertBefore:1});
  data.documentId=id;data.document=sourceDocument(id,['Question for written answer E-0001/2026','Subject: Source subject','Body paragraph.']);
  data.amendment.id=amendmentId;data.target.evidence.amendmentId=amendmentId;
  const h=await harness(t,()=>data);await h.render({request:{...overlayRequest,documentId:id,amendmentId},language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');assert(block);
  assert.equal(block.nextElementSibling.dataset.sourceParagraph,operation==='insert'?'1':'2');
  if(operation==='insert')assert.equal(block.previousElementSibling.dataset.sourceParagraph,'0');
  await h.click([...h.container.querySelectorAll('button')].find(button=>button.textContent==='Go to amendment'));
  assert.equal(h.scrolls.at(-1).element,block);assert.equal(document.activeElement,block);
});

test('committee body extraction retains an amendment placed before its body start',async t=>{
  const id='LIBE-PR-123456',amendmentId=id+'-AM-40',data=overlayResponse({insertAfter:0,insertBefore:1});
  data.documentId=id;data.document=sourceDocument(id,['Cover','CONTENTS','Page 1','DRAFT REPORT','Body paragraph.']);
  data.amendment.id=amendmentId;data.target.evidence.amendmentId=amendmentId;
  const h=await harness(t,()=>data);await h.render({request:{...overlayRequest,documentId:id,amendmentId},language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');assert(block);
  assert.equal(block.previousElementSibling.dataset.sourceParagraph,'0');assert.equal(block.nextElementSibling.dataset.sourceParagraph,'1');
});

for(const [reason,copy] of Object.entries({
  resolution_extent_uncertain:'The boundaries of this passage could not be determined.',
  resolution_end_unavailable:'The end of the resolution could not be determined.',
  insertion_reference_unavailable:'The insertion location is not specified clearly enough.',
  relative_target_not_found:'The preceding provision could not be found.',
  multiple_published_targets:'The published location matches more than one passage.',
  multiple_quoted_targets:'The quoted wording appears more than once.',
  target_not_found:'The passage this amendment changes could not be found.',
  source_passage_incomplete:'The source passage is incomplete.',
  source_structure_unavailable:'The document structure is unavailable.',
  proposal_note_scope_unavailable:'The footnotes in this amendment could not be placed.',
  matching_budget:'The amendment’s location could not be determined.',
  amendment_wording_unavailable:'The amendment wording is unavailable.',
  unknown_reason:'The amendment’s location could not be determined.',
}))test(`unresolved ${reason} explains the gap without implying a location`,async t=>{
  const data=overlayResponse({status:'unresolved',reason});
  if(reason==='amendment_wording_unavailable')data.amendment.variants[0].wordingStatus='unavailable';
  const h=await harness(t,()=>data);await h.render({request:overlayRequest,language:'en'});
  assert.equal(h.container.querySelector('[role="status"]').textContent,copy);
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0);
  assert.equal(h.container.querySelectorAll('[data-source-paragraph]').length,4);
});


for(const operation of ['replace','delete'])test(`${operation} preserves unchanged and deleted source links and note anchors in both diff modes`,async t=>{
  const data=overlayResponse({operation,span:{start:1,end:2}}),text=data.document.selectedText;
  text.paragraphs=['The European Parliament,','19. Keep linked words and remove cited words;', 'continued text;', '20. Following provision;'];
  text.notes=[{id:'1',label:'1',text:'Source footnote remains available.',links:[]},{id:'2',label:'2',text:'Deleted footnote remains available.',links:[]}];
  text.documentLinks=[{paragraph:1,start:9,end:21,url:'https://example.org/unchanged'},{paragraph:1,start:33,end:44,url:'https://example.org/deleted'}];
  text.noteAnchors=[{paragraph:1,offset:21,note:'1',label:'1'},{paragraph:1,offset:44,note:'2',label:'2'},{paragraph:2,offset:15,note:'1',label:'1'}];
  const variant=data.amendment.variants[0];variant.originalText=text.paragraphs.slice(1,3).join(' ');variant.proposedText=operation==='delete'?'deleted':'19. Keep linked words and add different text; continued text;';
  const h=await harness(t,()=>data);await h.render({request:overlayRequest,language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');
  const verify=()=>{
    assert.equal(block.querySelectorAll('a[href="https://example.org/unchanged"]').length,1);
    assert.equal(block.querySelectorAll('a[href="https://example.org/deleted"]').length,1);
    assert.equal(block.querySelectorAll('sup').length,3);
    assert(block.querySelector('del a[href="https://example.org/deleted"]'));
    assert(block.querySelector('del sup'));
    assert.equal(block.querySelector('ins a, ins sup'),null);
    for(const mark of block.querySelectorAll('sup a'))assert(h.container.querySelector(mark.getAttribute('href')),'note destination retained');
    assert(h.container.querySelector('.legal-notes').textContent.includes('Source footnote remains available.'));
    assert(!block.textContent.includes("Footnotes and links are shown in the full document's original"));
  };
  await h.click([...block.querySelectorAll('button')].find(button=>button.textContent==='Changes'));verify();
  await h.click([...block.querySelectorAll('button')].find(button=>button.textContent==='Side by side'));verify();
  const proposed=block.querySelectorAll('.wording-diff__columns section')[1];assert.equal(proposed.querySelector('sup,a'),null);
});
test('whitespace-normalized original offsets preserve source annotations',async t=>{
  const data=overlayResponse({operation:'replace',span:{start:1,end:2}}),text=data.document.selectedText;
  text.documentLinks=[{paragraph:1,start:4,end:8,url:'https://example.org/main'}];text.noteAnchors=[{paragraph:2,offset:16,note:'1',label:'1'}];text.notes=[{id:'1',label:'1',text:'Source note.',links:[]}];
  data.amendment.variants[0].originalText='  19.  Main provision:\n (a) final point;  ';
  const h=await harness(t,()=>data);await h.render({request:overlayRequest,language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');assert.equal(block.querySelector('a[href="https://example.org/main"]').textContent,'Main');assert.equal(block.querySelectorAll('sup').length,1);
});
test('non-equivalent amendment original shows annotation fallback while retaining the notes list',async t=>{
  const data=overlayResponse({operation:'replace',span:{start:1,end:2}}),text=data.document.selectedText;
  text.documentLinks=[{paragraph:1,start:4,end:8,url:'https://example.org/main'}];text.noteAnchors=[{paragraph:2,offset:16,note:'1',label:'1'}];text.notes=[{id:'1',label:'1',text:'Source note.',links:[]}];
  data.amendment.variants[0].originalText='Main provision with changed wording.';
  const h=await harness(t,()=>data);await h.render({request:overlayRequest,language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');assert(!block.textContent.includes("Footnotes and links are shown"));assert.equal(block.querySelector('sup,a'),null);assert(h.container.querySelector('.legal-notes').textContent.includes('Source note.'));
});


test('Commission proposal replaces the report body for recorded CBAM amendments 4, 7 and 8',async t=>{
  let number=4;
  const h=await harness(t,(_route,params)=>proposalContextResponse(report,params.get('amendment'),list,number));
  const props={request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'};
  for(const selected of [4,7,8]){
    number=selected;await h.render({...props,request:{...props.request,amendmentId:report+'-AM-'+selected}});
    assert.equal(h.container.querySelector('[data-amendment-block]')?.dataset.contextTarget,'true');
    assert(h.container.textContent.includes('Commission proposal · COM(2025)0087'));
    assert(!h.container.textContent.includes('Report body must not replace the proposal.'));
    assert(h.container.querySelector('[data-proposal-item="act-1"]'));
    assert(h.container.querySelector('[data-proposal-item="annex-1"]'));
    assert(h.container.querySelector('math'));
    assert(h.container.querySelector('.proposal-table'));
    assert(h.container.textContent.includes('Legal text © European Union'));
    const link=h.container.querySelector('.proposal-context-summary a');assert(link.href.includes('CELEX:52025PC0087'));
    assert.equal(link.textContent,'Commission proposal · COM(2025)0087 ↗');
    assert.equal(h.container.querySelectorAll('.proposal-context-summary a').length,2);
    const block=h.container.querySelector('[data-amendment-block]');
    assert.equal(block.getAttribute('aria-label'),'Amendment '+selected);
    assert.equal(block.querySelector('h4').textContent,'Amendment '+selected);
    assert.equal(block.querySelector('h4').lang,'en');
    assert.equal([...block.querySelectorAll('button')].find(b=>b.textContent==='Side by side').getAttribute('aria-pressed'),'true');
    assert.equal(block.querySelectorAll('.wording-diff__columns section').length,2);
    assert.equal(block.querySelector('.wording-diff__legend'),null);
    assert(!block.textContent.includes('Mostly rewritten'));assert(!block.textContent.includes('official document is authoritative'));
  }
});

test('placed amendment keeps an unchanged provision number the amendment column omits',async t=>{
  const {parseProposal}=await import('../server/proposal-structure.mjs'),{resolveProposalPlacement}=await import('../server/proposal-placement.mjs');
  const paragraphs=['Article 1','1.\tLead subparagraph text.','Second subparagraph text.'];
  const proposal=parseProposal({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map((_,i)=>({styleId:i?'Normal':'Titrearticle',numberingComplete:true,notesComplete:true}))});
  const value=proposalContextResponse(report,amendment,list,4),items=[{kind:'act',index:1,proposal}];
  const variant={...value.amendment.variants[0],targetLabel:'Article 1 – paragraph 1 – subparagraph 1',targetPath:{proposal:[],underlying:[],language:'en'},originalText:'Lead subparagraph text.',proposedText:'Changed subparagraph text.'};
  Object.assign(value,{proposal:{items},amendment:{...value.amendment,variants:[variant]},placement:resolveProposalPlacement(items,variant)});
  assert.equal(value.placement.status,'placed');
  const h=await harness(t,()=>value);
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');assert.equal(block.dataset.contextTarget,'true');
  assert(![...block.querySelectorAll('del')].some(node=>node.textContent.includes('1.')),'the provision number is not shown as deleted');
  assert(block.textContent.includes('1.'));assert(block.querySelector('ins').textContent.includes('Changed'));
});

async function renderPlacedLabel(t,paragraphs,targetLabel,originalText,proposedText,edit=proposal=>proposal) {
  let proposal;
  const {parseProposal}=await import('../server/proposal-structure.mjs'),{resolveProposalPlacement}=await import('../server/proposal-placement.mjs');
  proposal=parseProposal({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map((_,i)=>({styleId:i?'Normal':'Titrearticle',numberingComplete:true,notesComplete:true}))});
  proposal=edit(proposal);
  const value=proposalContextResponse(report,amendment,list,4),items=[{kind:'act',index:1,proposal}];
  const variant={...value.amendment.variants[0],targetLabel,targetPath:{proposal:[],underlying:[],language:'en'},originalText,proposedText};
  Object.assign(value,{proposal:{items},amendment:{...value.amendment,variants:[variant]},placement:resolveProposalPlacement(items,variant)});
  assert.equal(value.placement.status,'placed');
  const h=await harness(t,()=>value);
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');
  return {h,block,text:block.textContent,label:block.querySelector('[data-source-label]')?.textContent??null,deleted:[...block.querySelectorAll('del')].map(node=>node.textContent).join(' '),proposed:wordingText(block,'proposed')};
}

test('a source number is shown as context and proposed wording is never changed',async t=>{
  const {label,proposed}=await renderPlacedLabel(t,['Article 1','1. Intro:','(a) Old provision.','(b) Other.'],'Article 1 – paragraph 1 – point a','Old provision.','(b) New provision.');
  assert.equal(label,'(a)');assert.equal(proposed.replace(/\s+/g,' ').trim(),'(b) New provision.');
});

for(const label of ['Chapter II','point aa','Article premier','ΠΑΡΑΡΤΗΜΑ ΙΙ','aa','uvodna izjava 2','‘2a. New provision.’','‘2a.New provision.’','2.1. New provision.','”2a.New provision.”','b] New provision.','lxxxviii) New provision.','A. New provision.','II ) New provision.','aa ] New provision.','ii\t. New provision.'])test('replacement label '+label+' never acquires the source number',async t=>{
  const {proposed}=await renderPlacedLabel(t,['Article 1','1. Old provision.'],'Article 1 – paragraph 1','Old provision.',label);
  assert.equal(proposed.replace(/\s+/g,' ').trim(),label.replace(/\s+/g,' '),proposed);
});

for(const [name,edit,check] of [
  ['a link',proposal=>({...proposal,links:[...proposal.links,{paragraph:1,start:0,end:2,url:'https://example.org/number'}]}),block=>block.querySelector('a[href="https://example.org/number"]')],
  ['a note marker',proposal=>({...proposal,anchors:[...proposal.anchors,{paragraph:1,offset:0,note:'n1',label:'1'}],notes:[...proposal.notes,{id:'n1',label:'1',text:'Number note.',links:[],complete:true,objects:[]}]}),block=>block.querySelector('sup,a[href*="note"]')],
])test('a provision number carrying '+name+' stays in the compared source text',async t=>{
  const {h,block,label}=await renderPlacedLabel(t,['Article 1','1. Old wording.'],'Article 1 – paragraph 1','Old wording.','New wording.',edit);
  assert.equal(label,null);assert(check(block),'annotation kept in Changes mode');
  await h.click([...block.querySelectorAll('button')].find(b=>b.textContent==='Side by side'));
  assert(check(h.container.querySelector('[data-amendment-block]')),'annotation kept in Side by side mode');
});

test('label-like wording is never treated as a provision number',async t=>{
  const {text,deleted}=await renderPlacedLabel(t,['Article 1','1. Lead text. A. Old sentence.'],'Article 1 – paragraph 1','A. Old sentence.','B. New sentence.');
  assert(/(^|\W)A(\W|$)/.test(deleted),'the original wording is shown as deleted: '+text);
});

test('proposal deletion includes instruction 21(a) and its quotation while keeping 21(b) readable',async t=>{
  const h=await harness(t,()=>proposalContextResponse(report,amendment,list,7));
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');assert(block);assert.equal(block.dataset.contextTarget,'true');
  assert(block.querySelector('del').textContent.includes('the following paragraph 1a is inserted'));
  assert(block.textContent.includes('the past compliance of the authorised CBAM declarant'));
  assert(block.nextElementSibling.textContent.startsWith('(b)'));assert(!block.textContent.includes('the following paragraph 3a'));
  await h.click([...h.container.querySelectorAll('button')].find(b=>b.textContent==='Go to amendment'));
  assert.equal(h.scrolls.at(-1).element,block);assert.equal(h.window.document.activeElement,block);
});

test('proposal unresolved math retains the diff at the top and renders unchanged equations safely',async t=>{
  const value=proposalContextResponse(report,amendment,list,8);value.placement={...value.placement,status:'unresolved',reason:'math_comparison_unavailable'};
  const h=await harness(t,()=>value);await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
  assert.equal(h.container.querySelector('[role="status"]').textContent,'The equations could not be compared.');
  assert.equal(h.container.querySelector('[data-amendment-block]').dataset.contextTarget,undefined);
  assert(h.container.querySelector('math'));assert.equal(h.container.querySelector('.proposal-context-text').firstElementChild.dataset.amendmentBlock,'true');
});

test('a compound proposal note stays separate with its complete wording and scope explanation',async t=>{
  const value=proposalContextResponse(report,amendment,list,8),variant=value.amendment.variants[0];
  variant.originalText='';variant.proposedText='(2a) Published provision1a.\n___________\n1a Published footnote.\n+ OJ: Retain the source instruction.';
  value.placement={status:'unresolved',operation:'insert',reason:'proposal_note_scope_unavailable',evidence:[]};
  const h=await harness(t,()=>value);await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
  assert.equal(h.container.querySelector('[role="status"]').textContent,'The footnotes in this amendment could not be placed.');
  assert.equal(wordingText(h.container,'proposed'),variant.proposedText);
  assert.equal(h.container.querySelectorAll('[data-context-target="true"]').length,0);
  assert.equal(h.container.querySelector('.proposal-context-text').firstElementChild.dataset.amendmentBlock,'true');
});


test('proposal reader renders note equations at their source offset and exposes unsupported note gaps',async t=>{
  const noteText='Preserved note prefix at '+String.fromCharCode(0xFFFC)+' linked source after.';
  const offset=25,url='https://example.test/note-source';assert.equal(noteText[offset],String.fromCharCode(0xFFFC));
  const object={kind:'math',status:'converted',complete:true,offset,replacement:String.fromCharCode(0xFFFC),sourceUrl:source,
    math:{tag:'math',children:[{tag:'msub',children:[{tag:'mi',children:['E']},{tag:'mi',children:['j']}]}]}};
  const paragraphs=['Article 1','1. Original provision.','Article 2','Keep this source.'];
  const content={paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),
    notes:[{id:'1',label:'1',text:noteText,links:[url],linkSpans:[{start:27,end:40,url}],objects:[object],complete:true}],anchors:[{paragraph:1,offset:22,note:'1',label:'1'}],links:[]};
  let value;
  const h=await harness(t,()=>value);
  for(const complete of [true,false]){
    const p=parseProposal({...content,notes:[{...content.notes[0],complete,objects:[{...object,complete,status:complete?'converted':'unresolved',math:complete?object.math:null}]}]});
    value=proposalContextResponse(report,amendment,list,4);
    const variant={...value.amendment.variants[0],targetPath:null,targetLabel:'Article 1 – paragraph 1',originalText:paragraphs[1],proposedText:'1. Revised provision.'};
    value.amendment.variants=[variant];value.proposal.items=[{kind:'act',index:1,proposal:p}];value.placement=resolveProposalPlacement(value.proposal.items,variant);
    const selected=amendment+(complete?'':'a');value.amendment.id=selected;value.target.evidence.amendmentId=selected;
    await h.render({request:{documentId:report,amendmentId:selected,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
    const note=h.container.querySelector('.legal-notes li');assert(note);
    assert.equal(note.querySelector('a[href="'+url+'"]').textContent,'linked source');assert(note.textContent.includes(' after.'));assert(!note.textContent.includes(String.fromCharCode(0xFFFC)));
    const link=h.container.querySelector('sup a');assert(link);assert.equal(new URL(link.href).hash,'#'+note.id);
    if(complete){assert.equal(note.querySelector('msub').innerHTML,'<mi>E</mi><mi>j</mi>');assert(note.innerHTML.indexOf('Preserved note prefix at ')<note.innerHTML.indexOf('<math>'));assert.equal(value.placement.status,'placed');}
    else {assert(!note.querySelector('math'));assert(note.textContent.includes('Equation unavailable'));assert(note.querySelector('a[href="'+source+'"]'));assert.equal(p.contentComplete,false);assert.equal(proposalCandidates(p,'Article 1')[0].complete,false);assert(p.gaps.some(gap=>gap.code==='incomplete-note'));assert.equal(value.placement.status,'unresolved');}
  }
});

test('partial proposal splice keeps links and note anchors in unchanged and changed source text',async t=>{
  const text='1. Keep before. A changed sentence. Keep after.',start=text.indexOf('changed'),end=start+'changed'.length;
  const paragraphs=['Article 1',text];
  const p=parseProposal({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),
    notes:[{id:'1',label:'1',text:'Source note.',links:[]}],anchors:[{paragraph:1,offset:end,note:'1',label:'1'}],links:[{paragraph:1,start,end,url:'https://example.test/source'}]});
  const value=proposalContextResponse(report,amendment,list,4),variant={...value.amendment.variants[0],targetPath:null,targetLabel:'Article 1 – paragraph 1',originalText:'A changed sentence.',proposedText:'A revised sentence.'};
  value.amendment.variants=[variant];value.proposal.items=[{kind:'act',index:1,proposal:p}];value.placement=resolveProposalPlacement(value.proposal.items,variant);
  const h=await harness(t,()=>value);await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');assert.equal(block.dataset.contextTarget,'true');
  assert(block.previousElementSibling.textContent.includes('Keep before.'));assert.equal(block.nextElementSibling.textContent,' Keep after.');
  assert(block.querySelector('a[href="https://example.test/source"]'));assert(block.querySelector('sup'));assert(h.container.textContent.includes('Source note.'));
});

test('recorded formatting styles paragraphs, emphasis and tables without moving text, notes or targets',async t=>{
  const paragraphs=['MOTION FOR A RESOLUTION','A.\twhereas bold text has a note;','Cell one','Cell two','Exact target passage.'];
  const h=await harness(t,()=>response(report,sourceDocument(report,paragraphs,{
    noteAnchors:[{paragraph:1,offset:32,note:'1',label:'1'}],notes:[{id:'1',label:'1',text:'Source note.',links:[]}],
    formatStatus:'extracted',tables:[{rows:[[{start:2,end:3},{start:3,end:4}],[{start:4,end:5,colSpan:2}]],bordered:true}],
    paragraphFormats:[{align:'center',size:'xl',heading:1,marks:[{start:0,end:6,kind:'bold'}]},{indent:2.36,hanging:2.36,marks:[{start:11,end:15,kind:'bold'},{start:16,end:20,kind:'italic'}]},{},{},{}],
  }),{target:{...target,paragraphs:[4]},amendment:amendmentSource}));
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,view:'document',onBack:()=>{}},language:'en'});
  const title=h.container.querySelector('[data-source-paragraph="0"]');
  assert.equal(title.getAttribute('role'),'heading');assert.equal(title.getAttribute('aria-level'),'4');
  assert(title.classList.contains('doc-align-center')&&title.classList.contains('doc-size-xl'));
  assert.equal(title.querySelector('b').textContent,'MOTION');assert.equal(title.textContent,paragraphs[0]);
  const recital=h.container.querySelector('[data-source-paragraph="1"]');
  assert.equal(recital.querySelector('.doc-label').textContent,'A.\t');
  assert.equal(recital.querySelector('b').textContent,'bold');assert.equal(recital.querySelector('i').textContent,'text');
  assert.equal(recital.textContent,paragraphs[1]+'1','text is unchanged and the note mark stays at its offset');
  assert.equal(recital.lastChild.nodeName,'SUP');
  const table=h.container.querySelector('table.doc-table-bordered');
  assert.deepEqual([...table.querySelectorAll('tr')].map(row=>[...row.cells].map(cell=>cell.textContent)),[['Cell one','Cell two'],['Exact target passage.']]);
  assert.equal(table.querySelector('td[colspan="2"] [data-context-target="true"]').dataset.sourceParagraph,'4');
});

test('formatting that does not match the paragraphs is ignored',async t=>{
  const h=await harness(t,()=>response(report,sourceDocument(report,['Plain one.','Plain two.'],{formatStatus:'extracted',paragraphFormats:[{align:'center'}],tables:[]})));
  await h.render({request:{documentId:report,view:'document',onBack:()=>{}},language:'en'});
  assert.equal(h.container.querySelectorAll('.doc-align-center').length,0);
  assert.equal(h.container.querySelector('[data-source-paragraph="0"]').textContent,'Plain one.');
});

test('a note anchored just before an unresolved object stays visible with formatting',async t=>{
  const paragraph='Before￼ after.';
  const h=await harness(t,()=>response(report,sourceDocument(report,[paragraph],{
    documentObjects:[{paragraph:0,offset:6,path:'document/p/1/r/1/drawing',kind:'drawing',status:'unresolved'}],
    notes:[{id:'1',label:'1',text:'Exact source note.',links:[]}],noteAnchors:[{paragraph:0,offset:6,note:'1',label:'1'}],
    formatStatus:'extracted',paragraphFormats:[{marks:[{start:0,end:6,kind:'italic'}]}],tables:[],
  })));
  await h.render({request:{documentId:report,view:'document',onBack:()=>{}},language:'en'});
  const p=h.container.querySelector('[data-source-paragraph="0"]');
  assert.equal(p.querySelector('i').textContent,'Before');
  const mark=p.querySelector('sup.legal-note-mark'),object=p.querySelector('.document-context-object');
  assert(mark,'the note marker is rendered');assert(mark.compareDocumentPosition(object)&h.window.Node.DOCUMENT_POSITION_FOLLOWING,'the marker precedes the object placeholder');
});

const followupFile=(language='en',format='PDF')=>({expressionId:'expression/'+language,manifestationId:'manifestation/'+language+'/'+format,language,languageUri:'authority/'+language,format,url:'https://data.europarl.europa.eu/distribution/doc/SP-example_'+language+'.'+format.toLowerCase(),issued:'2026-06-10T16:53:54Z',byteSize:92679});
const followupItem=(id='SP-example',files=[followupFile()])=>({id,documentDate:'2026-05-11',files});
const directAdopted={documentId:adopted,view:'document',onBack:()=>{}};
for(const status of ['none-listed','unavailable'])test('follow-ups render nothing for '+status,async t=>{
  const h=await harness(t,()=>response(adopted),()=>({status,items:[],gaps:[]}));await h.render({request:directAdopted,language:'en'});
  assert.equal(h.container.querySelector('.commission-followups'),null);assert(h.container.textContent.includes('Exact target passage.'));
});
test('follow-up loading reserves no row and does not block the adopted text',async t=>{
  let finish;const h=await harness(t,()=>response(adopted),()=>new Promise(resolve=>finish=resolve));await h.render({request:directAdopted,language:'en'});
  assert.equal(h.container.querySelector('.commission-followups'),null);assert(h.container.textContent.includes('Exact target passage.'));assert.equal(h.container.querySelector('[data-context-pending]'),null);
  await act(async()=>finish({status:'none-listed',items:[],gaps:[]}));await h.settle();
});
test('follow-up network failure and retry leave the document body intact',async t=>{
  let calls=0;const h=await harness(t,()=>response(adopted),()=>++calls===1?Response.json({error:{message:'Source offline'}},{status:502}):{status:'available',items:[followupItem()],gaps:[]});
  await h.render({request:directAdopted,language:'en'});assert(h.container.textContent.includes('Exact target passage.'));const body=h.container.querySelector('.document-context-text');
  const notice=h.container.querySelector('.commission-followups [role="status"]');assert(notice.textContent.includes('Commission follow-up could not be checked.'));assert.equal(h.container.querySelector('[role="alert"]'),null);
  await h.click(notice.querySelector('button'));assert.equal(calls,2);assert.equal(h.container.querySelector('.document-context-text'),body);assert(h.container.querySelector('.commission-followup a'));assert.equal(h.container.querySelector('.commission-followups [role="status"]'),null);
});
test('follow-up links prefer PDF per expression language, show dates and disclose other languages',async t=>{
  const files=[followupFile('en','DOCX'),followupFile('en','HTML'),followupFile('en'),followupFile('fr','DOCX'),followupFile('fr'),followupFile('de','DOCX')];
  const h=await harness(t,()=>response(adopted),()=>({status:'available',items:[followupItem('SP-one',files),{...followupItem('SP-two',[followupFile('en','DOCX')]),documentDate:null}],gaps:[]}));
  await h.render({request:directAdopted,language:'en'});const rows=h.container.querySelectorAll('.commission-followup');assert.equal(rows.length,2);
  assert.equal(rows[0].querySelector('time').textContent,'11 May 2026');assert.equal(rows[0].querySelector('time').dateTime,'2026-05-11');assert.equal(rows[1].querySelector('time'),null);
  const primary=rows[0].querySelector('a');assert.equal(primary.textContent,'English · PDF ↗');assert.equal(primary.hreflang,'en');assert.equal(primary.hasAttribute('lang'),false);assert.equal(primary.querySelector('span').lang,'en');assert.equal(primary.target,'_blank');assert.equal(primary.rel,'noreferrer');assert.equal(primary.getAttribute('aria-label'),'Commission follow-up, English, PDF');
  const disclosure=rows[0].querySelector('details');assert.equal(disclosure.querySelector('summary').textContent,'Other languages');assert.equal(disclosure.querySelectorAll('a').length,2);assert.equal(disclosure.querySelector('a').textContent,'French · PDF ↗');assert.equal(rows[1].querySelector('a').textContent,'English · Word document ↗');
  assert.equal(h.container.querySelector('.document-context-language').nextElementSibling.className,'commission-followups');assert(!h.container.textContent.includes('92679'));assert(!h.container.textContent.includes('10 June'));
});
test('follow-up file language labels use the interface language and preserve the target language',async t=>{
  const h=await harness(t,()=>response(adopted,sourceDocument(adopted),{requestedLanguage:'fr'}),()=>({status:'available',items:[followupItem('SP-one',[followupFile('fr'),followupFile('en')])],gaps:[]}));
  await h.render({request:directAdopted,language:'fr'});
  const links=h.container.querySelectorAll('.commission-followup a');assert.equal(links.length,2);
  for(const [index,code] of ['fr','en'].entries()){
    const name=new Intl.DisplayNames(['fr'],{type:'language'}).of(code),link=links[index];
    assert.equal(link.hasAttribute('lang'),false);assert.equal(link.hreflang,code);
    assert.equal(link.querySelector('span').lang,'fr');assert.equal(link.querySelector('span').textContent,name);
    assert.equal(link.textContent,`${name} · PDF ↗`);assert.equal(link.getAttribute('aria-label'),`Commission follow-up, ${name}, PDF`);
  }
});
test('invalid follow-up dates omit the date and leave the document and file readable',async t=>{
  const dates=['not-a-date','2026-13-40',''];
  const h=await harness(t,()=>response(adopted),()=>({status:'available',items:dates.map((documentDate,index)=>({...followupItem('SP-'+index),documentDate})),gaps:[]}));
  await h.render({request:directAdopted,language:'en'});
  const rows=h.container.querySelectorAll('.commission-followup');assert.equal(rows.length,dates.length);
  for(const row of rows){assert.equal(row.querySelector('time'),null);assert.equal(row.querySelector('p').textContent,'Commission follow-up · English · PDF ↗ ');assert(row.querySelector('a'));}
  assert(h.container.textContent.includes('Exact target passage.'));
});
test('follow-up fallback reuses the reader language wording',async t=>{
  const h=await harness(t,()=>response(adopted,sourceDocument(adopted),{requestedLanguage:'hu'}),()=>({status:'available',items:[followupItem()],gaps:[]}));await h.render({request:directAdopted,language:'hu'});
  assert(h.container.querySelector('.commission-followups').textContent.includes('magyar unavailable · showing angol'));assert(h.requests.includes('commission-followups/'+adopted+'?lang=hu'));
});
for(const reason of ['absent-files','rejected-files'])test('verified reply without '+reason+' keeps a readable row',async t=>{
  const h=await harness(t,()=>response(adopted),()=>({status:'partial',items:[followupItem('SP-one',[])],gaps:[{id:'SP-one',reason:'file-unavailable'}]}));await h.render({request:directAdopted,language:'en'});
  const row=h.container.querySelector('.commission-followup');assert(row.textContent.includes('File unavailable here.'));assert.equal(row.querySelector('a'),null);assert.equal(h.container.querySelector('.commission-followups [role="status"]'),null);
});
test('a failed linked reply exposes retry alongside earlier usable replies',async t=>{
  const h=await harness(t,()=>response(adopted),()=>({status:'partial',items:[followupItem()],gaps:[{id:'SP-two',reason:'lookup-failed'}]}));await h.render({request:directAdopted,language:'en'});
  assert(h.container.querySelector('.commission-followup a'));assert(h.container.querySelector('.commission-followups [role="status"] button'));assert(h.container.textContent.includes('Exact target passage.'));
});

for(const reason of ['lookup-failed','time-budget','unrecognised-relationship','malformed-relationship','record-rejected',
  'file-rejected','file-language-unavailable','file-identity-unavailable','file-unavailable']){
  for(const hasItems of [false,true])test(`follow-up status for ${reason}, items=${hasItems}`,async t=>{
    const retryable=['lookup-failed','time-budget'].includes(reason),recordGap=!reason.startsWith('file-');
    const h=await harness(t,()=>response(adopted),()=>({status:'partial',items:hasItems?[followupItem()]:[],gaps:[{id:null,reason}]}));
    await h.render({request:directAdopted,language:'en'});
    const notices=h.container.querySelectorAll('.commission-followups > [role="status"]');
    const expected=hasItems&&recordGap?'Some follow-up documents could not be checked.':!hasItems&&retryable?'Commission follow-up could not be checked.':null;
    assert.equal(notices.length,expected?1:0);
    assert.equal(h.container.querySelectorAll('.commission-followups > p').length,expected?1:0,'no duplicate status line');
    if(expected){assert(notices[0].textContent.startsWith(expected));assert.equal(!!notices[0].querySelector('button'),retryable);}
    assert.equal(!!h.container.querySelector('.commission-followup a'),hasItems,'file gaps do not hide a working link');
    assert(h.container.textContent.includes('Exact target passage.'));
  });
}

test('overlays preserve surrounding paragraph formatting and complete source tables',async t=>{
  for(const operation of ['insert','replace','delete','unresolved'])await t.test(operation,async t=>{
    const data=overlayResponse({operation:operation==='unresolved'?'insert':operation,status:operation==='unresolved'?'unresolved':'placed',reason:operation==='unresolved'?'resolution_extent_uncertain':undefined,span:operation==='replace'||operation==='delete'?{start:1,end:2}:undefined});
    const text=data.document.selectedText;
    text.paragraphs.push('Cell one','Cell two');
    Object.assign(text,{formatStatus:'extracted',paragraphFormats:[{heading:1,marks:[{start:0,end:3,kind:'bold'}]},{indent:2,hanging:2},{},{marks:[{start:4,end:13,kind:'italic'}]},{},{}],tables:[{rows:[[{start:4,end:5},{start:5,end:6}]],bordered:true}]});
    const h=await harness(t,()=>data);await h.render({request:overlayRequest,language:'en'});
    const reader=h.container.querySelector('.document-context-text'),block=reader.querySelector('[data-amendment-block]');assert(block);
    assert.equal(reader.querySelector('[data-source-paragraph="0"]').getAttribute('role'),'heading');
    assert.equal(reader.querySelector('[data-source-paragraph="0"] b').textContent,'The');
    assert.equal(reader.querySelector('[data-source-paragraph="3"] i').textContent,'Following');
    assert.deepEqual([...reader.querySelectorAll('table.doc-table-bordered td')].map(cell=>cell.textContent),['Cell one','Cell two']);
    if(operation==='insert')assert.equal(block.previousElementSibling.dataset.sourceParagraph,'2');
    if(operation==='replace'||operation==='delete')assert.equal(reader.querySelector('[data-source-paragraph="1"],[data-source-paragraph="2"]'),null);
    if(operation==='unresolved')assert.equal(reader.querySelectorAll('[data-context-target]').length,0);
  });
});

for(const [name,status,stale,refreshError] of [
  ['saved','available',true,null],
  ['refresh failed','available',false,'download-failed'],
  ['stale metadata','partial',false,null],
  ['stale content','partial',true,'download-failed'],
])test(`proposal ${name} distinguishes saved text from unavailable content`,async t=>{
  const value=proposalContextResponse(report,amendment,list,7);
  value.baseline.status=status;value.baseline.gaps=status==='partial'?['stale-metadata','stale-content']:[];value.baseline.items[0].source={...value.baseline.items[0].source,stale,refreshError};
  const h=await harness(t,()=>value);await h.render({request:overlayRequest,language:'en'});
  const notices=[...h.container.querySelectorAll('.document-context-notice')].map(node=>node.textContent);
  assert.equal(notices.includes('Some proposal content is unavailable.'),false,'a stale observation does not mean missing text');
  assert.doesNotMatch(notices.join(' '),/Partial text|Document files not loaded/);
  assert.equal(notices.includes('Couldn’t update the proposal. Showing saved text.'),!!refreshError);
  assert.equal(notices.includes('Showing saved proposal text.'),stale&&!refreshError);
  assert(!h.container.textContent.includes('authoritative'));assert(!h.container.textContent.includes('consolidated'));
  assert(h.container.querySelector('[data-amendment-block] del'));
  assert.equal(h.container.querySelector('.document-context-document>.document-context-source:last-child').textContent,'Legal text © European Union.');
});


test('proposal content gaps name missing files without counting saved-text freshness warnings',async t=>{
  const value=proposalContextResponse(report,amendment,list,7);
  value.baseline.status='partial';value.baseline.gaps=[
    {code:'download-failed',itemId:'annex-1'},
    {code:'parse-failed',itemId:'annex-1'},
    {code:'download-failed',itemId:'annex-2'},
    {code:'stale-content',itemId:'act'},
    {code:'bundle-too-large'},
  ];
  const h=await harness(t,()=>value);await h.render({request:overlayRequest,language:'en'});
  const notices=[...h.container.querySelectorAll('.document-context-notice')].map(node=>node.textContent);
  assert(notices.includes('Document files not loaded: 2.'));
  assert(notices.includes('Document file limit reached.'));
  assert(h.container.querySelector('[data-amendment-block] del'),'readable text remains usable');
});

test('an unresolved native annex ordinal is distinct from a missing source file',async t=>{
  const value=proposalContextResponse(report,amendment,list,7);
  value.baseline.status='partial';value.baseline.gaps=[{code:'native-annex-ordinal-unverified',itemId:'annex-1',reason:'native-annex-unnumbered'},{code:'download-failed',itemId:'annex-2'}];
  const original=structuredClone(value.baseline.gaps);
  const h=await harness(t,()=>value);await h.render({request:overlayRequest,language:'en'});
  const notices=[...h.container.querySelectorAll('.document-context-notice')].map(node=>node.textContent);
  assert(notices.includes('Document files not loaded: 1.'));
  assert(!notices.includes('Document files not loaded: 2.'));
  assert.equal(value.baseline.status,'partial');assert.deepEqual(value.baseline.gaps,original,'native source and legal-placement gaps remain literal');
  assert(h.container.querySelector('[data-amendment-block] del'));
});

for(const [name,mutate] of [
  ['nested document ID',d=>{d.document.id=otherAdopted;}],
  ['selected document ID',d=>{d.document.selectedDocumentId=otherAdopted;}],
  ['evidence amendment ID',d=>{d.target.evidence.amendmentId=report+'-AM-999';}],
  ['evidence list ID',d=>{d.target.evidence.listId=report+'-AM-999-999';}],
  ['evidence language',d=>{d.target.evidence.wordingLanguage='fr';}],
  ['missing evidence',d=>{delete d.target.evidence;}],
  ['variant list ID',d=>{d.amendment.variants[0].listId=report+'-AM-999-999';}],
  ['variant language',d=>{d.amendment.variants[0].language='fr';}],
  ['unknown selected language',d=>{d.amendment.variants[0].language=null;d.target.evidence.wordingLanguage=null;}],
  ['amendment ID',d=>{d.amendment.id=report+'-AM-999';}],
])test('Commission placement independently rejects '+name,async t=>{
  const request={documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}};
  for(const invalid of [false,true])await t.test(invalid?'independent mismatch':'valid control',async t=>{
    const value=proposalContextResponse(report,amendment,list,4);if(invalid)mutate(value);
    const h=await harness(t,()=>value);await h.render({request,language:'en'});
    assert.equal(h.container.querySelectorAll('[data-context-target="true"]').length,invalid?0:1);
    assert(h.container.querySelector('.proposal-context-text'),'full proposal stays readable');
    for(const [i,item] of value.proposal.items.entries())for(const paragraph of item.proposal.paragraphs){
      if(!invalid&&i===value.placement.itemIndex&&paragraph.index>=value.placement.span.start&&paragraph.index<=value.placement.span.end)continue;
      const node=h.container.querySelector(`[data-proposal-item="${item.kind}-${item.index}"] [data-source-paragraph="${paragraph.index}"]`);assert(node);if(!paragraph.objects.length)assert.equal(node.textContent,paragraph.text);
    }
    if(invalid){
      assert.equal(h.container.querySelector('[role="status"]').textContent,'The amendment’s location could not be confirmed.');
      assert(!h.container.textContent.includes('The published location and original wording do not agree.'));
      assert.equal(h.container.querySelector('[data-amendment-block]').hasAttribute('tabindex'),false);
      assert(![...h.container.querySelectorAll('button')].some(button=>button.textContent==='Go to amendment'));
    }
  });
});

test('Commission placement uses matching proposal fallback language without report text',async t=>{
  const value=proposalContextResponse(report,amendment,list,4);delete value.document.selectedText;
  value.requestedLanguage='fr';delete value.requestedWordingLanguage;
  const h=await harness(t,()=>value);
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,view:'document',onBack:()=>{}},language:'fr'});
  assert.equal(h.container.querySelectorAll('[data-context-target="true"]').length,1);
  assert.equal(h.container.querySelector('.proposal-context-text').lang,'en');
});

for(const reason of ['conflicting_target_evidence','math_comparison_unavailable','source_passage_incomplete'])test('Commission reader preserves resolver reason '+reason+' without client evidence',async t=>{
  const value=proposalContextResponse(report,amendment,list,4);
  // Establish the conflict through the resolver, with an unrelated original quote.
  if(reason==='conflicting_target_evidence'){
    value.placement=resolveProposalPlacement(value.proposal.items,{...value.amendment.variants[0],originalText:'Unrelated wording that does not occur in the proposal.'});
    assert.equal(value.placement.status,'unresolved');assert.equal(value.placement.reason,reason);
  }else value.placement={...value.placement,status:'unresolved',reason};
  delete value.target.evidence;
  const h=await harness(t,()=>value);
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
  const copy={conflicting_target_evidence:'The published location and original wording do not agree.',math_comparison_unavailable:'The equations could not be compared.',source_passage_incomplete:'The source passage is incomplete.'};
  assert.equal(h.container.querySelector('[role="status"]').textContent,copy[reason]);
  assert.equal(h.container.querySelectorAll('[data-context-target="true"]').length,0);
  assert(![...h.container.querySelectorAll('button')].some(button=>button.textContent==='Go to amendment'));
  for(const item of value.proposal.items)for(const paragraph of item.proposal.paragraphs){const node=h.container.querySelector(`[data-proposal-item="${item.kind}-${item.index}"] [data-source-paragraph="${paragraph.index}"]`);assert(node);if(!paragraph.objects.length)assert.equal(node.textContent,paragraph.text);}
});

test('an unknown selected wording language withholds otherwise valid Commission placement neutrally',async t=>{
  for(const wordingLanguage of ['en',null])await t.test(wordingLanguage??'unknown',async t=>{
    const value=proposalContextResponse(report,amendment,list,4);value.requestedWordingLanguage=wordingLanguage;
    const h=await harness(t,()=>value);
    await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage,view:'document',onBack:()=>{}},language:'en'});
    assert.equal(h.container.querySelectorAll('[data-context-target="true"]').length,wordingLanguage?1:0);
    assert.equal([...h.container.querySelectorAll('button')].some(button=>button.textContent==='Go to amendment'),!!wordingLanguage);
    if(!wordingLanguage){
      assert.equal(h.container.querySelector('[role="status"]').textContent,'The amendment’s location could not be confirmed.');
      for(const item of value.proposal.items)for(const paragraph of item.proposal.paragraphs)assert(h.container.querySelector(`[data-proposal-item="${item.kind}-${item.index}"] [data-source-paragraph="${paragraph.index}"]`));
    }
  });
});

const taOpening=['European Parliament','2024-2029','\uFFFC','TEXTS ADOPTED','P10_TA(2026)0007','Murder of Mehdi Kessaci – urgent need for ambitious European action against drug trafficking','European Parliament resolution of 20 January 2026 on the murder of Mehdi Kessaci: urgent need for ambitious European action against drug trafficking (2025/3020(RSP))','The European Parliament,','–\thaving regard to the Treaty on European Union (TEU),','1.\tCalls for action;'];
const logoWarning='A drawing, equation or other document object is shown as a placeholder; the surrounding text is retained.';
function taText(){return {
  structureStatus:'extracted',paragraphSources:taOpening.map((p,i)=>({path:`/w:document[1]/w:body[1]/w:p[${i+1}]`,ordinal:i,container:'body',containerPath:'/w:document[1]/w:body[1]',segment:0,complete:i!==2})),
  documentObjects:[{paragraph:2,offset:0,path:'/w:document[1]/w:body[1]/w:p[3]/w:r[1]/w:drawing[1]',kind:'drawing',status:'unresolved'}],extractionWarnings:[logoWarning],
};}
test('an exact adopted masthead omits its logo notice while body notes and links keep source offsets',async t=>{
  const id='TA-10-2026-0007',extra={...taText(),notes:[{id:'fn1',label:'1',text:'Source note.',links:[]}],noteAnchors:[{paragraph:8,offset:2,note:'fn1',label:'1'}],documentLinks:[{paragraph:9,start:3,end:8,url:'https://www.europarl.europa.eu/'}]};
  const h=await harness(t,()=>response(id,sourceDocument(id,taOpening,extra)));await h.render({request:{documentId:id,view:'document'},language:'en'});
  const reader=h.container.querySelector('.document-context-text');
  assert.equal(reader.querySelector('[data-source-paragraph]').dataset.sourceParagraph,'6');
  assert.equal(reader.querySelector('[data-source-paragraph="6"]').textContent,taOpening[6]);
  assert(!h.container.textContent.includes('Some content is only available'));
  assert(!h.container.textContent.includes('Image in original'));
  assert(!reader.textContent.includes('TEXTS ADOPTED'));assert(!reader.textContent.includes('P10_TA'));
  assert(reader.querySelector('[data-source-paragraph="8"] sup'));
  assert.equal(reader.querySelector('[data-source-paragraph="9"] a').textContent,'Calls');
  assert(h.container.querySelector('.document-context-source a'));
});
test('adopted readers retain missing-content notices for body, note, structure and non-logo cover gaps',async t=>{
  for(const variant of ['body-drawing','note-object','numbering-warning','missing-note','unknown-structure','invalid-position','missing-object','incomplete-body','incomplete-cover','cover-target'])await t.test(variant,async t=>{
    const id='TA-10-2026-0007',paragraphs=[...taOpening],extra=taText();let targetExtra={};
    if(variant==='body-drawing'){paragraphs[9]+='\uFFFC';extra.paragraphSources[9].complete=false;extra.documentObjects.push({paragraph:9,offset:paragraphs[9].length-1,kind:'drawing',status:'unresolved'});}
    if(variant==='note-object')extra.notes=[{id:'fn1',label:'1',text:'Source note \uFFFC',links:[]}];
    if(variant==='numbering-warning')extra.extractionWarnings.push('Some automatic numbering uses an unsupported format or value.');
    if(variant==='missing-note')extra.notesStatus='not-extracted';
    if(variant==='unknown-structure')extra.structureStatus='not-extracted';
    if(variant==='invalid-position')extra.documentObjects[0].offset=99;
    if(variant==='missing-object')extra.documentObjects=[];
    if(variant==='incomplete-body')extra.paragraphSources[9].complete=false;
    if(variant==='incomplete-cover')extra.paragraphSources[5].complete=false;
    if(variant==='cover-target')targetExtra={amendment:amendmentSource,target:{...target,paragraphs:[2]}};
    const h=await harness(t,()=>response(id,sourceDocument(id,paragraphs,extra),targetExtra));
    await h.render({request:{documentId:id,view:'document',...(variant==='cover-target'?{amendmentId:amendment}:{})},language:'en'});
    assert(h.container.textContent.includes('Some content is only available in the original document.'),variant);
    if(variant==='body-drawing'||variant==='cover-target')assert(h.container.textContent.includes('Image in original'));
  });
});

const reportFallbackParagraphs=['Cover page.','DRAFT EUROPEAN PARLIAMENT LEGISLATIVE RESOLUTION','Resolution context.','Amendment\t\t1','First comparison.','Amendment\t\t2','Second comparison.','EXPLANATORY STATEMENT','Explanation.','OPINION OF THE COMMITTEE ON DEVELOPMENT','Amendment 1','Opinion comparison.','Amendment 2','Another opinion comparison.'];
function reportFallbackText(paragraphs=reportFallbackParagraphs) {
  return sourceDocument(report,[...paragraphs],{structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))});
}
const fallbackRequest={documentId:report,amendmentId:report+'-AM-2',listId:report+'-AM-001-002',wordingLanguage:'en',view:'document',onBack:()=>{}};
const fallbackResponse=(doc=reportFallbackText())=>response(report,doc,{requestedWordingLanguage:'en',amendment:{id:report+'-AM-2',status:'unavailable',variants:[{listId:fallbackRequest.listId,language:'en',wordingStatus:'unavailable',originalText:null,proposedText:null}]},placement:{status:'unresolved',reason:'amendment_wording_unavailable'}});

test('unavailable wording opens the exact main-report amendment and keeps the cover and opinion readable',async t=>{
  const h=await harness(t,()=>fallbackResponse());await h.render({request:fallbackRequest,language:'en'});
  const selected=h.container.querySelector('[data-report-amendment="true"]');
  assert.equal(selected.dataset.sourceParagraph,'5');assert.equal(selected.textContent,'Amendment\t\t2');
  assert.equal(h.scrolls.at(-1).element,selected);assert.equal(h.window.document.activeElement,selected);
  assert(h.container.textContent.includes('Cover page.'));assert(h.container.textContent.includes('Another opinion comparison.'));
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0,'A source heading is not a verified overlay placement.');
  assert(!h.container.textContent.includes('The amendment wording is unavailable.'));
  await h.click([...h.container.querySelectorAll('button')].find(button=>button.textContent==='Go to amendment'));
  assert.equal(h.scrolls.at(-1).element,selected);
});

for(const language of ['fr','lv','mt'])test(`unavailable ${language} wording navigates to its published report heading without a placement`,async t=>{
  const {editions}=JSON.parse(readFileSync(new URL('../server/fixtures/report-amendment-headings.json',import.meta.url)));
  const edition=editions.find(item=>item.language===language);
  const paragraphs=[edition.opening[1],...edition.amendmentOrdinals.map((_,i)=>edition.amendmentHeading.replace('{number}',String(i+1))),edition.ends[0][1],edition.opinion.heading[1],...edition.opinion.amendments.map(row=>row[1])];
  const doc=reportFallbackText(paragraphs);doc.id=edition.documentId;doc.selectedDocumentId=edition.documentId;
  Object.assign(doc.selectedText,{textLanguage:language,requestedLanguage:language,availableTextLanguages:[language]});
  const request={documentId:edition.documentId,amendmentId:edition.documentId+'-AM-2',listId:edition.listId,wordingLanguage:language,view:'document'};
  const value={...fallbackResponse(doc),documentId:edition.documentId,requestedLanguage:language,requestedWordingLanguage:language,amendment:{id:request.amendmentId,status:'unavailable',variants:[]}};
  const h=await harness(t,()=>value);await h.render({request,language});
  const selected=h.container.querySelector('[data-report-amendment="true"]');
  assert.equal(selected?.dataset.sourceParagraph,'2');assert.equal(selected.textContent,paragraphs[2]);
  assert.equal(h.window.document.activeElement,selected);assert.equal(h.scrolls.at(-1).element,selected);
  assert.equal(h.container.querySelectorAll('[data-context-target]').length,0);
  await h.click([...h.container.querySelectorAll('button')].find(button=>button.textContent==='Go to amendment'));
  assert.equal(h.scrolls.at(-1).element,selected);
});

for(const variant of ['wrong-list','wrong-document','opinion-only','duplicate','missing-section-end','incomplete-heading','table-heading','sequence-gap','other-language'])test('report heading fallback withholds '+variant,async t=>{
  const doc=reportFallbackText(),request={...fallbackRequest};
  if(variant==='wrong-list')request.listId=report+'-AM-003-004';
  if(variant==='wrong-document')request.amendmentId='A-10-2026-9999-AM-2';
  if(variant==='opinion-only')doc.selectedText.paragraphs[5]='No main heading.';
  if(variant==='duplicate')doc.selectedText.paragraphs[6]='Amendment 2';
  if(variant==='missing-section-end')doc.selectedText.paragraphs=doc.selectedText.paragraphs.slice(0,7);
  if(variant==='incomplete-heading')doc.selectedText.paragraphSources[5].complete=false;
  if(variant==='table-heading')doc.selectedText.paragraphSources[5].container='table-cell';
  if(variant==='sequence-gap')doc.selectedText.paragraphs[3]='Amendment 7';
  if(variant==='other-language')doc.selectedText.textLanguage='fr';
  const h=await harness(t,()=>fallbackResponse(doc));await h.render({request,language:'en'});
  assert.equal(h.container.querySelectorAll('[data-report-amendment]').length,0);assert.equal(h.scrolls.length,0);
  assert(h.container.textContent.includes('The amendment wording is unavailable.'));
});

test('title-case opinion headings cannot provide the main report amendment sequence',async t=>{
  const doc=reportFallbackText(['Cover page.','DRAFT EUROPEAN PARLIAMENT LEGISLATIVE RESOLUTION','No main comparison.','Opinion of the Committee on Development','Amendment 1','Opinion wording.','Amendment 2','More opinion wording.','PROCEDURE']);
  const h=await harness(t,()=>fallbackResponse(doc));await h.render({request:fallbackRequest,language:'en'});
  assert.equal(h.container.querySelectorAll('[data-report-amendment]').length,0);assert.equal(h.scrolls.length,0);
  assert(h.container.textContent.includes('The amendment wording is unavailable.'));
});


for(const [name,originalText,sourceText] of [
  ['punctuation','CO2.','1. CO2;'],
  ['quotation','CO2 "target".','1. CO2 “target”.'],
])test(`placed ${name} normalization keeps column formatting without inventing a change in either mode`,async t=>{
  const paragraphs=['Article 1',sourceText];
  const proposal=parseProposal({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map((_,i)=>({styleId:i?'Normal':'Titrearticle',numberingComplete:true,notesComplete:true}))});
  const value=proposalContextResponse(report,amendment,list,4),items=[{kind:'act',index:1,proposal}],marks=[{start:2,end:3,kind:'subscript'}];
  const variant={...value.amendment.variants[0],targetLabel:'Article 1 – paragraph 1',targetPath:{proposal:[],underlying:[],language:'en'},originalText,proposedText:originalText,originalFormatting:marks,proposedFormatting:marks};
  Object.assign(value,{proposal:{items},amendment:{...value.amendment,variants:[variant]},placement:resolveProposalPlacement(items,variant)});
  assert.equal(value.placement.status,'placed');assert.notEqual(value.placement.originalText,originalText);
  const h=await harness(t,()=>value);
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');assert.equal(block.dataset.contextTarget,'true');
  for(const mode of ['Changes','Side by side']) {
    await h.click([...block.querySelectorAll('button')].find(button=>button.textContent===mode));
    assert.equal(wordingText(block,'original'),originalText);assert.equal(wordingText(block,'proposed'),originalText);
    assert.equal(block.querySelector('del,ins'),null,'normalization must not become a wording or formatting edit');
    assert.deepEqual([...block.querySelectorAll('sub')].map(node=>node.textContent),mode==='Changes'?['2']:['2','2']);
  }
});

test('a separated provision prefix keeps later subscript ranges and source links aligned in both modes',async t=>{
  const sourceText='1.\tLead CO2 text.',originalText='Lead CO2 text.',proposedText='Lead CO2 revised text.';
  const paragraphs=['Article 1',sourceText];
  const parsed=parseProposal({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map((_,i)=>({styleId:i?'Normal':'Titrearticle',numberingComplete:true,notesComplete:true}))});
  const linkStart=sourceText.indexOf('text');
  const proposal={...parsed,links:[...parsed.links,{paragraph:1,start:linkStart,end:linkStart+4,url:'https://example.org/after-subscript'}]};
  const value=proposalContextResponse(report,amendment,list,4),items=[{kind:'act',index:1,proposal}],marks=[{start:7,end:8,kind:'subscript'}];
  const variant={...value.amendment.variants[0],targetLabel:'Article 1 – paragraph 1',targetPath:{proposal:[],underlying:[],language:'en'},originalText,proposedText,originalFormatting:marks,proposedFormatting:marks};
  Object.assign(value,{proposal:{items},amendment:{...value.amendment,variants:[variant]},placement:resolveProposalPlacement(items,variant)});
  assert.equal(value.placement.status,'placed');assert.equal(value.placement.originalText,sourceText);
  const h=await harness(t,()=>value);
  await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');
  for(const mode of ['Changes','Side by side']) {
    await h.click([...block.querySelectorAll('button')].find(button=>button.textContent===mode));
    assert.equal(block.querySelector('[data-source-label]').textContent,'1.');
    assert.equal(wordingText(block,'original'),originalText);assert.equal(wordingText(block,'proposed'),proposedText);
    const subscripts=[...block.querySelectorAll('sub')];
    assert.deepEqual(subscripts.map(node=>node.textContent),mode==='Changes'?['2']:['2','2']);
    assert(subscripts.every(node=>!node.closest('ins,del')),'unchanged subscript must not become a formatting edit');
    assert.equal(block.querySelector('a[href="https://example.org/after-subscript"]').textContent,'text','annotation callback shifts comparison offsets past the source prefix exactly once');
    if(mode==='Side by side')assert.equal(block.querySelectorAll('.wording-diff__columns section')[1].querySelector('a'),null);
  }
});

test('failed and missing document bodies retain exact amendment wording, summary and Back',async t=>{
  for(const body of ['error','unavailable','missing'])await t.test(body,async t=>{
    const doc=body==='missing'?null:sourceDocument(report,[],{status:body});
    const data=response(report,doc,{requestedLanguage:'fr',requestedWordingLanguage:'fr',amendment:{...amendmentSource,variants:[wordingVariant('fr')]},placement:{status:'unresolved',operation:null,reason:'baseline_unavailable',evidence:[]}});
    const h=await harness(t,()=>data);let backs=0;
    await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'fr',view:'document',backLabel:'Back to vote',summary:el('p',null,'Vote summary stays visible'),onBack:()=>backs++},language:'en'});
    assert.match(h.container.textContent,/Vote summary stays visible/);
    const block=h.container.querySelector('[data-amendment-block]');assert(block);
    await h.click([...block.querySelectorAll('button')].find(button=>button.textContent==='Side by side'));
    assert.deepEqual(['original','proposed'].map(side=>wordingText(block,side)),['Original wording.','Proposed wording.']);
    assert.equal(block.querySelector('.wording-diff__passage').getAttribute('lang'),'fr');
    assert.equal(h.container.querySelector('[data-context-target]'),null);
    if(body==='error')assert(h.container.querySelector('[role="alert"] button'),'retry survives a failed extraction');
    await h.click(h.container.querySelector('.document-context-back'));assert.equal(backs,1);
  });
});

test('Council context uses the Council label, comparison heading and public reading link',async t=>{
  const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/council-position-excerpts.json',import.meta.url),'utf8'));
  const value=proposalContextResponse(report,amendment,list,4),proposal=parsePublicLegalXhtml(fixture.xhtml,{language:'en',sourceUrl:fixture.sourceUrl});
  const variant={...value.amendment.variants[0],baseline:'council-position',baselineSource:{category:'council-position',conflicted:false},targetPath:null,targetLabel:'Article 30 – title',targetLabelLanguage:'en',originalText:'Code of conduct',proposedText:'Binding code of conduct'};
  value.baseline={...value.baseline,kind:'council-position',celex:fixture.celex};value.proposal.items=[{kind:'act',index:1,proposal}];value.amendment.variants=[variant];value.placement=resolveProposalPlacement(value.proposal.items,variant);
  const h=await harness(t,()=>value);await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
  assert.equal(value.placement.status,'placed');assert(h.container.querySelector('[data-context-target="true"]'));
  assert(h.container.textContent.includes('Council position · 6/2026'));
  assert(!h.container.textContent.includes('Commission proposal'));assert(!h.container.textContent.includes('DOCX'));
  assert(h.container.querySelector('a[href*="CELEX:52026AG0006"]'));
  assert(h.container.querySelector('.document-context-amendment h4').textContent.includes('Council position'));
});

test('existing-act context compares the inner replacement and keeps its amending instruction separate',async t=>{
  const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/existing-law-excerpts.json',import.meta.url),'utf8'))[0];
  const {resolveExistingLawPlacement}=await import('../server/existing-law-placement.mjs');
  const value=proposalContextResponse(report,amendment,list,4),proposal=parsePublicLegalXhtml(fixture.xhtml,{language:'en',sourceUrl:fixture.sourceUrl,identity:{work:fixture.workId,celex:fixture.celex}});
  const originalText='1. Any importer established in a\u00a0Member State shall, prior to importing goods into the customs territory of the Union, apply for the status of authorised CBAM declarant (“application for an authorisation”).';
  const variant={...value.amendment.variants[0],baseline:'present-text',baselineSource:{category:'present-text',conflicted:false},documentDate:'2026-09-09',targetPath:{proposal:[{raw:'Article 1 – paragraph 1 – point 3 b (new)'}],underlying:[{document:'Regulation (EU) 2023/956',raw:'Article 5 – paragraph 1'}]},originalText,proposedText:'(3b) in Article 5, paragraph 1 is replaced by the following:\n"1. Replacement wording." ;'};
  value.baseline={...value.baseline,kind:'existing-act',baseCelex:fixture.baseCelex,actLabel:'Regulation (EU) 2023/956',consolidationDate:fixture.date,amendmentDate:variant.documentDate,workId:fixture.workId,celex:fixture.celex};value.proposal.items=[{kind:'act',index:1,proposal}];value.amendment.variants=[variant];value.placement=resolveExistingLawPlacement(value.proposal.items,variant,value.baseline);
  assert.equal(value.placement.status,'placed');
  const h=await harness(t,()=>value);await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
  assert(h.container.querySelector('[data-context-target="true"]'));assert(h.container.textContent.includes('Existing act · Regulation (EU) 2023/956 · 2025-10-20'));
  const block=h.container.querySelector('[data-amendment-block]');await h.click([...block.querySelectorAll('button')].find(b=>b.textContent==='Side by side'));
  assert.equal(wordingText(block,'proposed'),'1. Replacement wording.');assert.match(block.querySelector('.document-context-instruction').textContent,/paragraph 1 is replaced/);
  assert(block.querySelector('.wording-diff__columns').textContent.includes('Existing act'));
  assert(h.container.querySelector('a[href*="CELEX:02023R0956-20251020"]'));assert(!h.container.textContent.includes('Commission proposal'));
});

test('an existing-act point keeps its source label when the amendment column omits it',async t=>{
  const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/existing-law-excerpts.json',import.meta.url),'utf8'))[0];
  const {resolveExistingLawPlacement}=await import('../server/existing-law-placement.mjs');
  const value=proposalContextResponse(report,amendment,list,4),proposal=parsePublicLegalXhtml(fixture.xhtml,{language:'en',sourceUrl:fixture.sourceUrl,identity:{work:fixture.workId,celex:fixture.celex}});
  const originalText='slightly modifying the goods concerned to make those goods fall under CN codes which are not listed in Annex I, except where the modification alters their essential characteristics;';
  const variant={...value.amendment.variants[0],baseline:'present-text',baselineSource:{category:'present-text',conflicted:false},documentDate:'2026-09-09',targetPath:{proposal:[{raw:'Article 1 – paragraph 1 – point 15 b (new)'}],underlying:[{document:'Regulation (EU) 2023/956',raw:'Article 27 – paragraph 2 – point a'}]},originalText,proposedText:'(15b) In Article 27(2), point a is replaced by the following:\n"Changed wording;"'};
  value.baseline={...value.baseline,kind:'existing-act',baseCelex:fixture.baseCelex,consolidationDate:fixture.date,amendmentDate:variant.documentDate,workId:fixture.workId,celex:fixture.celex};value.proposal.items=[{kind:'act',index:1,proposal}];value.amendment.variants=[variant];value.placement=resolveExistingLawPlacement(value.proposal.items,variant,value.baseline);
  assert.equal(value.placement.status,'placed');
  const h=await harness(t,()=>value);await h.render({request:{documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',view:'document',onBack:()=>{}},language:'en'});
  const block=h.container.querySelector('[data-amendment-block]');assert.equal(block.querySelector('[data-source-label]').textContent,'(a)');
  await h.click([...block.querySelectorAll('button')].find(b=>b.textContent==='Side by side'));assert.equal(wordingText(block,'original'),originalText);assert.equal(wordingText(block,'proposed'),'Changed wording;');
});

const reportCover=['European Parliament\t\uFFFC','2024-2029','Plenary sitting','A10-0275/2025','22.12.2025','***I','REPORT','on defence procurement','Report body.'];
function reportLogoText(paragraphs=reportCover){return {structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:ordinal!==0})),documentObjects:[{paragraph:0,offset:20,kind:'drawing',status:'unresolved'}],extractionWarnings:[logoWarning]};}
test('report masthead logos produce neither image links nor missing-content notices and preserve source offsets',async t=>{
  const id='A-10-2025-0275',extra={...reportLogoText(),noteAnchors:[{paragraph:8,offset:6,note:'fn1',label:'1'}],notes:[{id:'fn1',label:'1',text:'Report note.',links:[]}]};
  const h=await harness(t,()=>response(id,sourceDocument(id,reportCover,extra)));await h.render({request:{documentId:id,view:'document'},language:'en'});
  assert(!h.container.textContent.includes('Image in original'));
  assert(!h.container.textContent.includes('Some content is only available'));
  assert.equal(h.container.querySelector('[data-source-paragraph="0"]').textContent,'European Parliament\t');
  assert(h.container.querySelector('[data-source-paragraph="8"] sup'));
  assert(h.container.querySelector('[data-source-paragraph="8"]').textContent.includes('body.'));
});
test('report logo suppression retains real image, note and extraction gaps and rejects mismatched covers',async t=>{
  for(const variant of ['body-image','note-image','warning','wrong-reference','unknown-structure','non-drawing','caption'])await t.test(variant,async t=>{
    const id='A-10-2025-0275',paragraphs=[...reportCover],extra=reportLogoText();
    if(variant==='body-image'){paragraphs[8]+='\uFFFC';extra.documentObjects.push({paragraph:8,offset:12,kind:'drawing',status:'unresolved'});}
    if(variant==='note-image')extra.notes=[{id:'fn1',label:'1',text:'Note \uFFFC',links:[]}];
    if(variant==='warning')extra.extractionWarnings.push('Unsupported numbering.');
    if(variant==='wrong-reference')paragraphs[3]='A10-0276/2025';
    if(variant==='unknown-structure')extra.structureStatus='not-extracted';
    if(variant==='non-drawing')extra.documentObjects[0].kind='math';
    if(variant==='caption')paragraphs[0]+=' Figure caption';
    const h=await harness(t,()=>response(id,sourceDocument(id,paragraphs,extra)));await h.render({request:{documentId:id,view:'document'},language:'en'});
    assert(h.container.textContent.includes('Some content is only available'));
    assert.equal(h.container.querySelectorAll('.document-context-object').length,variant==='note-image'||variant==='warning'?0:1);
  });
});

test('inline pictures preserve surrounding links, note anchors and table-cell positions, and can enlarge',async t=>{
  const assetId='f'.repeat(64),data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1cAAAAASUVORK5CYII=',image={id:assetId,displayWidth:320,displayHeight:80,description:'Published figure description',title:'',part:'word/document.xml',target:'word/media/chart.png',relationshipId:'rId9',mime:'image/png',width:1,height:1};
  const h=await harness(t,()=>response(report,sourceDocument(report,['Heading','Before\uFFFC after'],{
    documentObjects:[{paragraph:1,offset:6,path:'/document/p/r/drawing',kind:'drawing',status:'unresolved',image}],
    imageAssets:{[assetId]:{mime:'image/png',width:1,height:1,sha256:assetId,sourceHash:'a'.repeat(64)}},
    notes:[{id:'1',label:'1',text:'Note \uFFFC end',links:[],objects:[{offset:5,replacement:'\uFFFC',kind:'drawing',image}]}],noteAnchors:[{paragraph:1,offset:7,note:'1',label:'1'}],
    documentLinks:[{paragraph:1,start:0,end:6,url:'https://example.com/source'}],formatStatus:'extracted',paragraphFormats:[{},{}],tables:[{rows:[[{start:1,end:2}]]}]
  })));
  await h.render({request:{documentId:report,view:'document',onBack:()=>{}},language:'en'});
  const cell=h.container.querySelector('td'),img=cell.querySelector('img');assert(img);assert.equal(img.alt,'Published figure description');assert.equal(img.style.width,'320px');assert.equal(img.style.aspectRatio,'320 / 80');assert.equal(img.src,'http://localhost/api/document-image/'+ 'a'.repeat(64)+'/'+assetId);
  assert(cell.textContent.includes('Before'));assert(cell.textContent.includes(' after'));assert.equal(cell.querySelector('sup').textContent,'1');assert.equal(cell.querySelector('a').textContent,'Before');
  assert(h.container.querySelector('.legal-notes img'));
  await h.click(cell.querySelector('button'));assert.equal(cell.querySelector('button').getAttribute('aria-expanded'),'true');assert.match(cell.querySelector('button').textContent,/Fit image/);
  assert(h.container.textContent.includes('View original pages'));assert.equal(h.requests.filter(route=>route.startsWith('document-pages')).length,0,'PDF stays lazy');
});
