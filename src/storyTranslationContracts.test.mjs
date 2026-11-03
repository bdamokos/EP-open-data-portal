import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReferenceTopicStories} from './topicStoryModel.mjs';
import {buildExactTopicStories} from './exactTopicStories.mjs';
import {storyLinkClaims} from './storyLinkModel.mjs';
import {createAppUiI18n} from './uiCatalogues.mjs';
const en=createAppUiI18n().forLocale('en');
function say(v,ui=en){
 if(v==null||typeof v==='string')return v||'';
 if(Array.isArray(v))return v.map(x=>say(x,ui)).join(' / ');
 if('text'in v)return say(v.text,ui);
 return ui.t(v.message||v.id,Object.fromEntries(Object.entries(v.values).map(([k,x])=>[k,say(x,ui)])),v.counts);
}
const periods=['2025-Q1','2025-Q2','2025-Q3'];
const qs=(n,q,home=[])=>Array.from({length:n},(_,i)=>({id:q+'-'+i,d:q==='2025-Q1'?'2025-01-01':q==='2025-Q2'?'2025-04-01':'2025-07-01',t:'Exact question',places:['FRA'],home,authors:['known']}));
test('reference rise and summary slots render the current canonical whole phrases',()=>{
 const f={questions:[...qs(2,periods[0]),...qs(2,periods[1]),...qs(11,periods[2]),...qs(1,periods[2],['FRA']).map(q=>({...q,id:'home'}))],docs:[],debates:[],topics:{},mepCountry:{known:'ES'}};
 const selection={periods,period:periods[2],labels:{FRA:'France'}};
 const rows=storyLinkClaims(buildReferenceTopicStories(f,selection),selection);
 const rise=rows.find(r=>r.id==='topics.story.map.rise.jumped');assert(rise);
 assert.match(say(rise),/^Questions about France jumped to 12, from an average of two a quarter/);
 assert.match(say(rise),/one had an author elected there/);
 const summary=storyLinkClaims(buildReferenceTopicStories(f,{...selection,place:'FRA',period:undefined}),selection);
 assert.match(say(summary[0]),/16 questions named France this term, 15 of them asked only by MEPs from other countries/);
});
test('composed native count slots retain raw selectors and rich reference identity',()=>{
 const translation={plural:'count',one:'ONE {count}',few:'FEW {count}',other:'OTHER {count}'};
 const ui=createAppUiI18n({pl:{'topics.story.links.home':translation,'topics.story.links.elsewhere':translation,'topics.story.count.debates':translation}},{}).forLocale('pl');
 const payload={ready:true,counts:{questions:7,questionElsewhere:2},periodCounts:[],winners:{},periodWinners:{},debates:[],docs:[],questions:[],askers:'all'};
 const summary=buildExactTopicStories(payload,{place:'FRA',language:'pl'})[0];
 assert.equal(summary.values.elsewhere.text.counts.count,2);assert.equal(say(summary.values.elsewhere,ui),'FEW 2');
 const home=storyLinkClaims([{id:'x',values:{clause:{message:'topics.story.rise.someHome',values:{questions:{text:'2',records:[],rawCount:2,target:'?place=FRA&t-askers=home'}}}}}],{})[0].values.clause.values.questions;
 assert.equal(home.target,'?place=FRA&t-askers=home');assert.equal(say(home,ui),'FEW 2');
 payload.counts={};payload.periodCounts=[{period:'2025-Q3'}];payload.periodWinners={'2025-Q3':{mostDebatedPlaces:[{id:'FRA',count:2},{id:'ESP',count:2}]}};
 const most=buildExactTopicStories(payload,{period:'2025-Q3',language:'pl',hasMessage:()=>false})[0];assert.equal(most.values.count.text.counts.count,2);assert.equal(say(most.values.count,ui),'2');assert.match(most.values.count.setKey,/debates/);
});
test('Italian ordinal many has a source fallback and a native explicit key',()=>{
 assert.equal(new Intl.PluralRules('it',{type:'ordinal'}).select(8),'many');
 assert.equal(en.t('topics.story.ordinal.many',{count:'8'}),'8th');
 const ui=createAppUiI18n({it:{'topics.story.ordinal.many':'{count}º'}}).forLocale('it');assert.equal(ui.t('topics.story.ordinal.many',{count:'8'}),'8º');
});
