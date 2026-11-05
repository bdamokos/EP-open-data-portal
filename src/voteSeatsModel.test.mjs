import test from 'node:test';
import assert from 'node:assert/strict';
import {seatBallots,positionTotals,unseatedDotTotals,differingVoterIds,countryGroupBreakdown,encodeMatrixSort,decodeMatrixSort} from './voteSeatsModel.mjs';
import {differentFromMajority} from './voteGroupMetrics.mjs';

const seat=(number,member)=>({seat:number,x:number*10,y:10,r:5,member});
const seats=[seat(1,101),seat(2,102),seat(3,103),seat(4,104)];

test('recorded positions join to seats by exact person ID only',()=>{
  const voters=[{id:'101',position:'for'},{id:'104',position:'against'}];
  const {bySeat,unseated}=seatBallots(voters,seats);
  assert.deepEqual([...bySeat.entries()].map(([key,value])=>[key,value.position]),[[1,'for'],[4,'against']]);
  assert.deepEqual(unseated,[]);
  // A padded or unknown ID never claims a seat.
  const {bySeat:missing}=seatBallots([{id:'103 ',position:'for'},{id:'999',position:'for'}],seats);
  assert.equal(missing.size,0);
});

test('voters without a seat stay out of the chart and their dots keep the totals',()=>{
  const voters=[{id:'101',position:'for'},{id:'102',position:'for'},{id:'333',position:'against'},{id:'334',position:'against'},{id:'335',position:'abstaining'},{id:'103',position:'against'}];
  const {bySeat}=seatBallots(voters,seats);
  assert.equal(bySeat.size,3);
  assert.deepEqual(unseatedDotTotals(voters,seats),{for:0,against:2,abstaining:1});
  const totals=positionTotals(voters),drawn={for:0,against:0,abstaining:0};
  for(const value of bySeat.values())drawn[value.position]++;
  const dots=unseatedDotTotals(voters,seats);
  assert.deepEqual({for:drawn.for+dots.for,against:drawn.against+dots.against,abstaining:drawn.abstaining+dots.abstaining},totals,'drawn marks add up to the recorded votes');
});

test('differing voter IDs follow the delegation rule and match differentFromMajority',()=>{
  const rows=[];
  for(let i=0;i<6;i++)rows.push({id:'a'+i,group:'PPE',position:i<4?'for':'against'});
  for(let i=0;i<3;i++)rows.push({id:'b'+i,group:'S&D',position:'for'});
  for(let i=0;i<2;i++)rows.push({id:'n'+i,group:'NI',position:'against'});
  rows.push({id:'x1',group:'Greens',position:'for'},{id:'x2',group:'Greens',position:'against'});
  const people=rows.filter(row=>row.id);
  const ids=differingVoterIds(people);
  assert.equal(ids.size,differentFromMajority(people));
  assert.deepEqual([...ids].sort(),['a4','a5'],'only voters outside their group majority differ');
});

test('country aggregation keeps empty cells distinct from zero and normalises Greece',()=>{
  const rows=[
    {group:'PPE',country:'ES',position:'for'},
    {group:'PPE',country:'ES',position:'for'},
    {group:'S&D',country:'ES',position:'against'},
    {group:'PPE',country:'GR',position:'for'},
    {group:'S&D',country:'DE',position:'abstaining'},
    {group:'PPE',country:'DE',position:'for'},
  ];
  const breakdown=countryGroupBreakdown(rows),byCountry=new Map(breakdown.map(row=>[row.country,row]));
  const es=byCountry.get('ES'),el=byCountry.get('EL');
  assert.ok(es&&el,'Greece uses the EU identifier EL');
  assert.deepEqual(es.counts,{for:2,against:1,abstaining:0});
  assert.deepEqual(es.cells.get('PPE'),{position:'for',count:2,tied:null});
  assert.deepEqual(es.cells.get('S&D'),{position:'against',count:1,tied:null});
  const tie=countryGroupBreakdown([{group:'PPE',country:'FR',position:'for'},{group:'PPE',country:'FR',position:'against'}])[0];
  assert.deepEqual(tie.cells.get('PPE'),{position:null,count:1,tied:['for','against']},'a tied most common position keeps its tied counts');
  // A group with no ballots from a country has no cell there, never 0.
  assert.ok(!es.cells.has('ZZZ'));
});

test('matrix sort state round-trips through a single URL value and refuses malformed input',()=>{
  assert.equal(encodeMatrixSort({kind:'country',dir:'asc'}),'');
  assert.equal(encodeMatrixSort({kind:'country',dir:'desc'}),'country:desc');
  assert.equal(encodeMatrixSort({kind:'group',key:'S&D',dir:'desc'}),'group:S&D');
  assert.equal(encodeMatrixSort({kind:'group',key:'S&D',dir:'asc'}),'group:S&D:asc');
  assert.deepEqual(decodeMatrixSort(''),{kind:'country',dir:'asc'});
  assert.deepEqual(decodeMatrixSort('country:desc'),{kind:'country',dir:'desc'});
  assert.deepEqual(decodeMatrixSort('group:S&D'),{kind:'group',key:'S&D',dir:'desc'});
  assert.deepEqual(decodeMatrixSort('group:S&D:asc'),{kind:'group',key:'S&D',dir:'asc'});
  assert.equal(decodeMatrixSort('country'),null);
  assert.equal(decodeMatrixSort('group:'),null);
  assert.equal(decodeMatrixSort('country:sideways'),null);
  assert.equal(decodeMatrixSort('seat:1'),null);
});
