import test from 'node:test';
import assert from 'node:assert/strict';
import {assertResolutionSimilarity} from './amendment-similarity-oracle.mjs';
const original='Calls on the Commission and the Member States to develop a common definition to recognise and address discrimination across the Union;';
const row=text=>({start:3,end:3,text});
test('resolution oracle accepts small damage and a unique shared opening',()=>{
 for(const text of [original.replace('Commission','Commissio'),original.slice(0,100)+' a different ending;'])assert(assertResolutionSimilarity([row(text)],original,{start:3,end:3}));
});
test('resolution oracle rejects competing passages and changed coordinates',()=>{
 const candidates=[row(original),{...row(original),start:4,end:4}];
 assert(!assertResolutionSimilarity(candidates,original,{start:3,end:3}));
 assert(!assertResolutionSimilarity([row(original)],original,{start:2,end:2}));
 assert(!assertResolutionSimilarity([row('Unrelated wording;')],original,{start:3,end:3}));
});
