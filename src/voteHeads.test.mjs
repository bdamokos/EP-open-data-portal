import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createAppUiI18n} from './uiCatalogues.mjs';
import {freshLoader} from './test-support/viteRunner.mjs';

const languages='bg cs da de el es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' ');
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const theme=await readFile(new URL('./theme.css',import.meta.url),'utf8');

// The widest of the three heads (mark, gap and word) per language at 12px, measured in a
// headless browser at 390 px. Re-measure and update this row and the :lang() rules in
// theme.css when a head is reworded.
const widest={
  en:["Abstain",55.2],
  bg:["Въздържане",87],
  cs:["Zdržení se",71.9],
  da:["Undlod",53.3],
  de:["Enthaltung",73.5],
  el:["Αποχή",48.7],
  es:["Abstención",76.2],
  et:["Erapooletu",73.7],
  fi:["Puolesta",61.4],
  fr:["Abstention",73.8],
  ga:["Ina aghaidh",77.8],
  hr:["Suzdržani",68.5],
  hu:["Tartózkodás",81.5],
  it:["Astensione",75.1],
  lt:["Susilaikė",62.2],
  lv:["Atturas",53.5],
  mt:["Astensjoni",71.2],
  nl:["Onthouding",79],
  pl:["Wstrzymane",82.8],
  pt:["Abstenção",72.8],
  ro:["Împotrivă",65.4],
  sk:["Zdržať sa",66],
  sl:["Vzdržan",58.8],
  sv:["Avstår",48],
};

const numRule=(language,phone)=>{
  const block=phone?theme.slice(theme.indexOf('@media (max-width: 767px)'),theme.indexOf(':root[data-theme=light]')):theme.slice(0,theme.indexOf('@media (max-width: 767px)'));
  const found=[...block.matchAll(new RegExp(':root:lang\\('+language+'\\)\\s*\\{\\s*--num:\\s*(\\d+)px','g'))].map(match=>Number(match[1]));
  assert(found.length<=1,'one --num rule per language and width: '+language);
  return found[0]??(phone?68:88);
};

test('every language renders its three column heads and the column fits the widest',async t=>{
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  t.after(()=>load.close());
  const {UiI18nProvider}=await load('/src/UiI18nReact.tsx');
  const {TallyHeads}=await load('/src/VoteRow.tsx');
  const english=await json('./ui-locales/en.json');
  const catalogues={};
  for(const language of languages)catalogues[language]=await json(`./ui-locales/${language}.json`);
  const i18n=createAppUiI18n(catalogues);
  assert.deepEqual(Object.keys(widest).sort(),['en',...languages].sort());
  for(const language of ['en',...languages]) {
    const catalogue=language==='en'?english:catalogues[language];
    const markup=renderToStaticMarkup(h(UiI18nProvider,{i18n,language},h(TallyHeads,{heading:'Votes'})));
    const heads=[...markup.matchAll(/<span class="n hd [fax]">(?:<svg.*?<\/svg>)([^<]*)<\/span>/g)].map(match=>match[1]);
    assert.deepEqual(heads,['votepage.head.for','votepage.head.against','votepage.head.abstain'].map(id=>catalogue[id]),language);
    for(const head of heads)assert(head.trim().length>0&&head.length<=12,language+': '+head);
    const [word,width]=widest[language];
    assert(heads.includes(word),language+': the measured head is no longer a head; re-measure');
    assert(numRule(language,true)>=width+2,language+' at 390: --num '+numRule(language,true)+' for '+width);
    assert(numRule(language,false)>=width*13/12+1,language+' at 1280: --num '+numRule(language,false)+' for '+width*13/12);
  }
});

test('plural families carry every category their language needs',async()=>{
  const pairs=await json('./ui-locales/plural-pairs.json');
  const forms=await json('./ui-locales/plural-forms.json');
  const newFamilies=pairs.map(pair=>pair.other).filter(id=>/^(votepage|week)\./.test(id));
  assert.equal(newFamilies.length,9);
  for(const language of languages) {
    const needed=new Intl.PluralRules(language).resolvedOptions().pluralCategories;
    for(const id of newFamilies) {
      const entry=forms[language][id];
      assert(entry,language+': '+id);
      for(const category of needed) {
        assert(entry[category]?.includes('{count}'),language+': '+id+' '+category);
      }
    }
  }
});
