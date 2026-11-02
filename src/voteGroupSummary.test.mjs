import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {freshLoader} from './test-support/viteRunner.mjs';
import {createAppUiI18n} from './uiCatalogues.mjs';
import {groupMajorities} from './voteGroupMetrics.mjs';

test('unity reserves 100% for unanimity and tags fallback messages by their actual language',async t=>{
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  t.after(()=>load.close());
  const {GroupUnity,VoteGroupSummary}=await load('/src/VoteGroupSummary.tsx'),{UiI18nProvider}=await load('/src/UiI18nReact.tsx');
  const i18n=createAppUiI18n({fr:{'votegroups.position.for':'Pour'}});
  const render=node=>renderToStaticMarkup(createElement(UiI18nProvider,{i18n,language:'fr'},node));
  const metric={code:'PPE',counts:{for:200,against:1,abstaining:0},voters:201,majority:'for',unity:200/201};
  const divided=render(createElement(GroupUnity,{metric,withPosition:true}));
  assert.match(divided,/99%/);assert.doesNotMatch(divided,/100%/);
  assert.match(divided,/<span lang="fr">Pour<\/span>/);
  assert.match(divided,/<span lang="en">99%/);
  assert.match(divided,/<span class="vote-group-unity-count" lang="en">200 of 201<\/span>/);
  assert.match(render(createElement(GroupUnity,{metric:{...metric,counts:{for:201,against:0,abstaining:0},unity:1}})),/100%/);
  assert.match(render(createElement(GroupUnity,{metric:{...metric,majority:null,unity:null}})),/lang="en">Split/);
  const rows=[{group:'PPE',position:'for'},{group:'S&D',position:'for'}];
  assert.match(render(createElement(VoteGroupSummary,{groups:groupMajorities(rows),rows})),/<p lang="en">Every group/);
  assert.match(render(createElement(VoteGroupSummary,{groups:groupMajorities(rows.slice(0,1)),rows:rows.slice(0,1)})),/<p lang="en">For:/);
});
