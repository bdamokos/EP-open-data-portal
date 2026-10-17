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
    {titles:{fr:'',de:'Do not select a later key'},expected:{}},
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
    const results=['en','hu','fr'].map(language=>savedStates(store,savedQuery(new URLSearchParams({questions:ids.join(','),members:'257043',lang:language}))));
    for(const [locale,result] of results.entries()) {
      const language=['en','hu','fr'][locale];
      for(const [index,item] of result.questions.entries()) {
        const expected=cases[index].expected[language]||[ids[index],null];
        assert.deepEqual([item.title,item.titleLanguage],expected);
        assert.equal(item.id,ids[index]);
        assert.deepEqual([item.latest[0].title,item.latest[0].titleLanguage],expected);
        const memberEntry=result.members[0].answers.find(a=>a.id===item.latest[0].id);
        assert.deepEqual([memberEntry.title,memberEntry.titleLanguage],cases[index].expected[language]||[ids[index]+'-ASW',null]);
        assert.equal(memberEntry.relatedQuestionId,item.id);
        assert.equal(item.revision,results[0].questions[index].revision,'changing display language is not new activity');
      }
      assert.equal(result.members[0].name,'A proper name');
      assert.equal(result.members[0].titleLanguage,undefined,'proper names are not assigned a guessed title language');
      assert.equal(result.members[0].revision,results[0].members[0].revision);
      assert.deepEqual(result.members[0].activityIds,results[0].members[0].activityIds);
    }
    assert.equal(store.db.prepare('SELECT count(*) n FROM sources').get().n,sourceCount);
    let raw=JSON.stringify({version:1,items:[{kind:'question',id:ids[0],title:'Legacy unknown',baseline:{revision:results[0].questions[0].revision,answerIds:[]}}]});
    const disk={getItem:()=>raw,setItem(_key,value){raw=value;}};
    const browser=createSavedStore(disk);browser.observe(results[1]);
    const loaded=createSavedStore(disk).snapshot().items[0];
    assert.equal(loaded.titleLanguage,'hu');assert.equal(loaded.unreadAnswers[0].titleLanguage,'hu');
    assert(loaded.newAnswer);assert(!loaded.newActivity);
  } finally {store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});}
});
