import {test} from 'node:test';
import assert from 'node:assert/strict';
import {legislationContributors,mergeSpeechSpeakers,orderLegislationPeople} from './legislationContributors.mjs';
const person=(id,currentMep=true)=>({id,name:'Person '+id,currentMep,demographics:currentMep?{country:'HU',group:'PPE',gender:'Female',age:'50–64'}:null});
const speech=(sourceId,people,kind='PLENARY_DEBATE_SPEECH')=>({sourceId,people,kind});
const header=(id,personId,role='Chairing the sitting',name=null)=>({id,people:[{id:personId,name,role}]});
function detail(people,speeches,roles=[]) {
  const n=people.filter(person=>person.currentMep).length;
  return {people,speeches,roles,stats:{uniquePeople:people.length,uniqueCurrentMeps:n,peopleOutsideCurrentRoster:people.length-n,denominator:n,referenceDate:'2026-10-07',dimensions:Object.fromEntries(Object.entries({country:'HU',group:'PPE',gender:'Female',age:'50–64'}).map(([key,label])=>[key,[{label,count:n}]]))}};
}
test('chair-only participation is excluded from people, roles and every demographic denominator',()=>{
  const chair=person('1'),speaker=person('2'),guest=person('3',false),input=detail([chair,speaker,guest],[speech('intro',[chair]),speech('debate',[speaker,guest])]);
  input.stats.demographicEvidence={'1':{bday:{status:'source_omission'}},'2':{bday:{status:'available'}}};
  const before=structuredClone(input),headers=mergeSpeechSpeakers({},[header('intro','1')]),result=legislationContributors(input,headers);
  assert.deepEqual(result.people.map(p=>p.id),['2','3']);assert.equal(result.excludedCount,1);assert.deepEqual(result.roles.map(p=>p.id),['2','3']);
  assert.equal(result.stats.denominator,1);assert.equal(result.stats.uniqueCurrentMeps,1);assert.equal(result.stats.uniquePeople,2);assert.equal(result.stats.peopleOutsideCurrentRoster,1);
  for(const rows of Object.values(result.stats.dimensions))assert.equal(rows[0].count,1);
  assert.deepEqual(Object.keys(result.stats.demographicEvidence),['2']);
  assert.deepEqual(input,before);
});
test('a chair with a separate speech stays involved regardless of speech order or header arrival',()=>{
  const chair=person('1'),input=detail([chair],[speech('intro',[chair]),speech('substantive',[chair])]);
  for(const evidence of [[header('intro','1'),header('substantive','1',null,'Named speaker')],[header('substantive','1',null,'Named speaker'),header('intro','1')]]) {
    const result=legislationContributors(input,mergeSpeechSpeakers({},evidence));
    assert.equal(result.people.length,1);assert.deepEqual(result.roles,[{id:'1',role:'SPEAKER'}]);assert.equal(result.stats.denominator,1);
  }
});
test('written statements and documented item roles independently retain a person who chaired',()=>{
  const chair=person('1');
  for(const [speeches,roles] of [[[speech('intro',[chair]),speech('written',[chair],'PLENARY_DEBATE_WRITTEN_STATEMENT')],[]],[[speech('intro',[chair])],[{id:'1',role:'RAPPORTEUR'}]]]) {
    const result=legislationContributors(detail([chair],speeches,roles),mergeSpeechSpeakers({},[header('intro','1')]));
    assert.equal(result.people.length,1);assert.equal(result.roles.length,1);assert.notEqual(result.roles[0].role,'SPEAKER');
  }
});
test('missing headers, partial pages and unrelated speech evidence do not imply chair-only participation',()=>{
  const chair=person('1'),input=detail([chair],[speech('intro',[chair]),speech('unread',[chair])]);
  for(const headers of [{},mergeSpeechSpeakers({},[header('intro','1')]),mergeSpeechSpeakers({},[header('unrelated','1')])])assert.equal(legislationContributors(input,headers).people.length,1);
  const all=mergeSpeechSpeakers({},[header('intro','1'),header('unread','1')]);assert.equal(legislationContributors(input,all).people.length,0);
  assert.deepEqual(legislationContributors(input,all).stats.dimensions.country,[]);
});
test('evidence survives country/language subsets and a chair label is scoped to its exact speech',()=>{
  const first=mergeSpeechSpeakers({},[header('intro','1'),header('other','2',null,'Guest')]);
  assert.strictEqual(mergeSpeechSpeakers(first,[header('other','2',null,'Guest')]),first);
  const next=mergeSpeechSpeakers(first,[header('intro','1',null,'Chair name')]);
  assert.equal(next.intro['1'].role,'Chairing the sitting');assert.equal(next.other['2'].role,null);
  assert(next.other);assert(next.intro);
});

test('plenary people put guests first, then the highest documented role and full-roster group size',()=>{
  const people=[
    {...person('speaker-small'),group:'Small'},
    {...person('shadow-large'),group:'Large'},
    {...person('rapporteur-small'),group:'Small'},
    {...person('guest',false),name:'Outside speaker'},
    {...person('speaker-large'),group:'Large'},
    {...person('opinion-large'),group:'Large'},
    {...person('shadow-opinion-large'),group:'Large'},
    {...person('shadow-small'),group:'Small'},
    {...person('multi-role'),group:'Large'},
    {...person('co-rapporteur-small'),group:'Small'},
    {...person('co-rapporteur-large'),group:'Large'},
  ];
  const roles=[['shadow-large','RAPPORTEUR_SHADOW'],['rapporteur-small','RAPPORTEUR'],['opinion-large','RAPPORTEUR_OPINION'],['shadow-opinion-large','RAPPORTEUR_SHADOW_OPINION'],['shadow-small','RAPPORTEUR_SHADOW'],['multi-role','RAPPORTEUR'],['multi-role','SPEAKER'],['multi-role','RAPPORTEUR_SHADOW'],['co-rapporteur-small','RAPPORTEUR_CO'],['co-rapporteur-large','RAPPORTEUR_SHADOW'],['co-rapporteur-large','RAPPORTEUR_CO'],['co-rapporteur-large','SPEAKER']].map(([id,role])=>({id,role}));
  const members=[{groupCode:'Small'},{groupCode:'Large'},{groupCode:'Large'}],before=structuredClone({people,roles,members});
  const ordered=orderLegislationPeople(people,roles,members);
  assert.deepEqual(ordered.map(p=>p.id),['guest','co-rapporteur-large','multi-role','co-rapporteur-small','rapporteur-small','opinion-large','shadow-large','shadow-small','shadow-opinion-large','speaker-large','speaker-small']);
  assert.deepEqual({people,roles,members},before);
  assert.deepEqual(orderLegislationPeople([...people].reverse(),[...roles].reverse(),members),ordered);
});

test('group ranking uses the whole roster, with non-attached and missing groups last and stable name/ID ties',()=>{
  const people=[
    {...person('z'),name:'Zulu',group:'Large',country:'HU'},
    {...person('s1'),group:'Small',country:'HU'},
    {...person('s2'),group:'Small',country:'HU'},
    {...person('2'),name:'Alpha',group:'Large',country:'FR'},
    {...person('1'),name:'Alpha',group:'Large',country:'HU'},
    {...person('ni'),group:'NI',country:'HU'},
    {...person('unknown'),group:null,country:'HU'},
    {...person('unnamed'),name:null,group:'Large',country:'HU'},
  ];
  const members=['Large','Large','Large','Small',...Array(5).fill('NI')].map(groupCode=>({groupCode}));
  const ordered=orderLegislationPeople(people,[],members);
  assert.deepEqual(ordered.map(p=>p.id),['1','2','z','unnamed','s1','s2','ni','unknown']);
  const subset=people.filter(p=>p.country==='HU');
  assert.deepEqual(orderLegislationPeople(subset,[],members),ordered.filter(p=>p.country==='HU'));
  assert.deepEqual(orderLegislationPeople(people,[]),orderLegislationPeople([...people].reverse(),[]));
  assert.deepEqual(orderLegislationPeople([],[],members),[]);
});
test('chairing removes only that dated speech contribution and retains a separate role under another group',()=>{
  const chair={...person('1'),contributionGroup:'S&D'},input=detail([chair],[speech('intro',[chair])],[{id:'1',role:'RAPPORTEUR'}]);
  input.stats.groupContributions={rows:[{label:'S&D',count:1},{label:'Renew',count:1}],total:2,unavailable:0};
  const before=structuredClone(input),result=legislationContributors(input,mergeSpeechSpeakers({},[header('intro','1')]));
  assert.equal(result.people.length,1);assert.equal(result.stats.groupContributions.total,1);assert.deepEqual(result.stats.groupContributions.rows,[{label:'Renew',count:1}]);assert.deepEqual(input,before);
});
