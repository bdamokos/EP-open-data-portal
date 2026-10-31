import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SpeechCloudInsights,speechCloudQuery,CLOUD_SORT} from './speech-cloud.mjs';

const now=()=>Date.parse('2026-10-16T10:00:00Z');
const date='2026-10-08',sitting='MTG-PL-'+date,topic=sitting+'-OJ-ITM-D-72';
const member='125065';
const query=value=>speechCloudQuery(new URLSearchParams(value),{now:now()});
const xml=(tag,text='Climate energy transport.')=>`<oralStatements><speech xml:lang="${tag}"><from><person refersTo="person/${member}">Public speaker</person></from><p>${text}</p></speech></oralStatements>`;
const activity=(number,{titles={en:'English title'},fragments={en:xml('en')}}={})=>({
  activity_id:sitting+'-OTH-'+number,activity_date:date,activity_label:titles,
  had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',
  had_participation:{had_participant_person:'person/'+member},
  recorded_in_a_realization_of:[{'api:xmlFragment':fragments}],
});
const record=data=>({
  url:'https://data.europarl.europa.eu/api/v2/speeches?include-output=xml_fragment',
  fetchedAt:now(),stale:false,
  payload:{data,meta:{total:data.length},searchResults:{hits:data.map(row=>({id:'eli/dl/event/'+row.activity_id}))}},
});
function storeFor(t) {
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec('CREATE TABLE members(id TEXT PRIMARY KEY,body TEXT NOT NULL)');
  db.prepare('INSERT INTO members VALUES (?,?)').run(member,JSON.stringify({id:member,name:'Saved speaker'}));
  db.exec('PRAGMA query_only=ON');
  return {db,get:()=>null,status:()=>({servingGeneration:1})};
}
function serviceFor(t,{data=[],labels={},detail}={}) {
  const source=record(data),calls=[];
  const legislation={
    catalogue:async()=>({sittings:[{activity_id:sitting,activity_date:date,activity_label:labels}]}),
    query:async selection=>{calls.push({topic:selection});return {detail};},
  };
  const service=new SpeechCloudInsights(storeFor(t),{clock:now,legislation,request:async(endpoint,params,options)=>{
    assert.equal(endpoint,'/speeches');
    calls.push({endpoint,params,options});
    return source;
  }});
  return {service,calls,source};
}

beforeEach(t=>{
  t.mock.method(globalThis,'fetch',async()=>assert.fail('Focused metadata tests must use injected public-shaped records'));
});

test('speech titles retain requested/English/fixed fallback selection with their actual language',async t=>{
  const cases=[
    {language:'en',titles:{fr:'Français',hu:'Magyar',en:'English'},title:'English',titleLanguage:'en'},
    {language:'hu',titles:{fr:'Français',en:'English',hu:'Magyar'},title:'Magyar',titleLanguage:'hu'},
    {language:'fr',titles:{hu:'Magyar',en:'English',fr:'Français'},title:'Français',titleLanguage:'fr'},
    {language:'hu',titles:{fr:'Français',en:'English'},title:'English',titleLanguage:'en'},
    {language:'fr',titles:{hu:'Magyar',fr:'',en:'English'},title:'English',titleLanguage:'en'},
    {language:'en',titles:{hu:'Magyar'},title:'Magyar',titleLanguage:'hu'},
    {language:'hu',titles:{bg:'Български',fr:'Français',hu:'',en:''},title:'Français',titleLanguage:'fr'},
    {language:'fr',titles:{},title:'Speech',titleLanguage:'en'},
  ];
  for(const [i,{language,titles,title,titleLanguage}] of cases.entries()) {
    const row=activity(i+1,{titles,fragments:{[language]:xml(language)}});
    const before=structuredClone(row),{service,calls,source}=serviceFor(t,{data:[row]});
    const result=await service.query(query(`member=${member}&days=term&lang=${language}`));
    assert.deepEqual(result.speeches,[{id:row.activity_id,date,title,titleLanguage,machineTranslation:false,people:[{id:member,name:'Saved speaker',currentMep:true,role:null,roleLabels:{},roleLanguage:null,roleSource:{speechId:row.activity_id,date,url:source.url,fetchedAt:new Date(now()).toISOString()}}]}]);
    assert.deepEqual(result.scope,{kind:'member',member,sitting:null,week:null,topic:null,title:null,titleLanguage:null,phase:'past'});
    assert.equal(result.language,language);
    assert.equal(result.coverage.complete,true);
    assert.equal(result.coverage.missingLanguage,0);
    assert.deepEqual(result.sources,[{url:source.url,fetchedAt:new Date(now()).toISOString(),stale:false}]);
    assert.equal(calls.length,1);
    assert.equal(calls[0].params.language,language);
    assert.equal(calls[0].params['include-output'],'xml_fragment');
    assert.equal(calls[0].params['sort-by'],CLOUD_SORT);
    assert.deepEqual(row,before);
  }
});

test('sitting scope titles use the shared display preference and retain actual language',async t=>{
  const cases=[
    {language:'en',labels:{hu:'Ülés',en:'Sitting'},title:'Sitting',titleLanguage:'en'},
    {language:'hu',labels:{en:'Sitting',hu:'Ülés'},title:'Ülés',titleLanguage:'hu'},
    {language:'fr',labels:{en:'Sitting',fr:'Séance'},title:'Séance',titleLanguage:'fr'},
    {language:'hu',labels:{fr:'Séance',en:'Sitting'},title:'Sitting',titleLanguage:'en'},
    {language:'fr',labels:{fr:'',en:'Sitting'},title:'Sitting',titleLanguage:'en'},
    {language:'hu',labels:{bg:'Заседание',fr:'Séance'},title:'Séance',titleLanguage:'fr'},
    {language:'en',labels:{},title:null,titleLanguage:null},
  ];
  for(const {language,labels,title,titleLanguage} of cases) {
    const {service}=serviceFor(t,{labels});
    const result=await service.query(query(`sitting=${sitting}&lang=${language}`));
    assert.deepEqual(result.scope,{kind:'sitting',member:null,sitting,week:null,topic:null,title,titleLanguage,phase:'past'});
  }
});

test('topic scope passes through the selected detail language including first-key and unknown metadata',async t=>{
  const cases=[
    {language:'en',title:'English topic',titleLanguage:'en'},
    {language:'hu',title:'Magyar napirendi pont',titleLanguage:'hu'},
    {language:'fr',title:'Sujet français',titleLanguage:'fr'},
    {language:'hu',title:'English fallback topic',titleLanguage:'en'},
    {language:'hu',title:'Premier titre français',titleLanguage:'fr'},
    {language:'en',title:'Mixed annotation',titleLanguage:'fr-t-hu-mtec'},
    {language:'fr',title:topic,titleLanguage:null},
    {language:'hu',title:'Unannotated title'},
  ];
  for(const {language,title,...metadata} of cases) {
    const detail={id:topic,title,...metadata,people:[],coverage:{speechAssociations:{sources:[]}}};
    const {service,calls}=serviceFor(t,{labels:{[language]:'Different sitting title'},detail});
    const result=await service.query(query(`sitting=${sitting}&topic=${topic}&lang=${language}`));
    assert.deepEqual(result.scope,{kind:'topic',member:null,sitting,week:null,topic,title,titleLanguage:metadata.titleLanguage??null,phase:'past'});
    assert.equal(result.coverage.associationUnavailable,true);
    assert.equal(calls.length,1);
    assert.deepEqual(calls[0],{topic:{language,sitting,topic,vote:null}});
  }
});

test('untitled week scopes keep null language even when a sitting has a localized title',async t=>{
  const {service}=serviceFor(t,{labels:{hu:'Ülés'}});
  const result=await service.query(query('week=2026-10-05&lang=hu'));
  assert.equal(result.scope.kind,'week');
  assert.equal(result.scope.title,null);
  assert.equal(result.scope.titleLanguage,null);
});

test('missing requested XML is still missing even when translated English XML and a requested title exist',async t=>{
  const row=activity(1,{titles:{hu:'Magyar cím',en:'English title'},fragments:{en:xml('fr-t-en-mtec')}});
  const {service,calls,source}=serviceFor(t,{data:[row]});
  const result=await service.query(query(`member=${member}&days=term&lang=hu`));
  assert.deepEqual(result.speeches,[]);
  assert.deepEqual(result.words,[]);
  assert.deepEqual(result.coverage,{transcripts:0,matchedSpeechRecords:1,missingLanguage:1,missingLanguageAlternatives:[{language:'en',count:1}],unreadableText:0,complete:true,truncated:false,sourceRecords:{unique:1,declared:1,duplicates:0,issues:[]},associationUnavailable:false,xmlBytes:0,textBytes:0});
  assert.equal(result.nextPage,null);
  assert.equal(calls.length,1);
  assert.deepEqual(result.sources,[{url:source.url,fetchedAt:new Date(now()).toISOString(),stale:false}]);
});

test('title language stays independent of requested XML translation and mixed or unknown annotations',async t=>{
  const hu=xml('fr-t-hu-mtec','Éghajlat energia közlekedés.');
  const rows=[
    activity(1,{titles:{en:'English fallback'},fragments:{en:xml('en'),hu}}),
    activity(2,{titles:{hu:'Magyar cím'},fragments:{en:xml('fr-t-en-mtec'),hu:xml('hu','Éghajlat energia.')}}),
    activity(3,{titles:{hu:'Vegyes szöveg'},fragments:{hu:xml('hu','Energia.').replace('</speech>','<p xml:lang="fr-t-hu-mtec">Közlekedés.</p></speech>')}}),
    activity(4,{titles:{hu:'Ismeretlen jelölés'},fragments:{hu:xml('und','Éghajlat energia.')}}),
  ];
  const {service}=serviceFor(t,{data:rows});
  const result=await service.query(query(`member=${member}&days=term&lang=hu`));
  assert.deepEqual(result.speeches.map(({id,title,titleLanguage,machineTranslation})=>({id,title,titleLanguage,machineTranslation})),[
    {id:rows[0].activity_id,title:'English fallback',titleLanguage:'en',machineTranslation:true},
    {id:rows[1].activity_id,title:'Magyar cím',titleLanguage:'hu',machineTranslation:false},
    {id:rows[2].activity_id,title:'Vegyes szöveg',titleLanguage:'hu',machineTranslation:true},
    {id:rows[3].activity_id,title:'Ismeretlen jelölés',titleLanguage:'hu',machineTranslation:false},
  ]);
  assert.equal(result.coverage.transcripts,4);
  assert.equal(result.coverage.xmlBytes,Buffer.byteLength(rows.map(row=>row.recorded_in_a_realization_of[0]['api:xmlFragment'].hu).join('')));
  assert.equal(result.coverage.missingLanguage,0);
});

test('cloud keeps all supplied role labels and provenance rather than treating the first Bulgarian header as English',async t=>{
  const roleXml=(lang,role)=>xml(lang).replace('<from>','<from xml:lang="'+lang+'">').replace('</person>','</person><role>'+role+'</role>');
  const row=activity(1,{fragments:{bg:roleXml('bg','Член на Комисията'),en:roleXml('en','Member of the Commission'),fr:roleXml('fr','Membre de la Commission')}});
  const {service,source}=serviceFor(t,{data:[row]});
  const result=await service.query(query(`member=${member}&days=term&lang=en`));
  const person=result.speeches[0].people[0];
  assert.equal(person.roleLanguage,'en');
  assert.deepEqual(person.roleLabels,{bg:{text:'Член на Комисията',language:'bg'},en:{text:'Member of the Commission',language:'en'},fr:{text:'Membre de la Commission',language:'fr'}});
  assert.deepEqual(person.roleSource,{speechId:row.activity_id,date,url:source.url,fetchedAt:new Date(now()).toISOString()});
});

test('retained cloud carries raw role language and known English independently of text language',async t=>{
  const row=activity(1),labels={bg:{text:'Член на Комисията',language:'bg'},en:{text:'Member of the Commission',language:'en'}};
  const source=record([]),store=storeFor(t);
  const service=new SpeechCloudInsights(store,{clock:now,request:async()=>assert.fail('Retained cloud cannot fetch upstream'),legislation:{catalogue:async()=>({sittings:[{activity_id:sitting,activity_date:date}]})},
    readCorpusPage:async()=>({revision:'1',total:1,nextOffset:null,records:[{id:row.activity_id,metadata:{activity:row,summary:{date,titles:row.activity_label},speakers:[{id:member,name:'Public speaker',role:labels.bg.text,roleLanguage:'bg',roleLabels:labels}],sourceUrl:source.url,fetchedAt:new Date(now()).toISOString()},text:{body:'Climate energy transport.',translationType:'original',sourceUrl:source.url,fetchedAt:new Date(now()).toISOString()}}]})});
  const result=await service.query(query(`sitting=${sitting}&lang=en`)),person=result.speeches[0].people[0];
  assert.equal(person.role,labels.bg.text);assert.equal(person.roleLanguage,'bg');assert.deepEqual(person.roleLabels,labels);
  assert.equal(person.roleSource.speechId,row.activity_id);
});

test('fallback display titles do not train English phrases in live or retained clouds',async t=>{
  const content='We discussed nord stream and energy.';
  for(const retained of [false,true])for(const english of [false,true]) {
    const titles=english?{en:'Nord Stream',fr:'Nord Stream'}:{fr:'Nord Stream'},row=activity(1,{titles,fragments:{en:xml('en',content)}});
    let service;
    if(!retained)({service}=serviceFor(t,{data:[row]}));
    else {
      const source=record([]);
      service=new SpeechCloudInsights(storeFor(t),{clock:now,request:async()=>assert.fail('Retained clouds must not fetch upstream'),legislation:{catalogue:async()=>({sittings:[{activity_id:sitting,activity_date:date}]})},
        readCorpusPage:async()=>({revision:'1',total:1,nextOffset:null,records:[{id:row.activity_id,metadata:{activity:row,summary:{date,titles},speakers:[],sourceUrl:source.url,fetchedAt:new Date(now()).toISOString()},text:{body:content,translationType:'original',sourceUrl:source.url,fetchedAt:new Date(now()).toISOString()}}]})});
    }
    const result=await service.query(query(retained?`sitting=${sitting}&lang=en`:`member=${member}&days=term&lang=en`));
    assert.equal(result.speeches[0].title,'Nord Stream');assert.equal(result.speeches[0].titleLanguage,english?'en':'fr');
    assert.equal(Object.hasOwn(result.speeches[0],'analysisTitle'),false);
    assert.deepEqual(result.words.map(word=>word.word).sort(),english?['discussed','energy','nord-stream']:['discussed','energy','nord','stream']);
  }
});
