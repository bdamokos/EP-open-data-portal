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
import {planGroupOrder,groupArcLayout,arcLabelPlacements,allocateRows} from './voteSeatsModel.mjs';
test('the group order is read from where each group sits in the plan, leftmost first',()=>{
  assert.deepEqual(planGroupOrder(plan),['A','B','C']);
  assert.deepEqual(planGroupOrder([]),[]);
});
const ballots=(group,counts)=>Object.entries(counts).flatMap(([position,n])=>Array.from({length:n},(_,i)=>({id:group+position+i,group,position})));
test('row allocation keeps every row and column total and cuts each row into consecutive parts',()=>{
  const rows=[10,14,18,22],totals=[30,20,14];
  const m=allocateRows(rows,totals);
  assert.deepEqual(m.map(row=>row.reduce((a,b)=>a+b,0)),rows,'each row keeps its dots');
  assert.deepEqual(totals.map((_,k)=>m.reduce((a,row)=>a+row[k],0)),totals,'each part keeps its total');
  assert(m.every(row=>row.every(value=>value>=0)));
  assert.deepEqual(allocateRows([5],[2,0,3]),[[2,0,3]]);
});
test('the group arc has one dot per ballot, wedges in plan order, gaps between them and one block per position inside each',()=>{
  const all=[...ballots('B',{abstaining:23,for:35,against:12}),...ballots('A',{against:24,for:46}),...ballots('C',{for:11}),...ballots(null,{for:2,against:1}),...ballots('Z',{abstaining:2})];
  const layout=groupArcLayout(all,{order:['A','B','C'],radius:300});
  assert.equal(layout.dots.length,all.length,'the dots add up to the recorded ballots');
  assert.deepEqual(layout.wedges.map(w=>w.group),['A','B','C','Z','unavailable'],'plan order, then other groups, the unknown one last');
  assert.deepEqual(layout.wedges.map(w=>w.count),[70,70,11,2,3]);
  const starts=layout.wedges.map(w=>w.start),ends=layout.wedges.map(w=>w.end);
  assert(starts.every((start,i)=>i===0||start<ends[i-1]),'wedges follow each other left to right without overlapping');
  const rank={for:0,against:1,abstaining:2};
  for(const wedge of layout.wedges) {
    const own=layout.dots.filter(dot=>dot.group===wedge.group);
    assert.deepEqual(layout.dots.slice(own[0].index,own[0].index+own.length).map(dot=>dot.group),own.map(dot=>dot.group),'a wedge is contiguous in the keyboard order');
    for(let row=0;row<layout.rows;row++) {
      const inRow=own.filter(dot=>dot.row===row).sort((x,y)=>y.angle-x.angle);
      assert(inRow.every((dot,i)=>i===0||rank[dot.position]>=rank[inRow[i-1].position]),wedge.group+' row '+row+': For, then Against, then Abstained, each in one piece');
    }
    for(const position of ['for','against','abstaining']) {
      const dots=own.filter(dot=>dot.position===position);
      if(dots.length>=layout.rows*2)assert.equal(new Set(dots.map(dot=>dot.row)).size,layout.rows,wedge.group+' '+position+' reaches from the inner row to the outer row');
    }
  }
  // Neighbouring wedges are about two dot spacings apart on top of the normal spacing (measured from the middle row out).
  for(let w=0;w<layout.wedges.length-1;w++)for(let row=Math.floor(layout.rows/2);row<layout.rows;row++){
    const left=layout.dots.filter(dot=>dot.group===layout.wedges[w].group&&dot.row===row).map(dot=>dot.angle),right=layout.dots.filter(dot=>dot.group===layout.wedges[w+1].group&&dot.row===row).map(dot=>dot.angle);
    if(!left.length||!right.length)continue;
    const radius=layout.dots.find(dot=>dot.row===row).radius,distance=(Math.min(...left)-Math.max(...right))*radius;
    assert(distance>=2.4*layout.spacing,'wedges '+w+' and '+(w+1)+' are separated in row '+row);
  }
  for(const dot of layout.dots){const r=Math.hypot(dot.x,dot.y);assert(r>=layout.inner&&r<=layout.radius&&dot.y<=0,'inside the half ring');}
  assert.equal(new Set(layout.dots.map(dot=>dot.id)).size,all.length,'every ballot keeps its own dot');
  assert.equal(groupArcLayout([],{order:[],radius:100}).dots.length,0);
  assert.equal(groupArcLayout([{id:1,position:'maybe'}],{order:[],radius:100}).dots.length,0,'only recorded positions count');
});
test('bigger charts give bigger dots from the same ballots, and wedge labels clear each other',()=>{
  const all=[...ballots('A',{for:60,against:10}),...ballots('B',{for:20,abstaining:20}),...ballots('C',{for:15}),...ballots('D',{against:15})];
  const small=groupArcLayout(all,{order:['A','B','C','D'],radius:150}),large=groupArcLayout(all,{order:['A','B','C','D'],radius:300});
  assert(large.dotRadius>small.dotRadius*1.9);
  const labels=arcLabelPlacements(large.wedges,{radius:300,dotRadius:large.dotRadius,measure:()=>({w:90,h:32})});
  assert.equal(labels.length,4);
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i].box,b=labels[j].box;assert(!(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top),'labels '+i+' and '+j+' do not overlap');}
  for(const label of labels)assert(label.box.bottom<=0||label.box.top>=0,'a label never crosses the baseline');
});
