import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractVoteChairs,collectVoteChairs} from './vote-chairs.mjs';

const date='2026-10-22',sitting='MTG-PL-'+date;
const chair=(id,name,n)=>({id:'eli/dl/event/'+sitting+'-PVCRE-CHA-'+n,activity_id:sitting+'-PVCRE-CHA-'+n,activity_date:date,had_activity_type:'def/ep-activities/MEETING_NAME_CHAIR',had_participation:{had_participant_person:['person/'+id]},recorded_in_a_realization_of:[{'api:xmlFragment':{en:`<communication><heading>IN THE CHAIR: <person refersTo="epdata:person/${id}">${name}</person></heading><subheading>Vice-President</subheading></communication>`}}]});
const chairs=[chair('118859','ROBERTA METSOLA',1),chair('197433','KATARINA BARLEY',2)];
const payload=(rows=chairs)=>({data:structuredClone(rows),meta:{total:rows.length},searchResults:{hits:rows.map(row=>({id:row.id}))}});
const change=name=>`<Orator.ChangeOfPresident.Text>IN THE CHAIR: ${name}<break/>Vice-President</Orator.ChangeOfPresident.Text>`;
const vote=n=>`<PV.Vote.Text><Pv.Reference.Text Pv.AnnexVote="${n}">Results of votes</Pv.Reference.Text></PV.Vote.Text>`;
const xml=body=>`<PV Sitting.Date="${date}" Document.Language="EN">${body}</PV>`;
const key=n=>'PV-10-'+date+'-VOT-ITM-'+String(n).padStart(3,'0');

test('exact minutes vote-result references select the presiding member rather than everyone chairing that day',()=>{
  const body=change('Roberta METSOLA')+'<PV.Other.Text>Award ceremony</PV.Other.Text>'+change('Katarina BARLEY')+vote(6);
  assert.deepEqual(extractVoteChairs(xml(body),payload(),date),{[key(6)]:'197433'});
  assert.deepEqual(extractVoteChairs(xml(change('Roberta METSOLA')+vote(1)+change('Katarina BARLEY')+vote(6)),payload(),date),{[key(1)]:'118859',[key(6)]:'197433'});
});

test('chair identities require complete same-day API records and exact structured person matches',()=>{
  const body=xml(change('Katarina BARLEY')+vote(1));
  for(const mutate of [p=>p.meta.total++,p=>p.searchResults.hits.pop(),p=>p.data[1].activity_date='2026-10-21',p=>p.data[1].id='eli/dl/event/OTHER',p=>p.data[1].had_participation.had_participant_person=['person/999'],p=>p.data.push(p.data[0])]){
    const p=payload();mutate(p);assert.equal(extractVoteChairs(body,p,date),null);
  }
  const ambiguous=payload([...chairs,chair('999','KATARINA BARLEY',3)]);
  assert.equal(extractVoteChairs(body,ambiguous,date),null);
  assert.deepEqual(extractVoteChairs(xml(change('Katarina BARLY')+vote(1)),payload(),date),{});
});

test('unknown or internal chair handovers never inherit a previous chair or suppress an ambiguous voting block',()=>{
  assert.deepEqual(extractVoteChairs(xml(change('Roberta METSOLA')+change('Unknown Chair')+vote(1)),payload(),date),{});
  const block='<PV.Vote.Text><Pv.Reference.Text Pv.AnnexVote="1"/>'+change('Katarina BARLEY')+'<Pv.Reference.Text Pv.AnnexVote="2"/></PV.Vote.Text>';
  assert.deepEqual(extractVoteChairs(xml(change('Roberta METSOLA')+block+vote(3)),payload(),date),{[key(3)]:'197433'});
  assert.deepEqual(extractVoteChairs(xml(change('Roberta METSOLA')+vote(1)+change('Katarina BARLEY')+vote(1)),payload(),date),{});
});

test('only numbered voting-result references in valid English same-day minutes establish scope',()=>{
  assert.deepEqual(extractVoteChairs(xml(change('Katarina BARLEY')+'<PV.Other.Text><Pv.Reference.Text Pv.AnnexVote="1"/></PV.Other.Text>'+vote('invalid')),payload(),date),{});
  for(const body of ['<PV/>',xml(vote(1)).replace(date,'2026-10-21'),xml(vote(1)).replace('Language="EN"','Language="FR"'),'<PV', '<!DOCTYPE PV [<!ENTITY x "text">]>'+xml(vote(1))])assert.equal(extractVoteChairs(body,payload(),date),null);
  const official='<!DOCTYPE PV SYSTEM "http://www.pv.ep.parl.union.eu/pv1/dtd/PV.dtd">'+xml(change('Katarina BARLEY')+vote(1));
  assert.deepEqual(extractVoteChairs(official,payload(),date),{[key(1)]:'197433'});
});

const url='https://data.europarl.europa.eu/distribution/doc/PV-10-'+date+'_en.xml';
const metadata=()=>({data:[{id:'eli/dl/doc/PV-10-'+date,document_date:date,is_realized_by:[{id:'eli/dl/doc/PV-10-'+date+'/en',is_embodied_by:[{id:'eli/dl/doc/PV-10-'+date+'/en/xml',is_exemplified_by:url}]}]}]});
const record=(body,url)=>({url,fetchedAt:Date.parse('2026-10-31T10:00:00Z'),payload:body});
test('bounded official-source collection retains metadata, chair identity and XML provenance',async()=>{
  const calls=[];const result=await collectVoteChairs(async(endpoint,params)=>{calls.push([endpoint,params]);return record(endpoint==='/speeches'?payload():metadata(),'https://data.europarl.europa.eu/api/v2'+endpoint);},sitting,{download:async chosen=>{assert.equal(chosen,url);return xml(change('Katarina BARLEY')+vote(1));},clock:()=>Date.parse('2026-10-31T10:00:00Z')});
  assert.equal(result.status,'observed');assert.deepEqual(result.byResultDocument,{[key(1)]:'197433'});assert.equal(result.sources.length,3);assert(result.sources.every(s=>s.contentHash.length===64));assert.equal(result.sources[2].fetchedAt,'2026-10-31T10:00:00.000Z');
  assert.equal(calls[1][1]['activity-type'],'MEETING_NAME_CHAIR');assert.equal(calls[1][1].limit,100);
});

test('unavailable or unsafe optional chair sources withhold the heuristic',async()=>{
  for(const target of ['https://example.invalid/x.xml','http://data.europarl.europa.eu/distribution/x.xml',url+'?token=x','https://user@data.europarl.europa.eu/distribution/x.xml']){
    const p=metadata();p.data[0].is_realized_by[0].is_embodied_by[0].is_exemplified_by=target;
    const result=await collectVoteChairs(async()=>record(p,'https://data.europarl.europa.eu/api/v2/source'),sitting,{download:async()=>{assert.fail('unsafe metadata must never start a download');}});assert.equal(result.status,'unavailable');
  }
  assert.equal((await collectVoteChairs(async()=>{throw Error('Unavailable');},sitting)).status,'unavailable');
});
