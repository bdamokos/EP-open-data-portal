import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CorpusStore} from './corpus-store.mjs';
import {reuseSpeechRole} from './speaker-role-reuse.mjs';

const bg='Член на Комисията',en='Member of the Commission';
const role=(text,language)=>({text,language});
function metadata({day='2026-10-19',number=1,id='220921',labels={bg:role(bg,'bg')},start='10:00:00',term=10,groups=[]}={}) {
  const speechId=`MTG-PL-${day}-OTH-${number}`;
  return {activity:{activity_id:speechId,activity_date:day,had_participation:[{had_participant_person:['person/'+id]}],recorded_in_a_realization_of:[{identifier:`CRE-${term}-${day}-OTH-${number}`}]},
    summary:{id:speechId,date:day,start:start?day+'T'+start+'Z':null,intervention:{type:'speech',onBehalfOf:groups.map(uri=>({uri}))}},
    speakers:[{id,name:'Same public name',role:bg,roleLanguage:'bg',roleLabels:labels}],sourceUrl:'https://data.europarl.europa.eu/api/v2/speeches/'+speechId,fetchedAt:'2026-10-22T12:00:00Z'};
}
const earlier=options=>metadata({day:'2026-10-07',labels:{bg:role(bg,'bg'),en:role(en,'en')},...options});

test('matching bilingual evidence reuses the exact ID label with both sources and comparison provenance',()=>{
  const current=metadata(),previous=earlier(),before=structuredClone({current,previous});
  const result=reuseSpeechRole(current,current.speakers[0],previous);
  assert.equal(result.text,en);assert.equal(result.language,'en');
  assert.deepEqual(result.reuse,{personId:'220921',currentSpeechId:current.summary.id,currentDate:current.summary.date,currentSource:{url:current.sourceUrl,fetchedAt:current.fetchedAt},speechId:previous.summary.id,date:previous.summary.date,source:{url:previous.sourceUrl,fetchedAt:previous.fetchedAt},compared:[{language:'bg',current:bg,previous:bg}]});
  assert.deepEqual({current,previous},before);
});
for(const [name,change] of [
  ['changed Bulgarian role',p=>p.speakers[0].roleLabels.bg.text='Председател на Комисията'],
  ['no comparable language',p=>{delete p.speakers[0].roleLabels.bg;delete p.speakers[0].role;delete p.speakers[0].roleLanguage;}],
  ['different person despite same name',p=>{p.speakers[0].id='999';p.activity.had_participation[0].had_participant_person=['person/999'];}],
  ['different participant ID',p=>p.activity.had_participation[0].had_participant_person=['person/999']],
  ['future record',p=>{p.summary.date='2026-10-20';}],
  ['changed term',p=>p.activity.recorded_in_a_realization_of[0].identifier='CRE-9-2026-10-07-OTH-1'],
  ['changed capacity',p=>p.summary.intervention.type='blue-card-question'],
  ['changed represented group',p=>p.summary.intervention.onBehalfOf=[{uri:'org/PPE'}]],
  ['chair evidence',p=>p.speakers[0].sittingRole='chair'],
  ['missing provenance',p=>delete p.fetchedAt],
  ['reused English label',p=>p.speakers[0].roleLabels.en.reuse={}],
  ['unknown comparison language',p=>p.speakers[0].roleLabels.bg.language=''],
])test('reuse rejects '+name,()=>{
  const current=metadata(),previous=earlier();change(previous);
  assert.equal(reuseSpeechRole(current,current.speakers[0],previous),null);
});
test('any contradictory shared label withholds reuse even with a matching Bulgarian pair',()=>{
  const current=metadata({labels:{bg:role(bg,'bg'),fr:role('Présidente','fr')}}),previous=earlier();
  previous.speakers[0].roleLabels.fr=role('Membre','fr');
  assert.equal(reuseSpeechRole(current,current.speakers[0],previous),null);
});
test('current-language labels win and same-day chronology requires an earlier timestamp',()=>{
  const current=metadata({labels:{bg:role(bg,'bg'),en:role('Current English','en')}});
  assert.equal(reuseSpeechRole(current,current.speakers[0],earlier()),null);
  const missing=metadata({number:2});
  for(const start of [null,'10:00:00','11:00:00'])assert.equal(reuseSpeechRole(missing,missing.speakers[0],earlier({day:'2026-10-19',start})),null);
  assert.equal(reuseSpeechRole(missing,missing.speakers[0],earlier({day:'2026-10-19',start:'09:00:00'})).text,en);
});
function put(store,{day,number,start='10:00:00',id='220921',labels,term=10}) {
  const m=metadata({day,number,start,id,term}),activity={...m.activity,had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',activity_start_date:m.summary.start,
    recorded_in_a_realization_of:[{identifier:`CRE-${term}-${day}-OTH-${number}`,'api:xmlFragment':Object.fromEntries(Object.entries({...labels,...(!Object.hasOwn(labels,'en')?{en:null}:{})}).map(([lang,text])=>[lang,`<oralStatements><speech xml:lang="${lang}"><from xml:lang="${lang}"><person refersTo="person/${id}">Same public name</person>${text===null?'':`<role>${text}</role>`}</from><p>Public text.</p></speech></oralStatements>`]))}]};
  store.putSpeechMetadata(activity,m.sourceUrl,m.fetchedAt);return activity.activity_id;
}
function corpus(t) {
  const dir=mkdtempSync(path.join(os.tmpdir(),'speaker-role-reuse-')),store=new CorpusStore(dir);store.acquire();
  t.after(()=>{store.release();store.close();rmSync(dir,{recursive:true,force:true});});
  t.mock.method(globalThis,'fetch',()=>assert.fail('Role reuse must never request upstream data'));
  return store;
}
test('retained reads use chronology rather than ingestion order and never persist reused labels',t=>{
  const store=corpus(t);
  const current=put(store,{day:'2026-10-19',number:2,labels:{bg}});
  put(store,{day:'2026-10-20',number:3,labels:{bg,en:'Future English'}});
  const prior=put(store,{day:'2026-10-07',number:1,labels:{bg,en}});
  const read=()=>store.speechData({sourceIds:[current],language:'en',metadataOnly:true}).records[0].metadata;
  const selected=read().speakers[0].roleLabels.en;
  const beforeSource=read().speakers[0].roleSource;
  assert.equal(selected.text,en);assert.equal(selected.reuse.speechId,prior);
  assert.equal(store.speechMetadata(current).speakers[0].roleLabels.en,undefined);
  put(store,{day:'2026-10-14',number:4,labels:{bg:'Председател на Комисията',en:'President of the Commission'}});
  assert.equal(read().speakers[0].roleLabels.en,undefined,'do not skip a changed nearest role to resurrect an older title');
  const afterSource=read().speakers[0].roleSource;
  assert.equal(afterSource.fetchedAt,beforeSource.fetchedAt);
  assert(afterSource.evidenceRevision>beforeSource.evidenceRevision,'history invalidation advances evidence even when the current source is unchanged');
});
test('nearest same-day earlier evidence works despite a later speech; unknown chronology blocks it',t=>{
  const store=corpus(t);
  const current=put(store,{day:'2026-10-19',number:2,start:'10:00:00',labels:{bg}});
  put(store,{day:'2026-10-19',number:3,start:'11:00:00',labels:{bg,en:'Future English'}});
  const previous=put(store,{day:'2026-10-19',number:1,start:'09:00:00',labels:{bg,en}});
  const read=()=>store.speechData({sourceIds:[current],language:'en',metadataOnly:true}).records[0].metadata.speakers[0].roleLabels.en;
  assert.equal(read().reuse.speechId,previous);
  put(store,{day:'2026-10-19',number:4,start:null,labels:{bg,en}});
  // An undated row sorts after timed rows in SQLite; it must still block reuse.
  assert.equal(read(),undefined);
});

test('an undated current speech cannot skip a changed same-day observation',t=>{
  const store=corpus(t);
  const current=put(store,{day:'2026-10-19',number:3,start:null,labels:{bg}});
  put(store,{day:'2026-10-19',number:2,start:'10:00:00',labels:{bg:'Председател на Комисията',en:'President of the Commission'}});
  put(store,{day:'2026-10-07',number:1,labels:{bg,en}});
  assert.equal(store.speechData({sourceIds:[current],language:'en',metadataOnly:true}).records[0].metadata.speakers[0].roleLabels.en,undefined);
});

test('tied nearest prior records do not choose a title by identifier',t=>{
  const store=corpus(t);
  const current=put(store,{day:'2026-10-19',number:3,labels:{bg}});
  put(store,{day:'2026-10-07',number:1,labels:{bg,en}});
  put(store,{day:'2026-10-07',number:2,labels:{bg:'Председател на Комисията',en:'President of the Commission'}});
  assert.equal(store.speechData({sourceIds:[current],language:'en',metadataOnly:true}).records[0].metadata.speakers[0].roleLabels.en,undefined);
});

test('history traversal uses the date index and withholds reuse across the 512-row boundary',t=>{
  const store=corpus(t);
  const current=put(store,{day:'2026-10-19',number:1,labels:{bg}});
  put(store,{day:'2026-10-07',number:2,labels:{bg,en}});
  const insert=store.db.prepare('INSERT INTO speech_catalog VALUES (?,?,?,?,?,?,?,?,?)');
  for(let i=0;i<513;i++)insert.run('MTG-PL-2026-10-14-OTH-'+(i+100),'2026-10-14','PLENARY_DEBATE_SPEECH','2026-10-14T10:00:00Z',i,'["999"]','[]',1,null);
  assert.equal(store.speechData({sourceIds:[current],language:'en',metadataOnly:true}).records[0].metadata.speakers[0].roleLabels.en,undefined);
  const plan=store.db.prepare("EXPLAIN QUERY PLAN SELECT source_id,date,start,participants FROM speech_catalog INDEXED BY speech_catalog_latest WHERE kind IN ('PLENARY_DEBATE_SPEECH','PLENARY_DEBATE_WRITTEN_STATEMENT') AND date<=? ORDER BY date DESC LIMIT 513").all('2026-10-19');
  assert(plan.some(row=>row.detail.includes('USING INDEX speech_catalog_latest')));
});

test('incomplete catalogue projection withholds reuse without hiding current supplied labels',t=>{
  const store=corpus(t);
  const current=put(store,{day:'2026-10-19',number:3,labels:{bg}});
  put(store,{day:'2026-10-07',number:1,labels:{bg,en}});
  const read=id=>store.speechData({sourceIds:[id],language:'en',metadataOnly:true}).records[0].metadata.speakers[0];
  assert.equal(read(current).roleLabels.en.text,en);
  const nearer=put(store,{day:'2026-10-14',number:2,labels:{bg:'Председател на Комисията',en:'President of the Commission'}});
  store.db.prepare('DELETE FROM speech_catalog WHERE source_id=?').run(nearer);
  assert(store.db.prepare('SELECT 1 FROM speech_catalog_dirty WHERE source_id=?').get(nearer));
  assert.equal(read(current).roleLabels.en,undefined);
  assert.equal(read(current).roleSource.historyComplete,false);
  assert.equal(read(nearer).roleLabels.en.text,'President of the Commission');
  assert.equal(store.speechMetadata(current).speakers[0].roleLabels.en,undefined);
  store.projectSpeechCatalog(store.speechMetadata(nearer).activity);
  assert.equal(read(current).roleSource.historyComplete,true);
  assert.equal(read(current).roleLabels.en,undefined,'the nearer changed role remains a contradiction after projection completes');
});
