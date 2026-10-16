import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {motionOutcome} from '../server/motion-outcomes.mjs';

const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/motion-outcomes-live-20261015.json',import.meta.url),'utf8'));
const record=id=>fixture.documents.find(document=>document.work.identifier===id);
const outcome=id=>motionOutcome(record(id).work,record(id).retrievedAt,()=>({work:fixture.votes,fetchedAt:fixture.retrievedAt}));
const joint={sourceId:'RC-10-2026-0441',reference:'RC-B10-0441/2026',title:'Joint motion on Russian State Duma elections',url:'https://data.europarl.europa.eu/distribution/reds_iPlRc/RC-10-2026-0441/RC-10-2026-0441_en.pdf',outcome:outcome('RC-10-2026-0441'),memberAuthorship:'not-recorded'};
const props={outcome:outcome('B-10-2026-0441'),related:[joint],sourceId:'B-10-2026-0441',reference:'B10-0441/2026',language:'en'};

test('motion cards keep each exact text and its outcome separate, with readable document links only',async t=>{
  const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const window=new Window();
  t.after(async()=>{await vite.close();await window.happyDOM.close();});
  const {MotionStatuses,PocMotionOutcome}=await vite.ssrLoadModule('/src/PocMotionOutcome.tsx');
  const render=(component,properties)=>{const node=window.document.createElement('div');node.innerHTML=renderToStaticMarkup(createElement(component,properties));return node;};
  await t.test('the collapsed card identifies both texts rather than implying one conflicting outcome',()=>{
    const node=render(MotionStatuses,props);
    assert.match(node.textContent,/Replaced by joint motion/);
    assert.match(node.textContent,/Joint motion: adopted/);
    assert.equal(node.querySelectorAll('[data-outcome="lapsed"]').length,1);
    assert.equal(node.querySelectorAll('[data-outcome="adopted"]').length,1);
  });
  await t.test('the expanded card attaches dates and totals to the joint text alone',()=>{
    const node=render(PocMotionOutcome,props),original=node.querySelector('.poc-motion-text-outcome'),related=node.querySelector('.poc-motion-joint-outcome');
    assert.match(original.textContent,/Original motion B10-0441\/2026/);
    assert.match(original.textContent,/replaced by the joint text/);
    assert.match(original.textContent,/not adopted separately/);
    assert.match(related.textContent,/No authorship is recorded for this MEP/);
    assert.equal(original.querySelector('dl'),null);
    assert.match(related.textContent,/Joint motion RC-B10-0441\/2026/);
    assert.match(related.textContent,/Roll-call vote/);
    assert.deepEqual([...related.querySelectorAll('dd')].map(node=>node.textContent),['482','41','39']);
    assert.equal(related.querySelector('a').href,joint.url);
    assert.equal(node.querySelectorAll('a').length,1,'raw decision sources must never be result links');
    assert.doesNotMatch(node.innerHTML,/Official result|api\/v2|eli\/dl/);
  });
  await t.test('missing or rejected joint outcomes are not promoted to adoption',()=>{
    for(const status of ['unavailable','rejected']) {
      const related=[{...joint,outcome:{status}}];
      const summary=render(MotionStatuses,{...props,related});
      assert.match(summary.textContent,new RegExp('Joint motion: '+(status==='unavailable'?'outcome unavailable':'rejected')));
      assert.doesNotMatch(summary.textContent,/adopted/);
      const detail=render(PocMotionOutcome,{...props,related});
      assert.equal(detail.querySelector('dl'),null);
      if(status==='unavailable')assert.match(detail.textContent,/No verified final outcome/);
    }
  });
  await t.test('joint authorship is stated only from that joint text, independently of its adoption',()=>{
    const node=render(PocMotionOutcome,{...props,related:[{...joint,memberAuthorship:'recorded'}]});
    assert.match(node.querySelector('.poc-motion-joint-outcome').textContent,/This MEP is also listed as an author/);
    const unknown=render(PocMotionOutcome,{...props,related:[{...joint,memberAuthorship:undefined}]});
    assert.doesNotMatch(unknown.querySelector('.poc-motion-joint-outcome').textContent,/This MEP|authorship/);
  });
  await t.test('a standalone lapsed motion invents no joint text, and a joint card names itself correctly',()=>{
    const lone=render(PocMotionOutcome,{...props,related:[]});
    assert.equal(lone.querySelector('.poc-motion-joint-outcome'),null);
    assert.doesNotMatch(lone.textContent,/related joint|Original motion/);
    const jointCard=render(MotionStatuses,{outcome:joint.outcome,sourceId:joint.sourceId});
    assert.match(jointCard.textContent,/Joint motion: adopted/);
    assert.equal(jointCard.querySelectorAll('[data-outcome]').length,1);
    const unavailable=render(PocMotionOutcome,{...props,related:[],outcome:{status:'unavailable'}});
    assert.match(unavailable.textContent,/Outcome unavailable/);
    assert.equal(unavailable.querySelector('dl'),null);
  });
  await t.test('multiple joint texts retain individual references, dates and outcomes',()=>{
    const second={...joint,sourceId:'RC-10-2026-0438',reference:'RC-B10-0438/2026',outcome:{status:'rejected',date:'2026-10-09',totals:{for:1,against:2,abstaining:null}}};
    const related=[joint,second],summary=render(MotionStatuses,{...props,related}),detail=render(PocMotionOutcome,{...props,related});
    assert.match(summary.textContent,/Joint motion RC-B10-0441\/2026: adopted/);
    assert.match(summary.textContent,/Joint motion RC-B10-0438\/2026: rejected/);
    const sections=detail.querySelectorAll('.poc-motion-joint-outcome');
    assert.match(sections[1].textContent,/Oct 9, 2026/);
    assert.deepEqual([...sections[1].querySelectorAll('dd')].map(node=>node.textContent),['1','2','—']);
  });
  await t.test('machine records and missing document URLs produce no clickable fallback',()=>{
    for(const url of ['', 'https://data.europarl.europa.eu/eli/dl/doc/RC-10-2026-0441','https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-10-08/decisions?format=application%2Fld%2Bjson']) {
      const node=render(PocMotionOutcome,{...props,related:[{...joint,url}]});
      assert.equal(node.querySelector('a'),null);
      assert.match(node.textContent,/RC-B10-0441\/2026/);
      assert.match(node.textContent,/Adopted/);
    }
  });
});
