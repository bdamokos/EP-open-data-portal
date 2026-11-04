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
 for(const options of [{notes:[['7','<w:drawing/>'],noteDefinitions[1]]},{notes:noteDefinitions,footnotePr:'<w:sectPr><w:footnotePr><w:numRestart w:val="eachPage"/></w:footnotePr></w:sectPr>'},{notes:noteDefinitions,styles:'<w:docDefaults><w:rPrDefault><w:rPr><w:vanish/></w:rPr></w:rPrDefault></w:docDefaults>'}]){const f=fixture();f.nativeQuoted.proposalBuffer=noteWord(noteBody,options);assert.notEqual(inspectNativeNoteScope(f).status,'verified');}
});
test('public verifier does not fall back past a failed note coordinate or metadata assertion',()=>{
 const f=fixture(),proof=inspectNativeNoteScope(f);f.placement.noteScope={...proof.noteScope,proposedBodyEnd:1};assert.equal(verifyPlacement({...f,items:[{proposal:f.proposal}]}).status,'failed');f.placement.noteScope=proof.noteScope;f.placement.splice.end.paragraph=2;assert.equal(verifyPlacement({...f,items:[{proposal:f.proposal}]}).status,'failed');
});
test('new recitals can carry proposed-only notes with lettered labels and a printed terminal period',()=>{
 const f=fixture();f.placement={status:'placed',operation:'insert',itemIndex:0,insertBefore:0,insertAfter:-1};f.wording.originalText='';f.wording.originalFormatting=[];f.wording.proposedText='(-1)\tNew1b.\n_____\n1b. New citation.';f.wording.proposedFormatting=[{kind:'superscript',start:8,end:11}];const a=inspectNativeNoteScope(f);assert.equal(a.status,'verified');assert.deepEqual(a.noteScope.proposedLabels,['1b']);assert.deepEqual(a.noteScope.sourceNotes,[]);
});
test('native Whereas block independently binds a new negative recital before the first existing recital',async()=>{
 const {assertNativeFirstRecital}=await import('./amendment-note-scope-oracle.mjs');
 const texts=['Whereas:','(1) First.','(2) Second.','HAS ADOPTED THIS DECISION:'];
 const input={proposal:{item:'act',paragraphs:texts.map((text,index)=>({index,text,complete:true,source:{complete:true,path:`/w:document[1]/w:body[1]/w:p[${index+1}]`}}))},wording:{language:'en',targetLabel:'Recital -1 (new)',originalText:'',proposedText:'(-1) New recital.'},placement:{operation:'insert',insertBefore:1,insertAfter:0},nativeQuoted:{proposalBuffer:noteWord(texts.map(text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join(''))}};
 assert.equal(assertNativeFirstRecital(input).status,'verified');const spaced=noteWord(texts.map(text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('').replace('<w:p><w:r><w:t>HAS ADOPTED','<w:p><w:r><w:t> </w:t></w:r></w:p><w:p><w:r><w:t>HAS ADOPTED'));const projected=structuredClone(input.proposal);projected.paragraphs.at(-1).source.path='/w:document[1]/w:body[1]/w:p[5]';assert.equal(assertNativeFirstRecital({...input,proposal:projected,nativeQuoted:{proposalBuffer:spaced}}).status,'verified');assert.equal(assertNativeFirstRecital({...input,placement:{...input.placement,insertBefore:2}}).status,'failed');input.nativeQuoted.proposalBuffer=noteWord(texts.map(text=>`<w:p><w:r><w:t>${text.replace('(2)','(3)')}</w:t></w:r></w:p>`).join(''));assert.equal(assertNativeFirstRecital(input).status,'unverified');
});

test('original-only detached notes independently verify deletion and note-free replacement',()=>{
 for(const proposedText of ['deleted','(1) Changed.']){const f=fixture();f.wording.proposedText=proposedText;f.wording.proposedFormatting=[];assert.equal(inspectNativeNoteScope(f).status,'verified');f.wording.originalText=f.wording.originalText.replace('First citation.','Wrong citation.');assert.equal(inspectNativeNoteScope(f).status,'failed');}
});

test('proposed editorial instructions and empty trailing rules keep their column boundaries',()=>{
 const f=fixture();f.placement={operation:'insert'};f.wording.originalText='';f.wording.originalFormatting=[];f.wording.proposedText='New1a+ text.\n_____\n1a Citation.\n+ OJ: Please complete the reference.';f.wording.proposedFormatting=[{kind:'superscript',start:3,end:6}];assert.equal(inspectNativeNoteScope(f).status,'verified');
 const g=fixture();g.wording.proposedText='Changed.\n_____';g.wording.proposedFormatting=[];assert.equal(inspectNativeNoteScope(g).status,'verified');
});
test('native section numbering restarts before the next section, leaving repeated printed labels distinct',async()=>{
 const {nativeNoteRows}=await import('./amendment-native-note-oracle.mjs');
 const p=(id,section='')=>`<w:p>${section}<w:r><w:t>Body</w:t><w:footnoteReference w:id="${id}"/></w:r></w:p>`;
 const end='<w:sectPr><w:footnotePr><w:numRestart w:val="eachSect"/></w:footnotePr></w:sectPr>';
 const rows=nativeNoteRows(noteWord(p('7',`<w:pPr>${end}</w:pPr>`)+p('9')+end,{notes:noteDefinitions}));
 assert.deepEqual(rows.flatMap(row=>row.refs.map(ref=>ref.label)),['1','1']);
});

test('notes in prior table cells count toward body labels without certifying table wording',async()=>{
 const {nativeNoteRows}=await import('./amendment-native-note-oracle.mjs');
 const ref=id=>`<w:r><w:t>Body</w:t><w:footnoteReference w:id="${id}"/></w:r>`;
 const rows=nativeNoteRows(noteWord(`<w:tbl><w:tr><w:tc><w:p>${ref('7')}</w:p></w:tc></w:tr></w:tbl><w:p>${ref('9')}</w:p>`,{notes:noteDefinitions}));
 assert.deepEqual(rows.flatMap(row=>row.refs.map(ref=>ref.label)),['2']);
});
test('native recast reading preserves note offsets after deleted runs',async()=>{
 const {nativeRecastNoteReading}=await import('./amendment-recast-oracle.mjs');
 const styles='<w:styles><w:style w:type="character" w:styleId="Gone"><w:name w:val="CR Deleted"/><w:rPr><w:strike/></w:rPr></w:style></w:styles>';
 const body='<w:p><w:r><w:rPr><w:rStyle w:val="Gone"/></w:rPr><w:t>Removed </w:t></w:r><w:r><w:t>Kept</w:t><w:footnoteReference w:id="7"/></w:r></w:p>';
 const reading=nativeRecastNoteReading(noteWord(body,{styles,notes:noteDefinitions}),'/w:document[1]/w:body[1]/w:p[1]');assert.equal(reading.text,'Kept');assert.deepEqual(reading.refs,[{id:'7',offset:4}]);
});
