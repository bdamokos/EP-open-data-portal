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
 calibration.observe({row,placement:{status:'placed'}});assert.equal(calibration.report().rows[0].reason,'am-not-in-ta');
 calibration.observe({row:{...row,targetDocumentId:'A-10-2026-0002'}});assert.equal(calibration.report().rows[1].reason,'ta-binding-unavailable');
});
test('order inversions are surfaced; equal gaps never invent within-gap order',()=>{
 const c=new AdoptedCalibration({snapshot:{snapshotId:'test'}});
 c.rows=[0,1].map(n=>({id:String(n),documentId:'d',taId:'t',ordinal:n,coordinate:5-n,placed:true,itemIndex:0,mode:'amendment-list',status:'agree'}));
 assert.equal(c.report().placedDisagreements.length,2);c.rows.forEach(r=>r.coordinate=5);assert.equal(c.report().rows[0].order.reason,'same-gap-order-not-exposed');
});
