import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {amendmentLanguageScope} from './amendmentLanguageScope.mjs';
import {amendmentOperation,resolveAmendmentPlacement} from '../server/document-context-model.mjs';
import {resolveProposalPlacement} from '../server/proposal-placement.mjs';
import {documentContextPlacement} from '../server/document-context-placement.mjs';
const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/amendment-language-scope.json',import.meta.url)));
const layouts=JSON.parse(readFileSync(new URL('../server/fixtures/amendment-language-layouts.json',import.meta.url)));

test('published repeated notes and divider-only columns retain whole-column scope without swallowing footnote changes',()=>{
  for(const example of layouts.examples) {
    const scope=amendmentLanguageScope(example);
    assert.equal(scope?.status??null,example.expected,example.language+' '+example.number);
    if(scope) {
      assert.equal(scope.note,example.proposedText);assert.equal(scope.field,'proposedText');
      for(const placement of [resolveAmendmentPlacement(null,example),resolveProposalPlacement([],example),documentContextPlacement({chosen:example})]) {
        assert.equal(placement.status,'not-applicable');assert.equal(placement.operation,null);
        assert.equal(placement.evidence[0].note,example.proposedText);
      }
    } else assert.equal(amendmentOperation(example),'replace');
  }
  const note='(Netýka sa slovenskej verzie.)';
  for(const proposedText of [note+'\nNew wording.',note+'\n15 A changed footnote.',note+'\n(Ne concerne pas la version française.)','__________________',note+'\n___ not a divider',Array(17).fill(note).join('\n')])assert.equal(amendmentLanguageScope({language:'sk',proposedText}),null);
  assert.equal(amendmentLanguageScope({language:'sk',proposedText:note+'\r\n\r\n__________________'})?.status,'not-applicable');
});

test('official whole-cell notes retain selected language and exact field provenance across placement paths',()=>{
  assert.equal(fixture.examples.length,23);
  for(const example of fixture.examples) {
    const chosen={...example,originalText:example.originalText??'Quoted wording.',proposedText:example.proposedText??example.note};
    const scope=amendmentLanguageScope(chosen);
    assert.deepEqual(scope,{status:'not-applicable',language:example.language,field:example.noteField,note:example.note},example.language);
    assert.equal(amendmentOperation(chosen),null,example.language);
    for(const placement of [resolveAmendmentPlacement(null,chosen),resolveProposalPlacement([],chosen),documentContextPlacement({chosen})]) {
      assert.equal(placement.status,'not-applicable',example.language);
      assert.equal(placement.operation,null,example.language);
      assert.equal(placement.reason,'language_version_unaffected',example.language);
      assert.equal(placement.span,undefined);assert.equal(placement.insertAfter,undefined);
      assert.equal(placement.evidence[0].note,example.note);
    }
  }
});

test('all 24 editions of the same amendment retain their independent language scope',()=>{
  assert.equal(new Set(fixture.controls.map(row=>row.language)).size,24);
  for(const example of fixture.controls) {
    assert.equal(amendmentLanguageScope(example)?.status??null,example.expected,example.language);
    if(example.expected===null)assert.equal(amendmentOperation(example),'replace',example.language);
  }
  assert.deepEqual(fixture.unverifiedNoteLanguages,['ga']);
});

test('scope is whole-cell and same-language: partial notes, legal prose, missing wording and other editions stay distinct',()=>{
  const note='(Ne concerne pas la version française.)';
  for(const proposedText of [note+'\nNew wording.', 'The words '+note, '«'+note+'»', 'supprimé', '',null]) {
    assert.equal(amendmentLanguageScope({originalText:'Original.',proposedText,language:'fr'}),null);
  }
  for(const language of ['en','ga',null,undefined])assert.equal(amendmentLanguageScope({proposedText:note,language}),null);
  assert.equal(amendmentOperation({originalText:'Original.',proposedText:'supprimé',language:'fr'}),'delete');
  assert.equal(amendmentOperation({originalText:'',proposedText:'New wording.',language:'fr'}),'insert');
  assert.equal(amendmentOperation({originalText:null,proposedText:null,language:'fr'}),null);
  const latvian=fixture.examples.find(row=>row.language==='lv');
  for(const prefix of ['1.','–','(a)','1.a'])assert.equal(amendmentLanguageScope({language:'lv',proposedText:prefix+'(Neattiecas uz tekstu latviešu valodā.)'})?.status,'not-applicable');
  assert(latvian);
});
