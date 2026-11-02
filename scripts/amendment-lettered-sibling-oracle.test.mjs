import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
import {parseProposal} from '../server/proposal-structure.mjs';

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
  // A repeated base label is ambiguous even when the next sibling looks right.
  const repeated=[unit('article','1',[],0,9,[child('paragraph','1',1,9,[child('point','25',1,9,[child('point','a',1,3),child('point','b',3,5,[],{pathConflict:true,complete:false}),child('point','c',5,7),child('point','b',7,9,[],{pathConflict:true,complete:false,id:'p/dup-b'})])])])];
  assert.equal(check(repeated,9,'Article 1 – paragraph 1 – point 25 – point b a (new)',insert(5,id('point:25','point:b'))).status,'unverified');
});

test('an address may omit only an article\'s sole implicit paragraph 1', () => {
  const tree=implicit=>[unit('article','2',[],0,8,[child('paragraph','1',1,8,[child('point','2',1,8,[child('point','a',2,5),child('point','b',5,8)])],{implicit})])];
  const b='p/article:2/paragraph:1/point:2/point:b';
  assert.equal(check(tree(true),8,'Article 2 – point 2 – point b a (new)',insert(8,b)).status,'verified');
  assert.equal(check(tree(false),8,'Article 2 – point 2 – point b a (new)',insert(8,b)).reason,'oracle-parent-mismatch');
  const twoParagraphs=[unit('article','2',[],0,10,[child('paragraph','1',1,8,[child('point','2',1,8,[child('point','a',2,5),child('point','b',5,8)])],{implicit:true}),child('paragraph','2',8,10)])];
  assert.equal(check(twoParagraphs,10,'Article 2 – point 2 – point b a (new)',insert(8,b)).reason,'oracle-parent-mismatch');
});

test('a numeric family reached through the omitted paragraph rejects repeated labels', () => {
  const paragraphs=['Article 2','Lead:','(1) First;','(2) Second;','(3) Third;','(2) Repeated.','Article 3'],styles=['Titrearticle','Normal','Point0','Point0','Point0','Point0','Titrearticle'];
  const p=parseProposal({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map((_,i)=>({styleId:styles[i],numberingComplete:true,notesComplete:true}))});
  const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children||[])]);
  const twos=flat(p.units).filter(unit=>unit.kind==='point'&&unit.label?.value==='2');
  assert.equal(twos.length,2);
  const placement=insert(twos[0].extent.end,twos[0].id);
  assert.notEqual(verifyPlacement({placement,wording:wording('Article 2 – point 2 a (new)'),items:[{proposal:p}]}).status,'verified');
});

test('Roman ordinals never stand in for a different spelling', () => {
  const paragraphs=['Article 2','Lead:','(i) One;','(ii) Two;','(iiii) Four;','(v) Five.','Article 3'],styles=['Titrearticle','Normal','Point0','Point0','Point0','Point0','Titrearticle'];
  const p=parseProposal({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map((_,i)=>({styleId:styles[i],numberingComplete:true,notesComplete:true}))});
  const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children||[])]);
  const odd=flat(p.units).find(unit=>unit.kind==='point'&&unit.label?.value==='iiii');
  assert(odd);
  assert.notEqual(verifyPlacement({placement:insert(odd.extent.end,odd.id),wording:wording('Article 2 – point iv a (new)'),items:[{proposal:p}]}).status,'verified');
});


test('Roman families require canonical spellings away from the selected anchor', () => {
  for(const fourth of ['iv','iiii']) {
    const paragraphs=['Article 2','Lead:','(i) One;','(ii) Two;','(iii) Three;',`(${fourth}) Four;`,'(v) Five.','Article 3'];
    const styles=['Titrearticle','Normal','Point0','Point0','Point0','Point0','Point0','Titrearticle'];
    const p=parseProposal({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map((_,i)=>({styleId:styles[i],numberingComplete:true,notesComplete:true}))});
    const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children||[])]);
    const first=flat(p.units).find(unit=>unit.kind==='point'&&unit.label?.value==='i');assert(first);
    assert.equal(verifyPlacement({placement:insert(first.extent.end,first.id),wording:wording('Article 2 – point i a (new)'),items:[{proposal:p}]}).status,fourth==='iv'?'verified':'unverified');
  }
});
