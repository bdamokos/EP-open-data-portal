import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {rootSourceValues,sourceByteChunks} from './topic-source-stream.mjs';
test('sitting arrays stream across UTF-8 and escaped-string boundaries without expanding other fields',()=>{
 const input={results:[{id:'a',title:'Árvíz " [ ] \\',children:[{value:1}]},{id:'b'}],ignored:[{huge:'x'.repeat(10000)}],decisions:[{id:'c'}],resultsUrl:'https://example.test/a?x="[]',decisionsUrl:'https://example.test/b'};
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE sources(body TEXT)');db.prepare('INSERT INTO sources VALUES (?)').run(JSON.stringify(input));
 try{
  const chunks=()=>sourceByteChunks(db,1,{chunkSize:7});
  assert.deepEqual([...rootSourceValues(chunks(),{arrays:['results','decisions']})],[...input.results.map(value=>({field:'results',value})),{field:'decisions',value:input.decisions[0]}]);
  assert.deepEqual([...rootSourceValues(chunks(),{scalars:['resultsUrl','decisionsUrl']})],[{field:'resultsUrl',value:input.resultsUrl},{field:'decisionsUrl',value:input.decisionsUrl}]);
  db.prepare('INSERT INTO sources VALUES (?)').run(JSON.stringify({results:[{id:'next sitting'}]}));assert.deepEqual([...rootSourceValues(sourceByteChunks(db,2,{chunkSize:7}),{arrays:['results']})],[{field:'results',value:{id:'next sitting'}}]);
  assert.throws(()=>[...rootSourceValues(['{"results":[{"id":1}'],{arrays:['results']})],/Incomplete/);
 }finally{db.close();}
});
