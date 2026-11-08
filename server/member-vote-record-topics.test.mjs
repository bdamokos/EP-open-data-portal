import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {decisionTags} from './member-vote-record-topics.mjs';

test('decision tags read microthesauri and places from the retained topic records',()=>{
  const catalogue=JSON.parse(readFileSync(new URL('./topic-eurovoc-metadata.json',import.meta.url),'utf8')).concepts;
  const [uri,concept]=Object.entries(catalogue).find(([,value])=>value.microthesauri?.length);
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE record_topic_records(generation INTEGER,id TEXT,kind TEXT,body TEXT)');
  db.prepare('INSERT INTO record_topic_records VALUES(1,?,?,?)').run('D1','document',JSON.stringify({procedureIds:['2024-0001'],
    assignments:[{role:'keyword',key:'eurovoc:'+uri.replace('http://eurovoc.europa.eu/','')},{role:'keyword',key:'eurovoc:not-a-concept'},{role:'place',key:'place:BEL'}]}));
  const tags=decisionTags(db,1,['D1','missing']);
  assert.deepEqual(tags.p,['2024-0001']);
  assert.deepEqual(tags.m,[...new Set(concept.microthesauri.map(micro=>String(micro).replace('http://eurovoc.europa.eu/','')))].sort());
  assert.deepEqual(tags.c,['BEL']);
  assert.deepEqual(decisionTags(db,null,['D1']),{p:[],m:[],c:[]});
});
