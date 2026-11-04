import test from 'node:test';import assert from 'node:assert/strict';
import {parseProposal} from './proposal-structure.mjs';import {documentContextPlacement} from './document-context-placement.mjs';
function fixture(citation='Native citation, ELI: http://example.test/act/1.',identity=''){
 const lead='Alpha'+(identity?' '+identity:'');
 const paragraphs=['(1) '+lead+' body.','(2) Next recital.','Article 1','Operative text.'],projection={sourceKind:'pdf',structureStatus:'extracted',paragraphs,paragraphSources:paragraphs.map((_,i)=>({part:'pdf',path:'p'+i,role:'/P',pages:[1],mcids:[{page:1,mcid:i}],complete:true})),paragraphProperties:paragraphs.map(()=>({notesComplete:true,annotationsComplete:true})),notes:[{id:'pdf-note:n',label:'8',text:citation,complete:true,source:{part:'pdf',path:'n',pages:[1]},objects:[]}],anchors:[{paragraph:0,offset:4+lead.length,note:'pdf-note:n',label:'8'}]};
 const body='(1) '+lead+'8 body.',next='(1) Changed8 body.',mark=s=>[{kind:'superscript',start:s.lastIndexOf('8'),end:s.lastIndexOf('8')+1}];
 return {chosen:{baseline:'council-position',baselineSource:{category:'council-position',conflicted:false},language:'en',targetLabelLanguage:'en',targetLabel:'Recital 1',originalText:body+'\n_____\n8 '+citation,proposedText:next+'\n_____\n8 '+citation,originalFormatting:mark(body),proposedFormatting:mark(next)},items:[{kind:'act',proposal:structuredClone(parseProposal(projection,{language:'en'}))}],baseline:{status:'available',language:'en',evidence:[{kind:'report-council-draft'}]}};
}
test('Council PDF note comparisons reuse whole-body placement and retain published columns',()=>{
 const f=fixture(),before=JSON.stringify(f.chosen),p=documentContextPlacement(f);assert.equal(p.status,'placed');assert.deepEqual(p.span,{start:0,end:0});assert.equal(p.splice.end.offset,f.items[0].proposal.paragraphs[0].text.length);assert.equal(p.noteScope.kind,'pdf-footnotes');assert.equal(p.noteScope.originalBodyEnd,f.chosen.originalText.indexOf('\n_____'));assert.equal(JSON.stringify(f.chosen),before);
});
for(const [name,change] of [
 ['unbound report record',f=>f.baseline.evidence=[]],
 ['multiple source items',f=>f.items.push(structuredClone(f.items[0]))],
 ['incomplete source page',f=>f.items[0].proposal.paragraphs[0].complete=false],
 ['unproved note ownership',f=>f.items[0].proposal.paragraphs[0].properties.notesComplete=false],
 ['unproved annotation',f=>f.items[0].proposal.paragraphs[0].properties.annotationsComplete=false],
 ['incomplete note',f=>f.items[0].proposal.notes[0].complete=false],
 ['note on another page',f=>f.items[0].proposal.notes[0].source.pages=[2]],
 ['second note on page',f=>f.items[0].proposal.notes.push({...f.items[0].proposal.notes[0],id:'other',label:'9'})],
 ['shared note owner',f=>f.items[0].proposal.anchors.push({...f.items[0].proposal.anchors[0],paragraph:1})],
 ['marker shifted to another word',f=>f.items[0].proposal.anchors[0].offset--],
 ['marker shifted after whitespace',f=>f.items[0].proposal.anchors[0].offset++],
 ['malformed original superscript',f=>f.chosen.originalFormatting[0].start--],
 ['missing proposed superscript',f=>f.chosen.proposedFormatting=[]],
 ['duplicate payload',f=>f.chosen.proposedText+='\n8 Another citation.'],
 ['changed original body',f=>f.chosen.originalText=f.chosen.originalText.replace('Alpha','Gamma')],
 ['changed URI punctuation',f=>f.chosen.originalText=f.chosen.originalText.replace('example.test','exampletest')],
])test(`Council PDF note scope withholds ${name}`,()=>{const f=fixture();change(f);assert.equal(documentContextPlacement(f).status,'unresolved');});
test('one citation punctuation typo is accepted; missing identifiers and digits are withheld',()=>{
 const f=fixture();f.chosen.originalText=f.chosen.originalText.replace('Native citation,','Native citation.,');assert.equal(documentContextPlacement(f).status,'placed');
 for(const citation of ['Native K(2007) 5841 citation.','Native 1.2 citation.']){const g=fixture(citation);g.chosen.originalText=g.chosen.originalText.replace('K(2007) 5841 ','').replace('1.2','12');assert.equal(documentContextPlacement(g).reason,'council_pdf_note_text_mismatch');}
});


test('an omitted citation identifier remains exact in the uniquely addressed body and gets a short note kind',()=>{
 const f=fixture('Native K(2007) 5841 citation, ELI: http://example.test/act/1.','K(2007)5841');f.chosen.originalText=f.chosen.originalText.replace('Native K(2007) 5841 citation','Native citation');const before=JSON.stringify(f.chosen);
 const p=documentContextPlacement(f);assert.equal(p.status,'placed');assert.equal(p.originalDifference,'omitted-citation-identifier');assert.equal(p.noteScope.kind,'pdf-footnotes');assert.deepEqual(p.span,{start:0,end:0});assert.equal(p.splice.end.offset,f.items[0].proposal.paragraphs[0].text.length);assert.equal(JSON.stringify(f.chosen),before);assert(f.chosen.originalText.includes('Native citation'));
 for(const change of [x=>x.chosen.originalText=x.chosen.originalText.replace('Native citation','Other citation'),x=>x.chosen.originalText=x.chosen.originalText.replace('Native citation,','Native citation;'),x=>x.chosen.originalText=x.chosen.originalText.replace('/act/1.','/act/2.'),x=>x.items.push(structuredClone(x.items[0])),x=>x.items[0].proposal.notes[0].complete=false]){const x=structuredClone(f);change(x);assert.equal(documentContextPlacement(x).status,'unresolved');}
 for(const identity of ['', 'K(2007)5842','K(2007)5841 K(2007)5841']){const x=fixture('Native K(2007) 5841 citation.',identity);x.chosen.originalText=x.chosen.originalText.replace('K(2007) 5841 ','');assert.equal(documentContextPlacement(x).status,'unresolved');}
 const two=fixture('Native K(2007)5841 C(2008)12 citation.','K(2007)5841');two.chosen.originalText=two.chosen.originalText.replace('K(2007)5841 C(2008)12 ','');assert.equal(documentContextPlacement(two).status,'unresolved');
});
