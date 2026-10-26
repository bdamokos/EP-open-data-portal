import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {freshLoader} from './test-support/viteRunner.mjs';
import {Window} from 'happy-dom';

test('current committee cards render already merged role history and localized current roles',async t=>{
  const loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>loadModule.close());
  const {CommitteeMemberships}=await loadModule('/src/CommitteeMemberships.tsx');
  const committee={id:'6363',code:'FEMM',names:{en:'Women’s Rights and Gender Equality',hu:'Nőjogi és Esélyegyenlőségi Bizottság'}};
  const periods=[{role:'MEMBER',start:'2022-01-25',end:null,current:true,observations:[]},{role:'CHAIR',start:'2019-07-10',end:'2022-01-24',current:false,observations:[]}];
  const profile={currentAffiliation:{status:'matched'},memberships:[],committeeMemberships:{complete:true,error:null,items:[{...committee,identity:'org/FEMM',roles:['MEMBER'],periods}]}};
  const window=new Window();t.after(()=>window.happyDOM.close());
  const render=(profile,lang='en')=>{window.document.body.innerHTML=renderToStaticMarkup(createElement(CommitteeMemberships,{profile,committees:[committee],lang,roleName:role=>lang==='hu'?{MEMBER:'Tag',CHAIR:'Elnök'}[role]:{MEMBER:'Member',CHAIR:'Chair'}[role],date:value=>value,retry:()=>{}}));return window.document.body;};
  let page=render(profile);assert.match(page.querySelector('strong').textContent,/FEMM · Member/);
  const rows=page.querySelectorAll('li');assert.equal(rows.length,2);assert.match(rows[0].textContent,/Chair.*2019-07-10 — 2022-01-24/);assert.match(rows[1].textContent,/Member.*2022-01-25 — Present/);assert(rows[1].classList.contains('is-current'));
  page=render(profile,'hu');assert.match(page.textContent,/FEMM · Tag/);assert.match(page.textContent,/Elnök/);assert.match(page.textContent,/jelenleg/);assert.equal(page.querySelector('small').lang,'hu');
  for(const status of ['not-current','unavailable',undefined]) {
    page=render({...profile,currentAffiliation:status?{status}:undefined});
    assert.doesNotMatch(page.textContent,/Present|not supplied/);assert.match(page.textContent,/From 2022-01-25/);
    assert.equal(page.querySelectorAll('.is-current').length,0);
    assert.equal(page.querySelector('strong').textContent,'FEMM');
  }
  page=render({...profile,committeeMemberships:{...profile.committeeMemberships,complete:false,error:'Some committee history is unavailable.'}});assert.match(page.textContent,/unavailable/);assert.equal(page.querySelector('button').textContent,'Retry committee history');assert.equal(page.querySelectorAll('section').length,1);
});
