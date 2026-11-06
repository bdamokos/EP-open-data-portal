import test from 'node:test';
import assert from 'node:assert/strict';
import {differingVoterIds,countryGroupBreakdown,allCountriesBreakdown,sortCountryRows,pluralityPosition,encodeMatrixSort,decodeMatrixSort} from './voteSeatsModel.mjs';
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
  assert.deepEqual(es.cells.get('PPE'),{position:'for',count:2,tied:null,total:2,other:0,counts:{for:2,against:0,abstaining:0}});
  assert.deepEqual(es.cells.get('S&D'),{position:'against',count:1,tied:null,total:1,other:0,counts:{for:0,against:1,abstaining:0}});
  const tie=countryGroupBreakdown([{group:'PPE',country:'FR',position:'for'},{group:'PPE',country:'FR',position:'against'}])[0];
  assert.deepEqual(tie.cells.get('PPE'),{position:null,count:1,tied:['for','against'],total:2,other:1,counts:{for:1,against:1,abstaining:0}},'a tied most common position keeps its tied counts');
  // A group with no ballots from a country has no cell there, never 0.
  assert.ok(!es.cells.has('ZZZ'));
});

test('matrix sort state round-trips through a single URL value and refuses malformed input',()=>{
  assert.equal(encodeMatrixSort({kind:'total',dir:'desc'}),'');
  assert.equal(encodeMatrixSort({kind:'country',dir:'asc'}),'country:asc');
  assert.equal(encodeMatrixSort({kind:'country',dir:'desc'}),'country:desc');
  assert.equal(encodeMatrixSort({kind:'total',dir:'asc'}),'total:asc');
  assert.equal(encodeMatrixSort({kind:'majority',dir:'desc'}),'majority:desc');
  assert.equal(encodeMatrixSort({kind:'group',key:'S&D',dir:'desc'}),'group:S&D');
  assert.equal(encodeMatrixSort({kind:'group',key:'S&D',dir:'asc'}),'group:S&D:asc');
  assert.deepEqual(decodeMatrixSort(''),{kind:'total',dir:'desc'},'the default is most ballots first');
  assert.deepEqual(decodeMatrixSort('country:asc'),{kind:'country',dir:'asc'});
  assert.deepEqual(decodeMatrixSort('country:desc'),{kind:'country',dir:'desc'});
  assert.deepEqual(decodeMatrixSort('total:asc'),{kind:'total',dir:'asc'});
  assert.deepEqual(decodeMatrixSort('majority:desc'),{kind:'majority',dir:'desc'});
  assert.deepEqual(decodeMatrixSort('group:S&D'),{kind:'group',key:'S&D',dir:'desc'});
  assert.deepEqual(decodeMatrixSort('group:S&D:asc'),{kind:'group',key:'S&D',dir:'asc'});
  assert.equal(decodeMatrixSort('country'),null);
  assert.equal(decodeMatrixSort('group:'),null);
  assert.equal(decodeMatrixSort('country:sideways'),null);
  assert.equal(decodeMatrixSort('majority'),null);
});

const ballot=(country,group,position,count)=>Array.from({length:count},()=>({country,group,position}));
test('cells keep splits visible: count of the most common position plus the other ballots',()=>{
  const rows=[...ballot('DE','PPE','for',26),...ballot('DE','PPE','against',3),...ballot('DE','PPE','abstaining',1),...ballot('FR','S&D','for',2),...ballot('FR','S&D','against',2),...ballot('FR','S&D','abstaining',1)];
  const [de,fr]=['DE','FR'].map(code=>countryGroupBreakdown(rows).find(row=>row.country===code));
  assert.deepEqual([de.cells.get('PPE').count,de.cells.get('PPE').other,de.cells.get('PPE').position],[26,4,'for']);
  assert.deepEqual([fr.cells.get('S&D').count,fr.cells.get('S&D').other,fr.cells.get('S&D').position],[2,3,null],'a tie keeps its count and counts the rest');
  assert.deepEqual(de.cells.get('PPE').counts,{for:26,against:3,abstaining:1},'the full split stays available for the label');
});
test('country majority is the position with strictly the most ballots, otherwise split',()=>{
  assert.equal(pluralityPosition({for:11,against:6,abstaining:0}),'for');
  assert.equal(pluralityPosition({for:33,against:0,abstaining:36}),'abstaining');
  assert.equal(pluralityPosition({for:2,against:2,abstaining:0}),null);
  assert.equal(pluralityPosition({for:0,against:0,abstaining:0}),null,'no ballots is not a majority');
});
test('the all-countries row sums every country and group, and rows sort by ballots by default',()=>{
  const rows=[...ballot('DE','PPE','for',3),...ballot('DE','NI','against',1),...ballot('FR','PPE','for',1),...ballot('FR','PPE','against',1),...ballot('MT','PPE','abstaining',1)];
  const all=allCountriesBreakdown(rows);
  assert.equal(all.country,null);assert.deepEqual(all.counts,{for:4,against:2,abstaining:1});assert.equal(all.ballots,7);assert.equal(all.majority,'for');
  assert.deepEqual([all.cells.get('PPE').count,all.cells.get('PPE').other],[4,2]);
  assert.equal(allCountriesBreakdown([]),null);
  const table=countryGroupBreakdown(rows),name=row=>row.country;
  assert.deepEqual(sortCountryRows(table,{kind:'total',dir:'desc'},name).map(row=>row.country),['DE','FR','MT'],'most ballots first');
  assert.deepEqual(sortCountryRows(table,{kind:'country',dir:'asc'},name).map(row=>row.country),['DE','FR','MT']);
  assert.deepEqual(sortCountryRows(table,{kind:'majority',dir:'desc'},name).map(row=>row.majority),[null,'abstaining','for'],'majority order is for, against, abstained, split; descending reverses it');
  assert.deepEqual(sortCountryRows(table,{kind:'group',key:'NI',dir:'desc'},name).map(row=>row.country),['DE','FR','MT'],'countries without ballots for the group sort last, by name');
});

import {seatBounds} from './voteSeatsModel.mjs';
// A synthetic half-ring of three groups by angle, standing in for a chamber plan.
const ring=(group,from,to,rows=3)=>{const out=[];for(let row=0;row<rows;row++)for(let i=0;i<=8;i++){const angle=(from+(to-from)*i/8)*Math.PI/180,radius=200+row*12;out.push({seat:out.length,x:300+radius*Math.cos(angle),y:300-radius*Math.sin(angle),r:4,group,member:1});}return out;};
const plan=[...ring('A',170,125),...ring('B',115,65),...ring('C',55,10)].map((seat,index)=>({...seat,seat:index}));
test('seat bounds hug the drawn seats',()=>{
  const bounds=seatBounds(plan);
  assert(bounds.width<460&&bounds.width>430);assert(bounds.height<230);assert.equal(seatBounds([]),null);
});
import {countryFilterPressed} from './voteSeatsModel.mjs';
test('a country filter reads as pressed only while the list shows it, and a cell only for its own position',()=>{
  const open={country:'DE',group:'ESN',position:'against'};
  assert.equal(countryFilterPressed(open,{country:'DE',group:'ESN',position:'against'}),true);
  assert.equal(countryFilterPressed({...open,position:'for'},{country:'DE',group:'ESN',position:'against'}),false,'list switched to another position');
  assert.equal(countryFilterPressed({...open,position:'for'},{country:'DE',group:'ESN'}),true,'row buttons do not depend on position');
  assert.equal(countryFilterPressed({...open,position:null},{country:'DE',group:'ESN'}),false,'list hidden');
  assert.equal(countryFilterPressed(open,{country:'FR',group:'ESN'}),false);
  assert.equal(countryFilterPressed({country:'DE',group:null,position:'for'},{country:'DE',group:null}),true);
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
