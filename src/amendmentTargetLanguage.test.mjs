import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const effectiveLanguage=node=>node?.closest('[lang]')?.getAttribute('lang');
const source=(language,name)=>({url:'https://data.europarl.europa.eu/'+name,language,fetchedAt:'2026-10-16T12:00:00Z'});
const fmt=(value,language)=>new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value));
const textNode=(scope,selector,text)=>[...scope.querySelectorAll(selector)].find(node=>node.textContent===text);
const targetSourceLine=scope=>[...scope.querySelectorAll('p')].find(node=>node.textContent.startsWith('Target label source:'));

for(const locale of ['en','hu','fr'])test(`${locale}: target labels and topics keep their own language and exact source through refresh`,async t=>{
  const window=new Window({url:'http://localhost/?view=amendments'});window.document.documentElement.lang=locale;
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root,reads=0;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(vite)await vite.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const metadata=source('fr','fresh-french-metadata'),wording=source('fr','fresh-french-wording'),candidate=source('fr','candidate-decision-page');
  const base={targetDocumentId:'A-10-2026-0254',language:'fr',metadataSource:metadata,wordingSource:wording,originalText:'Texte original français',proposedText:'Nouvelle proposition française',documentDate:'2026-10-16',dateBasis:'individual-amendment-document',outcome:'unavailable',sources:[metadata]};
  const targetTopic=(id,label,language)=>({id,label,basis:'target',language});
  function fixtures(refreshed=false) {
    const retainedLabel=refreshed?'Article 1 — nouveau libellé français':'Article 1 — retained English label';
    const retainedTopic=refreshed?'Disposition française actualisée':'Retained English topic';
    const retainedLanguage=refreshed?'fr':'en',retainedSource=source(retainedLanguage,refreshed?'exact-french-target':'exact-retained-english-target');
    const variantLabel=refreshed?'Article 7 — variante française':'Article 7 — retained English variant';
    return [
      {...base,id:'retained',number:1,targetLabel:retainedLabel,targetLabelLanguage:retainedLanguage,targetLabelSource:retainedSource,topics:[targetTopic('retained-topic',retainedTopic,retainedLanguage)]},
      // This is the API's English decision.referenceText fallback, independent of the unavailable exact decision page.
      {...base,id:'decision-fallback',number:2,targetLabel:'Article 2 — English decision reference',targetLabelLanguage:'en',targetLabelSource:null,topics:[targetTopic('decision-topic','English decision-reference topic','en')],decisions:[{id:'unavailable-exact-page',reference:'Article 2 — English decision reference',outcome:'ADOPTED',source:null,sourceCandidates:[candidate],provenance:'unavailable'}]},
      {...base,id:'unknown',number:3,targetLabel:'Target with unknown language',targetLabelLanguage:null,targetLabelSource:source('en','known-language-source-unknown-label'),topics:[targetTopic('unknown-topic','Topic with unknown language',null)]},
      {...base,id:'legacy-unknown',number:4,targetLabel:'Legacy target without a language field',targetLabelSource:source('fr','legacy-target-source'),topics:[{id:'legacy-topic',label:'Legacy topic without a language field',basis:'target'}]},
      {...base,id:'undetermined',number:5,targetLabel:'Undetermined target label',targetLabelLanguage:'und',targetLabelSource:source('fr','undetermined-target-source'),topics:[targetTopic('undetermined-topic','Undetermined topic label','und')]},
      {...base,id:'mixed',number:6,targetLabel:'Mixed-language target label',targetLabelLanguage:'mul',targetLabelSource:source('fr','mixed-target-source'),topics:[targetTopic('mixed-topic','Mixed-language topic label','mul')]},
      {...base,id:'variants',number:7,conflicted:true,variants:[
        {...base,listId:'variant-retained',targetLabel:variantLabel,targetLabelLanguage:retainedLanguage,targetLabelSource:source(retainedLanguage,refreshed?'exact-french-variant-target':'exact-retained-variant-target')},
        {...base,listId:'variant-unknown',targetLabel:'Variant target with unknown language',targetLabelLanguage:null,targetLabelSource:source('en','variant-source-unknown-label')},
        {...base,listId:'variant-undetermined',targetLabel:'Undetermined variant target',targetLabelLanguage:'und',targetLabelSource:null},
        {...base,listId:'variant-mixed',targetLabel:'Mixed-language variant target',targetLabelLanguage:'mul',targetLabelSource:null},
      ]},
      {...base,id:'independent-topic',number:8,targetLabel:'English target with a separately labelled topic',targetLabelLanguage:'en',targetLabelSource:source('en','independent-target-source'),topics:[targetTopic('independent-topic','Magyar tárgymegjelölés','hu')]},
    ];
  }
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);assert(url.pathname.endsWith('/amendments'));
    assert.equal(url.searchParams.get('lang'),locale);
    const items=fixtures(reads++>0);
    return Response.json({items,total:items.length,offset:0,limit:20,coverage:{complete:false,pending:false,gaps:[],lastUpdated:'2026-10-16T12:00:00Z'}});
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {Amendments}=await vite.ssrLoadModule('/src/Amendments.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement('div',{lang:locale},createElement(Amendments,{language:locale,document:'A-10-2026-0254',showFailures:false}))));
  const card=id=>container.querySelector('#amendment-'+id);
  const grouping=()=>container.querySelectorAll('.explorer-amendment-controls select')[1];
  async function group(value) {
    await act(async()=>{grouping().value=value;grouping().dispatchEvent(new window.Event('change',{bubbles:true}));});
  }
  function assertSource(scope,expected) {
    const line=targetSourceLine(scope);
    if(!expected){assert.equal(line,undefined,'no source record means no target-source link is borrowed from general metadata');return;}
    assert(line,'the exact target source is visible');
    assert.equal(line.querySelectorAll('a').length,1);
    assert.equal(line.querySelector('a').href,expected.url);
    assert.equal(effectiveLanguage(line.querySelector('a')),'en','source-link controls remain English');
    assert.equal(line.querySelector('time').textContent,fmt(expected.fetchedAt,locale));
    assert.equal(effectiveLanguage(line.querySelector('time')),locale);
    assert.equal(effectiveLanguage(line),'en');
  }
  async function assertPaths(refreshed) {
    const items=fixtures(refreshed),normal=items.filter(item=>!item.conflicted);
    for(const item of normal){
      const leaf=card(item.id).querySelector(':scope>.explorer-amendment-target');
      assert.equal(leaf.textContent,item.targetLabel);
      assert.equal(leaf.getAttribute('lang'),item.targetLabelLanguage??'','card labels never borrow metadata, wording, source or selected UI language');
      assertSource(card(item.id).querySelector('.explorer-amendment-evidence'),item.targetLabelSource);
      const topic=item.topics[0],evidence=textNode(card(item.id).querySelector('.explorer-amendment-evidence'),'li>span',topic.label);
      assert(evidence,'the topic appears in source evidence');
      assert.equal(evidence.getAttribute('lang'),topic.language??'','topic evidence consumes the topic language independently of its target label');
    }
    const variants=items.find(item=>item.conflicted).variants;
    for(const variant of variants){
      const section=[...card('variants').querySelectorAll('.explorer-amendment-variant')].find(node=>node.querySelector('h5').textContent.includes(variant.listId));
      const leaf=textNode(section,'p',variant.targetLabel);assert(leaf);
      assert.equal(leaf.getAttribute('lang'),variant.targetLabelLanguage??'','source-variant labels retain their own language');
      assertSource(section,variant.targetLabelSource);
    }
    await group('target');
    for(const item of normal){
      const heading=textNode(container,'.explorer-amendment-group-heading h3 span',item.targetLabel);assert(heading);
      assert.equal(heading.getAttribute('lang'),item.targetLabelLanguage??'','target grouping keeps the target-label language');
    }
    await group('topic');
    for(const item of normal){
      const topic=item.topics[0],heading=textNode(container,'.explorer-amendment-group-heading h3 span',topic.label);assert(heading);
      assert.equal(heading.getAttribute('lang'),topic.language??'','target-topic grouping consumes only topic.language');
    }
    for(const control of container.querySelectorAll('button,select,.explorer-amendment-evidence summary'))assert.equal(effectiveLanguage(control),'en');
    for(const date of container.querySelectorAll('time'))assert.equal(effectiveLanguage(date),locale);
    assert.equal(card('retained').querySelector('.wording-diff__passage').getAttribute('lang'),'fr','target-label language does not change refreshed wording');
    assert.equal(card('retained').querySelector(':scope>.explorer-amendment-meta time').textContent,fmt('2026-10-16',locale));
    assert.match(card('decision-fallback').textContent,/Exact decision source page unavailable/);
    assert.equal([...container.querySelectorAll('a')].some(link=>link.href===candidate.url),false,'a candidate decision page never becomes exact target-label evidence');
  }
  await assertPaths(false);
  assert.equal(reads,1);
  await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='Refresh').click());
  assert.equal(reads,2);
  await assertPaths(true);
  assert.doesNotMatch(container.textContent,/Article 1 — retained English label|Article 7 — retained English variant|Retained English topic/,'a refreshed exact French label replaces the retained English value and language together');
});
