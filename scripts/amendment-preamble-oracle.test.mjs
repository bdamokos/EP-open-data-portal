import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPlacement} from './amendment-benchmark-model.mjs';

const proposal=rows=>({sourceKind:'docx',units:[],paragraphs:rows.map((text,index)=>({index,text,source:{container:'body',complete:true},complete:true}))});
const rows=['THE EUROPEAN PARLIAMENT AND THE COUNCIL OF THE EUROPEAN UNION,','Having regard to the Treaty,','Having regard to the proposal from the European Commission,','Acting in accordance with the ordinary legislative procedure,','Whereas:','(1) A recital.','HAVE ADOPTED THIS REGULATION:','Article 1','1. Text.'];
const wording=(targetLabel,originalText,proposedText)=>({targetLabel,originalText,proposedText,language:'en',baseline:'commission-proposal'});
const insert=before=>({status:'placed',operation:'insert',itemIndex:0,insertAfter:before-1,insertBefore:before});
const replace=row=>({status:'placed',operation:'replace',itemIndex:0,span:{start:row,end:row},splice:{start:{paragraph:row,offset:0},end:{paragraph:row,offset:rows[row].length}}});
const check=(w,placement,p=proposal(rows))=>verifyPlacement({placement,wording:w,items:[{proposal:p}]});

test('preamble citations are counted from the enacting line to Whereas', () => {
  assert.deepEqual(check(wording('Citation 2 a (new)','','Having regard to the opinion of the Court of Auditors,'),insert(3)),{status:'verified',reason:'oracle-preamble-citation-boundary'});
  assert.equal(check(wording('Citation 2 a (new)','','Having regard to the opinion,'),insert(2)).status,'failed');
  assert.deepEqual(check(wording('Citation 2','Having regard to the proposal from the European Commission,','Changed,'),replace(2)),{status:'verified',reason:'oracle-preamble-citation-span'});
  assert.equal(check(wording('Citation 2','Having regard to the proposal from the European Commission,','Changed,'),replace(1)).status,'failed');
  assert.notEqual(check(wording('Citation 2 a (new)','','The European Parliament rejects the Commission proposal.'),insert(3)).status,'verified');
  const broken=proposal(rows);broken.paragraphs[2].source.complete=false;
  assert.equal(check(wording('Citation 2 a (new)','','New citation,'),insert(3),broken).status,'unverified');
});

test('Article -1 goes immediately before Article 1 after the enacting formula', () => {
  assert.deepEqual(check(wording('Article -1','','Article -1\nNew article.'),insert(7)),{status:'verified',reason:'oracle-negative-article-boundary'});
  assert.equal(check(wording('Article -1','','Article -1\nNew article.'),insert(8)).status,'failed');
  const gap=proposal(['HAVE ADOPTED THIS REGULATION:','Recital-like note.','Article 1','1. Text.']);
  assert.equal(check(wording('Article -1','','Article -1\nNew article.'),insert(2),gap).status,'unverified');
});

test('a citation continued on a second row withholds ordinal verification', () => {
  const split=proposal(['THE EUROPEAN PARLIAMENT AND THE COUNCIL OF THE EUROPEAN UNION,','Having regard to the Treaty on the Functioning of the European Union,','and in particular Article 192(1) thereof,','Having regard to the proposal from the European Commission,','Whereas:']);
  assert.notEqual(check(wording('Citation 1 a (new)','','Having regard to the opinion,'),insert(2),split).status,'verified');
});

test('a citation replacement must splice exactly the original wording', () => {
  const w=wording('Citation 2','Having regard to the proposal from the European Commission,','Changed,');
  const at=(paragraph,start,end)=>({status:'placed',operation:'replace',itemIndex:0,span:{start:2,end:2},splice:{start:{paragraph,offset:start},end:{paragraph,offset:end}}});
  assert.equal(check(w,at(1,0,rows[1].length)).status,'failed','a splice on another citation');
  assert.equal(check(w,at(2,0,6)).status,'failed','a partial splice');
  assert.equal(check(w,at(2,0,rows[2].length)).status,'verified');
});

test('a citation comparison must prove the complete note payload and its exact anchor',()=>{
 const p=proposal(rows),text=rows[2],at=text.length-1;
 p.anchors=[{paragraph:2,offset:at,note:'8',label:'2'}];p.notes=[{id:'8',text:'OJ C , , p. .',complete:true}];
 const original=text.slice(0,at)+'2 '+text.slice(at)+'\n_________________\n2 OJ C , , p. .',w={...wording('Citation 2',original,'After consulting the Commission,'),originalFormatting:[{kind:'superscript',start:at,end:at+1}]};
 assert.equal(check(w,replace(2),p).status,'verified');
 for(const change of [a=>a.notes[0].text='Different source.',a=>a.anchors[0].offset--,a=>a.notes[0].complete=false]){const a=structuredClone(p);change(a);assert.notEqual(check(w,replace(2),a).status,'verified');}
 assert.notEqual(check(w,replace(1),p).status,'verified');
});
