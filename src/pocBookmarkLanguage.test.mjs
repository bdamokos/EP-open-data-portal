import test from 'node:test';
import assert from 'node:assert/strict';
import {createSavedStore,readSaved,savedLinks} from './pocBookmarks.mjs';

const question={kind:'question',id:'E-10-2026-003031',title:'Legacy title',baseline:{revision:'old',answerIds:[]}};
function storage(items=[]) {
  let raw=JSON.stringify({version:1,items}),writes=0;
  return {getItem:()=>raw,setItem(_key,value){raw=value;writes++;},raw:()=>raw,writes:()=>writes};
}

test('legacy and explicit unknown languages survive cleaning without inferring from title text or writing storage',()=>{
  const items=[
    {...question,updated:true,newAnswer:true,newActivity:true,latest:[{id:'speech',title:'Bonjour'}],unreadAnswers:[{id:'answer',title:'Szia',titleLanguage:null}]},
    {...question,id:'E-10-2026-003032',titleLanguage:'mul'},
    {...question,id:'E-10-2026-003033',titleLanguage:'und'},
  ];
  const disk=storage(items),before=disk.raw(),store=createSavedStore(disk);
  store.reload();
  assert.equal(disk.raw(),before);assert.equal(disk.writes(),0);
  const loaded=store.snapshot().items;
  assert.equal(loaded[0].titleLanguage,null);assert.equal(loaded[0].latest[0].titleLanguage,null);
  assert.equal(loaded[0].unreadAnswers[0].titleLanguage,null);
  assert(loaded[0].updated&&loaded[0].newAnswer&&loaded[0].newActivity);
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
    assert.equal(item.unreadAnswers[0].title,title);assert.equal(item.unreadAnswers[0].titleLanguage,titleLanguage);
    assert(item.newAnswer);assert.equal(item.id,question.id);
  }
  store.observe({members:[],questions:[{id:question.id,status:'available',title:'Old server title',revision:'new',answers:[]}]});
  assert.equal(store.snapshot().items[0].titleLanguage,null,'new text without metadata cannot inherit an older title language');
  assert.equal(JSON.parse(disk.raw()).version,1);
});

test('answer titles carry their own metadata through preview fallbacks, older responses and individual acknowledgement',()=>{
  const disk=storage([{kind:'mep',id:'257043',title:'A name',titleLanguage:null,baseline:{activityVersion:3,revision:'old',total:1,latestIds:['speech'],answerIds:[]}}]);
  let store=createSavedStore(disk);
  const state={id:'257043',status:'available',name:'A name',revision:'new',total:2,activityIds:['speech','new-speech'],
    latest:[{id:'answer-fr',date:'2026-10-15',title:'Preview français',titleLanguage:'fr',recordKind:'answer'}],
    answers:[{id:'answer-hu',title:'Válasz',titleLanguage:'hu',relatedQuestionId:question.id},{id:'answer-fr'},{id:'answer-unknown',title:'Unknown answer'},{id:'answer-fixed',relatedQuestionId:question.id}]};
  store.observe({questions:[],members:[state]});store=createSavedStore(disk);
  let item=store.snapshot().items[0];
  assert.equal(item.titleLanguage,null);assert(item.newAnswer&&item.newActivity);
  assert.deepEqual(savedLinks(item).slice(0,4).map(a=>[a.id,a.title,a.titleLanguage]),[
    ['answer-fixed','Question '+question.id,'en'],['answer-fr','Preview français','fr'],['answer-hu','Válasz','hu'],['answer-unknown','Unknown answer',null],
  ]);
  store.markActivityRead('mep:257043');store.markAnswerRead('mep:257043','answer-hu');
  store.observe({questions:[],members:[{...state,latest:[],answers:state.answers.map(({title,titleLanguage,...a})=>a)}]});
  store=createSavedStore(disk);item=store.snapshot().items[0];
  assert.deepEqual(item.unreadAnswers.map(a=>a.id),['answer-fixed','answer-fr','answer-unknown']);
  assert.equal(item.unreadAnswers[1].title,'Preview français');assert.equal(item.unreadAnswers[1].titleLanguage,'fr');
  assert.equal(item.newActivity,false);assert(item.newAnswer&&item.updated);
  assert(item.baseline.answerIds.includes('answer-hu'));
});

test('absent titles never lend their language to identifier fallbacks or another title source',()=>{
  const item=readSaved(JSON.stringify({version:1,items:[{...question,title:'',titleLanguage:'hu',latest:[{id:'id-only',titleLanguage:'fr'}]}]}))[0];
  assert.equal(item.title,question.id);assert.equal(item.titleLanguage,null);
  assert.equal(item.latest[0].title,'id-only');assert.equal(item.latest[0].titleLanguage,null);
  const store=createSavedStore(storage([{...question,titleLanguage:'fr'}]));
  store.observe({members:[],questions:[{id:question.id,status:'not-saved',titleLanguage:'hu'}]});
  assert.equal(store.snapshot().items[0].titleLanguage,'fr');
});
