import test from 'node:test';
import assert from 'node:assert/strict';
import {createSavedStore,readSaved,savedLinks} from './bookmarks.mjs';

const question={kind:'question',id:'E-10-2026-003031',title:'Legacy title',baseline:{revision:'old',answerIds:[]}};
function storage(items=[]) {
  const data=new Map([['ep.bookmarks.v1',JSON.stringify({version:1,items})]]);let writes=0;
  return {getItem:key=>data.get(key)||null,setItem(key,value){data.set(key,value);writes++;},raw:()=>data.get('ep.following.v2')||data.get('ep.bookmarks.v1'),writes:()=>writes};
}

test('legacy and explicit unknown languages survive cleaning without inferring from title text; migration persists once',()=>{
  const items=[
    {...question,updated:true,newAnswer:true,newActivity:true,latest:[{id:'speech',title:'Bonjour'}],unreadAnswers:[{id:'answer',title:'Szia',titleLanguage:null}]},
    {...question,id:'E-10-2026-003032',titleLanguage:'mul'},
    {...question,id:'E-10-2026-003033',titleLanguage:'und'},
  ];
  const disk=storage(items),store=createSavedStore(disk),before=disk.raw(),writes=disk.writes();
  store.reload();
  assert.equal(disk.raw(),before);assert.equal(disk.writes(),writes);
  const loaded=store.snapshot().items;
  assert.equal(loaded[0].titleLanguage,null);assert.equal(loaded[0].latest[0].titleLanguage,null);
  assert.equal(loaded[0].entries[0].titleLanguage,null);
  assert(loaded[0].updated&&loaded[0].newAnswer);
  assert.equal(loaded[1].titleLanguage,'mul');assert.equal(loaded[2].titleLanguage,'und');
  assert.deepEqual(loaded.map(item=>item.id),items.map(item=>item.id));
});

test('question title and language follow the same selected observation and persist through normal reloads',()=>{
  const disk=storage([question]);let store=createSavedStore(disk);
  for(const [title,titleLanguage] of [['Titre français','fr'],['Magyar cím','hu'],['English title','en'],['Unknown title',null]]) {
    store.observe({members:[],questions:[{id:question.id,status:'available',title,titleLanguage,revision:'new',answers:[{id:question.id+'-ASW'}]}]});
    store=createSavedStore(disk);
    const item=store.snapshot().items[0];
    assert.equal(item.title,title);assert.equal(item.titleLanguage,titleLanguage);
    assert.equal(item.entries[0].title,'Titre français');assert.equal(item.entries[0].titleLanguage,'fr');
    assert(item.newAnswer);assert.equal(item.id,question.id);
  }
  store.observe({members:[],questions:[{id:question.id,status:'available',title:'Old server title',revision:'new',answers:[]}]});
  assert.equal(store.snapshot().items[0].titleLanguage,null,'new text without metadata cannot inherit an older title language');
  assert.equal(JSON.parse(disk.raw()).version,2);
});

test('migrated answer titles preserve language metadata through materialization and acknowledgement',()=>{
 const disk=storage([{kind:'mep',id:'42',title:'A name',baseline:{activityVersion:3,activityIdsComplete:true,latestIds:[],answerIds:[]}}]);
 const store=createSavedStore(disk);store.applyManifest({epoch:'one',generation:2,indexComplete:true,rosterBasis:'publication',members:{42:[null,2,0,2]}});
 const data={epoch:'one',generation:2,member:'42',status:'available',ids:[['fr-answer',1,2],['unknown',1,2]],entries:[{id:'fr-answer',title:'Réponse',titleLanguage:'fr',kind:'answer',mark:2},{id:'unknown',title:'Unknown',kind:'answer',mark:2}]};
 store.materialize(data);let item=createSavedStore(disk).snapshot().items[0];
 assert.deepEqual(savedLinks(item).map(x=>[x.title,x.titleLanguage]),[['Réponse','fr'],['Unknown',null]]);
 store.markEntryRead('mep:42','answer','unknown');item=createSavedStore(disk).snapshot().items[0];assert.equal(savedLinks(item)[0].titleLanguage,'fr');
});

test('absent titles never lend their language to identifier fallbacks or another title source',()=>{
  const item=readSaved(JSON.stringify({version:1,items:[{...question,title:'',titleLanguage:'hu',latest:[{id:'id-only',titleLanguage:'fr'}]}]}))[0];
  assert.equal(item.title,question.id);assert.equal(item.titleLanguage,null);
  assert.equal(item.latest[0].title,'id-only');assert.equal(item.latest[0].titleLanguage,null);
  const store=createSavedStore(storage([{...question,titleLanguage:'fr'}]));
  store.observe({members:[],questions:[{id:question.id,status:'not-saved',titleLanguage:'hu'}]});
  assert.equal(store.snapshot().items[0].titleLanguage,'fr');
});
