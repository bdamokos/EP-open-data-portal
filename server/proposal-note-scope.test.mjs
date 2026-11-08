import test from 'node:test';import assert from 'node:assert/strict';
import {noteWord,noteBody,noteDefinitions} from './test-support/note-scope-fixture.mjs';
import {parseProposal} from './proposal-structure.mjs';
import {documentContextPlacement} from './document-context-placement.mjs';
const chosen=()=>({baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false},language:'en',targetLabelLanguage:'en',targetLabel:'Recital 1',originalText:'(1)\tAlpha1 and Beta2.\n_____\n1 First citation.\n2 Second citation.',proposedText:'(1)\tChanged2.\n_____\n1 First citation.\n2 Second citation.',originalFormatting:[{kind:'superscript',start:9,end:10},{kind:'superscript',start:19,end:20}],proposedFormatting:[{kind:'superscript',start:11,end:12}]});
const setup=()=>({items:[{kind:'act',proposal:structuredClone(parseProposal(noteWord(noteBody,{notes:noteDefinitions})))}],baseline:{evidence:[{kind:'native-procedure',status:'verified',procedure:'2028/0045(NLE)'}]}});
test('NLE note comparisons place the body and preserve separately bound payload metadata',()=>{
 const input={...setup(),chosen:chosen()},a=documentContextPlacement(input);assert.equal(a.status,'placed');assert.equal(a.operation,'replace');assert.deepEqual(a.noteScope.sourceNotes,[{id:'7',label:'1'},{id:'9',label:'2'}]);assert.deepEqual(a.noteScope.unreferencedLabels,['1']);assert.equal(input.chosen.proposedText,chosen().proposedText);
});
test('changed source notes, moved markers and fabricated orphan notes stay withheld',()=>{
 for(const change of [x=>x.chosen.originalText=x.chosen.originalText.replace('First citation.','Changed.'),x=>x.chosen.originalFormatting[0].start--,x=>x.chosen.proposedText+='\n3 New orphan.',x=>x.items[0].proposal.notes[0].complete=false,x=>x.chosen.proposedFormatting=[]]){const input={...setup(),chosen:chosen()};change(input);assert.equal(documentContextPlacement(input).reason,'proposal_note_scope_unavailable');}
});
test('CNS uses native note proof and an unrelated body cannot place',()=>{
 const input={...setup(),chosen:chosen()};input.baseline.evidence[0].procedure='2028/0045(CNS)';input.chosen.documentReferences=[{field:'DocRef',raw:'2028/0045 (CNS)'}];assert.equal(documentContextPlacement(input).status,'placed');
 input.baseline.evidence[0].procedure='2028/0045(NLE)';input.chosen.originalText=input.chosen.originalText.replace('Alpha','Gamma');assert.equal(documentContextPlacement(input).status,'unresolved');
});
test('proposed-only notes before recital one use a complete Whereas block, independent of cover completeness',()=>{
 const texts=['Whereas:','(1) First.','(2) Second.','HAS ADOPTED THIS DECISION:'];const bytes=noteWord(texts.map(text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join(''));
 const input={...setup(),chosen:{...chosen(),targetLabel:'Recital -1 (new)',originalText:'',originalFormatting:[],proposedText:'(-1)\tNew1a.\n_____\n1a New citation.',proposedFormatting:[{kind:'superscript',start:8,end:10}]},items:[{kind:'act',proposal:parseProposal(bytes)}]};
 const a=documentContextPlacement(input);assert.equal(a.status,'placed');assert.equal(a.insertBefore,1);assert.deepEqual(a.noteScope.proposedLabels,['1a']);
 input.items[0].proposal=structuredClone(input.items[0].proposal);input.items[0].proposal.paragraphs[2].complete=false;assert.equal(documentContextPlacement(input).status,'unresolved');
});

test('original-only notes support deletions across proposal procedures',()=>{
 for(const procedure of ['CNS','COD','NLE']){const input={...setup(),chosen:chosen()};input.baseline.evidence[0].procedure=`2028/0045(${procedure})`;input.chosen.documentReferences=[{field:'DocRef',raw:`2028/0045(${procedure})`}];input.chosen.proposedText='deleted';input.chosen.proposedFormatting=[];const a=documentContextPlacement(input);assert.equal(a.status,'placed');assert.equal(a.operation,'delete');if(procedure==='COD')assert.equal(a.noteScope,undefined);else assert.deepEqual(a.noteScope.proposedLabels,[]);input.chosen.originalText=input.chosen.originalText.replace('First citation.','Wrong citation.');assert.equal(documentContextPlacement(input).status,'unresolved');}
});
test('proposed instructions with a plus marker stay in the note comparison',()=>{
 const input={...setup(),chosen:chosen()};input.chosen.proposedText='(1) Changed1a+.\n_____\n1a New citation.\n+ OJ: Please complete the reference.';input.chosen.proposedFormatting=[{kind:'superscript',start:11,end:14}];assert.equal(documentContextPlacement(input).status,'placed');
 input.chosen.proposedText='(1) Changed.\n_____';input.chosen.proposedFormatting=[];assert.equal(documentContextPlacement(input).status,'placed');
});

// A-10-2025-0150 AM 29 deletes Article 30d; its only call-out of the
// proposal's note 8 is printed as note 2 in the list, in every language.
// A-10-2026-0175 AM 3 replaces Recital 65 and drops footnote 23 likewise.
const twoRecitals=(shared=false)=>parseProposal(noteWord(`<w:p><w:r><w:t>(1)\tAlpha</w:t><w:footnoteReference w:id="7"/><w:t> and Beta</w:t>${shared?'<w:footnoteReference w:id="9"/>':''}<w:t>.</w:t></w:r></w:p><w:p><w:r><w:t>(2)\tGamma</w:t><w:footnoteReference w:id="9"/><w:t> and Delta.</w:t></w:r></w:p>`,{notes:noteDefinitions}));
const deletion=(language,label,overrides={})=>({chosen:{baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false},language,targetLabelLanguage:language,targetLabel:label,originalText:'(2)\tGamma1 and Delta.\n_____\n1 Second citation',proposedText:language==='fr'?'supprimé':'deleted',originalFormatting:[{kind:'superscript',start:9,end:10}],proposedFormatting:[],...overrides},items:[{kind:'act',proposal:twoRecitals()}],baseline:{evidence:[{kind:'native-procedure',status:'verified',procedure:'2028/0045(NLE)'}]}});
test('a note called only in deleted text falls with it in any language, whatever the list numbers it',()=>{
 for(const [language,label] of [['en','Recital 2'],['fr','Considérant 2']]){
  const a=documentContextPlacement(deletion(language,label));
  assert.equal(a.status,'placed');assert.equal(a.operation,'delete');assert.deepEqual(a.span,{start:1,end:1});
  assert.deepEqual(a.noteScope.sourceNotes,[{id:'9',label:'1'}]);assert.deepEqual(a.noteScope.proposedLabels,[]);
 }
});
test('a dropped note must be the same note, called only inside the replaced text',()=>{
 const changed=deletion('fr','Considérant 2',{originalText:'(2)\tGamma1 and Delta.\n_____\n1 Other citation'});
 assert.equal(documentContextPlacement(changed).reason,'proposal_note_scope_unavailable');
 const shared=deletion('fr','Considérant 2');shared.items[0].proposal=twoRecitals(true);
 assert.equal(shared.items[0].proposal.anchors.filter(a=>a.note==='9').length,2);
 assert.equal(documentContextPlacement(shared).reason,'proposal_note_scope_unavailable');
 // Outside English, a note kept in the proposed column stays withheld.
 const kept=deletion('fr','Considérant 2',{proposedText:'(2)\tGamma1 and Epsilon.\n_____\n1 Second citation',proposedFormatting:[{kind:'superscript',start:9,end:10}]});
 assert.equal(documentContextPlacement(kept).reason,'proposal_note_scope_unavailable');
});
// A-10-2026-0175 AM 3 fr: the list prints a plain apostrophe where the Council
// XHTML has a typographic one, so only the note-scope path places it.
test('a Council XHTML note numbered differently in the list falls with its deleted recital',async()=>{
 const {parsePublicLegalXhtml}=await import('./public-legal-xhtml.mjs');
 const council=(shared=false)=>parsePublicLegalXhtml(`<html><body><div id="rct_1"><p>(1) Alpha${shared?' <a href="#ntr8">(8)</a>':''} and Beta.</p></div><div id="rct_2"><p>(2) Gamma <a href="#ntr8">(8)</a> and Delta’s.</p></div><p class="oj-note"><a id="ntr8">(8)</a> Second citation.</p></body></html>`,{language:'fr'});
 const input=deletion('fr','Considérant 2');input.items=[{kind:'act',proposal:council()}];
 Object.assign(input.chosen,{baseline:'council-position',baselineSource:{category:'council-position',conflicted:false},originalText:"(2)\tGamma1 and Delta's.\n_____\n1 Second citation."});delete input.baseline;
 const a=documentContextPlacement(input);
 assert.equal(a.status,'placed');assert.equal(a.operation,'delete');assert.deepEqual(a.noteScope.sourceNotes,[{id:'ntr8',label:'1'}]);
 input.chosen.originalText=input.chosen.originalText.replace('Second','Other');assert.equal(documentContextPlacement(input).reason,'proposal_note_scope_unavailable');
 input.chosen.originalText=input.chosen.originalText.replace('Other','Second');input.items=[{kind:'act',proposal:council(true)}];assert.equal(documentContextPlacement(input).reason,'proposal_note_scope_unavailable');
});
