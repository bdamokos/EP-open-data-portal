import test from 'node:test';import assert from 'node:assert/strict';
import {reportCouncilDraftReference} from './council-draft-reference.mjs';
const reportId='A-10-2026-0123';
const report={id:'eli/dl/doc/'+reportId,work_type:'def/ep-document-types/REPORT_PLENARY',inverse_created_a_realization_of:['eli/dl/proc/2023-0123'],is_realized_by:[{title_alternative:{en:'(01234/2026 – C10-0012/2026 – 2023/0123(CNS))'}}]};
test('draft URL derives from the exact report record, CNS procedure and native ST reference',()=>{
 const value=reportCouncilDraftReference(report,{reportId,language:'cs'});assert.equal(value.status,'resolved');assert.equal(value.url,'https://data.consilium.europa.eu/doc/document/ST-1234-2026-INIT/cs/pdf');
 assert.equal(reportCouncilDraftReference({...report,id:'eli/dl/doc/A-10-2026-0999'},{reportId}).status,'unresolved');
 assert.equal(reportCouncilDraftReference({...report,work_type:'REPORT_PLENARY'},{reportId}).status,'unresolved');
 assert.equal(reportCouncilDraftReference({...report,inverse_created_a_realization_of:['eli/dl/proc/2023-9999']},{reportId}).status,'unresolved');
 assert.equal(reportCouncilDraftReference({...report,is_realized_by:[]},{reportId}).status,'unresolved');
 assert.equal(reportCouncilDraftReference({...report,is_realized_by:[...report.is_realized_by,{title_alternative:{fr:'(12345/2026 – C10-0012/2026 – 2023/0123(CNS))'}}]},{reportId}).status,'unresolved');
 assert.equal(reportCouncilDraftReference(report,{reportId,language:'en/../../x'}).status,'unresolved');
});
