import test from 'node:test';import assert from 'node:assert/strict';import {proposalNoteComparison} from './proposalNoteScope.mjs';
test('comparison cuts retain the published body, payload and each formatting range',()=>{
 const body='Body1a.',notes='1a Citation.',value=body+'\n_____\n'+notes;
 const wording={originalText:'Old body.',proposedText:value,proposedFormatting:[{kind:'superscript',start:4,end:6},{kind:'italic',start:14,end:16}]},scope={kind:'word-footnotes',originalBodyEnd:9,proposedBodyEnd:body.length};
 const split=proposalNoteComparison(wording,scope);assert.equal(split.proposed.body,body);assert.equal(split.proposed.notes,notes);assert.deepEqual(split.proposed.bodyFormatting,[{kind:'superscript',start:4,end:6}]);assert.deepEqual(split.proposed.notesFormatting,[{kind:'italic',start:0,end:2}]);assert.equal(split.original.notes,'');
 assert.deepEqual(proposalNoteComparison(wording,{...scope,kind:'pdf-footnotes'}),split);
 for(const end of [-1,1,100,1.5])assert.equal(proposalNoteComparison(wording,{...scope,proposedBodyEnd:end}),null);
});

test('original-only note payloads remain a reader comparison for deletions',()=>{
 const wording={originalText:'Old1.\n_____\n1 Citation.',proposedText:'deleted'},scope={kind:'word-footnotes',originalBodyEnd:5,proposedBodyEnd:7};
 const comparison=proposalNoteComparison(wording,scope);assert.equal(comparison.original.body,'Old1.');assert.equal(comparison.original.notes,'1 Citation.');assert.equal(comparison.proposed.notes,'');
});
