import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireLanguageVariants} from './amendment-benchmark-languages.mjs';
import {amendmentLanguagePreference} from '../server/language-order.mjs';

const documentId='B-10-2026-0406',listId=documentId+'-AM-001-006';
const file=(id,language)=>({language,is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:'distribution/test/'+id+'_'+language+'.docx'}]});
const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:'eli/dl/doc/'+documentId,is_realized_by:['en','fr','de','es'].map(language=>file(listId,language))};
const rows=[{id:documentId+'-AM-1',number:1,targetDocumentId:documentId,listId,language:'en',baseline:'motion-resolution',wordingSource:{url:'https://data.europarl.europa.eu/distribution/test/list_en.docx'}}];
const contexts=new Map([['en',{plain:{value:{document:{selectedText:{availableTextLanguages:['fr','de','es'],textLanguage:'fr'}}}}}]]);

test('matching wording preference preserves requested, English, originals and display ordering',()=>{
  assert.deepEqual(amendmentLanguagePreference(['bg','de','fr','en','es'],'bg',['de']),['bg','en','de','fr','es']);
  assert.deepEqual(amendmentLanguagePreference(['it','es','de','fr'],'en',['it']),['it','fr','es','de']);
});

test('supplementary acquisition uses embedded exact-list declarations and one matching edition',async()=>{
  const reads=[],downloads=[],work={identifier:documentId,id:'eli/dl/doc/'+documentId,originalLanguage:['de'],is_realized_by:['fr','de','es'].map(language=>file(documentId,language)),inverse_foresees_change_of:[list]};
  const cache={json:async url=>{reads.push(url);return {value:{data:[work]}};},get:async url=>{downloads.push(url);return {url,ok:true};}};
  const result=await acquireLanguageVariants(rows,contexts,cache);
  assert.equal(result.get(listId).language,'de');assert.equal(reads.length,1);
  assert.deepEqual(downloads,['https://data.europarl.europa.eu/distribution/test/'+listId+'_de.docx','https://data.europarl.europa.eu/distribution/test/'+documentId+'_de.docx']);
  work.inverse_foresees_change_of=[{...list,foresees_change_of:'eli/dl/doc/B-10-2026-0408'}];
  await assert.rejects(acquireLanguageVariants(rows,contexts,cache),/target unavailable/);
});

test('supplementary acquisition never changes proposal baselines or reads matching-language inputs again',async()=>{
  const cache={json:async()=>{throw Error('Unexpected metadata read');}};
  assert.equal((await acquireLanguageVariants([{...rows[0],baseline:'commission-proposal'}],contexts,cache)).size,0);
  assert.equal((await acquireLanguageVariants(rows,new Map([['en',{plain:{value:{document:{selectedText:{availableTextLanguages:['en']}}}}}]]),cache)).size,0);
});
