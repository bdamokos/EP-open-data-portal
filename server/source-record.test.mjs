import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceTarget,humanSourceUrl} from './source-links.mjs';
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
test('source reader rejects mismatched identities and oversized responses without inventing a website',async()=>{
  const read=payload=>createSourceReader({request:async()=>({url:base+'/procedures/2025-0407',fetchedAt:Date.now(),payload})});
  await assert.rejects(()=>read({data:[{id:'eli/dl/proc/2025-0408'}]})(base+'/procedures/2025-0407'),error=>error.code==='source_identity');
  await assert.rejects(()=>read({data:[{id:'eli/dl/proc/2025-0407',text:'x'.repeat(1024*1024)}]})(base+'/procedures/2025-0407'),error=>error.code==='source_size');
  const data=await read({data:[{id:'eli/dl/proc/2025-0407',process_type:'def/ep-procedure-types/COD',process_title:{en:'Exact procedure',fr:'Procédure exacte'}}]})(base+'/procedures/2025-0407','fr');
  assert.equal(data.records[0].title,'Procédure exacte');assert.match(data.records[0].websiteUrl,/\/fr\/procedure-file/);
});
