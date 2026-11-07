import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpError} from './http-utils.mjs';
import {DossierActivity} from './dossier-activity.mjs';
import {DossierStatus,tabledReports} from './dossier-status.mjs';
import {leadCommitteeCodes,rapporteurIds,standingLines,WEEK_ITEM_VERSION,weekItem,weekItemQuery} from './week-item.mjs';

const event=(type,date,extra={})=>({id:'eli/dl/event/'+type+date,had_activity_type:'def/ep-activities/'+type,activity_date:date,activity_id:type+date,...extra});
const part=(role,person,committee,term='org/ep-10')=>({participation_role:'def/ep-roles/'+role,had_participant_person:['person/'+person],participation_in_name_of:'org/'+committee,parliamentary_term:term});
const lead=code=>({participation_role:'def/ep-roles/COMMITTEE_LEAD',had_participant_organization:['org/'+code]});
const procedure=(id,label,extra={})=>({id:'eli/dl/proc/'+id,label,process_type:'def/ep-procedure-types/'+/\(([A-Z]+)\)/.exec(label)[1],process_title:{en:'Title'},...extra});
const cancer=procedure('2025-2139','2025/2139(INI)',{
  had_participation:[lead('SANT'),part('RAPPORTEUR','257112','SANT'),part('RAPPORTEUR_OPINION','1','FEMM')],
  consists_of:[event('COMMITTEE_ADOPTING_OPINION','2026-06-01'),event('COMMITTEE_ADOPTING_REPORT','2026-09-28'),event('TABLING_PLENARY','2026-10-08',{based_on_a_realization_of:['eli/dl/doc/A-10-2026-0261']})],
});
const investors=procedure('2023-0166','2023/0166(COD)',{
  had_participation:[lead('ECON'),part('RAPPORTEUR','111','ECON','org/ep-9'),part('RAPPORTEUR','197','ECON')],
  consists_of:[event('COMMITTEE_ADOPTING_REPORT','2024-03-20'),event('PLENARY_ENDORSE_COMMITTEE_INTERINSTITUTIONAL_NEGOTIATIONS','2024-04-11'),event('COMMITTEE_APPROVE_PROVISIONAL_AGREEMENT','2026-06-23')],
});
const clock=()=>Date.parse('2026-11-07T09:00:00Z');

function harness(held,{lists={}}={}) {
  const members={257112:{name:'Vlad VASILE-VOICULESCU',groupCode:'Renew'},197:{name:'New RAPPORTEUR',groupCode:'PPE'}};
  const store={
    status:()=>({servingGeneration:7}),
    get:()=>null,
    source:(generation,key)=>held[key]?{work:held[key],fetchedAt:'2026-11-05T10:00:00Z'}:null,
    votingListsForSitting:sitting=>lists[sitting]||[],
    db:{prepare:()=>({get:id=>members[id]?{body:JSON.stringify(members[id])}:undefined,all:()=>[]})},
  };
  const activity=new DossierActivity(store,{reader:{record:async()=>{throw new Error('a fold asks Parliament for nothing');}}});
  const status=new DossierStatus({activity,votes:{snapshot:async()=>{throw new Error('no vote held');}},clock});
  return {store,activity,status,clock,request:async()=>{throw new HttpError(404,'odp_cache_miss','not retained');},pressStore:{mentions:reference=>({items:reference==='2025/2139(INI)'?[{body:{url:'https://www.europarl.europa.eu/news/en/press-room/1/',title:'A title',publishedAt:'2026-09-28T10:00:00Z',lead:' Public health MEPs want more. ',paragraphs:['Public health MEPs want more.','On Monday they adopted a resolution. It asks for a budget.']}}]:[]})}};
}

test('the query takes exact identifiers only, in a stable order',()=>{
  assert.deepEqual(weekItemQuery(new URLSearchParams({procedures:'2025-2139',documents:'B-10-2026-0002,A-10-2026-0261',sittings:'MTG-PL-2026-11-12,MTG-PL-2026-11-11',lang:'fr'})),
    {procedures:['2025-2139'],documents:['A-10-2026-0261','B-10-2026-0002'],sittings:['MTG-PL-2026-11-11','MTG-PL-2026-11-12'],language:'fr'});
  for(const text of ['','procedures=x','procedures=2025-2139,2025-2139','documents=C-10-2025-0174','procedures=2025-2139&sittings=2026-11-11','procedures=2025-2139&extra=1','procedures=2025-2139&procedures=2025-2140','procedures=2025-0001,2025-0002,2025-0003'])
    assert.throws(()=>weekItemQuery(new URLSearchParams(text)),error=>error.status===400,text);
});
test('the committee is the procedure\'s lead; opinion committees are not',()=>{
  assert.deepEqual(leadCommitteeCodes(cancer),['SANT']);
  assert.deepEqual(leadCommitteeCodes(procedure('2025-0001','2025/0001(COD)',{had_participation:[part('RAPPORTEUR_CO','1','ENVI'),part('RAPPORTEUR_CO','2','SANT')]})),['ENVI','SANT']);
  assert.deepEqual(leadCommitteeCodes(null),[]);
});
test('a report found from the procedure is an event\'s own document, newest first, amendment lists left out',()=>{
  const work=procedure('2025-2118','2025/2118(INI)',{consists_of:[
    event('TABLING_PLENARY','2024-03-25',{based_on_a_realization_of:['eli/dl/doc/A-9-2024-0160']}),
    event('TABLING_PLENARY','2026-10-26',{based_on_a_realization_of:['eli/dl/doc/A-10-2026-0280']}),
    event('TABLING_PLENARY','2026-11-04',{based_on_a_realization_of:['eli/dl/doc/A-10-2026-0280-AM-001-002']}),
    event('COMMITTEE_TABLING_REPORT','2026-03-25',{based_on_a_realization_of:['eli/dl/doc/AFCO-PR-779285']}),
  ]});
  assert.deepEqual(tabledReports(work),['A-10-2026-0280','A-9-2024-0160']);
  assert.deepEqual(tabledReports(null),[]);
});
test('the report names its rapporteurs; without them the procedure does, in its latest term and for the lead committee',()=>{
  const report={workHadParticipation:[part('RAPPORTEUR_CO','1','ENVI'),part('RAPPORTEUR_CO','2','SANT'),part('AUTHOR','3','ENVI')]};
  assert.deepEqual(rapporteurIds(report,investors,['ECON']),['1','2']);
  assert.deepEqual(rapporteurIds({},investors,['ECON']),['197'],'an earlier term\'s rapporteur is not named');
  assert.deepEqual(rapporteurIds(null,procedure('2025-0001','2025/0001(COD)',{had_participation:[part('RAPPORTEUR','5','JURI'),part('RAPPORTEUR','6','ECON')]}),['ECON']),['6']);
  assert.deepEqual(rapporteurIds(null,null,[]),[]);
});
test('standing: a non-legislative file has its committee report; a deal also has Parliament\'s earlier position',()=>{
  const indexEvents=[{had_activity_type:'COMMITTEE_ADOPTING_REPORT',activity_date:'2026-09-28',activity_id:'x'}];
  const committees=[{code:'SANT',name:'Committee on Public Health',language:'en'}];
  assert.deepEqual(standingLines({family:'INI',steps:[],stage:'unknown',indexEvents,committees,vote:null}).map(line=>[line.id,line.values.date]),[['dossierstatus.reported','2026-09-28']]);
  assert.deepEqual(standingLines({family:'RSO',steps:[],stage:'unknown',indexEvents:[],committees:[],vote:null}),[]);
  const steps=[{key:'committee',date:'2024-03-20'},{key:'parliament',date:'2024-04-11'},{key:'deal',date:'2026-06-23'}];
  assert.deepEqual(standingLines({family:'COD',steps,stage:'deal',indexEvents:[],committees:[],vote:null}).map(line=>[line.id,line.values.date]),[['dossierstatus.position_talks_no_tally','2024-04-11'],['dossierstatus.deal','2026-06-23']]);
  assert.deepEqual(standingLines({family:'COD',steps,stage:'deal',indexEvents:[],committees:[],vote:{date:'2024-04-11',outcome:'ADOPTED',totals:{for:400,against:100,abstaining:50}}})[0].values.tally,{for:400,against:100,abstaining:50});
});
test('a Council approval states its own date, and a sentence with no date is left out',()=>{
  const steps=[{key:'committee',date:'2024-03-20'}];
  assert.deepEqual(standingLines({family:'COD',steps,stage:'council-approved',indexEvents:[],committees:[],vote:null,councilApproval:{date:'2026-09-01'}}).map(line=>[line.id,line.values.date]),[['dossierstatus.council_approved','2026-09-01']]);
  assert.deepEqual(standingLines({family:'COD',steps,stage:'council-approved',indexEvents:[],committees:[],vote:null}),[]);
});
test('an earlier term\'s rapporteur stays out whatever shape the term is in',()=>{
  const rows=wrap=>procedure('2025-0001','2025/0001(COD)',{had_participation:[{...part('RAPPORTEUR','111','ECON'),parliamentary_term:wrap('org/ep-9')},{...part('RAPPORTEUR','112','ECON'),parliamentary_term:wrap('org/ep-10')}]});
  for(const wrap of [value=>value,value=>[value],value=>({id:value})])assert.deepEqual(rapporteurIds(null,rows(wrap),['ECON']),['112']);
});
test('a release with no lead held gives no text and no link',async()=>{
  const context=harness({'/procedures/2025-2139':cancer});
  context.pressStore={mentions:()=>({items:[{body:{url:'https://www.europarl.europa.eu/news/en/press-room/2/',title:'Title only',publishedAt:'2026-09-28T10:00:00Z'}}]})};
  assert.equal((await weekItem({procedures:['2025-2139'],documents:[],sittings:[],language:'en'},context)).press,null);
});
test('one held item answers without a source read, and what is not held stays absent',async()=>{
  const list={documentId:'A-10-2026-0261',rows:[{kind:'heading'},{kind:'amendment'},{kind:'final'}]};
  const context=harness({'/procedures/2025-2139':cancer,'/plenary-documents/A-10-2026-0261':{workHadParticipation:[part('RAPPORTEUR','257112','SANT')]}},{lists:{'MTG-PL-2026-11-12':[list]}});
  const reply=await weekItem({procedures:['2025-2139'],documents:['A-10-2026-0261'],sittings:['MTG-PL-2026-11-11','MTG-PL-2026-11-12'],language:'en'},context);
  assert.deepEqual(reply.procedures,[{id:'2025-2139',code:'INI'}]);
  assert.deepEqual(reply.rapporteurs,[{id:'257112',name:'Vlad VASILE-VOICULESCU',currentMep:true,group:'Renew'}]);
  assert.equal(reply.standing[0].values.committees[0].code,'SANT');
  assert.equal(reply.standing[0].id,'dossierstatus.reported');
  assert.deepEqual(reply.documents,[{id:'A-10-2026-0261',amendments:null,voteSitting:'MTG-PL-2026-11-12'}]);
  assert.deepEqual(reply.press,{url:'https://www.europarl.europa.eu/news/en/press-room/1/',publishedAt:'2026-09-28T10:00:00Z',lead:'Public health MEPs want more.',second:'On Monday they adopted a resolution.'},'verbatim, by the stories\' rule');
  assert(Buffer.byteLength(JSON.stringify(reply))<2048,'a fold\'s reply stays small');
  const none=await weekItem({procedures:['2026-2952'],documents:[],sittings:[],language:'en'},context);
  assert.deepEqual(none,{version:WEEK_ITEM_VERSION,procedures:[],rapporteurs:[],standing:[],debated:null,documents:[],press:null});
});
