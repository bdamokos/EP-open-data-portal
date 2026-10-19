import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {interventionMetadata} from './speech-interventions.mjs';
import {SpeechInterventions} from './speech-intervention-service.mjs';

const observations=JSON.parse(readFileSync(new URL('./fixtures/blue-card-header-variants.json',import.meta.url))).observations;
const annotations=JSON.parse(readFileSync(new URL('./speech-intervention-annotations.json',import.meta.url)));
const clone=value=>structuredClone(value);
const fragments=activity=>activity.recorded_in_a_realization_of[0]['api:xmlFragment'];

test('official original and English header variants distinguish all five ambiguous blue-card labels',()=>{
  for(const {activity,expectedType} of observations) {
    assert.equal(interventionMetadata(activity).type,expectedType,activity.activity_id);
    const english=clone(activity);english.recorded_in_a_realization_of[0]['api:xmlFragment']={en:fragments(activity).en};
    assert.equal(interventionMetadata(english).type,expectedType,'English-only listing '+activity.activity_id);
    if(expectedType==='chair')continue;
    const original=clone(activity);delete fragments(original).en;
    assert.equal(interventionMetadata(original).type,expectedType,'original-only '+activity.activity_id);
  }
});

test('ambiguous aliases require their exact element, speaker and complete header label',()=>{
  const source=observations.find(row=>row.expectedType==='blue-card-answer').activity;
  for(const change of [
    xml=>xml.replaceAll('<answer','<speech').replaceAll('</answer>','</speech>'),
    xml=>xml.replaceAll('epdata:person/256918','epdata:person/999999'),
    xml=>xml.replace('Blue Carton Response','Other Blue Carton Response'),
  ]) {
    const activity=clone(source);activity.recorded_in_a_realization_of[0]['api:xmlFragment']={en:change(fragments(source).en)};
    assert.equal(interventionMetadata(activity).type,'unclassified');
  }
  const ordinary=clone(source);
  ordinary.recorded_in_a_realization_of[0]['api:xmlFragment']={en:'<oralStatements><question xml:lang="en"><from><person refersTo="epdata:person/256918">Exact speaker</person></from><p>I am answering a blue card.</p></question></oralStatements>'};
  assert.equal(interventionMetadata(ordinary).type,'speech','element and body words alone do not identify a blue card');
});

test('conflicting original blue-card headers remain unknown and unmatched originals cannot override English',()=>{
  const activity=clone(observations.find(row=>row.expectedType==='blue-card-answer').activity);
  activity.recorded_in_a_realization_of[0].originalLanguage=['http://publications.europa.eu/resource/authority/language/FRA','http://publications.europa.eu/resource/authority/language/EST'];
  fragments(activity).et='<oralStatements><question xml:lang="et"><from><person refersTo="epdata:person/256918">Exact speaker</person><process>sinise kaardi küsimus</process></from></question></oralStatements>';
  assert.equal(interventionMetadata(activity).type,'unclassified');
  fragments(activity).et=fragments(activity).et.replace('person/256918','person/999999');
  assert.equal(interventionMetadata(activity).type,'blue-card-answer');
});

const apiGap=row=>({id:'eli/dl/event/'+row.id,activity_id:row.id,activity_date:row.id.slice(7,17),
  activity_start_date:row.start,activity_end_date:row.end,had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',
  had_participation:{had_participant_person:['person/'+row.personId],participation_role:'def/ep-roles/SPEAKER'},
  inverse_consists_of:['eli/dl/event/'+row.parentId],recorded_in_a_realization_of:[]});

test('verified transcript classifications preserve absent API headers and exact source provenance',async()=>{
  const rows=annotations.map(apiGap),snapshot=clone(rows);
  for(const [index,activity] of rows.entries()) {
    const meta=interventionMetadata(activity),row=annotations[index];
    assert.equal(meta.type,row.type);assert.equal(meta.headerAvailable,false);assert.equal(meta.speaker,null);
    assert.equal(meta.process,null);assert.equal(meta.evidence,'verified-official-transcript');
    assert.deepEqual(meta.classificationSources,row.sources);
    assert(meta.classificationSources.every(source=>source.url.startsWith('https://')&&/^[a-f0-9]{64}$/.test(source.sha256)&&Number.isFinite(Date.parse(source.fetchedAt))));
  }
  assert.deepEqual(rows,snapshot,'classification cannot alter API observations');
  const own=rows.filter(row=>row.had_participation.had_participant_person[0]==='person/197655');
  const stats=await new SpeechInterventions({request:async()=>({url:'https://data.europarl.europa.eu/api/v2/speeches',fetchedAt:Date.now(),payload:{data:own,meta:{total:own.length},searchResults:{hits:own.map(row=>({id:row.id}))}}})}).member('197655');
  assert.equal(stats.coverage.unclassified,0);assert.equal(stats.coverage.headers,0);
  assert(own.every(row=>interventionMetadata(row).type==='oral-explanation-of-vote'));
});

test('annotations reject changed identities, participants, timing and agenda instead of joining by names',()=>{
  const row=annotations.find(row=>row.type==='oral-explanation-of-vote');
  for(const mutate of [
    a=>a.id='eli/dl/event/MTG-PL-2026-01-01-OTH-1',
    a=>a.activity_id='MTG-PL-2026-01-01-OTH-1',
    a=>a.activity_date='2026-01-01',
    a=>a.activity_start_date=a.activity_start_date.replace(/T\d\d:/,'T00:'),
    a=>a.activity_end_date=null,
    a=>a.had_participation.had_participant_person=['person/999999'],
    a=>a.had_participation.had_participant_person.push('person/999999'),
    a=>a.had_participation.had_participant_person=['unrelated/'+row.personId],
    a=>a.inverse_consists_of=['eli/dl/event/MTG-PL-2026-01-01-PVCRE-ITM-1'],
    a=>a.inverse_consists_of.push('eli/dl/event/MTG-PL-2026-01-01-PVCRE-ITM-1'),
  ]) {
    const activity=apiGap(row);mutate(activity);
    assert.equal(interventionMetadata(activity).type,'unclassified');
  }
});
