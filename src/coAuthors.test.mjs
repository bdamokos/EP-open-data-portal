import test from 'node:test';
import assert from 'node:assert/strict';
import {coAuthorSegments,linkedCoAuthors,coAuthorProfileUrl} from './coAuthors.mjs';
const author=(id,name,extra={})=>({id,name,profileAvailable:true,role:'AUTHOR',...extra});
test('links only authoritative current-person authors, preserves displayed spelling and whitespace',()=>{
 const text='Yannis Maniatis (S&D), Maravillas Abadía Jover (PPE).';
 const parts=coAuthorSegments(text,[author(1,'Yannis MANIATIS'),author(257043,'Maravillas ABADÍA JOVER')]);
 assert.deepEqual(parts.filter(p=>p.id).map(p=>p.id),[1,257043]);assert.equal(parts.map(p=>p.text).join(''),text);
 assert.equal(coAuthorSegments('Yannis\u00a0Maniatis',[author(1,'Yannis MANIATIS')])[0].id,1);
});
test('unknown profiles, organizations and rapporteurs cannot turn prose into author links',()=>{
 const people=[author(1,'A Name',{profileAvailable:false}),author(2,'B Name',{role:'RAPPORTEUR'}),author(3,null)];
 assert.equal(linkedCoAuthors(people).length,0);assert.deepEqual(coAuthorSegments('A Name, B Name',people),[{text:'A Name, B Name',id:null}]);
});
test('ambiguous names and partial-name occurrences stay plain',()=>{
 assert.equal(coAuthorSegments('A Name',[author(1,'A Name'),author(2,'A NAME')])[0].id,null);
 assert.deepEqual(coAuthorSegments('Alexander Sellman, Alexander Sell',[author(256959,'Alexander SELL')]),[
  {text:'Alexander Sellman, ',id:null},
  {text:'Alexander Sell',id:256959},
 ]);
});
test('answer-linked question authors remain eligible with their explicit role',()=>{
 assert.equal(coAuthorSegments('Maravillas Abadía Jover',[author(257043,'Maravillas ABADÍA JOVER',{role:'QUESTION_AUTHOR'})])[0].id,257043);
 assert.match(coAuthorProfileUrl('hu',257043),/lang=hu&member=257043&module=profile/);
 assert.throws(()=>coAuthorProfileUrl('en',NaN));
});

test('profile references preserve the document origin and path, including authority-like paths',()=>{
 for(const path of ['/','/index.html','/browser/mep-speeches-poc/','/browser/mep-speeches-poc/index.html','//attacker.example/','///attacker.example/','/\\attacker.example/','/x/..//attacker.example/','/%2fattacker.example/','/%5cattacker.example/']) {
  const page=new URL(`https://explorer.example${path}?member=1&module=activities#document`);
  const href=coAuthorProfileUrl('hu',257043),destination=new URL(href,page);
  assert.equal(href,'?lang=hu&member=257043&module=profile');
  assert.equal(destination.origin,page.origin,path);
  assert.equal(destination.pathname,page.pathname,path);
  assert.deepEqual([...destination.searchParams],[['lang','hu'],['member','257043'],['module','profile']]);
  assert.equal(destination.hash,'');
 }
 assert.equal(new URL(coAuthorProfileUrl('en&member=1#x',2),'https://explorer.example/').searchParams.get('lang'),'en&member=1#x');
 for(const id of [0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1,'257043'])assert.throws(()=>coAuthorProfileUrl('en',id),/Invalid MEP identifier/);
});
