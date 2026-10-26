import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {savedMetadata} from './insights-store.mjs';
import {demographicStats} from './insights-model.mjs';
import {demographicMetadata,demographicObservation,retainDemographicRecord} from './demographic-metadata.mjs';
const at='2026-10-26T09:00:00Z',url=id=>`https://data.europarl.europa.eu/api/v2/meps/${id}?format=application%2Fld%2Bjson`;
function fixture(t) {
 const directory=mkdtempSync('/tmp/ep-demographic-'),store=new ActivityStore(directory,{clock:()=>Date.parse(at)});
 store.acquire();const generation=store.beginCycle().generation;
 store.setMembers(['1','2','3','4','5','6'].map(id=>({id})));
 t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
 return {store,generation,members:new Map(['1','2','3','4','5','6'].map(id=>[id,{id}]))};
}
const record=(id,node)=>({url:url(id),fetchedAt:at,payload:{data:[{id:'person/'+id,identifier:id,...node}]}});
test('bounded background person work recovers demographics without opening a profile, and retains source omissions separately from cold and failed acquisition',async t=>{
 const {store,generation,members}=fixture(t),calls=[];
 const worker=new ActivityWorker(store,{clock:()=>Date.parse(at),fetchRecord:async endpoint=>{
  calls.push(endpoint);const id=endpoint.split('/').at(-1);
  if(id==='3')throw Error('offline');
  return record(id,id==='1'?{bday:'1961-01-04',hasGender:'authority/FEMALE',hasMembership:[]}:id==='4'?{bday:'2020-02-30',hasMembership:[]}:{hasGender:'authority/MALE',hasMembership:[]});
 }});worker.readCachedMepRecord=async()=>null;
 for(const id of ['1','2','3','4']) {
  store.enqueue(generation,'group-history:'+id,'group-history-person',{id});
  await worker.task(store.nextTask(generation));
 }
 assert.deepEqual(calls,['/meps/1','/meps/2','/meps/3','/meps/4']);
 assert.equal(store.get('working').groupHistoryRefetches,4);
 // No raw-cache directory or profile HTTP handler participates in these reads.
 const metadata=await savedMetadata({directory:null,members,store});
 const status=id=>metadata.get(id).demographicProvenance.bday.status;
 assert.equal(status('1'),'available');assert.equal(status('2'),'source_omission');
 assert.equal(status('3'),'fetch_failed');assert.equal(status('4'),'invalid');assert.equal(status('5'),'missing_acquisition');
 const evidence=metadata.get('1').demographicProvenance;
 assert.deepEqual(evidence.bday.sources,[{url:url('1'),retrievedAt:at,language:null,field:'bday',values:['1961-01-04']}]);
 assert.equal(evidence.hasGender.sources[0].values[0],'authority/FEMALE');
 assert.equal(metadata.get('2').demographicProvenance.bday.sources[0].url,url('2'));
 // A failed refresh keeps the successful birthday and its original provenance.
 worker.fetchRecord=async()=>{throw Error('offline');};await assert.rejects(worker.request('/meps/1'));
 const retained=await savedMetadata({directory:null,members,store});
 assert.equal(retained.get('1').bday,'1961-01-04');assert.equal(retained.get('1').demographicProvenance.bday.lastAttempt.status,'fetch_failed');
 // Observations survive publication, copying and pruning of the acquisition generation.
 store.publish(generation);const next=store.beginCycle().generation;store.publish(next);const third=store.beginCycle().generation;store.publish(third);
 assert.equal((await savedMetadata({directory:null,members,store})).get('1').bday,'1961-01-04');
});
test('field-level conflicts and invalid dates remain unavailable; later same-source corrections replace omissions',async t=>{
 const {store,generation,members}=fixture(t);
 retainDemographicRecord(store,generation,'1',record('1',{bday:'1980-01-01'}));
 retainDemographicRecord(store,generation,'1',record('1',{bday:'1981-01-01','api:country-of-representation':'HU',hasGender:'authority/FEMALE'}),{kind:'roster'});
 retainDemographicRecord(store,generation,'2',record('2',{bday:['1980-01-01','1981-01-01']}));
 retainDemographicRecord(store,generation,'3',record('3',{bday:'2030-01-01'}));
 const metadata=await savedMetadata({directory:null,members,store}),stats=demographicStats(['1','1','2','3','99'],members,metadata,'2026-10-26');
 assert.equal(metadata.get('1').bday,undefined);assert.equal(metadata.get('1')['api:country-of-representation'],'HU');
 assert.equal(metadata.get('1').demographicProvenance.bday.status,'conflict');assert.equal(metadata.get('2').demographicProvenance.bday.status,'conflict');
 assert.equal(stats.demographicEvidence['3'].bday.status,'invalid');assert.equal(stats.denominator,3);
 for(const rows of Object.values(stats.dimensions))assert.equal(rows.reduce((n,row)=>n+row.count,0),3);
 assert.equal(stats.demographicEvidence['99'],undefined);
 retainDemographicRecord(store,generation,'4',record('4',{}));retainDemographicRecord(store,generation,'4',record('4',{bday:'1990-02-01'}));
 assert.equal((await savedMetadata({directory:null,members,store})).get('4').bday,'1990-02-01');
 assert.throws(()=>retainDemographicRecord(store,generation,'5',record('5',{identifier:'6'})),/exact/);
});
test('cached person acquisition persists demographics even when group memberships are malformed; no birthday guessed from another person',async t=>{
 const {store,generation,members}=fixture(t),worker=new ActivityWorker(store);
 worker.readCachedMepRecord=async id=>record(id,{bday:'1990-01-01'});
 store.enqueue(generation,'group-history:1','group-history-person',{id:'1'});await worker.task(store.nextTask(generation));
 assert.equal((await savedMetadata({directory:null,members,store})).get('1').bday,'1990-01-01');assert.equal(worker.requests,0);
 const source=demographicObservation({identifier:'1',bday:'2020-02-30'},{id:'1',url:url('1'),retrievedAt:at});
 assert.equal(demographicMetadata('1',[source]).demographicProvenance.bday.status,'invalid');
});

test('verified public Gosiewska, Petrov and Bossdorf records omit birthdays while supplying gender',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/demographic-omissions.json',import.meta.url)));
 for(const record of fixture.records) {
  const person=record.payload.data[0],id=person.identifier;
  assert.equal(Object.hasOwn(person,'bday'),false);
  const metadata=demographicMetadata(id,[demographicObservation(person,{id,url:record.url,retrievedAt:record.fetchedAt})]);
  assert.equal(metadata.demographicProvenance.bday.status,'source_omission');
  assert.equal(metadata.demographicProvenance.hasGender.status,'available');
  assert.equal(metadata.demographicProvenance.bday.sources[0].url,record.url);
 }
});

 test('roster failures belong to representation fields, and profile failures never masquerade as roster failures',async t=>{
  const {store,members}=fixture(t),worker=new ActivityWorker(store,{fetchRecord:async()=>{throw Error('offline');}});
  await assert.rejects(worker.request('/meps/1'));
  let metadata=await savedMetadata({directory:null,members,store});
  assert.equal(metadata.get('1').demographicProvenance.bday.status,'fetch_failed');
  assert.equal(metadata.get('1').demographicProvenance['api:country-of-representation'].status,'missing_acquisition');
  await assert.rejects(worker.request('/meps/show-current',{limit:1000,offset:0}));
  metadata=await savedMetadata({directory:null,members,store});
  assert.equal(metadata.get('1').demographicProvenance['api:country-of-representation'].status,'fetch_failed');
  assert.match(metadata.get('1').demographicProvenance['api:country-of-representation'].lastAttempt.url,/show-current/);
 });

test('older raw-cache observations cannot overwrite newer retained fields or erase a later fetch failure',async t=>{
 const {store,generation,members}=fixture(t);
 retainDemographicRecord(store,generation,'1',record('1',{bday:'1980-01-01'}));
 const worker=new ActivityWorker(store,{fetchRecord:async()=>{throw Error('offline');}});await assert.rejects(worker.request('/meps/1'));
 const older={...record('1',{bday:'1990-01-01'}),fetchedAt:'2026-10-20T09:00:00Z'};
 retainDemographicRecord(store,generation,'1',older);
 retainDemographicRecord(store,generation,'1',record('1',{bday:'1980-01-01'}));
 const metadata=(await savedMetadata({directory:null,members,store})).get('1');
 assert.equal(metadata.bday,'1980-01-01');assert.equal(metadata.demographicProvenance.bday.lastAttempt.status,'fetch_failed');
});

test('new roster reads do not hide the retrieval date of older birthday and gender evidence',async t=>{
 const {store,generation,members}=fixture(t),profileAt='2026-10-20T09:00:00Z';
 retainDemographicRecord(store,generation,'1',{...record('1',{bday:'1980-01-01',hasGender:'authority/FEMALE'}),fetchedAt:profileAt});
 retainDemographicRecord(store,generation,'1',record('1',{'api:country-of-representation':'HU'}),{kind:'roster'});
 const metadata=await savedMetadata({directory:null,members,store});
 assert.deepEqual(demographicStats(['1'],members,metadata,'2026-10-26').metadataSourceDates,{from:profileAt,to:at});
 assert.equal(metadata.get('1').demographicProvenance.bday.sources.find(source=>source.values.length).retrievedAt,profileAt);
});
