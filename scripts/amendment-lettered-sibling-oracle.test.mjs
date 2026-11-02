import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPlacement} from './amendment-benchmark-model.mjs';

// Minimal parsed proposal: each unit owns its listed rows; children nest.
const segment=(kind,value)=>({kind,value});
function unit(kind,value,parentPath,start,end,children=[],extra={}) {
  const path=[...parentPath,segment(kind,value)];
  const suffix=/^[a-z]([a-z]+)$/u.exec(value)?.[1]&&!/^[ivxlc]+$/u.test(value)?value.slice(1):'';
  return {id:'p/'+path.map(s=>s.kind+':'+s.value).join('/'),kind,scope:'proposal',path,extent:{start,end},complete:true,
    label:{kind,value,number:/^\d+$/u.test(value)?Number(value):null,suffix},children:children.map(child=>child(path)),...extra};
}
const child=(...args)=>parent=>unit(args[0],args[1],parent,...args.slice(2));
const rows=count=>Array.from({length:count},(_,index)=>({index,text:'Row '+index+'.',complete:true,source:{container:'body',complete:true}}));
const proposal=(units,count)=>({units,paragraphs:rows(count)});
const insert=(before,anchor)=>({status:'placed',operation:'insert',itemIndex:0,insertAfter:before-1,insertBefore:before,
  evidence:[{basis:'preceding-sibling-subtree',anchor}]});
const wording=targetLabel=>({targetLabel,originalText:'',proposedText:'(x)\tNew point.',language:'en',baseline:'commission-proposal'});
const check=(units,count,label,placement)=>verifyPlacement({placement,wording:wording(label),items:[{proposal:proposal(units,count)}]});

// Point 25 holds lettered points (a)–(c); point 26 (a) holds Roman (i)–(ii).
const amending=()=>[unit('article','1',[],0,12,[child('paragraph','1',1,12,[
  child('point','25',1,7,[child('point','a',1,3),child('point','b',3,5),child('point','c',5,7)]),
  child('point','26',7,12,[child('point','a',8,12,[child('point','i',8,10),child('point','ii',10,12)])]),
])])];
const id=(...parts)=>'p/article:1/paragraph:1/'+parts.join('/');

test('lettered point insertions follow the full preceding sibling subtree', () => {
  const b=id('point:25','point:b');
  assert.deepEqual(check(amending(),12,'Article 1 – paragraph 1 – point 25 – point b a (new)',insert(5,b)),{status:'verified',reason:'oracle-sibling-boundary'});
  assert.equal(check(amending(),12,'Article 1 – paragraph 1 – point 25 – point ba (new)',insert(5,b)).status,'verified');
  assert.equal(check(amending(),12,'Article 1 – paragraph 1 – point 25 – point b a (new)',insert(4,b)).reason,'oracle-insertion-boundary-mismatch');
  assert.equal(check(amending(),12,'Article 1 – paragraph 1 – point 25 – point b a (new)',insert(7,id('point:25','point:c'))).reason,'oracle-anchor-label-mismatch');
  assert.equal(check(amending(),12,'Article 1 – paragraph 1 – point 25 – point c a (new)',insert(7,id('point:25','point:c'))).status,'verified');
});

test('Roman point insertions use the Roman family ordinal', () => {
  const i=id('point:26','point:a','point:i'),ii=id('point:26','point:a','point:ii');
  assert.equal(check(amending(),12,'Article 1 – paragraph 1 – point 26 – point a – point i a (new)',insert(10,i)).status,'verified');
  assert.equal(check(amending(),12,'Article 1 – paragraph 1 – point 26 – point a – point ii a (new)',insert(12,ii)).status,'verified');
  assert.equal(check(amending(),12,'Article 1 – paragraph 1 – point 26 – point a – point i a (new)',insert(12,ii)).reason,'oracle-anchor-label-mismatch');
  // A bare new Roman point is no suffixed insertion; it stays unverified.
  assert.equal(check(amending(),12,'Article 1 – paragraph 1 – point 26 – point a – point ii (new)',insert(10,i)).status,'unverified');
});

test('unsupported families and duplicated labels never verify', () => {
  const gapped=[unit('article','1',[],0,6,[child('paragraph','1',1,6,[child('point','25',1,6,[child('point','b',1,3),child('point','c',3,6)])])])];
  assert.equal(check(gapped,6,'Article 1 – paragraph 1 – point 25 – point b a (new)',insert(3,id('point:25','point:b'))).status,'unverified');
  const existing=[unit('article','1',[],0,8,[child('paragraph','1',1,8,[child('point','25',1,8,[child('point','a',1,3),child('point','b',3,5),child('point','ba',5,6),child('point','c',6,8)])])])];
  assert.equal(check(existing,8,'Article 1 – paragraph 1 – point 25 – point b a (new)',insert(5,id('point:25','point:b'))).status,'failed');
});

test('an address may omit only an article\'s sole implicit paragraph 1', () => {
  const tree=implicit=>[unit('article','2',[],0,8,[child('paragraph','1',1,8,[child('point','2',1,8,[child('point','a',2,5),child('point','b',5,8)])],{implicit})])];
  const b='p/article:2/paragraph:1/point:2/point:b';
  assert.equal(check(tree(true),8,'Article 2 – point 2 – point b a (new)',insert(8,b)).status,'verified');
  assert.equal(check(tree(false),8,'Article 2 – point 2 – point b a (new)',insert(8,b)).reason,'oracle-parent-mismatch');
  const twoParagraphs=[unit('article','2',[],0,10,[child('paragraph','1',1,8,[child('point','2',1,8,[child('point','a',2,5),child('point','b',5,8)])],{implicit:true}),child('paragraph','2',8,10)])];
  assert.equal(check(twoParagraphs,10,'Article 2 – point 2 – point b a (new)',insert(8,b)).reason,'oracle-parent-mismatch');
});
