import test from 'node:test';
import assert from 'node:assert/strict';
import {outsideSpeakerCountries} from './outside-speaker-country.mjs';
// Small synthetic header fixtures using public CRE role labels; exact person IDs
// from /api/v2/speeches (research retrieval 2026-11-02); combinations are synthetic.
const outsideSpeakerCountry=(id,rows)=>{const result=outsideSpeakerCountries(id,rows);return result.size?{country:[...result.values()][0].country,basis:'role-debate-agreement',appearanceIds:[...result.keys()]}:null;};
const a=(id,role,debatePlaces=['PRT'],personId='281548')=>({id,personId,header:{role},debatePlaces});
test('option A requires an appearance role and exactly one agreeing country',()=>{
 const rows=[a('one','Prime Minister of Portugal',['MNE','PRT'])];
 assert.deepEqual(outsideSpeakerCountry('281548',rows),{country:'PRT',basis:'role-debate-agreement',appearanceIds:['one']});
 rows[0].debatePlaces=['MNE'];assert.equal(outsideSpeakerCountry('281548',rows),null,'MTG-PL-2026-10-06-PVCRE-ITM-5 surname mistag cannot assign Montenegro');
 assert.equal(outsideSpeakerCountry('other',rows),null);
 assert.equal(outsideSpeakerCountry('281548',[a('two','Speaker of the Verkhovna Rada',['UKR'])]),null);
 assert.equal(outsideSpeakerCountry('281548',[a('two','Prime Minister of Portugal and Spain',['PRT','ESP'])]),null);
});
test('institutional majority, including ties, excludes misleading leader headers',()=>{
 for(const role of ['Member of the Commission','President-in-Office of the Council','President of the European Council']){
  const rows=[a('one','Prime Minister of Portugal'),a('two',role),a('three',role)];assert.equal(outsideSpeakerCountry('281548',rows),null);
  assert.equal(outsideSpeakerCountry('281548',rows.slice(0,2)),null);
 }
 assert.equal(outsideSpeakerCountry('281548',[a('one','Prime Minister of Portugal, President-in-Office of the Council')]),null);
 const rows=[a('one','Prime Minister of Portugal'),a('two','Prime Minister of Portugal'),a('three','President-in-Office of the Council')];assert.deepEqual(outsideSpeakerCountry('281548',rows).appearanceIds,['one','two']);
});
test('all observed role languages contribute country evidence without name matching',()=>{
 const row=a('one','Presidente da República de Portugal',[]);row.debatePlaces=['PRT','ESP'];assert.equal(outsideSpeakerCountry('281548',[row]).country,'PRT');
 row.header={role:'President of the Republic',observations:[{role:'President of Ukraine'}]};row.debatePlaces=['UKR'];assert.equal(outsideSpeakerCountry('281548',[row]).country,'UKR');
});

test('country selection belongs to each appearance even if a person changes roles',()=>{
 const rows=[a('one','President of Portugal',['PRT']),a('two','President of Spain',['ESP'])];
 assert.deepEqual([...outsideSpeakerCountries('281548',rows).values()].map(x=>x.country),['PRT','ESP']);
});

test('missing roles do not outvote an observed institutional majority',()=>{
 const rows=[a('one','Prime Minister of Portugal'),a('two','Member of the Commission'),a('three','Member of the Commission'),...Array.from({length:5},(_,i)=>a('unknown'+i,null))];
 assert.equal(outsideSpeakerCountries('281548',rows).size,0);
});
