import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement as el,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const languages=['en','hu','fr'];
const effectiveLanguage=element=>element.closest('[lang]')?.getAttribute('lang');
const questionId='COM-PR-12345',speechId='MTG-PL-2026-03-25-OTH-2017069380111';
const sourceText='Exact source passage with accents: énergie, közlekedés.';
const question=(language)=>({id:questionId,selectedDocumentId:questionId,files:[],answers:[],selectedText:{status:'available',paragraphs:['Exact source header','CONTENTS','DRAFT REPORT',sourceText],textLanguage:language,availableTextLanguages:languages,translationType:'original',sourceFormat:'DOCX',sourceUrl:'https://www.europarl.europa.eu/document.docx',notes:[{id:'1',label:'1',text:'Exact source note',links:['https://example.org/note']} ]}});
const speech=(language)=>({id:speechId,kind:'PLENARY_DEBATE_SPEECH',start:null,end:null,speakers:[{id:'1',name:'Ágnes Élodie',role:'présidente',nameSource:'fixture'},{id:'2',name:'Other speaker',role:'Chairing the sitting',nameSource:'fixture'}],xml:'<speech><p>'+sourceText+'</p></speech>',textLanguage:language,availableTextLanguages:languages,translationType:'machine',websiteUrl:'https://www.europarl.europa.eu/transcript.html'});

test('speaker names and sitting roles follow the UI independently of the selected transcript language',async t=>{
  const person={id:'256986',name:'Γεάδης Γεάδη',sittingRole:'chair',office:{code:'vice-president-parliament'},nameVariants:[
    {value:'Geadis Geadi',script:'Latn',language:null,source:'ODP person'},
    {value:'Γεάδης Γεάδη',script:'Grek',language:null,source:'ODP person'},
  ]};
  const connectedId=speechId+'2';
  const h=await harness(t,(route,params)=>route.startsWith('speech/')?{...speech(params.get('lang')),speakers:[person]}:route.startsWith('speech-context/')?{speechId,unavailable:false,debates:[{id:'MTG-PL-2026-03-25-PVCRE-ITM-1',titles:{en:'Public debate fixture'},records:[{id:connectedId,start:null,intervention:{type:'speech',speaker:{...person,sittingRole:undefined,office:null},onBehalfOf:[]},replyTo:null,exchangeId:null}],exchanges:[],coverage:{complete:true,available:1,expected:1}}]}:undefined);
  await h.render(el(h.InsightSpeechReader,{id:speechId,language:'en'}),'en');
  assert.equal(h.container.querySelector('h3').textContent,'Geadis Geadi');
  assert.equal(h.container.querySelector('.insight-secondary').textContent,'Vice-President of the European Parliament · Chairing the sitting');
  await h.change(h.container.querySelector('.insight-reader-heading select'),'fr');
  assert.equal(h.container.querySelector('.insight-reader-text').lang,'fr');
  assert.equal(h.container.querySelector('h3').textContent,'Geadis Geadi');
  assert(h.container.querySelector('.insight-secondary').textContent.includes('Vice-President'));
  await h.click(h.container.querySelector('.intervention-context-toggle'));
  assert(h.requests.some(request=>request.startsWith('speech-context/')&&request.endsWith('lang=en')));
  assert(!h.requests.some(request=>request.startsWith('speech-context/')&&request.endsWith('lang=fr')));
  await h.click(h.container.querySelector('.intervention-read'));
  assert(h.requests.includes(`speech/${connectedId}?lang=fr`),'connected contributions preserve the chosen transcript language');
  assert.equal(h.container.querySelector('.intervention-connected-text').lang,'fr');
  assert.equal(h.container.querySelector('.intervention-read>span').textContent,'Geadis Geadi','connected-row names still use the English UI');
  await h.render(el(h.InsightSpeechReader,{id:speechId,language:'el'}),'el');
  assert.equal(h.container.querySelector('h3').textContent,'Γεάδης Γεάδη');
  assert.equal(h.container.querySelector('.insight-secondary span').lang,'el');
});

async function harness(t,respond) {
  const window=new Window({url:'http://localhost/'}),requests=[],scrolls=[];
  class ReaderDOMParser extends window.DOMParser {
    parseFromString(...args) {
      const parsed=super.parseFromString(...args),query=parsed.getElementsByTagNameNS.bind(parsed);
      // Happy DOM lacks wildcard namespace queries used by the real reader.
      parsed.getElementsByTagNameNS=(namespace,name)=>namespace==='*'?parsed.getElementsByTagName(name):query(namespace,name);
      return parsed;
    }
  }
  const globals={window,document:window.document,DOMParser:ReaderDOMParser,HTMLElement:window.HTMLElement,matchMedia:()=>({matches:true}),requestAnimationFrame:callback=>setTimeout(callback,0),cancelAnimationFrame:clearTimeout,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(window.HTMLElement.prototype,'scrollIntoView',function(options){scrolls.push({element:this,options});});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href),route=url.pathname.split('/poc/')[1];
    assert(route,'Only local mocked application routes are allowed');requests.push(route+url.search);
    const data=respond(route,url.searchParams);assert.notEqual(data,undefined,'Unexpected fixture request: '+route+url.search);
    return Response.json(data);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const [readers,references,cloud,procedure]=await Promise.all(['/src/PocInsightReaders.tsx','/src/PocReferences.tsx','/src/PocSpeechCloud.tsx','/src/PocProcedureContext.tsx'].map(path=>vite.ssrLoadModule(path)));
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const settle=(delay=10)=>act(async()=>new Promise(resolve=>setTimeout(resolve,delay)));
  const render=async(element,language='hu')=>{container.lang=language;document.documentElement.lang=language;await act(async()=>root.render(element));await settle();};
  const click=async element=>{assert(element,'Missing fixture control');await act(async()=>{element.focus();element.click();});await settle();};
  const change=async(element,value)=>{assert(element,'Missing fixture selector');await act(async()=>{element.value=value;element.dispatchEvent(new window.Event('change',{bubbles:true}));});await settle();};
  return {window,container,requests,scrolls,render,click,change,settle,...readers,...references,...cloud,...procedure};
}

test('reader controls stay English while EN/HU/FR source passages and language changes keep their actual tags',async t=>{
  for(const kind of ['question','speech'])await t.test(kind,async t=>{
    const h=await harness(t,(route,params)=>route.startsWith('document/')?question(params.get('lang')):route.startsWith('speech/')?speech(params.get('lang')):undefined);
    for(const language of languages) {
      const Component=kind==='question'?h.InsightQuestionReader:h.InsightSpeechReader;
      await h.render(el(Component,{key:language,id:kind==='question'?questionId:speechId,language}),language);
      const body=()=>h.container.querySelector('.insight-reader-text');
      assert.equal(effectiveLanguage(body()),language);
      assert(body().textContent.includes(sourceText));
      assert.equal(body().closest('[aria-live],[role="status"]'),null,'source text stays outside status regions');
      assert.equal(effectiveLanguage(h.container.querySelector('.insight-reader-heading select')),'en');
      assert.equal(effectiveLanguage(h.container.querySelector('button[aria-label^="Find in"]')),'en');
      if(kind==='question') {
        assert.equal(effectiveLanguage(h.container.querySelector('.insight-reader-source > p')),language,'extracted headers retain source language');
        assert.equal(effectiveLanguage(h.container.querySelector('.legal-notes summary')),'en');
        assert.equal(effectiveLanguage(h.container.querySelector('.legal-notes li')),language);
        assert.equal(effectiveLanguage(h.container.querySelector('.legal-notes li .source-link span')),'en','the added Link action is English');
        assert.equal(effectiveLanguage(h.container.querySelector('.insight-reader-source summary')),'en');
      } else {
        assert.equal(effectiveLanguage(h.container.querySelector('h3')),'','speaker names have no guessed language');
        assert.deepEqual([...h.container.querySelectorAll('.insight-secondary span')].map(effectiveLanguage),['',language]);
        assert.equal(effectiveLanguage(h.container.querySelector('.insight-machine-label')),'en');
        assert.equal(effectiveLanguage(h.container.querySelector('.insight-source-document')),'en');
      }
      const next=language==='fr'?'hu':'fr';
      await h.change(h.container.querySelector('.insight-reader-heading select'),next);assert.equal(effectiveLanguage(body()),next);
      await h.change(h.container.querySelector('.insight-reader-heading select'),'en');assert.equal(effectiveLanguage(body()),'en');
      assert.equal(effectiveLanguage(h.container.querySelector('button[aria-label^="Find in"]')),'en');
    }
  });
});

test('reader fallbacks separate localized display names from English copy and preserve unknown, mul and und metadata',async t=>{
  for(const actual of ['en','fr',null,'mul','und'])await t.test(String(actual),async t=>{
    const h=await harness(t,route=>route.startsWith('document/')?question(actual):route.startsWith('speech/')?speech(actual):undefined);
    for(const kind of ['question','speech']) {
      await h.render(el(kind==='question'?h.InsightQuestionReader:h.InsightSpeechReader,{key:kind,id:kind==='question'?questionId:speechId,language:'hu'}));
      assert.equal(effectiveLanguage(h.container.querySelector('.insight-reader-text')),actual??'');
      const fallback=h.container.querySelector('.insight-language-fallback');
      if(actual) {
        assert.equal(effectiveLanguage(fallback),'en');
        assert.deepEqual([...fallback.querySelectorAll('span')].map(effectiveLanguage),['hu','hu']);
        assert.equal(fallback.textContent,new Intl.DisplayNames(['hu'],{type:'language'}).of('hu')+' unavailable · showing '+new Intl.DisplayNames(['hu'],{type:'language'}).of(actual));
      } else assert.equal(fallback,null,'unknown language does not invent a fallback notice');
    }
  });
});

const procedureData=(language)=>({reference:'2026/0001(COD)',title:'Exact dossier title',language,summaries:[{id:'first',stage:'first-reading',date:'2026-03-25'}],summary:{id:'first',stage:'first-reading',date:'2026-03-25',blocks:[{kind:'heading',text:'Exact source heading'},{kind:'paragraph',text:sourceText},{kind:'paragraph',text:'Exact final paragraph'}],method:'AI-generated and human-reviewed',source:{url:'https://oeil.europarl.europa.eu/summary'}},subjects:[{code:'1.10',label:'Exact subject label'}],topics:[{id:'http://eurovoc.europa.eu/1',label:'Énergie',language:'fr'},{id:'http://eurovoc.europa.eu/2',label:'Közlekedés',language:'hu'},{id:'http://eurovoc.europa.eu/3',label:'Mixed source tag',language:'mul'},{id:'http://eurovoc.europa.eu/4',label:'Unknown source label',language:''}],source:{url:'https://oeil.europarl.europa.eu/procedure'}});

test('procedure title, summary, subjects and each EuroVoc label restore source languages inside English UI',async t=>{
  for(const [index,language] of languages.entries())await t.test(language,async t=>{
    const actual=languages[(index+1)%languages.length],h=await harness(t,route=>route==='insights/procedure-context'?procedureData(actual):undefined),chosen=[];
    await h.render(el(h.PocProcedureContext,{reference:'2026/0001(COD)',language,showTitle:true,onTopic:topic=>chosen.push(topic.id)}),language);
    for(const selector of ['h2','.insight-official-summary','.insight-procedure-context details li'])assert.equal(effectiveLanguage(h.container.querySelector(selector)),actual,selector);
    for(const selector of ['h3','.insight-procedure-context details summary','.insight-summary-footer button','.insight-summary-footer a'])assert.equal(effectiveLanguage(h.container.querySelector(selector)),'en',selector);
    assert.equal(effectiveLanguage(h.container.querySelector('time')),language);
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-summary-footer small span')),language);
    const topics=[...h.container.querySelectorAll('.insight-official-topics button')];assert.deepEqual(topics.map(effectiveLanguage),['fr','hu','mul','']);
    await h.click(topics[0]);assert.deepEqual(chosen,['http://eurovoc.europa.eu/1']);
    const more=h.container.querySelector('.insight-summary-footer button');await h.click(more);
    assert.equal(h.container.querySelector('.insight-official-summary').textContent,'Exact source heading'+sourceText+'Exact final paragraph');
    assert.equal(more.textContent,'Show less');assert.equal(effectiveLanguage(more),'en');
    await h.render(el(h.PocProcedureContext,{key:'source-links',reference:'2026/0001(COD)',language,showTitle:true}),language);
    assert.deepEqual([...h.container.querySelectorAll('.insight-official-topics .source-link > a:first-child > span')].map(effectiveLanguage),['fr','hu','mul','']);
  });
});

test('translated first-reading stages use the selected UI language with localized dates in native options',async t=>{
  for(const language of languages)await t.test(language,async t=>{
    const data=procedureData('fr');data.summaries.push({id:'second',stage:'final-act',date:'2026-04-01'});
    const h=await harness(t,route=>route==='insights/procedure-context'?data:undefined);
    await h.render(el(h.PocProcedureContext,{reference:data.reference,language}));
    const select=h.container.querySelector('.insight-summary-stage select'),option=select.querySelector('option');
    const date=new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date('2026-03-25T12:00:00Z'));
    const stage={en:'First reading',hu:'Első olvasat',fr:'Première lecture'}[language];
    assert.equal(option.textContent,stage+' · '+date,'the stage follows the UI locale, independently of the French source');
    assert.equal(option.getAttribute('lang'),language);
    const finalAct=select.querySelectorAll('option')[1];
    assert.equal(finalAct.getAttribute('lang'),language==='en'?'en':'','an untranslated stage mixed with a localized date remains explicit');
    assert.equal(select.closest('label').querySelector('span').textContent,'Summary stage');
    assert.equal(select.hasAttribute('aria-labelledby'),false,'the native labelling mechanism stays unchanged');
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-official-summary')),'fr','UI terminology does not relabel source text');
  });
});

const cloudData=()=>({scope:{kind:'member',phase:'past'},language:'fr',words:[{word:'énergie',label:'Énergie',speechCount:4,occurrences:4,speechIds:['known','unknown','named','mul','und']}],speeches:[{id:'known',title:'Titre français',titleLanguage:'fr'},{id:'unknown',title:'Legacy unannotated title',titleLanguage:null},{id:'named',title:'English fallback title',titleLanguage:'en',people:[{id:'1',name:'Ágnes Élodie',currentMep:true,role:null}]},{id:'mul',title:'Mixed annotation',titleLanguage:'mul'},{id:'und',title:'Undetermined annotation',titleLanguage:'und'}].map(s=>({date:'2026-03-25',machineTranslation:false,people:[],...s})),coverage:{transcripts:5,matchedSpeechRecords:5,missingLanguage:1,unreadableText:0,complete:false,truncated:false,associationUnavailable:false},window:{start:'2026-03-25',end:'2026-03-26'},nextPage:null});

test('cloud response terms, source title metadata and localized dates remain separate from English headings and actions',async t=>{
  for(const language of languages)await t.test(language,async t=>{
    const h=await harness(t,route=>route==='insights/speech-cloud'?cloudData():undefined),opened=[];
    await h.render(el(h.PocSpeechCloud,{member:1,interfaceLanguage:language,onSpeech:(...args)=>opened.push(args)}),language);
    assert.equal(effectiveLanguage(h.container.querySelector('h3')),'en');
    assert.equal(effectiveLanguage(h.container.querySelector('.poc-cloud-controls select')),'en');
    assert([...h.container.querySelector('.poc-cloud-controls select').querySelectorAll('option')].every(option=>effectiveLanguage(option)===language));
    assert.equal(effectiveLanguage(h.container.querySelector('.poc-cloud-words button')),'fr','response language wins over requested text language');
    assert([...h.container.querySelectorAll('.poc-cloud-caption span')].every(span=>effectiveLanguage(span)===language));
    await h.click(h.container.querySelector('.poc-cloud-words button'));
    const heading=h.container.querySelector('h4');assert.equal(effectiveLanguage(heading.querySelector('span')),'fr');assert.equal(effectiveLanguage(heading.querySelector('small')),'en');
    assert.equal(heading.querySelector('span').style.fontSize,'inherit','inline boundary preserves the heading font size');
    assert.equal(heading.textContent,'Énergie in 4 speeches');
    const buttons=[...h.container.querySelectorAll('.poc-cloud-source')];
    assert.deepEqual(buttons.map(button=>effectiveLanguage(button.querySelector(':scope > span'))),['fr','','en','mul','und']);
    assert.deepEqual(buttons.map(button=>effectiveLanguage(button.querySelector('strong'))),['fr','','','mul','und']);
    assert(buttons.every(button=>effectiveLanguage(button.querySelector('small'))===language));
    assert(buttons.every(button=>effectiveLanguage(button.querySelector('.poc-cloud-read-action'))==='en'));
    await h.click(buttons[0]);assert.deepEqual(opened,[['known','en']],'language markup must not change the selected speech language');
  });
});

test('reference popup UI restores English while titles, citation fallbacks, dossier text and dates keep separate languages',async t=>{
  const citation='E-003031/2026',id='E-10-2026-003031';
  for(const titleLanguage of ['fr',null,'mul','und'])await t.test(String(titleLanguage),async t=>{
    const title='Exact reference title';
    const h=await harness(t,(route)=>route==='references'?{references:[{key:'question:E-2026-003031',kind:'question',status:'found',id,title,titleLanguage,date:'2026-03-25',procedure:'2026/0001(COD)'}]}:route==='reference-summary'?procedureData('fr'):undefined);
    const render=()=>h.render(el('section',{lang:'en'},el('h3',null,'Original document'),el(h.ReferenceScope,{texts:[citation],language:'hu',textLanguage:'hu',renderQuestion:()=>el('div',{lang:'fr'},'Exact nested source')},el('p',{lang:'hu'},el(h.ReferenceText,{text:citation})))));
    await render();const trigger=h.container.querySelector('button.legal-ref');await h.click(trigger);
    const card=h.container.querySelector('.legal-reference-card');assert.equal(effectiveLanguage(card),'hu','dialog accessible name follows the source citation');
    assert.equal(effectiveLanguage(card.querySelector('.legal-reference-kind')),'en');
    assert.equal(effectiveLanguage(card.querySelector('.legal-reference-title')),titleLanguage??'');
    assert.equal(effectiveLanguage(card.querySelector('.legal-reference-meta span')),'hu');
    assert.equal(effectiveLanguage(card.querySelector('.legal-reference-actions button')),'en');
    assert.equal(effectiveLanguage(card.querySelector('button[aria-label="Close"]')),'en');
    await h.click([...card.querySelectorAll('button')].find(button=>button.textContent==='Dossier summary'));
    assert.equal(effectiveLanguage(card.querySelector('.legal-reference-summary > div[lang]')),'fr');
    assert.equal(effectiveLanguage(card.querySelector('.legal-reference-summary .legal-reference-actions a')),'en');
    await h.click(card.querySelector('button[aria-label="Close"]'));assert.equal(document.activeElement,trigger,'close still returns to the exact original citation');
    assert.equal(effectiveLanguage(trigger),'hu');
    await h.click(trigger);await h.click([...h.container.querySelectorAll('.legal-reference-actions button')].find(button=>button.textContent==='Read question'));
    const destination=h.container.querySelector('.legal-reference-question');assert.equal(document.activeElement,destination);assert.equal(effectiveLanguage(destination.querySelector('button')),'en');assert.equal(effectiveLanguage(destination.querySelector('div')),'fr');
    await h.click(destination.querySelector('button'));assert.equal(document.activeElement,trigger);
  });
  await t.test('citation fallback without a title',async t=>{
    const h=await harness(t,route=>route==='references'?{references:[{key:'question:E-2026-003031',kind:'question',status:'found',id,title:null,titleLanguage:'en'}]}:undefined);
    await h.render(el(h.ReferenceScope,{texts:[citation],language:'en',textLanguage:'fr'},el('p',{lang:'fr'},el(h.ReferenceText,{text:citation}))));await h.click(h.container.querySelector('button.legal-ref'));
    const title=h.container.querySelector('.legal-reference-title');assert.equal(title.textContent,citation);assert.equal(effectiveLanguage(title),'fr','unused title metadata cannot relabel the source citation fallback');
  });
});

test('source hyperlinks retain known or unknown document language while their own English source actions stay separate',async t=>{
  for(const language of ['en','hu','fr',null,'mul','und'])await t.test(String(language),async t=>{
    const h=await harness(t,route=>route==='references'?{references:[]}:undefined);
    const text='Exact linked source label',url='https://data.europarl.europa.eu/eli/dl/doc/E-10-2026-003031';
    const notes=[{id:'1',label:'1',text:'Exact note link',links:[url],linkSpans:[{start:0,end:15,url}]}];
    await h.render(el(h.ReferenceScope,{texts:[text,url],language:'en',textLanguage:language,notes},el('div',{lang:language??''},el('p',null,el(h.ReferenceText,{text,links:[{start:0,end:text.length,url}]})),el(h.DocumentNotes,{notes,prefix:'link-notes'}))));
    const labels=[...h.container.querySelectorAll('.source-link > a:first-child > span')];assert.equal(labels.length,2);
    assert(labels.every(label=>effectiveLanguage(label)===(language??'')));
    const actions=[...h.container.querySelectorAll('.source-read')];assert.equal(actions.length,2);assert(actions.every(action=>effectiveLanguage(action)==='en'));
    assert.equal(effectiveLanguage(h.container.querySelector('.legal-notes summary')),'en');
  });
});

test('procedure reference popup restores dossier title language and separates evidence titles from English explanation',async t=>{
  const citation='E-003031/2026',other='E-003032/2026',key='question:E-2026-003031',otherKey='question:E-2026-003032';
  const notes=[{id:'1',label:'1',text:other,links:[]}];
  const h=await harness(t,route=>route==='references'?{references:[{key,kind:'procedure',status:'found',procedure:'2026/0001(COD)'},{key:otherKey,kind:'question',status:'found',id:'E-10-2026-003032',title:'Titre français cité',titleLanguage:'fr'}]}:route==='reference-summary'?procedureData('hu'):undefined);
  await h.render(el(h.ReferenceScope,{texts:[citation,other],language:'fr',textLanguage:'fr',notes,notePrefix:'evidence'},el('p',{lang:'fr'},el(h.ReferenceText,{text:citation,anchors:[{paragraph:0,offset:citation.length,note:'1',label:'1'}],notePrefix:'evidence'}))),'fr');
  await h.click(h.container.querySelector('button.legal-ref'));
  const summary=h.container.querySelector('.legal-reference-summary');
  assert.equal(effectiveLanguage(summary.querySelector('.legal-reference-title')),'hu');
  assert.equal(effectiveLanguage(summary.querySelector('div[lang]')),'hu');
  const explanation=h.container.querySelector('.legal-reference-evidence');assert.equal(effectiveLanguage(explanation),'en');
  const title=explanation.querySelector('span[lang]');assert.equal(title.textContent,'Titre français cité');assert.equal(effectiveLanguage(title),'fr');
  assert.equal(explanation.textContent,'The document’s footnote 1 points to Titre français cité.');
  const note=h.container.querySelector('.legal-note-ref');
  assert.equal(note.getAttribute('aria-label'),'Note 1: Titre français cité');assert.equal(note.hasAttribute('aria-labelledby'),false);assert.equal(effectiveLanguage(note),'fr');
  t.diagnostic(JSON.stringify({assessment:'OPEN',accessibleName:note.getAttribute('aria-label'),mechanism:'aria-label',constituents:[{text:'Note 1: ',language:'en'},{text:'Titre français cité',language:'fr'}],effectiveLang:effectiveLanguage(note)}));
});

test('OPEN cloud flat names keep the original aria-label mechanism with exact French and unknown-name fixtures',async t=>{
  const h=await harness(t,(route)=>route==='insights/speech-cloud'?cloudData():route.startsWith('speech/')?{...speech('fr'),id:route.slice('speech/'.length)}:undefined);
  await h.render(el(h.PocSpeechCloud,{member:1,interfaceLanguage:'hu'}));await h.click(h.container.querySelector('.poc-cloud-words button'));
  const buttons=[...h.container.querySelectorAll('.poc-cloud-source')];
  for(const [index,name,sourceLanguage] of [[0,'Titre français','fr'],[1,'Legacy unannotated title',null],[2,'Ágnes Élodie',null]]) {
    const button=buttons[index];assert.equal(button.getAttribute('aria-label'),'Read speech by '+name);assert.equal(effectiveLanguage(button),'en');assert.equal(button.hasAttribute('aria-labelledby'),false);
    t.diagnostic(JSON.stringify({assessment:'OPEN',accessibleName:button.getAttribute('aria-label'),mechanism:'aria-label',constituents:[{text:'Read speech by ',language:'en'},{text:name,language:sourceLanguage}],effectiveLang:effectiveLanguage(button),visibleNameEffectiveLang:effectiveLanguage(button.querySelector('strong'))}));
  }
  await h.click(buttons[0]);assert.equal(buttons[0].getAttribute('aria-label'),'Close speech by Titre français');
  const region=h.container.querySelector('.poc-cloud-reader');assert.equal(region.getAttribute('aria-label'),'Speech by Titre français');assert.equal(region.hasAttribute('aria-labelledby'),false);assert.equal(effectiveLanguage(region),'en');
  t.diagnostic(JSON.stringify({assessment:'OPEN',accessibleName:region.getAttribute('aria-label'),mechanism:'aria-label',constituents:[{text:'Speech by ',language:'en'},{text:'Titre français',language:'fr'}],effectiveLang:effectiveLanguage(region)}));
});

test('OPEN compound reader headings keep exact date-bearing labels, status and local-find names',async t=>{
  const h=await harness(t,route=>route.startsWith('document/')?question('fr'):undefined);
  const heading='Answer 2 · 2026. márc. 25.';
  await h.render(el(h.InsightQuestionReader,{id:questionId,language:'hu',heading}));await h.settle(375);
  const select=h.container.querySelector('.insight-reader-heading select'),find=h.container.querySelector('button[aria-label^="Find in"]'),status=h.container.querySelector('[aria-live]');
  assert.equal(h.container.querySelector('h3').textContent,heading);assert.equal(effectiveLanguage(h.container.querySelector('h3')),'en');
  assert.equal(select.getAttribute('aria-label'),heading+' language');assert.equal(select.hasAttribute('aria-labelledby'),false);assert.equal(effectiveLanguage(select),'en');
  assert.equal(find.getAttribute('aria-label'),'Find in '+heading.toLowerCase());assert.equal(find.hasAttribute('aria-labelledby'),false);assert.equal(effectiveLanguage(find),'en');
  assert.equal(status.textContent,heading+': Text loaded.');assert.equal(effectiveLanguage(status),'en');
  t.diagnostic(JSON.stringify({assessment:'OPEN',heading,constituents:[{text:'Answer 2',language:'en'},{text:'2026. márc. 25.',language:'hu'}],effectiveLang:'en',selectorName:select.getAttribute('aria-label'),findName:find.getAttribute('aria-label'),status:status.textContent,mechanism:'existing text and aria-label strings'}));
});
