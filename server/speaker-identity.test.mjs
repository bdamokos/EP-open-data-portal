import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileAsync} from './test-support/subprocess.mjs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {SpeakerIdentities,personNameVariants,parliamentOffice} from './speaker-identity.mjs';
import {speechSpeakerDetails} from './speech-speakers.mjs';
import {SpeechInterventions} from './speech-intervention-service.mjs';
import {runWithRequestSignal} from './request-budget.mjs';
import {apiCachePolicy} from './response-cache.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/speaker-names-20261017.json',import.meta.url)));
const [greek,bulgarian,chair]=fixture.examples.map(example=>example.person);
const day='2026-10-06',speechId='MTG-PL-2026-10-06-OTH-1',parentId='MTG-PL-2026-10-06-PVCRE-ITM-1';
const record=data=>({url:'https://data.europarl.europa.eu/api/v2/meps',fetchedAt:Date.parse('2026-10-17T07:00:00Z'),payload:{data}});
const fragment=(id,name,role='')=>`<oralStatements><speech xml:lang="ro-t-en-mtec"><from><person refersTo="epdata:person/${id}">${name}</person>${role?`<role>${role}</role>`:''}</from><p>Public fixture text.</p></speech></oralStatements>`;
const activity=(id,name)=>({id:'eli/dl/event/'+speechId,activity_id:speechId,activity_date:day,had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/'+id]}],inverse_consists_of:['eli/dl/event/'+parentId],recorded_in_a_realization_of:[{numbering:1,'api:xmlFragment':{en:fragment(id,name)}}]});

test('sampled public person records retain supplied Latin, Greek and Cyrillic forms',()=>{
  assert.deepEqual(personNameVariants(greek).map(v=>[v.value,v.script]),[['Geadis Geadi','Latn'],['Γεάδης Γεάδη','Grek']]);
  assert.deepEqual(personNameVariants(bulgarian).map(v=>[v.value,v.script]),[['Kristian Vigenin','Latn'],['Кристиан Вигенин','Cyrl']]);
  assert.equal(personNameVariants(greek).some(v=>v.script==='Cyrl'),false);
});

test('Parliament offices apply only within dated exact institutional memberships',()=>{
  assert.equal(parliamentOffice(chair,day).code,'vice-president-parliament');
  assert.equal(parliamentOffice(chair,'2024-07-15'),null);
  for(const change of [
    {organization:'org/committee'}, {organization:'org/7028'},
    {membershipClassification:'def/ep-entities/COMMITTEE_PARLIAMENTARY_STANDING'},
    {role:'def/ep-roles/CHAIR_VICE'}, {memberDuring:{startDate:'2024-07-16',endDate:'2026-10-05'}}
  ])assert.equal(parliamentOffice({...chair,hasMembership:chair.hasMembership.map(m=>({...m,...change}))},day),null);
  const conflict={...chair.hasMembership[0],role:'def/ep-roles/PRESIDENT'};
  assert.equal(parliamentOffice({...chair,hasMembership:[...chair.hasMembership,conflict]},day),null);
});

test('header variants require the exact participant and never turn a role into a name',()=>{
  const row=activity(chair.identifier,'Președinte');
  row.recorded_in_a_realization_of[0]['api:xmlFragment'].ro=fragment(chair.identifier,'Președinte');
  const [person]=speechSpeakerDetails(row);
  assert.equal(person.sittingRole,'chair');assert.deepEqual(person.nameVariants,[]);
  row.had_participation=[{had_participant_person:['person/999']}];
  assert.deepEqual(speechSpeakerDetails(row),[]);
});

test('shared roster names and bounded exact chair profiles resolve without per-speaker fan-out',async()=>{
  const calls=[];
  const resolver=new SpeakerIdentities({request:async(route)=>{calls.push(route);return record(route==='/meps/show-current'?[greek,bulgarian,chair]:[chair]);}});
  const result=await resolver.enrich([{id:greek.identifier,name:'Γεάδης Γεάδη'},{id:bulgarian.identifier,name:'Кристиан Вигенин'},{id:chair.identifier,name:'Președinte'}],day,{chairs:[chair.identifier]});
  assert.deepEqual(calls,['/meps/show-current','/meps/58766']);
  assert.equal(result[0].name,'Geadis Geadi');assert.equal(result[1].name,'Kristian Vigenin');
  assert.equal(result[2].name,'Nicolae Ștefănuță');assert.equal(result[2].office.code,'vice-president-parliament');
  assert(result[2].identitySources.every(source=>source.url&&source.fetchedAt));
  const missing=await new SpeakerIdentities({request:async()=>{throw new Error('Unavailable');}}).enrich([{id:'58766',name:'Președinte'}],day,{chairs:['58766']});
  assert.equal(missing[0].name,'');assert.equal(missing[0].office,null);assert(missing[0].identityIssues.length);
});

test('a mismatched profile cannot provide the name or office of a chair',async()=>{
  const resolver=new SpeakerIdentities({request:async()=>record([greek])});
  const [result]=await resolver.enrich([{id:'58766',name:'Președinte'}],day,{chairs:['58766']});
  assert.equal(result.name,'');assert.equal(result.office,null);
});

test('failed individual profiles mark only the affected identities while successful missing-office observations remain explicit',async()=>{
  let failing=true;
  const calls=[];
  const resolver=new SpeakerIdentities({request:async(route)=>{
    calls.push(route);
    if(route==='/meps/show-current')return record([greek]);
    if(failing)throw new Error('Public profile temporarily unavailable');
    return record(route==='/meps/'+chair.identifier?[{...chair,hasMembership:[]}]:[{id:'person/43',identifier:'43',givenName:'Public',familyName:'Person'}]);
  }});
  const people=[{id:greek.identifier,name:'Γεάδης Γεάδη'},{id:chair.identifier,name:'Nicolae Ștefănuță'},{id:'43',name:'Public Person'}];
  const read=()=>resolver.enrich(people,day,{chairs:[chair.identifier],profileIds:['43']});
  const failed=await read();
  assert.deepEqual(calls,['/meps/show-current','/meps/'+chair.identifier,'/meps/43']);
  assert.deepEqual(failed[0].identityIssues,[]);
  assert.deepEqual(failed[1].identityIssues,['person-profile-unavailable','parliament-office-unavailable']);
  assert.deepEqual(failed[2].identityIssues,['person-profile-unavailable']);
  assert.equal(failed[1].name,people[1].name);
  assert.equal(failed[2].name,people[2].name);

  failing=false;
  const recovered=await read();
  assert.deepEqual(recovered[0].identityIssues,[]);
  assert.deepEqual(recovered[1].identityIssues,['parliament-office-unavailable']);
  assert.equal(recovered[1].office,null);
  assert.deepEqual(recovered[2].identityIssues,[]);
});

test('an aborted identity budget marks skipped bounded profiles as temporary failures',async()=>{
  const people=Array.from({length:10},(_,i)=>({id:String(i+1),name:'Public Speaker '+(i+1)}));
  for(const kind of ['chairs','profileIds']) {
    const controller=new AbortController(),calls=[],pending=[];
    const identities=new SpeakerIdentities({request:async route=>{
      calls.push(route);
      if(route==='/meps/show-current')return record([]);
      return new Promise(resolve=>pending.push(resolve));
    }});
    const job=runWithRequestSignal(controller.signal,()=>identities.enrich(people,day,{[kind]:people.map(person=>person.id)}));
    for(let turn=0;turn<10&&pending.length<2;turn++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(pending.length,2,'only the first bounded batch starts');
    controller.abort(new Error('Synthetic identity budget elapsed'));
    const result=await job;
    for(const finish of pending)finish(record([]));
    assert.deepEqual(calls,['/meps/show-current','/meps/1','/meps/2']);
    for(const person of result.slice(0,8))assert(person.identityIssues.includes('person-profile-unavailable'),person.id+' must retain its temporary lookup failure');
    for(const person of result.slice(8))assert(!person.identityIssues.includes('person-profile-unavailable'),'the explicit profile cap remains a coverage limit');
    const skipped=result[2];
    assert.equal(skipped.name,people[2].name);
    for(const [route,payload] of [
      ['/api/speech/test',{date:'2026-09-01',xml:'<speech>Retained text</speech>',speakers:[skipped]}],
      ['/api/speech-context/test',{debates:[{speaker:skipped}]}],
    ])assert.equal(apiCachePolicy({method:'GET',headers:{}},new URL(route,'https://example.test'),payload).cdnCacheControl,'no-store');
  }
});

test('an established speech retains expired empty ODP profile evidence during refresh and after its failure',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'identity-profile-freshness-'));
  const id='MTG-PL-2026-09-01-OTH-1',now=Date.now();
  const url=(endpoint,params={})=>{
    const value=new URL('https://data.europarl.europa.eu/api/v2'+endpoint);
    for(const [key,item]of Object.entries({...params,format:'application/ld+json'}))value.searchParams.set(key,item);
    return value.href;
  };
  const profileUrl=url('/meps/43');
  const profile={url:profileUrl,fetchedAt:now-8*86400000,payload:{data:[]}};
  const speech={id:'eli/dl/event/'+id,activity_id:id,activity_date:'2026-09-01',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/43']}],recorded_in_a_realization_of:[{'api:xmlFragment':{en:fragment('43','President')}}]};
  const records=[
    profile,
    {url:url('/meps/show-current',{limit:1000,offset:0}),fetchedAt:now,payload:{data:[{id:'person/44',identifier:'44',givenName:'Current',familyName:'Member'}]}},
    {url:url('/speeches/'+id,{'include-output':'xml_fragment'}),fetchedAt:now,payload:{data:[speech]}},
  ];
  const filename=value=>path.join(directory,createHash('sha256').update(value).digest('hex')+'.json');
  try {
    for(const record of records)await writeFile(filename(record.url),JSON.stringify(record));
    const script=`
      import assert from 'node:assert/strict';
      let requests=0,finish,started;const refreshStarted=new Promise(resolve=>started=resolve);
      globalThis.fetch=async value=>{
        assert.equal(String(value),${JSON.stringify(profileUrl)},'Only the retained profile may refresh');
        requests++;started();
        return new Promise(resolve=>{finish=()=>resolve(new Response('{}',{status:500,headers:{'content-type':'application/json'}}));});
      };
      const {odpSpeech}=await import(${JSON.stringify(new URL('./odp.mjs',import.meta.url).href)});
      const {apiCachePolicy}=await import(${JSON.stringify(new URL('./response-cache.mjs',import.meta.url).href)});
      const readPolicy=value=>apiCachePolicy({method:'GET',headers:{}},new URL('https://example.test/api/speech/'+${JSON.stringify(id)}),value);
      const during=await odpSpeech(${JSON.stringify(id)},'en');
      const duringPolicy=readPolicy(during);
      await refreshStarted;
      assert.equal(typeof finish,'function');
      finish();
      let after;const deadline=performance.now()+110_000;
      do {
        after=await odpSpeech(${JSON.stringify(id)},'en');
        if(after.speakers[0].identitySources.find(source=>source.url===${JSON.stringify(profileUrl)}).refreshError)break;
        await new Promise(resolve=>setImmediate(resolve));
      }while(performance.now()<deadline);
      console.log(JSON.stringify({during,after,duringPolicy,afterPolicy:readPolicy(after),requests}));
    `;
    const out=JSON.parse((await execFileAsync(t,process.execPath,['--input-type=module','-e',script],{env:{...process.env,ODP_CACHE_DIR:directory},encoding:'utf8'})).stdout);
    assert.equal(out.requests,1);
    for(const [value,policy]of [[out.during,out.duringPolicy],[out.after,out.afterPolicy]]){
      const identity=value.speakers.find(person=>person.id==='43');
      assert.equal(identity.name,'');
      assert.equal(identity.sittingRole,'chair');
      assert.equal(identity.office,null);
      assert.deepEqual(identity.identityIssues,['parliament-office-unavailable']);
      const source=identity.identitySources.find(source=>source.url===profileUrl);
      assert(source,'Expired empty profile remains explicit in the real speech payload');
      assert.equal(source.fetchedAt,new Date(profile.fetchedAt).toISOString());
      assert.equal(source.stale,true);
      assert.deepEqual(policy,{cacheControl:'no-store',cdnCacheControl:'no-store'});
    }
    assert.equal(out.during.speakers[0].identitySources.find(source=>source.url===profileUrl).refreshInProgress,true);
    assert.match(out.after.speakers[0].identitySources.find(source=>source.url===profileUrl).refreshError,/500/);
    assert.deepEqual(JSON.parse(await readFile(filename(profileUrl),'utf8')),profile,'Failed refresh preserves the retained source fixture');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('context enrichment keeps each contribution role and leaves exchange classification intact',async()=>{
  const first=activity('58766','Președinte'),second=activity('58766','Nicolae Ștefănuță');second.activity_id=speechId+'2';second.id='eli/dl/event/'+second.activity_id;second.recorded_in_a_realization_of[0].numbering=2;
  const request=async(route)=>route.startsWith('/events/')?record([{activity_id:parentId,consists_of:[first.id,second.id]}]):route==='/speeches'?{...record([first,second]),payload:{data:[first,second],meta:{total:2}}}:record([first]);
  const identities=new SpeakerIdentities({request:async(route)=>record(route==='/meps/show-current'?[]:[chair])});
  const context=await new SpeechInterventions({request,identities}).context(speechId);
  const [a,b]=context.debates[0].records;
  assert.equal(a.intervention.type,'chair');assert.equal(a.intervention.speaker.office.code,'vice-president-parliament');
  assert.equal(b.intervention.type,'speech');assert.equal(b.intervention.speaker.sittingRole,undefined);assert.equal(b.intervention.speaker.office,undefined);
  assert.equal(b.intervention.speaker.roleLabels.en,undefined,'the substantive speech never inherits a role from another turn');
  assert.equal(context.debates[0].coverage.complete,true);
});

test('failed identity lookups retain each supplied name and chair heading role when the final turn is only President',async()=>{
  const substantive=activity('58766','Nicolae Ștefănuță');
  const heading=activity('58766','ignored');heading.had_activity_type='def/ep-activities/MEETING_NAME_CHAIR';
  heading.recorded_in_a_realization_of[0]['api:xmlFragment'].en='<communication><heading><person refersTo="epdata:person/58766">Nicolae ŞTEFĂNUŢĂ</person></heading><subheading>Vice-President</subheading></communication>';
  const closing=activity('58766','President'),rows=[substantive,heading,closing];
  rows.forEach((row,index)=>{row.activity_id=speechId+index;row.id='eli/dl/event/'+row.activity_id;row.recorded_in_a_realization_of[0].numbering=index+1;});
  const request=async(route)=>route.startsWith('/events/')?record([{activity_id:parentId,consists_of:rows.map(row=>row.id)}]):route==='/speeches'?{...record(rows),payload:{data:rows,meta:{total:rows.length}}}:record([substantive]);
  const identities=new SpeakerIdentities({request:async()=>{throw new Error('Public identity source unavailable');}});
  const result=await new SpeechInterventions({request,identities}).context(substantive.activity_id);
  const [speech,change,chairing]=result.debates[0].records;
  assert.equal(result.intervention.speaker.name,'Nicolae Ștefănuță');
  assert.equal(speech.intervention.speaker.name,'Nicolae Ștefănuță');
  assert.equal(speech.intervention.speaker.sittingRole,undefined);
  assert.equal(change.intervention.chair.name,'Nicolae ŞTEFĂNUŢĂ');
  assert.equal(change.intervention.chair.role,'Vice-President');
  assert.equal(change.intervention.chair.office,null);
  assert.equal(chairing.intervention.speaker.name,'Nicolae Ștefănuță','a verified same-ID name remains usable for a role-only turn');
  assert.equal(chairing.intervention.type,'chair');
});
