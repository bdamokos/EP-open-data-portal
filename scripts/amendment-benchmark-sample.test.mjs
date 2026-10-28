import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {digest} from './amendment-benchmark-cache.mjs';
import {decisionsInSample,excludedSnapshot,sampleExclusions} from './amendment-benchmark-sample.mjs';
import {options} from './amendment-benchmark.mjs';

const decision=date=>({id:'decision-'+date,date,sittingId:'MTG-PL-'+date});
test('explicit decision weeks are canonical Mondays and cannot silently mix selectors',()=>{
  assert.deepEqual(options(['--decision-week','2025-03-10','--decision-week','2024-10-21','--decision-week','2025-03-10']).decisionWeeks,['2024-10-21','2025-03-10']);
  for(const value of ['2025-03-11','2025-02-31','yesterday'])assert.throws(()=>options(['--decision-week',value]),/Monday/);
  for(const extra of [['--weeks','8'],['--from','2025-03-01','--to','2025-03-31'],['--document','A-10-2025-0001']])assert.throws(()=>options(['--decision-week','2025-03-10',...extra]),/Choose/);
  const sample={mode:'plenary-weeks',weeks:['2024-10-21','2025-03-10'],asOf:'2025-03-13'};
  const row={id:'exact',decisions:['2024-10-24','2025-03-06','2025-03-13','2025-03-14'].map(decision)};
  assert.deepEqual(decisionsInSample(row,sample).map(d=>d.date),['2024-10-24','2025-03-13']);
});

test('exclusion uses all frozen sample IDs, across decisions and variants, independent of outcomes',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'benchmark-exclusion-'));
  try {
    await mkdir(path.join(directory,'inputs'));
    const apiBase='https://public.example',url=apiBase+'/api/amendments?offset=0&limit=50&lang=en';
    const rows=[
      {id:'A-10-2025-0001-AM-1',variants:[{language:'fr'},{language:'en'}],decisions:[decision('2025-03-13'),decision('2025-05-08')]},
      {id:'A-10-2025-0001-AM-10',decisions:[decision('2025-05-08')]},
      {id:'A-10-2025-0001-AM-2',decisions:[decision('2025-03-12')]},
    ];
    const body=JSON.stringify({items:rows}),meta={url,ok:true,bytes:Buffer.byteLength(body),sha256:digest(body)};
    const sample={mode:'date-window',from:'2025-03-10',to:'2025-03-14',asOf:'2025-10-27'},manifest=[meta];
    const snapshotId=digest(JSON.stringify({apiBase,sample,manifest}));
    const filename=path.join(directory,'snapshot.json'),bodyPath=path.join(directory,'inputs',digest(url)+'.body');
    await writeFile(filename,JSON.stringify({apiBase,sample,manifest,snapshotId}));await writeFile(bodyPath,body);
    const excluded=await excludedSnapshot(filename);
    assert.deepEqual(excluded,{snapshotId,amendmentIds:[rows[0].id,rows[2].id]});
    const exclusions=await sampleExclusions([filename,filename]);
    assert.deepEqual(exclusions,{snapshotIds:[snapshotId],amendmentIds:excluded.amendmentIds});
    const holdout={mode:'plenary-weeks',weeks:['2025-05-05'],asOf:'2025-10-27',exclusions};
    assert.equal(decisionsInSample(rows[0],holdout).length,0);
    assert.equal(decisionsInSample(rows[1],holdout).length,1); // Exact ID, not a prefix.
    await writeFile(bodyPath,body.replace('AM-1','AM-9'));
    await assert.rejects(excludedSnapshot(filename),/Invalid exclusion catalogue input/);
    await writeFile(bodyPath,body);await writeFile(filename,JSON.stringify({apiBase,sample:{...sample,to:'2025-06-01'},manifest,snapshotId}));
    await assert.rejects(excludedSnapshot(filename),/Invalid exclusion snapshot manifest/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
