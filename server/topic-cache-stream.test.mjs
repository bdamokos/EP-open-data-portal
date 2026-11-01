import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {topicCachedWorks} from './topic-cache-stream.mjs';
import {topicWorkFields} from './topic-work-fields.mjs';
test('streamed cache works preserve escaped text and chunk boundaries while dropping transcript bodies',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topic-cache-stream-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'page.json'),title='Greece " { } \\ '+ 'é'.repeat(40000),works=[{id:'first',title_dcterms:{en:title},is_realized_by:[{title:{en:'Original'},xml_fragment:'x'.repeat(100000)}],recorded_in_a_realization_of:[{identifier:'CRE-10-2025-05-06-ITM-001',is_part_of:['eli/dl/doc/CRE-10-2025-05-06-ITM-001'],'api:xmlFragment':{en:'x'.repeat(100000)}}],had_participation:[{had_participant_person:['person/123']}],is_about:[],consists_of:[]},{id:'second',inverse_consists_of:null}];
 await writeFile(file,JSON.stringify({url:'https://data.europarl.europa.eu/api/v2/speeches',fetchedAt:123,payload:{'@context':{data:'a nested field'},data:works}}));
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const compact=topicWorkFields(db),rows=[];
 for await(const row of topicCachedWorks(file)){assert.equal(row.source.fetchedAt,123);rows.push(compact(row.json));}
 assert.equal(rows.length,2);assert.equal(rows[0].title_dcterms.en,title);assert.deepEqual(rows[0].is_realized_by,[{title:{en:'Original'}}]);assert.deepEqual(rows[0].is_about,[]);assert.deepEqual(rows[0].recorded_in_a_realization_of[0].is_part_of,['eli/dl/doc/CRE-10-2025-05-06-ITM-001']);assert(!JSON.stringify(rows[0]).includes('xmlFragment'));assert.deepEqual(rows[0].had_participation,[{had_participant_person:['person/123']}]);assert.equal(rows[1].inverse_consists_of,null);assert(!Object.hasOwn(rows[1],'executed'));
 await writeFile(file,JSON.stringify({url:'https://data.europarl.europa.eu/api/v2/speeches',fetchedAt:123,payload:{data:works}}).slice(0,-1));
 await assert.rejects(async()=>{for await(const row of topicCachedWorks(file))void row;},SyntaxError);
});
