import test from 'node:test';
import assert from 'node:assert/strict';
import {amendmentListSettled,amendmentGraceDays,amendmentMetadataCheckDays,AMENDMENT_SETTLE_GRACE_DAYS} from './amendment-refresh-policy.mjs';
const DAY=86400000,list={document_date:'2026-01-01'};
test('grace includes its exact boundary, extends through linked sittings, and retains unknown dates',()=>{
  const boundary=Date.parse(list.document_date)+AMENDMENT_SETTLE_GRACE_DAYS*DAY;
  for(const now of [boundary-1,boundary])assert.equal(amendmentListSettled(list,{now}),false);
  assert.equal(amendmentListSettled(list,{now:boundary+1}),true);
  assert.equal(amendmentListSettled(list,{now:boundary+1,sittingIds:['MTG-PL-2026-01-02']}),false);
  assert.equal(amendmentListSettled(list,{now:boundary+DAY+1,sittingIds:['MTG-PL-2026-01-02']}),true);
  for(const date of [null,'2026-02-30','unknown'])assert.equal(amendmentListSettled({document_date:date},{now:boundary+100*DAY}),false);
  assert.equal(amendmentListSettled(list,{now:Date.parse('2026-01-03'),graceDays:1}),true);
});
test('grace configuration is validated',t=>{
  const previous=process.env.AMENDMENT_SETTLE_GRACE_DAYS;
  t.after(()=>{if(previous===undefined)delete process.env.AMENDMENT_SETTLE_GRACE_DAYS;else process.env.AMENDMENT_SETTLE_GRACE_DAYS=previous;});
  process.env.AMENDMENT_SETTLE_GRACE_DAYS='90';assert.equal(amendmentGraceDays(),90);
  process.env.AMENDMENT_SETTLE_GRACE_DAYS='0';assert.throws(amendmentGraceDays,/between 1 and 3650/);
});

test('settled metadata interval is configurable and validated',t=>{
  const previous=process.env.AMENDMENT_SETTLED_METADATA_DAYS;
  t.after(()=>{if(previous===undefined)delete process.env.AMENDMENT_SETTLED_METADATA_DAYS;else process.env.AMENDMENT_SETTLED_METADATA_DAYS=previous;});
  delete process.env.AMENDMENT_SETTLED_METADATA_DAYS;assert.equal(amendmentMetadataCheckDays(),90);
  process.env.AMENDMENT_SETTLED_METADATA_DAYS='120';assert.equal(amendmentMetadataCheckDays(),120);
  process.env.AMENDMENT_SETTLED_METADATA_DAYS='0';assert.throws(amendmentMetadataCheckDays,/between 1 and 3650/);
});
