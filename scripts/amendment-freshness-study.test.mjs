import test from 'node:test';
import assert from 'node:assert/strict';
import {studyFreshness} from './amendment-freshness-study.mjs';
const target='eli/dl/doc/A-10-2025-0001',id=target+'-AM-001-001';
function observation(at,size,issued,{date='2025-01-01',language='ENG'}={}) {
  return {url:'https://data.europarl.europa.eu/api/v2/plenary-documents/A-10-2025-0001',fetchedAt:at,payload:{data:[{id:target,identifier:'A-10-2025-0001',inverse_based_on_a_realization_of:['eli/dl/event/MTG-PL-2025-01-03-VOT-ITM-1'],inverse_foresees_change_of:[{id,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:target,document_date:date,is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/'+language,is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/test/list.docx',byteSize:size,issued}]}]}]}]}};
}
test('study retains published lags, recognizes exact descriptor corrections and counts each list once',()=>{
  const before=observation('2025-01-04T00:00:00Z',100,'2025-01-02T00:00:00Z');
  const after=observation('2025-01-10T00:00:00Z',101,'2025-01-09T00:00:00Z');
  const result=studyFreshness([after,before],{now:Date.parse('2025-04-01'),graceDays:60});
  assert.equal(result.listCount,1);assert.equal(result.languageIssueLagDays.p99,8);
  assert.equal(result.issueAfterLatestDecisionDays.max,6);
  assert.equal(result.corrections.status,'observed');assert.equal(result.corrections.observations[0].daysAfterDocument,9);
  assert.equal(result.weeklyPrimaryDownloads.avoidedNow,1);
});
test('study cannot turn absent history, missing dates, an empty distribution or an unverified relationship into zero lag',()=>{
  const record=observation('2025-01-10T00:00:00Z',100,undefined,{date:null});
  const result=studyFreshness([record],{now:Date.parse('2025-04-01')});
  assert.equal(result.languageIssueLagDays.p99,null);assert.equal(result.missing.documentDate,1);
  assert.equal(result.weeklyPrimaryDownloads.avoidedNow,0);assert.equal(result.weeklyPrimaryDownloads.unknownDate,1);
  assert.equal(result.corrections.status,'unavailable-without-repeated-descriptor-observations');
  const list=record.payload.data[0].inverse_foresees_change_of[0];list.is_realized_by=[];
  assert.equal(studyFreshness([record]).weeklyPrimaryDownloads.baseline,0);
  list.foresees_change_of='eli/dl/doc/A-10-2025-0002';assert.equal(studyFreshness([record]).listCount,0);
});
