import test from 'node:test';import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFOperator,PDFString,StandardFonts} from 'pdf-lib';
import {extractCouncilDraftPdf} from './council-draft-pdf.mjs';
import {parseProposal} from './proposal-structure.mjs';
import {createHash} from 'node:crypto';

async function fixture({tagged=true,paint=false,noteOwners=0,extraRole=null}={}) {
 const pdf=await PDFDocument.create(),page=pdf.addPage(),context=pdf.context;
 const font=await pdf.embedFont(StandardFonts.Helvetica);
 page.pushOperators(PDFOperator.of('BDC',[PDFName.of('P'),context.obj({MCID:0})]));
 page.drawText('1234/26 2023/0123 (CNS)',{x:60,y:700,size:12,font});
 for(let i=0;i<noteOwners;i++)page.drawText('1',{x:320+i*25,y:705,size:8,font});
 page.pushOperators(PDFOperator.of('EMC'));
 if(noteOwners){page.pushOperators(PDFOperator.of('BDC',[PDFName.of('P'),context.obj({MCID:1})]));page.drawText('1 Note body.',{x:60,y:100,size:12,font});page.pushOperators(PDFOperator.of('EMC'));}
 if(paint)page.drawRectangle({x:70,y:650,width:40,height:40});
 if(extraRole){page.pushOperators(PDFOperator.of('BDC',[PDFName.of('P'),context.obj({MCID:2})]));page.drawText('1. Native list body.',{x:60,y:500,size:12,font});page.pushOperators(PDFOperator.of('EMC'));}
 if(tagged){const root=context.obj({Type:'StructTreeRoot'}),rootRef=context.register(root),element=context.obj({Type:'StructElem',S:'P',P:rootRef,Pg:page.ref,K:0}),ref=context.register(element);const kids=[ref];if(noteOwners){const note=context.obj({Type:'StructElem',S:'Note',P:rootRef,Pg:page.ref}),noteRef=context.register(note),noteP=context.register(context.obj({Type:'StructElem',S:'P',P:noteRef,Pg:page.ref,K:1}));note.set(PDFName.of('K'),context.obj([noteP]));kids.push(noteRef);}if(extraRole)kids.push(context.register(context.obj({Type:'StructElem',S:extraRole,P:rootRef,Pg:page.ref,K:2})));root.set(PDFName.of('K'),context.obj(kids));pdf.catalog.set(PDFName.of('StructTreeRoot'),rootRef);}
 return Buffer.from(await pdf.save());
}
const identity={number:1234,year:2026,procedure:'2023/0123(CNS)'};
test('native structure reference owns paragraph; complete text needs an empty paint audit',async()=>{
 const buffer=await fixture(),result=await extractCouncilDraftPdf(buffer,identity),parsedNative=parseProposal(result);
 assert.equal(parsedNative.nativeSourceHash,createHash('sha256').update(buffer).digest('hex'));
 assert.notEqual(parsedNative.sourceHash,parsedNative.nativeSourceHash);
 assert.equal(result.paragraphs[0],'1234/26 2023/0123 (CNS)');
 assert.match(result.paragraphSources[0].path,/^\d+ 0 R$/u);
 assert.equal(result.paragraphSources[0].complete,true);
 assert.deepEqual(result.proof.ownershipGaps,[]);
 const painted=await extractCouncilDraftPdf(await fixture({paint:true}),identity);
 assert.equal(painted.paragraphSources[0].complete,false);
 assert(painted.proof.pageProofs[0].paint.length>0);
 const parsed=parseProposal(painted);assert(parsed.paragraphs.every(p=>!p.complete));
});
test('source proof refuses absent tags, wrong identity, bytes and cancellation',async()=>{
 await assert.rejects(extractCouncilDraftPdf(await fixture({tagged:false}),identity),/tags-unavailable/u);
 await assert.rejects(extractCouncilDraftPdf(await fixture(),{...identity,number:9999}),/st-mismatch/u);
 await assert.rejects(extractCouncilDraftPdf(await fixture(),{...identity,procedure:'2023/9999(CNS)'}),/procedure-mismatch/u);
 await assert.rejects(extractCouncilDraftPdf(Buffer.from('no PDF'),identity),/byte-limit/u);
 const controller=new AbortController();controller.abort(new Error('test cancelled'));
 await assert.rejects(extractCouncilDraftPdf(await fixture(),{...identity,signal:controller.signal}),/test cancelled/u);
});

test('native note paragraphs bind one superscript owner; repeated owners stay incomplete',async()=>{
 const bound=await extractCouncilDraftPdf(await fixture({noteOwners:1}),identity);
 assert.equal(bound.notes.length,1);assert.equal(bound.notes[0].text,'Note body.');assert.deepEqual(bound.notes[0].links,[]);assert.equal(bound.anchors.length,1);assert.equal(bound.anchors[0].note,bound.notes[0].id);assert.deepEqual(bound.proof.ownershipGaps,[]);assert.equal(bound.paragraphProperties[0].notesComplete,true);
 const ambiguous=await extractCouncilDraftPdf(await fixture({noteOwners:2}),identity);
 assert(ambiguous.proof.ownershipGaps.some(g=>g.code==='council-pdf-note-owner-unproved'));
 assert.equal(ambiguous.paragraphProperties[0].notesComplete,false);
});

test('direct native LBody content is retained; an unsupported text owner keeps its page incomplete',async()=>{
 const list=await extractCouncilDraftPdf(await fixture({extraRole:'LBody'}),identity);
 assert.equal(list.paragraphs[1],'1. Native list body.');assert.equal(list.paragraphSources[1].role,'/LBody');assert(list.paragraphSources.every(p=>p.complete));
 const unsupported=await extractCouncilDraftPdf(await fixture({extraRole:'Figure'}),identity);
 assert.equal(unsupported.paragraphs.length,1);assert.equal(unsupported.paragraphSources[0].complete,false);assert.equal(unsupported.proof.pageProofs[0].unownedMarkedText[0].mcid,2);
});

async function linkFixture(appearance='q Q',actionExtra=false){
 const pdf=await PDFDocument.create(),page=pdf.addPage(),context=pdf.context,font=await pdf.embedFont(StandardFonts.Helvetica),url='https://example.eu/act',width=font.widthOfTextAtSize(url,12);
 page.pushOperators(PDFOperator.of('BDC',[PDFName.of('P'),context.obj({MCID:0})]));page.drawText('1234/26 2023/0123 (CNS)',{x:60,y:700,size:12,font});page.drawText(url,{x:60,y:600,size:12,font});page.drawRectangle({x:60,y:598.5,width,height:.5});page.pushOperators(PDFOperator.of('EMC'));
 const ap=context.register(context.flateStream(appearance,{Type:'XObject',Subtype:'Form',BBox:[0,0,width+4,16],Resources:{}}));
 const link=context.register(context.obj({Type:'Annot',Subtype:'Link',Rect:[58,596,64+width,612],F:4,BS:{W:0},A:{S:'URI',URI:PDFString.of(url),...(actionExtra?{Next:{S:'JavaScript',JS:PDFString.of('void 0')}}:{})},AP:{N:ap}}));page.node.set(PDFName.of('Annots'),context.obj([link]));
 const root=context.obj({Type:'StructTreeRoot'}),rootRef=context.register(root),object=context.register(context.obj({Type:'OBJR',Obj:link,Pg:page.ref})),p=context.register(context.obj({Type:'StructElem',S:'P',P:rootRef,Pg:page.ref,K:[0,object]}));root.set(PDFName.of('K'),context.obj([p]));pdf.catalog.set(PDFName.of('StructTreeRoot'),rootRef);return Buffer.from(await pdf.save());
}
test('native link appearances and actions must be empty or fully accounted for',async()=>{
 const link=await extractCouncilDraftPdf(await linkFixture(),identity);
 assert.equal(link.paragraphSources[0].complete,true,JSON.stringify(link.proof.pageProofs));assert.equal(link.links[0].url,'https://example.eu/act');assert.equal(link.proof.pageProofs[0].ownedPaint[0].kind,'link-underline');
 for(const buffer of [await linkFixture('0 0 10 10 re f'),await linkFixture('q Q',true)]){const unproved=await extractCouncilDraftPdf(buffer,identity);assert.equal(unproved.paragraphSources[0].complete,false);assert.equal(unproved.proof.pageProofs[0].annotations.length,1);}
});
