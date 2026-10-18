import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {booleanFromEnvironment,integerFromEnvironment,absolutePathFromEnvironment} from './config.mjs';
import {activityIndex,startActivityIndex} from './activity-index-worker.mjs';
import {corpus,startCorpus} from './corpus-worker.mjs';
import {activityDocument} from './activities.mjs';
import {speechMedia} from './mmc.mjs';
import {retainedSpeechMetadata} from './corpus-speeches.mjs';
import {speechTranscript} from './speech-transcript.mjs';

function environment(t,names) {
  const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  t.after(()=>{for(const [name,value] of Object.entries(saved))value===undefined?delete process.env[name]:process.env[name]=value;});
  for(const name of names)delete process.env[name];
}

test('environment parsers read each call and reject invalid booleans, integer bounds and paths',t=>{
  const name='EXPLORER_TEST_SETTING';environment(t,[name]);
  for(const value of [undefined,'']) {
    if(value===undefined)delete process.env[name];else process.env[name]=value;
    assert.equal(booleanFromEnvironment(name),false);assert.equal(booleanFromEnvironment(name,true),true);
    assert.equal(integerFromEnvironment(name,5,1,10),5);
    assert.equal(absolutePathFromEnvironment(name),undefined);
    assert.equal(absolutePathFromEnvironment(name,'./var'),path.resolve('var'));
  }
  for(const value of ['1','true','YES','On']){process.env[name]=value;assert.equal(booleanFromEnvironment(name),true);}
  for(const value of ['0','false','NO','Off']){process.env[name]=value;assert.equal(booleanFromEnvironment(name,true),false);}
  for(const value of ['tru','2',' ','enabled']){process.env[name]=value;assert.throws(()=>booleanFromEnvironment(name),/EXPLORER_TEST_SETTING must be a boolean/);}
  for(const value of ['1','10']){process.env[name]=value;assert.equal(integerFromEnvironment(name,5,1,10),Number(value));}
  for(const value of ['0','11','1.5','NaN','bad']){process.env[name]=value;assert.throws(()=>integerFromEnvironment(name,5,1,10),/EXPLORER_TEST_SETTING must be an integer between 1 and 10/);}
  process.env[name]='./var/corpus';assert.equal(absolutePathFromEnvironment(name),path.resolve('var/corpus'));
});

test('worker flags and readers share boolean parsing after import without retrieving sources',async t=>{
  environment(t,['ACTIVITY_INDEX_ENABLED','ACTIVITY_INDEX_DIR','CORPUS_ENABLED','CORPUS_DIR']);
  const id='MTG-PL-2026-10-07-OTH-1';
  for(const value of ['1','true','YES','on']) {
    process.env.ACTIVITY_INDEX_ENABLED=value;process.env.CORPUS_ENABLED=value;
    for(const read of [activityIndex,startActivityIndex])assert.throws(read,error=>error.code==='activity_index_configuration');
    for(const read of [corpus,startCorpus])assert.throws(read,error=>error.code==='corpus_configuration');
    await assert.rejects(activityDocument('E-10-2026-000001','42','en'),error=>error.code==='activity_index_configuration');
    await assert.rejects(speechMedia(id,'en'),error=>error.code==='activity_index_configuration');
  }
  process.env.ACTIVITY_INDEX_ENABLED='off';process.env.CORPUS_ENABLED='0';
  assert.throws(activityIndex,error=>error.code==='activity_index_disabled');assert.throws(corpus,error=>error.code==='corpus_disabled');
  assert.equal(typeof startActivityIndex(),'function');assert.equal(typeof startCorpus(),'function');
  assert.equal(await retainedSpeechMetadata(id),null);assert.deepEqual(await speechTranscript(id,'en'),{id,available:false});
  process.env.ACTIVITY_INDEX_ENABLED='invalid';process.env.CORPUS_ENABLED='invalid';
  for(const read of [activityIndex,startActivityIndex])assert.throws(read,/ACTIVITY_INDEX_ENABLED must be a boolean/);
  for(const read of [corpus,startCorpus])assert.throws(read,/CORPUS_ENABLED must be a boolean/);
  await assert.rejects(activityDocument('E-10-2026-000001','42','en'),/ACTIVITY_INDEX_ENABLED must be a boolean/);
  await assert.rejects(speechMedia(id,'en'),/ACTIVITY_INDEX_ENABLED must be a boolean/);
  await assert.rejects(retainedSpeechMetadata(id),/CORPUS_ENABLED must be a boolean/);
  await assert.rejects(speechTranscript(id,'en'),/CORPUS_ENABLED must be a boolean/);
});
