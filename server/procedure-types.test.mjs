import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyProcedure} from './insights-legislation-model.mjs';

const uri=code=>'https://data.europarl.europa.eu/def/ep-procedure-types/'+code;
test('consent, Article 225 initiatives and budget preparation retain their distinct nature',()=>{
  // Official EP taxonomy 20260131_1; exact OEIL references also expose these
  // types. A procedure classification is not evidence of an enacted act.
  const consent=classifyProcedure({process_type:uri('APP'),label:'2022/0401(APP)'});
  assert.equal(consent.status,'known');assert.equal(consent.label,'Consent procedure');
  assert.equal(consent.classification,'consent');assert.equal(consent.reference,'2022/0401(APP)');
  const initiative=classifyProcedure({process_type:uri('INL')});
  assert.equal(initiative.label,'Legislative initiative procedure');assert.equal(initiative.classification,'legislative-initiative');
  const preparation=classifyProcedure({process_type:uri('BUI'),label:'2025/2246(BUI)'});
  assert.equal(preparation.classification,'budgetary');assert.equal(preparation.label,'Budgetary initiative');
  assert.equal(classifyProcedure({process_type:uri('DEC')}).label,'Discharge procedure');
  assert.equal(classifyProcedure({process_type:uri('GBD')}).classification,'budgetary');
  assert.equal(classifyProcedure({process_type:uri('ACI')}).classification,'non-legislative');
  assert.equal(classifyProcedure({process_type:uri('NLE')}).classification,'non-legislative','international-agreement consent does not turn NLE into APP');
});
test('ordinary procedure families and explicit historical identities survive',()=>{
  for(const code of ['COD','CNS'])assert.equal(classifyProcedure({process_type:uri(code)}).classification,'legislative');
  for(const code of ['INI','RSP','NLE'])assert.equal(classifyProcedure({process_type:uri(code)}).classification,'non-legislative');
  const assent=classifyProcedure({process_type:uri('AVC'),label:'2009/0059(AVC)'});
  assert.equal(assent.code,'AVC');assert.equal(assent.label,'Assent procedure');assert.equal(assent.deprecated,true);assert.equal(assent.classification,'consent');
  const cooperation=classifyProcedure({process_type:uri('SYN')});
  assert.equal(cooperation.code,'SYN');assert.equal(cooperation.deprecated,true);assert.equal(cooperation.label,'Cooperation procedure');
  for(const code of ['COS','DCE','RPS']){const row=classifyProcedure({process_type:uri(code)});assert.equal(row.status,'known');assert.equal(row.code,code);assert.equal(row.deprecated,true);}
});
test('missing observations differ from unknown future codes and malformed declarations',()=>{
  const absent=classifyProcedure({id:'eli/dl/proc/2025-2117',process_title:{en:'Ordinary legislative procedure (COD)'}});
  assert.equal(absent.status,'missing');assert.equal(absent.code,null);assert.equal(absent.label,'Procedure type not supplied');
  const referenceOnly=classifyProcedure({label:'2026/0001(COD)',process_type:null,procedure_type:[]});
  assert.equal(referenceOnly.status,'missing');assert.equal(referenceOnly.code,null);assert.equal(referenceOnly.referenceCode,'COD');
  const future=classifyProcedure({process_type:uri('XYZ'),label:'2026/0001(XYZ)'});
  assert.equal(future.status,'unknown');assert.equal(future.code,'XYZ');assert.equal(future.classification,'unresolved');assert.equal(future.reference,'2026/0001(XYZ)');assert.equal(future.label,'Unknown procedure type');
  assert.deepEqual(future.declarations,[{field:'process_type',value:uri('XYZ'),code:'XYZ'}]);
  const malformed=classifyProcedure({process_type:{unexpected:'COD'}});
  assert.equal(malformed.status,'unknown');assert.equal(malformed.code,null);assert.notEqual(malformed.label,absent.label);
  for(const label of ['Draft 2026/0001(COD)','2026/0001(COD) extra','2026-0001','(COD)'])assert.equal(classifyProcedure({label}).status,'missing');
});
test('all declarations and a full reference suffix participate in conflict detection',()=>{
  const raw=[uri('COD'),uri('CNS')],conflict=classifyProcedure({process_type:raw,label:'2026/0001(COD)'});
  assert.equal(conflict.status,'conflicting');assert.equal(conflict.code,null);assert.equal(conflict.classification,'unresolved');assert.deepEqual(conflict.codes,['COD','CNS']);
  assert.deepEqual(conflict.declarations.map(row=>row.value),raw);assert.equal(conflict.reference,'2026/0001(COD)');assert.equal(conflict.referenceCode,'COD');
  assert.equal(classifyProcedure({process_type:uri('APP'),had_procedure_type:uri('NLE')}).status,'conflicting');
  assert.equal(classifyProcedure({process_type:uri('COD'),label:'2026/0001A(CNS)'}).status,'conflicting');
  assert.equal(classifyProcedure({process_type:[uri('COD'),{}]}).status,'conflicting');
  const repeated=classifyProcedure({process_type:[uri('COD'),uri('COD')],procedure_type:{'@id':uri('COD')},had_procedure_type:'COD',label:'2026/0001A(COD)'});
  assert.equal(repeated.status,'known');assert.equal(repeated.code,'COD');assert.equal(repeated.reference,'2026/0001A(COD)');assert.equal(repeated.declarations.length,4);
  assert.equal(classifyProcedure({process_type:uri('MR')}).status,'unknown','a consent subtype is not a top-level procedure type');
});

test('all supplied object identities must agree, including malformed aliases',()=>{
  for(const field of ['process_type','procedure_type','had_procedure_type']) {
    for(const value of [
      {id:uri('COD'),'@id':uri('RSP')},
      {id:uri('RSP'),'@id':uri('COD')},
      {id:uri('COD'),'@id':null},
      {id:null,'@id':uri('COD')},
      {id:uri('COD'),'@id':'not a type'},
      {id:'not a type','@id':uri('COD')},
    ]) {
      const result=classifyProcedure({[field]:value});
      assert.equal(result.status,'conflicting');assert.equal(result.code,null);
      assert.deepEqual(result.declarations,[{field,value,code:null}]);
    }
    for(const value of [{id:uri('COD'),'@id':'COD'},{'@id':uri('COD'),id:'COD'}]) {
      const result=classifyProcedure({[field]:value});
      assert.equal(result.status,'known');assert.equal(result.code,'COD');assert.deepEqual(result.codes,['COD']);
      assert.deepEqual(result.declarations,[{field,value,code:'COD'}]);
    }
  }
});
