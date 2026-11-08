import test from 'node:test';
import assert from 'node:assert/strict';
import {differingVoterIds,countryTallies,orderCountries,sideTurn,countrySide,winningShare,decodeCountryOrder,encodeCountryOrder} from './voteSeatsModel.mjs';
import {differentFromMajority} from './voteGroupMetrics.mjs';

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

const ballot=(country,group,position,count)=>Array.from({length:count},()=>({country,group,position}));
test('country tallies count every ballot, normalise Greece and leave countries without ballots out',()=>{
  const rows=[...ballot('ES','PPE','for',2),...ballot('ES','S&D','against',1),...ballot('GR','PPE','abstaining',7),...ballot('DE','unavailable','for',1),...ballot(null,'PPE','for',4),{country:'FR',group:'PPE',position:null}];
  const byCountry=new Map(countryTallies(rows).map(row=>[row.country,row]));
  assert.deepEqual([...byCountry.keys()].sort(),['DE','EL','ES'],'no country without a ballot, and no row for an unknown country');
  assert.deepEqual(byCountry.get('ES'),{country:'ES',counts:{for:2,against:1,abstaining:0},ballots:3},'zero stays a counted zero');
  assert.deepEqual(byCountry.get('EL').counts,{for:0,against:0,abstaining:7},'Greece uses the EU identifier EL');
  assert.equal(byCountry.get('DE').ballots,1,'a ballot without a known group still counts for its country');
  assert.deepEqual(countryTallies([]),[]);
});
const tally=(country,f,a,x)=>({country,counts:{for:f,against:a,abstaining:x},ballots:f+a+x});
const names={AT:'Austria',BE:'Belgium',CZ:'Czechia',DE:'Germany',EL:'Greece',IE:'Ireland',LU:'Luxembourg',MT:'Malta',SK:'Slovakia'};
const nameOf=code=>names[code];
// From DEC-198357 (adopted 434 to 203) plus two made-up edge rows: a 1–1 split and an abstain-only delegation.
const sample=[tally('AT',12,6,0),tally('BE',15,3,4),tally('CZ',5,15,0),tally('EL',10,3,7),tally('IE',9,0,1),tally('LU',5,0,0),tally('MT',0,4,1),tally('SK',1,1,0),tally('DE',0,0,2)];
test('the share leaves abstentions out and a split or abstain-only country sits between the sides',()=>{
  assert.equal(winningShare({for:10,against:3,abstaining:7},'for'),10/13,'abstentions do not count, as in Parliament');
  assert.equal(winningShare({for:0,against:0,abstaining:2},'for'),null);
  assert.deepEqual(['EL','MT','SK','DE'].map(code=>countrySide(sample.find(row=>row.country===code).counts,'for')),['win','lose','split','split']);
  assert.equal(countrySide({for:3,against:1,abstaining:0},'against'),'lose','the side follows the outcome');
});
test('by default the winning side leads, with the rule where the majority turns',()=>{
  const adopted=orderCountries(sample,decodeCountryOrder(''),{winning:'for',nameOf,locale:'en'});
  assert.deepEqual(adopted.map(row=>row.country),['LU','IE','BE','AT','EL','SK','DE','CZ','MT'],'the green bar shrinks to the rule, then splits, then the red bar grows');
  assert.equal(sideTurn(adopted,'for'),5,'the rule falls after the last country with a majority for');
  const rejected=orderCountries(sample,decodeCountryOrder(''),{winning:'against',nameOf,locale:'en'});
  assert.deepEqual(rejected.map(row=>row.country).slice(0,2),['MT','CZ'],'on a rejection the most opposed lead');
  assert.equal(sideTurn(rejected,'against'),2);
  const reversed=orderCountries(sample,decodeCountryOrder('share-rev'),{winning:'for',nameOf,locale:'en'});
  assert.deepEqual(reversed.map(row=>row.country).slice(0,2),['MT','CZ']);
  assert.equal(sideTurn(reversed,'for'),4,'reversed, the rule falls before the first country with a majority for');
  assert.equal(sideTurn([tally('AT',3,0,0),tally('BE',2,1,0)],'for'),-1,'no rule when every country is on one side');
});
test('every head sorts, with name A to Z in the page language and counts largest first',()=>{
  const order=raw=>orderCountries(sample,decodeCountryOrder(raw),{winning:'for',nameOf,locale:'en'}).map(row=>row.country);
  assert.deepEqual(order('name').slice(0,3),['AT','BE','CZ']);
  assert.deepEqual(order('name-rev').slice(0,2),['SK','MT']);
  assert.deepEqual(order('for').slice(0,3),['BE','AT','EL']);
  assert.deepEqual(order('against').slice(0,2),['CZ','AT']);
  assert.deepEqual(order('abstain').slice(0,2),['EL','BE']);
  assert.deepEqual(order('for-rev').slice(0,3),['DE','MT','SK'],'reversed counts run smallest first, ties by name');
  const de={AT:'Österreich',DE:'Deutschland',EL:'Griechenland'};
  assert.deepEqual(orderCountries([tally('AT',1,0,0),tally('DE',1,0,0),tally('EL',1,0,0)],decodeCountryOrder('name'),{winning:'for',nameOf:code=>de[code],locale:'de'}).map(row=>row.country),['DE','EL','AT'],'Österreich sorts with O in German');
});
test('the order round-trips through one short address value and refuses anything else',()=>{
  for(const raw of ['','share-rev','name','name-rev','for','for-rev','against','against-rev','abstain','abstain-rev'])assert.equal(encodeCountryOrder(decodeCountryOrder(raw)),raw);
  assert.deepEqual(decodeCountryOrder('share'),{key:'share',reversed:false});
  assert.equal(encodeCountryOrder({key:'share',reversed:false}),'','the default leaves the address clean');
  for(const raw of ['country:asc','total','for-asc','abstaining','sideways',null])assert.deepEqual(decodeCountryOrder(raw),{key:'share',reversed:false});
});

import {seatBounds} from './voteSeatsModel.mjs';
// A synthetic half-ring of three groups by angle, standing in for a chamber plan.
const ring=(group,from,to,rows=3)=>{const out=[];for(let row=0;row<rows;row++)for(let i=0;i<=8;i++){const angle=(from+(to-from)*i/8)*Math.PI/180,radius=200+row*12;out.push({seat:out.length,x:300+radius*Math.cos(angle),y:300-radius*Math.sin(angle),r:4,group,member:1});}return out;};
const plan=[...ring('A',170,125),...ring('B',115,65),...ring('C',55,10)].map((seat,index)=>({...seat,seat:index}));
test('seat bounds hug the drawn seats',()=>{
  const bounds=seatBounds(plan);
  assert(bounds.width<460&&bounds.width>430);assert(bounds.height<230);assert.equal(seatBounds([]),null);
});
import {planGroupOrder,groupArcLayout,nearestDot,tableGroupOrder,wedgeLabels} from './voteSeatsModel.mjs';
import {groupCounts} from './hemicycleModel.mjs';
import {readFileSync} from 'node:fs';
test('the group order is read from where each group sits in the plan, leftmost first',()=>{
  assert.deepEqual(planGroupOrder(plan),['A','B','C']);
  assert.deepEqual(planGroupOrder([]),[]);
});
const ballots=(group,counts)=>Object.entries(counts).flatMap(([position,n])=>Array.from({length:n},(_,i)=>({id:group+position+i,group,position})));
test('the table order is largest first by seats, a plan-less group next, unknown then non-attached last',()=>{
  const plan=[{group:'PPE',count:185},{group:'S&D',count:135},{group:'NI',count:27},{group:'ESN',count:27}];
  assert.deepEqual(tableGroupOrder([['NI',30],['ESN',1],['S&D',2],['PPE',3],['New',9],['unavailable',40]],plan),['PPE','S&D','ESN','New','unavailable','NI']);
  assert.deepEqual(tableGroupOrder([['NI',30],['S&D',2],['PPE',3]],[]),['PPE','S&D','NI'],'without a plan, this vote orders the table and NI stays last');
});
// The 22 Oct Strasbourg plan, reduced to what the orders read.
const strasbourg=JSON.parse(readFileSync(new URL('./test-support/hemicycle-str-groups.json',import.meta.url),'utf8')).map(([group,x,y])=>({group,x,y,r:7,member:1}));
test('on the Strasbourg plan the chart follows seating and the table follows size',()=>{
  assert.deepEqual(planGroupOrder(strasbourg),['The Left','S&D','Verts/ALE','Renew','PPE','NI','ECR','PfE','ESN']);
  const sizes=groupCounts(strasbourg),votes=sizes.map(entry=>[entry.group,1]);
  assert.deepEqual(tableGroupOrder(votes,sizes),['PPE','S&D','PfE','ECR','Renew','Verts/ALE','The Left','ESN','NI']);
});
test('wedges hold every ballot in plan order, with marks For, Abstain, Against from the inside out',()=>{
  const all=[...ballots('A',{for:40,against:10,abstaining:20}),...ballots('B',{for:30,abstaining:5}),...ballots('C',{against:60}),{id:'x',group:null,position:'for'},...ballots('D',{for:2})];
  const layout=groupArcLayout(all,{order:['A','B','C'],radius:322});
  assert.equal(layout.dots.length,all.length,'every ballot is drawn');
  assert.deepEqual(layout.wedges.map(wedge=>wedge.group),['A','B','C','D','unavailable'],'a group the plan lacks still gets a wedge, unknown last');
  assert.deepEqual(layout.dots.map(dot=>dot.index),layout.dots.map((_,i)=>i));
  assert.deepEqual(new Set(layout.dots.map(dot=>dot.id)).size,all.length);
  assert(Math.abs(layout.inner/layout.radius-.48)<1e-9);
  for(const dot of layout.dots)assert(dot.y<=0,'above the baseline');
  for(let i=1;i<layout.wedges.length;i++)assert(layout.wedges[i].start-layout.wedges[i-1].end>=.062,'a clear gap between wedges');
  const a=layout.dots.filter(dot=>dot.group==='A'),mean=position=>{const own=a.filter(dot=>dot.position===position);return own.reduce((sum,dot)=>sum+dot.radius,0)/own.length;};
  assert(mean('for')<mean('abstaining')&&mean('abstaining')<mean('against'),'inside to outside');
  assert.equal(Math.max(...a.filter(dot=>dot.position==='for').map(dot=>dot.radius))<=Math.min(...a.filter(dot=>dot.position==='against').map(dot=>dot.radius)),true);
  assert.equal(groupArcLayout([],{order:[],radius:100}).dots.length,0);
  assert.equal(groupArcLayout([{id:1,position:'maybe'}],{order:[],radius:100}).dots.length,0,'only recorded positions count');
});
test('wedge labels sit outside the arc, on the side of their wedge',()=>{
  const layout=groupArcLayout([...ballots('A',{for:100}),...ballots('B',{for:100}),...ballots('C',{for:100})],{order:['A','B','C'],radius:322});
  const labels=wedgeLabels(layout.wedges,{radius:322,dotRadius:layout.dotRadius});
  assert.deepEqual(labels.map(label=>[label.group,label.alignX]),[['A','-100%'],['B','-50%'],['C','0%']]);
  for(const label of labels)assert(Math.hypot(label.x,label.y)>322);
});
test('a press picks the closest mark within reach',()=>{
  const {dots,dotRadius}=groupArcLayout(ballots('A',{for:100}),{order:['A'],radius:322});
  const dot=dots[40];
  assert.equal(nearestDot(dots,dot.x+dotRadius,dot.y,dotRadius*1.2)?.index,40);
  assert.equal(nearestDot(dots,dot.x+500,dot.y+500,10),null);
});
