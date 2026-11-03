import {buildExactTopicStories} from './exactTopicStories.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAppUiI18n} from './uiCatalogues.mjs';
import {buildReferenceTopicStories} from './topicStoryModel.mjs';
import {storyLinkClaims} from './storyLinkModel.mjs';
const languages='bg cs da de el es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' ');
const read=name=>JSON.parse(readFileSync(new URL('./ui-locales/'+name+'.json',import.meta.url)));
const catalogues=Object.fromEntries(languages.map(l=>[l,read(l)])),forms=read('plural-forms'),english=read('en'),pairs=read('plural-pairs');
const i18n=createAppUiI18n(catalogues),slots=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
test('reviewed story messages and outside labels have native whole-message coverage and exact slots',()=>{
 const keys=Object.keys(catalogues.fr).filter(k=>k.startsWith('topics.story.')||k.startsWith('MotionComparison.contextStage.')||k.startsWith('membervotesummary.fullPosition.')||k.startsWith('membervotes.summary.recorded.'));
 for(const l of languages)for(const k of keys){assert.equal(typeof catalogues[l][k],'string',l+'/'+k);assert(catalogues[l][k].trim());assert.deepEqual(slots(catalogues[l][k]),slots(english[k]),l+'/'+k);assert.equal(i18n.forLocale(l).messageLocale(k),i18n.forLocale(l).locale,l+'/'+k);}
});
test('story cardinal families retain numeric selectors including decimals and independent counts',()=>{
 const counts=[0,1,2,3,5,7,11,19,20,21,22,101,111,1.5,2.1];
 for(const l of languages){const ui=i18n.forLocale(l);for(const pair of pairs.filter(p=>p.other.startsWith('topics.story.'))){
  const fs=forms[l][pair.other];assert(fs&&fs.other,l+'/'+pair.other);
  for(const [category,value]of Object.entries(fs)){assert(['zero','one','two','few','many','other'].includes(category));assert(value.trim());assert.deepEqual(slots(value),slots(english[pair.other]));}
  for(const n of counts){const values=Object.fromEntries(slots(english[pair.other]).map(k=>[k,k===pair.count?String(n):'7']));const category=new Intl.PluralRules(ui.locale).select(n),expected=(fs[category]??fs.other).replace(/\{(\w+)\}/g,(_,k)=>values[k]);assert.equal(ui.t(pair.other,values,{[pair.count]:n}),expected,l+'/'+pair.other+'/'+n);}
 }}
 assert.equal(i18n.forLocale('pt').locale,'pt-PT');
});
test('German additional-resolution stories agree at singular and plural counts',()=>{
 const ui=i18n.forLocale('de');
 const text=value=>value==null?'':typeof value==='string'?value:Array.isArray(value)?value.map(text).join(' / '):'text'in value?text(value.text):ui.t(value.message||value.id,Object.fromEntries(Object.entries(value.values).map(([key,item])=>[key,text(item)])),value.counts);
 for(const count of [1,2,22]){
  const facts={questions:[],debates:[],docs:Array.from({length:count},(_,index)=>({id:`B10-${String(index+1).padStart(4,'0')}/2026`,title:'Opaque source title',date:'2026-07-01',type:'RESOLUTION_MOTION',places:['FRA'],outcome:{outcome:'ADOPTED'}}))};
  const selection={place:'FRA',period:'2026-Q3',periods:['2026-Q3'],language:'de',proseLanguage:'de',labels:{FRA:'Frankreich'}};
  const story=storyLinkClaims(buildReferenceTopicStories(facts,selection),selection).find(row=>row.id==='topics.story.place.quarter.otherResolutions');
  assert(story,`additional resolutions story at ${count}`);
  assert.equal(text(story),`Das Parlament nahm auch folgende Texte an, in denen der Ort genannt wurde: ${count} ${count===1?'Entschließung':'Entschließungen'}.`);
 }
});

const integrated=l=>Object.entries(catalogues[l]).filter(([k])=>k.startsWith('topics.story.integrated.'));
test('integrated leader stories keep a verb in the debates clause and German debate capitalisation',()=>{
 const q='2026-Q3',payload={ready:true,counts:{},winners:{},periodCounts:[{period:q}],periodWinners:{[q]:{mostQuestionedPlaces:[{id:'TUR',count:23}]}},periods:[q],partial:{},series:{TUR:{[q]:{debates:2}}},debates:[],docs:[],questions:[]};
 // A debates slot must sit in a clause with its own words, not after a bare conjunction ("…(23), en 2 debatten").
 const keys=k=>/^topics\.story\.(integrated\.lead\.(first|again|streak|soFar)|exact\.question(RiseFew|JumpedFew|Rare)Debates)(\.eu)?$/.test(k);
 const clause=v=>{const i=v.indexOf('{debates}'),start=Math.max(...',;:·'.split('').map(c=>v.lastIndexOf(c,i)))+1,end=v.slice(i).search(/[,;:·.]/);return v.slice(start,end<0?v.length:i+end);};
 for(const l of languages){
  for(const [key,value]of Object.entries(catalogues[l]).filter(([k])=>keys(k))){const words=clause(value).replace(/\{\w+\}/g,' ').split(/[\s()]+/).filter(w=>/\p{L}/u.test(w));assert(words.length>=2,l+'/'+key+': '+value);}
  const ui=i18n.forLocale(l),say=v=>v==null?'':typeof v==='string'?v:Array.isArray(v)?v.map(say).join(' / '):'text'in v?say(v.text):ui.t(v.message||v.id,Object.fromEntries(Object.entries(v.values).map(([k,x])=>[k,say(x)])),v.counts);
  const rows=buildExactTopicStories(payload,{period:q,language:l,labels:{TUR:'Türkiye'},hasMessage:id=>ui.messageLocale(id)===ui.locale});
  assert.equal(rows[0].id,'topics.story.integrated.lead.first',l);assert(say(rows[0]).includes(ui.t('topics.story.count.shortDebates',{count:'2'},{count:2})),l+': '+say(rows[0]));
 }
 for(const n of [1,2])assert.match(i18n.forLocale('de').t('topics.story.count.shortDebates',{count:String(n)},{count:n}),/Debatte/);
 for(const [key,value]of integrated('pl'))assert(!/ z \{average\}|zabrali|\}: .*: \{/.test(value),key);
 for(const [key,value]of integrated('fr'))assert(!/\S[:;]|:\S/.test(value),key);
});

test('Europe-zoom integrated stories open with the scope phrase, never the busiest-debate label',()=>{
 const euKeys=Object.keys(english).filter(k=>k.startsWith('topics.story.integrated.')&&k.endsWith('.eu'));
 for(const l of languages){
  const values=euKeys.map(k=>catalogues[l][k]),label=catalogues[l]['topics.story.exact.busiestPlace.eu'].split('{')[0];
  let scope=values[0];for(const v of values)while(!v.startsWith(scope))scope=scope.slice(0,-1);
  scope=scope.split('{')[0];assert(scope.trim().length>=10,l+': '+scope);
  // Main's busiest-debate opener is a label for that one sentence; it is not a scope phrase.
  if(!catalogues[l]['topics.story.map.lead.first.eu'].startsWith(label))for(const v of values)assert(!v.startsWith(label),l+': '+v);
  for(const k of euKeys){const world=catalogues[l][k.slice(0,-3)];assert.deepEqual(slots(catalogues[l][k]),slots(world),l+'/'+k);}
 }
});

test('verb-second locales keep the verb second in so-far and Europe-zoom stories',()=>{
 const scopes={de:'In Europa und seinen Nachbarregionen',nl:'In Europa en de buurlanden',sv:'I Europa och dess grannländer',da:'I Europa og nabolandene',et:'Euroopas ja selle naabruses'};
 for(const [l,scope]of Object.entries(scopes))for(const [key,value]of integrated(l)){
  assert(!/(Bisher|Tot nu toe|Hittills|Hidtil|Seni),? \{place/i.test(value),l+'/'+key+': '+value);
  if(key.endsWith('.eu'))assert(value.startsWith(scope+' ')&&!value.startsWith(scope+' {')&&!value.startsWith(scope+','),l+'/'+key+': '+value);
 }
 assert.equal(i18n.forLocale('de').t('topics.story.integrated.bothSoFar',{place:'Österreich',questions:'11',meps:'10 Abgeordnete',title:'Bericht',date:'20. Januar',format:'',outcome:''}),'Österreich war bisher Thema sowohl der Debatte mit den meisten Rednern auf der Karte als auch der meisten Anfragen (11): 10 Abgeordnete sprachen zu Bericht (20. Januar).');
});
