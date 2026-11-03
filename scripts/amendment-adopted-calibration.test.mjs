import test from 'node:test';
import assert from 'node:assert/strict';
import {readCalibrationXml,calibrationPath,compareFinalPath,compareConsolidated,AdoptedCalibration} from './amendment-adopted-calibration.mjs';
const xml='<SDOCTA><IDENT>P10_TA(2026)0001</IDENT><AMDLST><AMEND><TI.AMD>Amendments 7, 19 and 22</TI.AMD><STI.AMD>Article 1 – paragraph 2</STI.AMD><OLD/><NEW/></AMEND></AMDLST></SDOCTA>';
test('native AM identity preserves collective numbers and full heading',()=>{
 const ta=readCalibrationXml(Buffer.from(xml),'TA-10-2026-0001');assert.deepEqual(ta.amendments[0].numbers,[7,19,22]);assert.equal(ta.amendments[0].headings[0],'Article 1 – paragraph 2');
 assert.throws(()=>readCalibrationXml(Buffer.from(xml),'TA-10-2026-0002'),/identity/);
 assert.throws(()=>readCalibrationXml(Buffer.from('<!DOCTYPE a>'+xml),'TA-10-2026-0001'));
});
test('independent grammar retains full nested path and rejects unsupported residue',()=>{
 assert.equal(calibrationPath('Article 1 – paragraph 1 – point 20').length,3);assert.equal(calibrationPath('Annex III – table'),null);
 assert.equal(calibrationPath('Recital -1 (new)')[0].value,'-1');
});
const items=[{proposal:{units:[{scope:'proposal',path:[{kind:'recital',value:'14'}],extent:{start:5,end:7}}]}}];
test('final relabelled suffix maps to source gap, actual wrong coordinates disagree',()=>{
 const input={headings:['Proposal for a regulation','Recital 14 b (new)'],placement:{status:'placed',operation:'insert',insertAfter:6,insertBefore:7},items,language:'en'};
 assert.equal(compareFinalPath(input).status,'agree');assert.equal(compareFinalPath({...input,placement:{...input.placement,insertAfter:8}}).status,'disagree');
 assert.equal(compareFinalPath({...input,headings:[...input.headings,'Article 30 – paragraph 6']}).status,'inconclusive');
 assert.equal(compareFinalPath({...input,language:'pl'}).status,'inconclusive');
});
test('consolidated match requires both immediate unchanged neighbours',()=>{
 const texts=['Long original predecessor paragraph with enough distinctive words.','New adopted paragraph with enough distinctive words to match exactly.','Long original following paragraph with enough distinctive words.'];
 const input={ta:{units:texts.map((text,ordinal)=>({text,kind:'ACTION',ordinal}))},wording:{proposedText:texts[1]},language:'en',placement:{status:'placed',operation:'insert',insertAfter:0,insertBefore:1},text:{paragraphs:[texts[0],texts[2]]}};
 assert.equal(compareConsolidated(input).status,'agree');assert.equal(compareConsolidated({...input,text:{paragraphs:['Amended neighbour',texts[2]]}}).status,'inconclusive');
 assert.equal(compareConsolidated({...input,ta:{...input.ta,negotiated:true}}).status,'inconclusive');
});
test('binding requires exact adopted document and date; absent AM stays inconclusive',()=>{
 const sealed={snapshot:{snapshotId:'test'},works:[{id:'eli/dl/doc/TA-10-2026-0001',document_date:'2026-03-01',adopts:['eli/dl/doc/A-10-2026-0001']}],bodies:new Map([['TA-10-2026-0001_en.xml',Buffer.from(xml)]])};
 const calibration=new AdoptedCalibration(sealed),row={id:'A-10-2026-0001-AM-9',targetDocumentId:'A-10-2026-0001',number:9,decisions:[{outcome:'ADOPTED',date:'2026-03-01',amendmentIds:['A-10-2026-0001-AM-9']}]};
 calibration.observe({row,placement:{status:'placed'},items:[{proposal:{sourceHash:'native-byte-hash'}}]});assert.equal(calibration.report().rows[0].reason,'am-not-in-ta');assert.equal(calibration.report().rows[0].coordinateSpace,'sha256:native-byte-hash');
 calibration.observe({row:{...row,targetDocumentId:'A-10-2026-0002'}});assert.equal(calibration.report().rows[1].reason,'ta-binding-unavailable');
});
test('order inversions are surfaced; equal gaps never invent within-gap order',()=>{
 const c=new AdoptedCalibration({snapshot:{snapshotId:'test'}});
 c.rows=[0,1].map(n=>({id:String(n),documentId:'d',taId:'t',ordinal:n,coordinate:5-n,placed:true,itemIndex:0,mode:'amendment-list',status:'agree',coordinateSpace:'sha256:same'}));
 assert.equal(c.report().placedDisagreements.length,2);c.rows.forEach(r=>r.coordinate=5);assert.equal(c.report().rows[0].order.reason,'same-gap-order-not-exposed');
});
// Native STI.AMD excerpts: TA-10-2026-0276 EN, AM77–80, public declared
// https://data.europarl.europa.eu/distribution/doc/TA-10-2026-0276_en.xml
// Retrieved 2026-11-03; wording retained in the sealed external TA snapshot.
test('unparsed native amended-act headings cannot collapse to the outer instruction',()=>{
 const unit={scope:'proposal',path:[{kind:'article',value:'1'},{kind:'paragraph',value:'1'},{kind:'point',value:'20'}],extent:{start:5,end:10}};
 for(const suffix of ['a','b','c','d'])for(const span of [{start:5,end:9},{start:7,end:8}]) {
  const headings=['Proposal for a regulation','Article 1 – paragraph 1 – point 20','Regulation (EU) 2023/956',`Article 30 – paragraph 6 – subparagraph 2 – point b – point ii ${suffix} (new)`];
  assert.equal(compareFinalPath({headings,placement:{status:'placed',operation:'replace',span},items:[{proposal:{units:[unit]}}],language:'en'}).reason,'amended-act-path-requires-mapping');
 }
});
test('a printed resolution number alone cannot truncate a multiline unit',()=>{
 const source={paragraphs:['The European Parliament,','7. Allocates resources as follows:','(a) first allocation;','(b) second allocation;','and the remaining funds.','8. Next paragraph.']};
 for(const span of [{start:1,end:4},{start:1,end:1}])assert.equal(compareFinalPath({headings:['Paragraph 7'],placement:{status:'placed',operation:'replace',span},text:source,language:'en'}).reason,'resolution-unit-extent-unavailable');
});

test('order never compares different source bytes or unmapped structural paths',()=>{
 const c=new AdoptedCalibration({snapshot:{snapshotId:'test'}});
 const rows=[0,1].map(n=>({id:String(n),documentId:'d',taId:'t',ordinal:n,coordinate:5-n,placed:true,itemIndex:0,mode:'amendment-list',status:'agree',coordinateSpace:'sha256:'+n}));
 c.rows=rows;assert.equal(c.report().placedDisagreements.length,0);assert.equal(rows[0].order.reason,'no-comparable-peer');
 rows[1].coordinateSpace=rows[0].coordinateSpace;rows[1].status='inconclusive';assert.equal(c.report().placedDisagreements.length,0);
 rows[1].status='agree';assert.equal(c.report().placedDisagreements.length,2);
 rows[1].status='inconclusive';assert.equal(c.report().placedDisagreements.length,0,'a recomputed report clears previous order verdicts');
});
