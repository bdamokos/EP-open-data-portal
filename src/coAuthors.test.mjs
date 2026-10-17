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
 assert.equal(coAuthorSegments('Alexander Sellman, Alexander Sell',[author(256959,'Alexander SELL')]).filter(p=>p.id).length,1);
});
test('answer-linked question authors remain eligible with their explicit role',()=>{
 assert.equal(coAuthorSegments('Maravillas Abadía Jover',[author(257043,'Maravillas ABADÍA JOVER',{role:'QUESTION_AUTHOR'})])[0].id,257043);
 assert.match(coAuthorProfileUrl('/browser/mep-speeches-poc/','hu',257043),/lang=hu&member=257043&module=profile/);
 assert.throws(()=>coAuthorProfileUrl('/','en',NaN));
});
