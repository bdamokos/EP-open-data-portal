import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const languages='bg cs da de el en es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' ');
const catalogue=async language=>JSON.parse(await readFile(new URL('./ui-locales/'+language+'.json',import.meta.url),'utf8'));
const notes={
  'documentcontext.note.number_exists':[],
  'documentcontext.note.original_differs':[],
  'documentcontext.note.follows_amendment':['{number}'],
  'documentcontext.note.changes_table':[],
  'documentcontext.note.report_paragraph':['{report}','{source}'],
  'documentcontext.note.label_instruction_differ':[],
};
const removed=['proposalcontexttext.colliding.new.point','documentcontext.citation_before_existing','proposalcontexttext.new.unnumbered.table','proposalcontexttext.new.point.order','proposalcontexttext.preceding.new.annex','documentcontext.table_level_amendment','documentcontext.after_paragraph_lead','documentcontext.original_wording_differs','documentcontext.single_word_difference','proposalcontexttext.original.citation.omits.an.identifier','proposalcontexttext.unique.entry.labels','proposalcontexttext.sequential.paragraph','proposalcontexttext.label_instruction_difference'];

test('placement notes are translated in every catalogue and retired keys are gone',async()=>{
  const english=await catalogue('en');
  for(const language of languages) {
    const messages=await catalogue(language);
    for(const id of removed)assert(!Object.hasOwn(messages,id),language+' '+id);
    for(const [id,slots] of Object.entries(notes)) {
      const text=messages[id];
      assert.equal(typeof text,'string',language+' '+id);
      assert.deepEqual([...text.matchAll(/\{\w+\}/gu)].map(match=>match[0]).sort(),[...slots].sort(),language+' '+id);
      if(language!=='en')assert.notEqual(text,english[id],language+' '+id+' is still English');
    }
  }
});
