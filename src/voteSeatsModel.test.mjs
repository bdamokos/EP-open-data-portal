import test from 'node:test';
import assert from 'node:assert/strict';
import {seatBallots,positionTotals,unseatedDotTotals,differingVoterIds,countryGroupBreakdown,allCountriesBreakdown,sortCountryRows,pluralityPosition,encodeMatrixSort,decodeMatrixSort} from './voteSeatsModel.mjs';
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

import {seatBounds,groupLabelPlacements} from './voteSeatsModel.mjs';
// A synthetic half-ring of three groups by angle, standing in for a chamber plan.
const ring=(group,from,to,rows=3)=>{const out=[];for(let row=0;row<rows;row++)for(let i=0;i<=8;i++){const angle=(from+(to-from)*i/8)*Math.PI/180,radius=200+row*12;out.push({seat:out.length,x:300+radius*Math.cos(angle),y:300-radius*Math.sin(angle),r:4,group,member:1});}return out;};
const plan=[...ring('A',170,125),...ring('B',115,65),...ring('C',55,10)].map((seat,index)=>({...seat,seat:index}));
test('seat bounds hug the drawn seats',()=>{
  const bounds=seatBounds(plan);
  assert(bounds.width<460&&bounds.width>430);assert(bounds.height<230);assert.equal(seatBounds([]),null);
});
test('group labels sit outside the outer edge along each group, derived from the plan',()=>{
  const labels=groupLabelPlacements(plan,{scale:1,widthOf:()=>30});
  assert.deepEqual(labels.map(label=>label.group).sort(),['A','B','C']);
  const by=Object.fromEntries(labels.map(label=>[label.group,label]));
  assert(by.A.x<by.B.x&&by.B.x<by.C.x,'labels follow the groups left to right');
  const cx=(seatBounds(plan).minX+seatBounds(plan).maxX)/2;
  for(const label of labels)assert(Math.hypot(label.x-cx,300-label.y)>224,'outside the seats');
  assert.equal(by.A.anchor,'end');assert.equal(by.C.anchor,'start');
});
test('labels that would overlap are skipped, and an unknown scale places none',()=>{
  const crowded=groupLabelPlacements(plan,{scale:1,widthOf:()=>700,height:300}).map(label=>label.group);
  assert(crowded.length<3&&!crowded.includes('B'),'the top label overlaps both side labels and is skipped');
  assert.deepEqual(groupLabelPlacements(plan,{scale:0,widthOf:()=>30}),[]);
});
test('a label steps outwards past other groups\' seats instead of covering them',()=>{
  // Group D sits outside group A on the same angles, so A's own outer edge is inside D's seats.
  const outer=[...ring('D',170,125,3)].map(seat=>({...seat,x:300+(seat.x-300)*1.1,y:300-(300-seat.y)*1.1}));
  const behind=[...plan,...outer].map((seat,index)=>({...seat,seat:index}));
  const width=30,height=12,labels=groupLabelPlacements(behind,{scale:1,widthOf:()=>width,height,gap:3,pad:5});
  assert(labels.some(label=>label.group==='A'),'A is still labelled');
  for(const label of labels) {
    const left=label.anchor==='start'?label.x:label.anchor==='end'?label.x-width:label.x-width/2,top=label.y-height/2;
    for(const seat of behind)assert(!(seat.x+seat.r>left&&seat.x-seat.r<left+width&&seat.y+seat.r>top&&seat.y-seat.r<top+height),'label '+label.group+' covers seat '+seat.seat);
  }
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
test('a label carries its count line only where the taller box clears every seat',()=>{
  const fits=groupLabelPlacements(plan,{scale:1,widthOf:()=>30,extra:12,extraWidthOf:()=>50});
  assert.equal(fits.length,3);assert(fits.every(label=>label.withExtra),'room for every count line');
  for(const label of fits)for(const seat of plan)assert(!(seat.x+seat.r>label.box.left&&seat.x-seat.r<label.box.right&&seat.y+seat.r>label.box.top&&seat.y-seat.r<label.box.bottom),'the taller box clears every seat');
  assert.equal(groupLabelPlacements(plan,{scale:1,widthOf:()=>30}).every(label=>!label.withExtra),true,'no extra line unless asked for');
});

import {planGroupOrder,groupArcLayout,arcLabelPlacements} from './voteSeatsModel.mjs';
test('the group order is read from where each group sits in the plan, leftmost first',()=>{
  assert.deepEqual(planGroupOrder(plan),['A','B','C']);
  assert.deepEqual(planGroupOrder([]),[]);
});
const ballots=(group,counts)=>Object.entries(counts).flatMap(([position,n])=>Array.from({length:n},(_,i)=>({id:group+position+i,group,position})));
test('the group arc has one dot per ballot, wedges in plan order and For, Against, Abstained blocks inside each',()=>{
  const all=[...ballots('B',{abstaining:3,for:5,against:2}),...ballots('A',{against:4,for:6}),...ballots('C',{for:1}),...ballots(null,{for:2,against:1}),...ballots('Z',{abstaining:2})];
  const layout=groupArcLayout(all,{order:['A','B','C'],radius:300});
  assert.equal(layout.dots.length,all.length,'the dots add up to the recorded ballots');
  assert.deepEqual(layout.wedges.map(w=>w.group),['A','B','C','Z','unavailable'],'plan order, then other groups, the unknown one last');
  assert.deepEqual(layout.wedges.map(w=>w.count),[10,10,1,2,3]);
  const angles=layout.dots.map(dot=>dot.angle);
  assert(angles.every((angle,i)=>i===0||angle<=angles[i-1]+1e-9),'dots run left to right');
  for(const wedge of layout.wedges) {
    const own=layout.dots.filter(dot=>dot.group===wedge.group),rank={for:0,against:1,abstaining:2};
    assert(own.every((dot,i)=>i===0||rank[dot.position]>=rank[own[i-1].position]),wedge.group+' runs For, Against, Abstained');
    assert.deepEqual(layout.dots.slice(own[0].index,own[0].index+own.length).map(dot=>dot.group),own.map(dot=>dot.group),'a wedge is contiguous');
  }
  for(const dot of layout.dots){const r=Math.hypot(dot.x,dot.y);assert(r>=layout.inner&&r<=layout.radius&&dot.y<=0,'inside the half ring');}
  assert.deepEqual(new Set(layout.dots.map(dot=>dot.id)).size,all.length,'every ballot keeps its own dot');
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
