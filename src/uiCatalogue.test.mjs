import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createAppUiI18n,uiMessageId} from './uiCatalogues.mjs';
import {readJson} from './client.mjs';
import {freshLoader} from './test-support/viteRunner.mjs';

const english=JSON.parse(await readFile(new URL('./ui-locales/en.json',import.meta.url),'utf8'));
const aliases=JSON.parse(await readFile(new URL('./ui-locales/aliases.json',import.meta.url),'utf8'));
const pairs=JSON.parse(await readFile(new URL('./ui-locales/plural-pairs.json',import.meta.url),'utf8'));

test('catalogue IDs, aliases and plural contracts resolve without changing imported dictionaries',()=>{
  for(const target of Object.values(aliases))assert(Object.hasOwn(english,target),target);
  for(const pair of pairs) {
    assert(Object.hasOwn(english,pair.one),pair.one);
    assert(Object.hasOwn(english,pair.other),pair.other);
    assert.equal(uiMessageId(pair.other),pair.other);
  }
  const id='membervotes.tsx.count.decisions';
  const translated=Object.freeze({[id]:Object.freeze({plural:'count',one:'{count} decyzja',few:'{count} decyzje',many:'{count} decyzji',other:'{count} decyzji'})});
  const i18n=createAppUiI18n({pl:translated},{});
  assert.equal(i18n.forLocale('pl').t(id,{count:22}),'22 decyzje');
  assert.equal(i18n.forLocale('pl').t(id,{count:25}),'25 decyzji');
  assert.equal(i18n.forLocale('en').t(id,{count:1}),'1 decision');
  assert.equal(i18n.forLocale('en').t(id,{count:2}),'2 decisions');
  assert.equal(uiMessageId('constructor'),'constructor');
  assert.equal(i18n.forLocale('pl').t('For'),'For','source literals are never looked up as message IDs');
});

test('every explicit static application message points to a real catalogue entry',async()=>{
  async function files(directory) {
    const entries=await readdir(directory,{withFileTypes:true});
    return (await Promise.all(entries.map(entry=>entry.isDirectory()?files(new URL(entry.name+'/',directory)):[new URL(entry.name,directory)]))).flat();
  }
  for(const file of await files(new URL('./',import.meta.url))) {
    if(!/\.(tsx|ts|mjs)$/.test(file.pathname)||/\.test\.|test-support/.test(file.pathname))continue;
    const text=await readFile(file,'utf8');
    const patterns=[/ui\.t\(\s*['"]([^'"]+)['"]\s*(?=[,)])/g,/<Ui(?:Annotated)?Message\s+id=['"]([^'"]+)['"]/g];
    for(const pattern of patterns)for(const match of text.matchAll(pattern))assert(Object.hasOwn(english,uiMessageId(match[1])),file.pathname+': '+match[1]);
    assert(!text.includes('+v.values[i]+'),file.pathname);
  }
});

test('locale formatters leave public API values, identifiers, gaps and source languages unchanged',async()=>{
  const payload=Object.freeze({id:'A-10-2026-001234',title:'For',language:'el',titleLanguage:null,count:0,unavailable:null,source:Object.freeze({url:'https://www.europarl.europa.eu/doceo/document/A-10-2026-001234_EN.html',fetchedAt:'2026-10-30T12:00:00Z'})});
  const bytes=JSON.stringify(payload);
  const translated=createAppUiI18n({fr:{'membervotespresentation.for':'POUR'}}).forLocale('fr');
  const result=await readJson('/api/public-fixture',{fetchImpl:async()=>({ok:true,status:200,headers:new Headers(),json:async()=>payload})},translated);
  assert.equal(result,payload);
  assert.equal(JSON.stringify(result),bytes);
});

test('real UI consumers translate owned labels while preserving source titles and numeric SVG syntax',async t=>{
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  t.after(()=>load.close());
  const {UiI18nProvider}=await load('/src/UiI18nReact.tsx');
  const {GroupDonut}=await load('/src/InsightCharts.tsx');
  const {VoteSubjectTitle}=await load('/src/VoteSubjectTitle.tsx');
  const i18n=createAppUiI18n({fr:{'membervotespresentation.for':'POUR','batch4.insightcharts.groupSummaryEntry':'{count} : {group}'}});
  const provider=(language,child)=>h(UiI18nProvider,{i18n,language},child);
  const subject={id:'exact-source',uri:'exact-source',title:'For',titles:{fr:'For'},titleLanguage:'fr',documentIds:[]};
  const vote={context:{relationships:[]}};
  assert.match(renderToStaticMarkup(provider('fr',h(VoteSubjectTitle,{subject,vote,language:'fr'}))),/>For<\/p>/);
  const chart=renderToStaticMarkup(provider('fr',h(GroupDonut,{rows:[{label:'For',count:1234}]})));
  assert.match(chart,/stroke-dasharray="389\.55748904513433 389\.55748904513433"/);
  assert(chart.includes('For'));
  assert(!chart.includes('POUR'));
});

test('reviewed category overrides merge without manufacturing English locale entries',()=>{
  const id='membervotes.tsx.count.decisions';
  const catalogue=Object.freeze({[id]:'{count} neutral'});
  const forms=Object.freeze({[id]:Object.freeze({few:'{count} native few',many:'{count} native many'})});
  const ui=createAppUiI18n({pl:catalogue},{pl:forms}).forLocale('pl');
  assert.equal(ui.t(id,{count:22}),'22 native few');
  assert.equal(ui.t(id,{count:25}),'25 native many');
  assert.equal(ui.t(id,{count:1}),'1 neutral');
  const portuguese=createAppUiI18n().forLocale('pt');
  assert.equal(portuguese.locale,'pt-PT');assert.equal(portuguese.language,'pt');
  assert.equal(portuguese.pluralCategory(0),'other');
});

test('historical compatibility labels remain intact while loaded catalogues supply revised MEP wording',async()=>{
  const id='batch4.parliamentheader.tsx.25.1';
  const historical=createAppUiI18n({},{}).forLocale('hu');
  assert.equal(historical.t(id),'Tagok');
  const hungarian=JSON.parse(await readFile(new URL('./ui-locales/hu.json',import.meta.url),'utf8'));
  const current=createAppUiI18n({hu:hungarian}).forLocale('hu');
  assert.equal(current.t(id),'Képviselők');
  assert.equal(current.t('app.mepCountUnit',{}, {count:0}),'EP-képviselő');
});

test('startup shell uses explicit owned bindings and keeps numeric member IDs literal',async t=>{
  const {Window}=await import('happy-dom');
  const window=new Window({url:'http://localhost/?lang=hu',settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  t.after(()=>window.happyDOM.close());
  window.document.write(await readFile(new URL('../index.html',import.meta.url),'utf8'));
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  t.after(()=>load.close());
  const {localizeInitialShell}=await load('/src/initialShell.ts');
  const {loadUiLocale}=await load('/src/appUiI18n.ts');
  await loadUiLocale('hu');
  localizeInitialShell(window.document,new URLSearchParams({lang:'hu'}));
  assert.equal(window.document.querySelector('h1').textContent,'Európai parlamenti képviselők');
  assert.equal(window.document.querySelector('a[data-view="members"]').textContent,'Képviselők');
  localizeInitialShell(window.document,new URLSearchParams({lang:'hu',member:'1234567'}));
  assert.equal(window.document.querySelector('h1').textContent,'EP-képviselő 1234567');
  window.document.getElementById('initial-shell').remove();
  const title=window.document.title;
  localizeInitialShell(window.document,new URLSearchParams({lang:'fr'}));
  assert.equal(window.document.title,title,'a late shell binding never inspects or rewrites the mounted app');
});

test('all reachable messages have translated values in each supported language',async()=>{
  for(const language of 'bg cs da de el es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' ')) {
    const catalogue=JSON.parse(await readFile(new URL(`./ui-locales/${language}.json`,import.meta.url),'utf8'));
    for(const id of Object.keys(english)) {
      // These whole-message variants are selected only by the corresponding
      // grammatical branches; other languages use the common reviewed messages.
      if(id.startsWith('MotionComparison.contextStage.')&&language!=='ro')continue;
      if((id.startsWith('membervotesummary.fullPosition.')||id.startsWith('membervotes.summary.recorded.'))&&!['ro','lt'].includes(language))continue;
      // New Topics messages use the documented per-message English fallback.
      if(id.startsWith('topics.')&&!Object.hasOwn(catalogue,id))continue;
      assert.equal(typeof catalogue[id],'string',language+': '+id);
      assert(catalogue[id].trim(),language+': '+id);
    }
    const ui=createAppUiI18n({[language]:catalogue}).forLocale(language);
    for(const pair of pairs)for(const count of [0,1,2,3,5,11,19,20,21,22,100,101,1000000]) {
      const template=english[pair.other];
      const values=Object.fromEntries([...template.matchAll(/(?<!\{)\{([A-Za-z_][A-Za-z0-9_]*)\}(?!\})/g)].map(match=>[match[1],match[1]===pair.count?count:'sample']));
      values[pair.count]=count;
      assert(ui.t(pair.other,values),language+': '+pair.other+' @ '+count);
    }
  }
});
