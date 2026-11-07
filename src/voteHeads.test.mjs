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

// The three heads each language was measured with, and the widest (mark, gap and word) at 12px
// in a headless browser at 390 px. Re-measure and update this row and the :lang() rules in
// theme.css when any head is reworded.
const widest={
  en:["For|Against|Abstain",55.2],
  bg:["За|Против|Въздържане",87],
  cs:["Pro|Proti|Zdržení se",71.9],
  da:["For|Imod|Undlod",53.3],
  de:["Dafür|Dagegen|Enthaltung",73.5],
  el:["Υπέρ|Κατά|Αποχή",48.7],
  es:["A favor|En contra|Abstención",76.2],
  et:["Poolt|Vastu|Erapooletu",73.7],
  fi:["Puolesta|Vastaan|Tyhjää",61.4],
  fr:["Pour|Contre|Abstention",73.8],
  ga:["Ina fhabhar|Ina aghaidh|Staonadh",77.8],
  hr:["Za|Protiv|Suzdržani",68.5],
  hu:["Mellette|Ellene|Tartózkodás",81.5],
  it:["A favore|Contrari|Astensione",75.1],
  lt:["Už|Prieš|Susilaikė",62.2],
  lv:["Par|Pret|Atturas",53.5],
  mt:["Favur|Kontra|Astensjoni",71.2],
  nl:["Voor|Tegen|Onthouding",79],
  pl:["Za|Przeciw|Wstrzymane",82.8],
  pt:["A favor|Contra|Abstenção",72.8],
  ro:["Pentru|Împotrivă|Abținere",65.4],
  sk:["Za|Proti|Zdržať sa",66],
  sl:["Za|Proti|Vzdržan",58.8],
  sv:["För|Emot|Avstår",48],
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
    const [measured,width]=widest[language];
    assert.equal(heads.join('|'),measured,language+': a head changed; re-measure');
    assert(numRule(language,true)>=width+2,language+' at 390: --num '+numRule(language,true)+' for '+width);
    assert(numRule(language,false)>=width*13/12+1,language+' at 1280: --num '+numRule(language,false)+' for '+width*13/12);
  }
});

test('plural families carry every category their language needs',async()=>{
  const pairs=await json('./ui-locales/plural-pairs.json');
  const forms=await json('./ui-locales/plural-forms.json');
  const newFamilies=pairs.map(pair=>pair.other).filter(id=>/^(votepage|week)\.|^dossierstatus\.voting_list\./.test(id));
  assert.equal(newFamilies.length,15);
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
