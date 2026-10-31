import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceTarget,humanSourceUrl,sourceLanguages} from './source-links.mjs';
import {createSourceReader} from './source-record.mjs';
const base='https://data.europarl.europa.eu/api/v2';

test('source admission rejects arbitrary hosts, paths, credentials, duplicate filters and unbounded offsets',()=>{
  for(const url of ['http://data.europarl.europa.eu/api/v2/meps/1',base+'/../admin',base+'/procedures/%32%30%32%35-0407',base+'/context.jsonld',base+'/speeches?url=https://example.com',base+'/speeches?limit=5&limit=6',base+'/speeches?offset=10001',base+'/speeches?limit=0',base+'/speeches?format=text/html',base+'/speeches#fragment','https://user:pass@data.europarl.europa.eu/api/v2/meps/1',base.replace('data.europarl.europa.eu','data.europarl.europa.eu.evil.example')+'/meps/1'])assert.equal(sourceTarget(url),null,url);
  assert.equal(sourceTarget(base+'/meetings/MTG-PL-2026-10-07/decisions?vote-method=ROLL_CALL_EV&limit=1').collection,true);
});
test('human sources preserve exact identities and do not substitute a current website roster for dated data',()=>{
  assert.match(humanSourceUrl(base+'/procedures/2025-0407',{reference:'2025/0407(COD)',language:'fr'}),/\/fr\/procedure-file\?reference=2025%2F0407%28COD%29$/);
  assert.equal(humanSourceUrl(base+'/procedures/2025-0407',{reference:'2025/0408(COD)'}),null);
  assert.match(humanSourceUrl(base+'/procedures/2025-0407',{record:{process_type:'def/ep-procedure-types/COD'}}),/0407%28COD%29$/);
  assert.equal(humanSourceUrl(base+'/meps/show-current?mandate-date=2024-10-09'),null);
  assert.equal(humanSourceUrl(base+'/speeches?person-id=125065&parliamentary-term=10'),null);
  assert.equal(sourceTarget('https://data.europarl.europa.eu/eli/dl/doc/RC-10-2026-0441.rdf').endpoint,'/plenary-documents/RC-10-2026-0441');
  assert.equal(humanSourceUrl(base+'/committee-documents/TRAN-PR-785404'),'https://www.europarl.europa.eu/doceo/document/TRAN-PR-785404_EN.html');
  assert.equal(humanSourceUrl(base+'/meps/125065'),'https://www.europarl.europa.eu/meps/en/125065');
  assert.equal(humanSourceUrl(base+'/parliamentary-questions/E-10-2026-003031'),'https://www.europarl.europa.eu/doceo/document/E-10-2026-003031_EN.html');
  assert.match(humanSourceUrl('http://eurovoc.europa.eu/3064'),/uri=http%3A%2F%2Feurovoc.europa.eu%2F3064$/);
  assert.equal(humanSourceUrl('https://eurovoc.europa.eu/3064?other=1'),null);
  assert.equal(humanSourceUrl('https://unrelated.example/eli/dl/doc/A-10-2026-0237'),null);
});
test('source reader preserves the exact filtered request, bounds display/download together, and uses the shared upstream adapter',async()=>{
  const url=base+'/speeches?person-id=125065&parliamentary-term=10&language=en&include-output=xml_fragment&limit=500&offset=50&format=application%2Frdf%2Bxml',calls=[];
  const read=createSourceReader({request:async(endpoint,params,options)=>{calls.push({endpoint,params,options});return {url:base+'/speeches?limit=25&format=application%2Fld%2Bjson',fetchedAt:Date.parse('2026-10-16T17:00Z'),stale:true,refreshError:'Source unavailable',payload:{data:Array.from({length:30},(_,i)=>({id:'eli/dl/event/'+i,activity_label:{en:'Speech '+i}})),'@context':{data:'@graph'}}};}});
  const data=await read(url,'en');assert.equal(calls.length,1);assert.equal(calls[0].params.limit,25);assert.equal(calls[0].params.offset,'50');assert.equal(calls[0].params['person-id'],'125065');assert.equal(calls[0].params['include-output'],'xml_fragment');assert(!('format' in calls[0].params));assert.equal(calls[0].options.staleWhileRevalidate,true);
  assert.equal(data.sourceUrl,url);assert.equal(data.records.length,25);assert.equal(data.payload.data.length,25);assert.equal(data.limited,true);assert.equal(data.stale,true);assert.equal(data.records[0].websiteUrl,null);
});
test('type-only procedure links require one consistent declaration across representations and aliases',async()=>{
  const id='2026-0001A',url=base+'/procedures/'+id,type='def/ep-procedure-types/APP';
  const expected='https://oeil.europarl.europa.eu/oeil/fr/procedure-file?reference=2026%2F0001A%28APP%29';
  for(const fields of [{process_type:type},{process_type:{id:type}},{process_type:{'@id':type}},{process_type:[type,{id:type},type]},{procedure_type:type,had_procedure_type:{id:type}}]) {
    assert.equal(humanSourceUrl(url,{language:'fr',record:fields}),expected);
    const read=createSourceReader({request:async()=>({url,fetchedAt:Date.parse('2026-10-31T09:00:00Z'),payload:{data:[{id:'eli/dl/proc/'+id,...fields}]}})});
    assert.equal((await read(url,'fr')).records[0].websiteUrl,expected);
  }
  for(const fields of [{},{process_type:{}},{process_type:[type,{}]},{process_type:[type,null]},{process_type:[type,'def/ep-procedure-types/COD']},{process_type:['def/ep-procedure-types/COD',type]},{process_type:type,procedure_type:'COD'}])assert.equal(humanSourceUrl(url,{record:fields}),null);
  const contradictory={process_type:['COD','RSP'],label:'2026/0001A(APP)'};
  assert.equal(humanSourceUrl(url,{language:'fr',record:contradictory}),expected,'an exact printed reference keeps its established path');
  assert.equal(humanSourceUrl(url,{language:'fr',reference:'2026/0001A(APP)',record:{process_type:{}}}),expected);
  assert.equal(humanSourceUrl(url,{reference:'2026/0001(APP)',record:{process_type:type}}),null,'the letter suffix is part of identity');
  assert.equal(humanSourceUrl(url,{record:{label:'2026/0002A(APP)',process_type:type}}),null);
  assert.equal(new URL(humanSourceUrl(url,{record:{process_type:'XYZ'}})).searchParams.get('reference'),'2026/0001A(XYZ)','unknown future codes retain exact syntax');
});
test('source reader rejects mismatched identities and oversized responses without inventing a website',async()=>{
  const read=payload=>createSourceReader({request:async()=>({url:base+'/procedures/2025-0407',fetchedAt:Date.now(),payload})});
  await assert.rejects(()=>read({data:[{id:'eli/dl/proc/2025-0408'}]})(base+'/procedures/2025-0407'),error=>error.code==='source_identity');
  await assert.rejects(()=>read({data:[{id:'eli/dl/proc/2025-0407',text:'x'.repeat(1024*1024)}]})(base+'/procedures/2025-0407'),error=>error.code==='source_size');
  const data=await read({data:[{id:'eli/dl/proc/2025-0407',process_type:'def/ep-procedure-types/COD',process_title:{en:'Exact procedure',fr:'Procédure exacte'}}]})(base+'/procedures/2025-0407','fr');
  assert.equal(data.records[0].title,'Procédure exacte');assert.match(data.records[0].websiteUrl,/\/fr\/procedure-file/);
});
test('the complete response stays within one MiB without duplicating records',async()=>{
  const make=record=>createSourceReader({request:async()=>({url:base+'/procedures/2025-0407',fetchedAt:Date.now(),payload:{data:[record]}})})(base+'/procedures/2025-0407');
  const result=await make({id:'eli/dl/proc/2025-0407',text:'x'.repeat(600*1024)});
  assert(Buffer.byteLength(JSON.stringify(result)+'\n')<1024*1024);assert(!('value' in result.records[0]));assert.equal(result.payload.data[0].text.length,600*1024);
  const title='x'.repeat(530*1024),record={id:'eli/dl/proc/2025-0407',process_title:{en:title}};
  assert(Buffer.byteLength(JSON.stringify({data:[record]}))<1024*1024);
  await assert.rejects(()=>make(record),error=>error.code==='source_size','the final envelope and title metadata count toward the response limit');
});
test('source languages include nested maps without treating identifiers as languages',()=>{
  assert.deepEqual(sourceLanguages({id:'eli/dl/proc/2025-0407',activity_label:{en:'English'},nested:[{text:{fr:'Français',hu:'Magyar'}}],identifier:{id:'record-id'}}),['en','fr','hu']);
});
test('existing Outside evidence filters survive the reader request and collection cap',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/outside-speakers-20261016.json',import.meta.url)));
  const urls=[...new Set(fixture.contributions.map(row=>row.sourceUrl))];
  assert(urls.some(url=>url.includes('language-filter=hu')));
  assert(urls.some(url=>url.includes('title=')&&url.includes('search-language=')));
  for(const url of urls)assert(sourceTarget(url),url);
  for(const url of urls){
    if(!sourceTarget(url).collection)continue;
    const original=new URL(url);let actual;
    const read=createSourceReader({request:async(endpoint,params)=>{actual={endpoint,params};return {url:base+endpoint,fetchedAt:Date.now(),payload:{data:[]}};}});
    const data=await read(url);
    assert.equal(actual.endpoint,'/speeches');assert.equal(data.sourceUrl,url);
    const expected=Object.fromEntries(original.searchParams);delete expected.format;expected.limit=Math.min(25,Number(expected.limit)||25);
    assert.deepEqual(actual.params,expected,url);
    assert.equal(humanSourceUrl(url),null,'a website search is not the exact source result');
  }
  for(const query of ['language-filter=invalid','search-language=EN','title=','title=%20','title=x&title=y','language-filter=en&language-filter=hu','search-language=en&search-language=fr','title=%00'])assert.equal(sourceTarget(base+'/speeches?'+query),null,query);
});
