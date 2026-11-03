import test from 'node:test';import assert from 'node:assert/strict';
import {noteWord,noteBody,noteDefinitions} from '../server/test-support/note-scope-fixture.mjs';
import {inspectNativeNoteScope} from './amendment-note-scope-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
function fixture(){
 const originalBody='(1)\tAlpha1 and Beta2.',proposedBody='(1)\tChanged2.';
 const marks=(body,labels)=>labels.map(label=>({kind:'superscript',start:body.indexOf(label,3),end:body.indexOf(label,3)+label.length}));
 const wording={baseline:'commission-proposal',language:'en',targetLabel:'Recital 1',originalText:originalBody+'\n_____\n1 First citation.\n2 Second citation.',proposedText:proposedBody+'\n_____\n1 First citation.\n2 Second citation.',originalFormatting:marks(originalBody,['1','2']),proposedFormatting:marks(proposedBody,['2'])};
 const text='(1)\tAlpha and Beta.',proposal={sourceKind:'docx',paragraphs:[{index:0,text,complete:true,source:{complete:true,path:'/w:document[1]/w:body[1]/w:p[1]'}}],anchors:[{paragraph:0,offset:9,note:'7',label:'1'},{paragraph:0,offset:18,note:'9',label:'2'}],notes:noteDefinitions.map(([id,text],i)=>({id,text,label:String(i+1),complete:true})),units:[]};
 return {proposal,wording,placement:{status:'placed',operation:'replace',itemIndex:0,span:{start:0,end:0},splice:{start:{paragraph:0,offset:0},end:{paragraph:0,offset:text.length}},evidence:[]},nativeQuoted:{proposalBuffer:noteWord(noteBody,{notes:noteDefinitions})}};
}
test('note assertion binds original payload and anchors to native bytes, retaining an unchanged unreferenced note',()=>{
 const f=fixture(),a=inspectNativeNoteScope(f);assert.equal(a.status,'verified');assert.deepEqual(a.noteScope.unreferencedLabels,['1']);assert.deepEqual(a.noteScope.sourceNotes,[{id:'7',label:'1'},{id:'9',label:'2'}]);assert.equal(a.bodyWording.proposedText,'(1)\tChanged2.');
});
test('note assertion rejects moved coordinates, payloads and projection notes even when the body still matches',()=>{
 for(const change of [f=>f.placement.splice.start.paragraph=1,f=>f.placement.splice.end.paragraph=1,f=>f.proposal.anchors[0].offset++,f=>f.proposal.notes[0].text='Changed.',f=>f.wording.originalText=f.wording.originalText.replace('First citation.','Changed.'),f=>f.nativeQuoted.proposalBuffer=noteWord(noteBody.replace('Alpha','Alphx'),{notes:noteDefinitions})]){const f=fixture();change(f);assert.equal(inspectNativeNoteScope(f).status,'failed');}
});
test('unmatched, duplicate or fabricated notes and ambiguous separators are withheld',()=>{
 for(const change of [f=>f.wording.proposedText=f.wording.proposedText.replace('1 First citation.','1 Changed.'),f=>f.wording.proposedText+='\n3 Fabricated.',f=>f.wording.proposedText+='\n2 Duplicate.',f=>f.wording.proposedText+='\n_____\nMore.',f=>f.wording.proposedFormatting=[]]){const f=fixture();change(f);assert.notEqual(inspectNativeNoteScope(f).status,'verified');}
});
test('native hidden notes and unsupported numbering cannot certify a projected comparison',()=>{
 for(const options of [{notes:[['7','<w:drawing/>'],noteDefinitions[1]]},{notes:noteDefinitions,footnotePr:'<w:sectPr><w:footnotePr><w:numRestart w:val="eachSect"/></w:footnotePr></w:sectPr>'},{notes:noteDefinitions,styles:'<w:docDefaults><w:rPrDefault><w:rPr><w:vanish/></w:rPr></w:rPrDefault></w:docDefaults>'}]){const f=fixture();f.nativeQuoted.proposalBuffer=noteWord(noteBody,options);assert.notEqual(inspectNativeNoteScope(f).status,'verified');}
});
test('public verifier does not fall back past a failed note coordinate or metadata assertion',()=>{
 const f=fixture(),proof=inspectNativeNoteScope(f);f.placement.noteScope={...proof.noteScope,proposedBodyEnd:1};assert.equal(verifyPlacement({...f,items:[{proposal:f.proposal}]}).status,'failed');f.placement.noteScope=proof.noteScope;f.placement.splice.end.paragraph=2;assert.equal(verifyPlacement({...f,items:[{proposal:f.proposal}]}).status,'failed');
});
test('new recitals can carry proposed-only notes with lettered labels and a printed terminal period',()=>{
 const f=fixture();f.placement={status:'placed',operation:'insert',itemIndex:0,insertBefore:0,insertAfter:-1};f.wording.originalText='';f.wording.originalFormatting=[];f.wording.proposedText='(-1)\tNew1b.\n_____\n1b. New citation.';f.wording.proposedFormatting=[{kind:'superscript',start:8,end:11}];const a=inspectNativeNoteScope(f);assert.equal(a.status,'verified');assert.deepEqual(a.noteScope.proposedLabels,['1b']);assert.deepEqual(a.noteScope.sourceNotes,[]);
});
