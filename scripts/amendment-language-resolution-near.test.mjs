import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {verifyLanguagePlacement} from './amendment-language-oracle.mjs';
const example=JSON.parse(readFileSync(new URL('./fixtures/resolution-near-fr-native.json',import.meta.url))),{expected,rawText}=example;
const path=n=>`/w:document[1]/w:body[1]/w:p[${n}]`;
const selected=rawText.paragraphs.find(p=>p.path===path(95));
const verify=(raw=rawText,row=selected,target=expected)=>verifyLanguagePlacement({expected:target,placement:{status:'placed',operation:'replace',span:{start:0,end:0}},text:{paragraphs:[row.text],paragraphSources:[{path:row.path}]},rawText:raw});
test('native French near-match remains bound to report paragraph25, independently of the amendment header path',()=>{
 assert.equal(expected.path,path(53));assert.match(rawText.paragraphs.find(p=>p.path===path(53)).text,/^B\./u);assert.match(selected.text,/^25\./u);
 const result=verify();assert.equal(result.status,'verified',result.reason);assert.equal(result.location.value,'25');
});
test('near-match never verifies an off-label paragraph even when it is a closer unique quote',()=>{
 const other={...rawText.paragraphs.find(p=>p.path===path(96)),text:expected.originalText.replace(/^25\./u,'26.')};
 const raw={paragraphs:rawText.paragraphs.map(p=>p.path===other.path?other:p)};
 assert.equal(verify(raw,other).status,'failed');
});
test('a stronger nonadjacent competitor, even an incomplete one, withholds the native labelled near-match',()=>{
 const competitor={...rawText.paragraphs.find(p=>p.path===path(97)),text:expected.originalText.replace(/^25\./u,'27.')};
 for(const uncertain of [false,true])assert.notEqual(verify({paragraphs:rawText.paragraphs.map(p=>p.path===competitor.path?{...competitor,uncertain}:p)}).status,'verified');
});
test('near-match requires a complete native whole-unit extent',()=>{
 assert.notEqual(verify({paragraphs:rawText.paragraphs.map(p=>p.path===selected.path?{...p,uncertain:true}:p)}).status,'verified');
 const continuation={...selected,path:path(96),text:'a continuing part of the same provision.'};
 const rows=rawText.paragraphs.flatMap(p=>p.path===selected.path?[p,continuation]:[{...p,path:p.path.replace(/w:p\[(\d+)\]$/u,(value,n)=>Number(n)>=96?'w:p['+(Number(n)+1)+']':value)}]);
 assert.notEqual(verify({paragraphs:rows}).status,'verified');
});

test('native near-match cannot bypass detached-note payload proof',()=>{
 assert.notEqual(verify(rawText,selected,{...expected,originalText:expected.originalText+'\n______\n7 X'}).status,'verified');
});
