import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

test('member affiliations omit gaps and render localized lines and accessible compact tags',async t=>{
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const window=new Window();
  t.after(async()=>{await load.close();await window.happyDOM.close();});
  const {MemberAffiliation}=await load('/src/components/MemberAffiliation.tsx');
  const render=props=>{const container=window.document.createElement('div');container.innerHTML=renderToStaticMarkup(createElement(MemberAffiliation,{language:'en',...props}));return container;};
  for(const variant of ['line','tag']){
    for(const group of [undefined,null,'','Unknown','unavailable'])for(const country of [undefined,null,'','unknown','HUN','H'])assert.equal(render({group,country,variant}).innerHTML,'');
    const groupOnly=render({group:'PPE',country:'unknown',variant});assert.equal(groupOnly.textContent,'EPP');assert.equal(groupOnly.querySelectorAll('i').length,1);
    const countryOnly=render({country:'HU',variant});assert.equal(countryOnly.textContent,variant==='tag'?'HU':'Hungary');assert.equal(countryOnly.querySelector('i'),null);assert.doesNotMatch(countryOnly.textContent,/·/);
  }
  const line=render({group:'PPE',country:'HU',language:'hu'});
  assert.equal(line.firstElementChild.tagName,'P');assert.equal(line.textContent,'EPP · Magyarország');assert.equal(line.querySelector('[lang="hu"]').textContent,'Magyarország');
  assert.equal(line.querySelector('i').getAttribute('aria-hidden'),'true');assert.match(line.querySelector('i').getAttribute('style'),/var\(--group-ppe\)/);
  for(const [group,label] of [['NI','Non-attached'],['TheLeft','The Left'],['Verts/ALE','Greens/EFA']]){
    const result=render({group,country:'EL'});assert.equal(result.querySelector('.member-affiliation__group').lang,'en');assert.equal(result.textContent,label+' · Greece');
  }
  const tag=render({group:'PPE',country:'HU',variant:'tag'}).firstElementChild;
  assert.equal(tag.tagName,'SPAN');assert.ok(tag.classList.contains('member-affiliation--tag'));assert.equal(tag.textContent,'EPP · HU');assert.equal(tag.title,'Hungary');assert.equal(tag.getAttribute('aria-label'),'EPP, Hungary');
  const {groupLabel,groupColor,groupTokens}=await load('/src/groupLabels.ts');
  const charts=await load('/src/InsightCharts.tsx');assert.equal(charts.groupLabel,groupLabel);assert.equal(charts.groupColor,groupColor);assert.equal(charts.groupTokens,groupTokens);
});
