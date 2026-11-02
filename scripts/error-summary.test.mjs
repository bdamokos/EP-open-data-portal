import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';

test('summary counts indexing failures by category, status and language across rotated files',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'error-summary-'));
  try {
    const event={time:'2026-11-02T09:00:00Z',source:'activity-index',kind:'task-failure',category:'speech-record',taskKind:'outside-detail',status:503,language:'en'};
    await writeFile(path.join(directory,'errors.jsonl.1'),JSON.stringify(event)+'\n');
    await writeFile(path.join(directory,'errors.jsonl'),[
      {...event,time:'2026-11-02T10:00:00Z'},
      {...event,category:'speaker-list',taskKind:'outside-roster'},
      {...event,status:404},
      {...event,language:'mul'},
      {time:event.time,source:'browser',kind:'http',status:503,request:'/api/outside/directory?term=10'},
    ].map(JSON.stringify).join('\n')+'\n{"incomplete":');
    const {stdout}=await promisify(execFile)(process.execPath,['scripts/error-summary.mjs',directory]);
    const rows=JSON.parse(stdout);
    assert.equal(rows.length,5);assert.equal(rows[0].count,2);assert.equal(rows[0].category,'speech-record');
    assert.equal(rows[0].first,event.time);assert.equal(rows[0].last,'2026-11-02T10:00:00Z');
    assert.equal(rows.find(row=>row.source==='browser').request,'/api/outside/directory');
  }finally{await rm(directory,{recursive:true,force:true});}
});
