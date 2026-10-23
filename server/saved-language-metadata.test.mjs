import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ActivityStore} from './activity-index-store.mjs';
import {documentRows,projectDocument} from './activity-index-model.mjs';
import {savedQuery,savedStates} from './insights-saved.mjs';
import {createSavedStore} from '../src/bookmarks.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/activity-index-live-20261013.json',import.meta.url)));
const base=fixture.documents.find(d=>d.work.identifier==='E-10-2026-003031').work;

test('saved responses pair chosen titles with exact dictionary keys without changing IDs, revisions or source state',()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'saved-language-')),store=new ActivityStore(directory);
  const cases=[
    {titles:{hu:'Azonos cím',en:'English title',fr:'Titre français'},expected:{hu:['Azonos cím','hu'],en:['English title','en'],fr:['Titre français','fr']}},
    {titles:{en:'English fallback'},expected:{hu:['English fallback','en'],en:['English fallback','en'],fr:['English fallback','en']}},
    {titles:{fr:'Premier titre',de:'Zweiter Titel'},expected:{hu:['Premier titre','fr'],en:['Premier titre','fr'],fr:['Premier titre','fr']}},
    {titles:{en:'Identical',hu:'Identical',fr:'Identical'},expected:{hu:['Identical','hu'],en:['Identical','en'],fr:['Identical','fr']}},
    {titles:{},expected:{}},
    {titles:{fr:'',de:'Later German title'},expected:{hu:['Later German title','de'],en:['Later German title','de'],fr:['Later German title','de']}},
    {titles:{mul:'Mixed supplied title'},expected:{hu:['Mixed supplied title','mul'],en:['Mixed supplied title','mul'],fr:['Mixed supplied title','mul']}},
  ];
  try {
    store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'257043',name:'A proper name'}]);
    const ids=cases.map((entry,index)=>{
      const id='E-10-2026-'+String(9000+index).padStart(6,'0');
      const answer={...base.inverse_answers_to[0],id:'eli/dl/doc/'+id+'-ASW',identifier:id+'-ASW'};
      const work={...base,id:'eli/dl/doc/'+id,identifier:id,title_dcterms:entry.titles,is_realized_by:[],inverse_answers_to:[answer]};
      const key='/parliamentary-questions/'+id;
      store.putSource(generation,key,'document',projectDocument(work),fixture.verifiedAt,documentRows(work,key,fixture.verifiedAt).rows);
      return id;
    });
    const sourceCount=store.db.prepare('SELECT count(*) n FROM sources').get().n;
    store.db.exec('PRAGMA query_only=ON');
    const results=['en','hu','fr'].map(language=>savedStates(store,savedQuery(new URLSearchParams({questions:ids.join(','),lang:language}))));
    for(const [locale,result] of results.entries()) {
      const language=['en','hu','fr'][locale];
      for(const [index,item] of result.questions.entries()) {
        const expected=cases[index].expected[language]||[ids[index],null];
        assert.deepEqual([item.title,item.titleLanguage],expected);
        assert.equal(item.id,ids[index]);
        assert.deepEqual([item.latest[0].title,item.latest[0].titleLanguage],expected);
        assert.equal(item.revision,results[0].questions[index].revision,'changing display language is not new activity');
      }

    }
    assert.equal(store.db.prepare('SELECT count(*) n FROM sources').get().n,sourceCount);
    const data=new Map();let raw=JSON.stringify({version:1,items:[{kind:'question',id:ids[0],title:'Legacy unknown',baseline:{revision:results[0].questions[0].revision,answerIds:[]}}]});
    data.set('ep.bookmarks.v1',raw);const disk={getItem:key=>data.get(key)||null,setItem(key,value){data.set(key,value);}};
    const browser=createSavedStore(disk);browser.observe(results[1]);
    const loaded=createSavedStore(disk).snapshot().items[0];
    assert.equal(loaded.titleLanguage,'hu');assert.equal(loaded.entries.find(entry=>entry.kind==='answer').titleLanguage,'hu');
    assert(loaded.newAnswer);assert(!loaded.newActivity);
  } finally {store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});}
});
