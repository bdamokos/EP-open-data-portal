import test from 'node:test';import assert from 'node:assert/strict';
import {inspectCouncilPdfNoteScope,councilNoteGeometry} from './amendment-council-note-oracle.mjs';
import {assertCouncilDraftPlacement} from './amendment-council-draft-oracle.mjs';
function fixture(citation='Published citation.',identity=''){
 const lead='Alpha'+(identity?' '+identity:'');
 const word=(text,x,y,width=20,height=10)=>`<word xMin="${x}" yMin="${y}" xMax="${x+width}" yMax="${y+height}">${text}</word>`;
 const bbox='<page width="200" height="300">'+word('(1)',10,100,15)+word(lead,30,100,29)+word('8',60,96,4,6)+word('body.',65,100)+word('(2)',10,140,15)+word('Next.',30,140)+word('8',10,240,4,6)+word(citation,30,241,130)+word('1234/26',10,280,40)+word('1',180,280,10)+'</page>';
 const body='(1) '+lead+'8 body.',next='(1) Changed8 body.',mark=text=>[{kind:'superscript',start:text.lastIndexOf('8'),end:text.lastIndexOf('8')+1}],text='(1) '+lead+' body.';
 const proposal={sourceKind:'pdf',paragraphs:[{index:0,text,complete:true,source:{path:'body',complete:true,pages:[1],mcids:[{page:1,mcid:0}]}},{index:1,text:'(2) Next.'}],notes:[{id:'pdf-note:note',label:'8',text:citation,complete:true,source:{path:'note'}}],anchors:[{paragraph:0,offset:4+lead.length,note:'pdf-note:note',label:'8'}]};
 return {bbox,structure:[{ref:'body',note:false,pages:[1],mcids:[{page:1,mcid:0}]},{ref:'note',note:true,pages:[1],mcids:[{page:1,mcid:1}]}],wording:{language:'en',targetLabel:'Recital 1',originalText:body+'\n_____\n8 '+citation,proposedText:next+'\n_____\n8 '+citation,originalFormatting:mark(body),proposedFormatting:mark(next)},items:[{proposal}],placement:{status:'placed',operation:'replace',itemIndex:0,span:{start:0,end:0},splice:{start:{paragraph:0,offset:0},end:{paragraph:0,offset:text.length}}}};
}
test('independent PDF evidence separates the whole body and its unique tagged native note',()=>{
 const f=fixture(),p=inspectCouncilPdfNoteScope(f);assert.equal(p.status,'verified');assert.equal(p.bodyWording.originalText,'(1) Alpha body.');assert.equal(p.noteScope.kind,'pdf-footnotes');assert.deepEqual(p.noteScope.sourceNotes,[{id:'pdf-note:note',label:'8'}]);
 f.placement.noteScope=p.noteScope;assert.equal(inspectCouncilPdfNoteScope(f).status,'verified');
});
for(const [name,change] of [
 ['shifted splice',f=>f.placement.splice.start.offset=1],
 ['truncated splice',f=>f.placement.splice.end.offset--],
 ['wrong ordinal',f=>f.wording.targetLabel='Recital 2'],
 ['moved marker',f=>f.items[0].proposal.anchors[0].offset--],
 ['marker after whitespace',f=>f.items[0].proposal.anchors[0].offset++],
 ['wrong original marker',f=>f.wording.originalFormatting[0].start--],
 ['changed original note',f=>f.wording.originalText=f.wording.originalText.replace('Published citation.','Other citation.')],
 ['omitted identifier',f=>f.wording.originalText=f.wording.originalText.replace('Published citation.','citation.')],
 ['incomplete source note',f=>f.items[0].proposal.notes[0].complete=false],
 ['changed projected note',f=>f.items[0].proposal.notes[0].text='Other citation.'],
 ['wrong tagged note',f=>f.items[0].proposal.notes[0].source.path='another-note'],
 ['wrong source MCID',f=>f.items[0].proposal.paragraphs[0].source.mcids[0].mcid=2],
 ['ambiguous tagged notes',f=>f.structure.push({...f.structure[1],ref:'other'})],
 ['fabricated proposed orphan',f=>f.wording.proposedText+='\n9 Other note.'],
 ['missing proposed marker',f=>f.wording.proposedFormatting=[]],
 ['ambiguous separator',f=>f.wording.originalText+='\n_____\nMore'],
 ['painted-note geometry missing',f=>f.bbox=f.bbox.replace('yMin="240"','yMin="100"')],
])test(`PDF note proof rejects ${name}`,()=>{const f=fixture();change(f);assert.notEqual(inspectCouncilPdfNoteScope(f).status,'verified');});
test('a small punctuation typo preserves every word and the exact URI',()=>{
 const citation='Published citation, ELI: http://example.test/act/1.',f=fixture(citation);
 f.wording.originalText=f.wording.originalText.replace('Published citation,','Published citation.,');assert.equal(inspectCouncilPdfNoteScope(f).status,'verified');
 f.wording.originalText=f.wording.originalText.replace('http://example.test/act/1.','http://exampletest/act/1.');assert.notEqual(inspectCouncilPdfNoteScope(f).status,'verified');
});
test('a copied body elsewhere cannot certify moved coordinates',()=>{
 const f=fixture(),p=f.items[0].proposal;p.paragraphs.push({...p.paragraphs[0],index:2});p.anchors.push({...p.anchors[0],paragraph:2});f.placement.span={start:2,end:2};f.placement.splice.start.paragraph=2;f.placement.splice.end.paragraph=2;assert.notEqual(inspectCouncilPdfNoteScope(f).status,'verified');
});
test('invalid geometry and non-native ordinary digits cannot create a note owner',()=>{
 for(const bbox of ['',fixture().bbox.replace('yMax="102"','yMax="106"'),fixture().bbox.replace('1234/26','not-a-footer')])assert.equal(councilNoteGeometry(bbox),null);
});
test('the public PDF assertion refuses native bytes from another projected source',()=>{
 const f=fixture();f.items[0].proposal.sourceHash='0'.repeat(64);
 assert.deepEqual(assertCouncilDraftPlacement({...f,nativeQuoted:{proposalBuffer:Buffer.from('different PDF')}}),{status:'failed',reason:'oracle-council-pdf-note-source-hash-mismatch'});
});


test('an omitted whole citation identifier is proved in the unchanged addressed native body',()=>{
 const f=fixture('Published K(2007) 5841 citation.','K(2007)5841');
 f.wording.originalText=f.wording.originalText.replace('Published K(2007) 5841 citation.','Published citation.');f.placement.originalDifference='omitted-citation-identifier';
 assert.equal(inspectCouncilPdfNoteScope(f).status,'verified');
 for(const change of [x=>delete x.placement.originalDifference,x=>x.placement.originalDifference='one-word',x=>x.wording.originalText=x.wording.originalText.replace('Published citation.','Published citation;'),x=>x.wording.originalText=x.wording.originalText.replace('Published citation.','Published K(2007) 5842 citation.'),x=>x.wording.originalText=x.wording.originalText.replace('Published citation.','citation.'),x=>x.placement.splice.start.offset++,x=>x.items[0].proposal.anchors[0].offset--]){const x=structuredClone(f);change(x);assert.notEqual(inspectCouncilPdfNoteScope(x).status,'verified');}
 for(const body of ['', 'K(2007)5842','K(2007)5841 K(2007)5841']){const x=fixture('Published K(2007) 5841 citation.',body);x.wording.originalText=x.wording.originalText.replace('Published K(2007) 5841 citation.','Published citation.');x.placement.originalDifference='omitted-citation-identifier';assert.notEqual(inspectCouncilPdfNoteScope(x).status,'verified');}
 const two=fixture('Published K(2007)5841 and C(2008)12 citation.','K(2007)5841');two.wording.originalText=two.wording.originalText.replace('Published K(2007)5841 and C(2008)12 citation.','Published citation.');two.placement.originalDifference='omitted-citation-identifier';assert.notEqual(inspectCouncilPdfNoteScope(two).status,'verified');
 const uri=fixture('Published K(2007)5841 citation http://example.test/act/1.','K(2007)5841');uri.wording.originalText=uri.wording.originalText.replace('K(2007)5841 citation http://example.test/act/1.','citation http://other.test/act/1.');uri.placement.originalDifference='omitted-citation-identifier';assert.notEqual(inspectCouncilPdfNoteScope(uri).status,'verified');
 const exact=fixture();exact.placement.originalDifference='omitted-citation-identifier';assert.notEqual(inspectCouncilPdfNoteScope(exact).status,'verified');
});
