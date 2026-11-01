import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {snapshotHttpObservation} from './sitting-snapshot-source.mjs';

test('background snapshots retain the foreground reader 404 body hash and retrieval evidence',async()=>{
  const url='https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-10-07/decisions',body='{"error":"not found"}',now=12345;
  await assert.rejects(snapshotHttpObservation(new Response(body,{status:404}),url,{clock:()=>now}),error=>{
    assert.equal(error.code,'odp_unavailable');assert.equal(error.upstreamStatus,404);assert.equal(error.responseBytes,Buffer.byteLength(body));
    assert.deepEqual(error.source,{url,fetchedAt:now,contentHash:createHash('sha256').update(body).digest('hex'),httpStatus:404});return true;
  });
});
test('204 remains unavailable for a first source page rather than an invented empty observation',async()=>{
  await assert.rejects(snapshotHttpObservation(new Response(null,{status:204}),'https://example.test'),error=>error.code==='odp_no_content');
  assert.equal(await snapshotHttpObservation(Response.json({data:[]}),'https://example.test'),undefined);
});
