import test from 'node:test';
import assert from 'node:assert/strict';

test('directory emits displayed surname/first-name order from the upstream roster',async t=>{
  const roster=[
    {identifier:'1',givenName:'Stefan',familyName:'Berger',sortLabel:'BERGERS'},
    {identifier:'2',givenName:'Sibylle',familyName:'Berg',sortLabel:'BERGS'},
    {identifier:'3',givenName:'Asger',familyName:'Christensen',sortLabel:'CHRISTENSENA'},
    {identifier:'4',givenName:'Marie-Sophie',familyName:'Christ',sortLabel:'CHRISTMS'},
    {identifier:'5',givenName:'Nicolas',familyName:'Bay',sortLabel:'BAY'},
    {identifier:'6',givenName:'Christophe',familyName:'Bay',sortLabel:'BAYC'},
  ];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);
    assert.equal(url.origin,'https://data.europarl.europa.eu');
    if(url.pathname.endsWith('/meps/show-current'))return Response.json({data:roster});
    if(url.pathname.endsWith('/corporate-bodies/show-current'))return Response.json({data:[]});
    const person=roster.find(p=>url.pathname.endsWith('/meps/'+p.identifier));
    assert(person,'Unexpected upstream request: '+url);
    return Response.json({data:[{...person,hasMembership:[]}]});
  });
  const {odpDirectory}=await import('./odp.mjs');
  const result=await odpDirectory();
  assert.deepEqual(result.members.map(m=>m.id),[6,5,2,1,4,3]);
  assert.equal(result.members.find(m=>m.id===2).sortName,'BERGS','retain original sort metadata');
});
