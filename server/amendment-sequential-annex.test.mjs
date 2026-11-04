import test from 'node:test';import assert from 'node:assert/strict';
import {sequentialAnnexNative} from '../scripts/fixtures/sequential-annex-native.mjs';
import {createHash} from 'node:crypto';
import {DocumentContext,documentContextQuery} from './document-context.mjs';
import {extractAmendments} from './amendment-documents.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {documentContextPlacement} from './document-context-placement.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const extract=a=>extractAmendments(a.nativeQuoted.amendmentBuffer,{language:'en',listId:'A-10-2026-0001-AM-001-002',targetDocumentId:'A-10-2026-0001'}).amendments.find(row=>row.number===2);
const place=(a,w)=>resolveProposalPlacement(a.items,w,{nativeProposalInputs:[a.nativeQuoted.proposalBuffer]});
test('producer retains the native second-annex frame and proves preceding published order',()=>{const a=sequentialAnnexNative(),w=extract(a);assert.equal(w.proposedText,a.wording.proposedText);assert.deepEqual(w.documentReferences.find(r=>r.field==='PrecedingAnnex'),a.wording.documentReferences[1]);const p=place(a,w);assert.equal(p.status,'placed');assert.equal(p.insertBefore,a.placement.insertBefore);assert.equal(p.evidence.find(e=>e.basis==='sequential-new-annex').reference,'1');assert.equal(verifyPlacement({...a,wording:w,placement:p}).status,'verified');});
test('missing or changed native predecessor and ambiguous second-annex layout do not emit order proof',()=>{
 for(const change of [x=>x.replace('Amendment\t\t1','Amendment\t\t3'),x=>x.replace('Annex 1 - Indicators','Annex 3 - Indicators'),x=>x.replace('>INDICATORS<','>WRONG CAPTION<'),x=>x.replace('Published complete indicator wording.','…'),x=>x.replace('<w:tblGrid><w:gridCol/></w:tblGrid>','<w:tblGrid/>'),x=>x.replace('>The programme','><w:drawing/>The programme'),x=>x.replace('>The programme','><w:vanish/>The programme')]){const a=sequentialAnnexNative({change}),w=extract(a);assert(!w.documentReferences.some(r=>r.field==='PrecedingAnnex'));assert.notEqual(place(a,w).status,'placed');}
});
test('source signature proof remains required and marker declarations cannot change target meaning',()=>{
 for(const edit of [a=>a.wording.documentReferences[1].raw='5',a=>a.wording.documentReferences[1].sourceRaw='Annex 3 - Wrong',a=>a.wording.targetPath.underlying=[{raw:'Annex I'}],a=>a.wording.number=9,a=>a.wording.listId='A-10-2026-0001-AM-002-002',a=>a.wording.proposedText=a.wording.proposedText.replace('ANNEX','TABLE')]){const a=sequentialAnnexNative();edit(a);assert.notEqual(place(a,a.wording).status,'placed');}
 const a=sequentialAnnexNative();assert.notEqual(resolveProposalPlacement(a.items,a.wording).status,'placed');
});
test('live selector receives the selected amendment number privately',()=>{const a=sequentialAnnexNative(),chosen={...extract(a),targetLabelLanguage:'en'};delete chosen.number;const p=documentContextPlacement({chosen,items:a.items,nativeProposalInputs:[a.nativeQuoted.proposalBuffer],amendmentNumber:2});assert.equal(p.status,'placed');assert.equal(documentContextPlacement({chosen,items:a.items,nativeProposalInputs:[a.nativeQuoted.proposalBuffer]}).status,'unresolved');});

test('live endpoint forwards the exact selected number without exposing source buffers',async()=>{
 const input=sequentialAnnexNative(),wording=extract(input),id='A-10-2026-0001',listId=id+'-AM-001-002',source={url:'https://data.europarl.europa.eu/distribution/doc/test_en.docx',fetchedAt:'2026-11-04T10:00:00Z',language:'en',sha256:createHash('sha256').update(input.nativeQuoted.amendmentBuffer).digest('hex')},work={id:'eli/dl/doc/'+id,identifier:id,document_date:'2026-09-15',work_type:'def/ep-document-types/REPORT_PLENARY',title_dcterms:{en:'Test'},is_realized_by:[]};
 const reader=new DocumentContext({request:async()=>({payload:{data:[work]},fetchedAt:Date.parse(source.fetchedAt)}),readText:async()=>({status:'available',paragraphs:['Report'],textLanguage:'en',structureStatus:'extracted'}),findAmendment:()=>({...wording,id:id+'-AM-2',targetDocumentId:id,listId,language:'en',textIntegrity:'complete',wordingSource:source,authors:[]}),readProposal:async()=>({status:'available',language:'en',workId:'test',gaps:[],evidence:[],items:[{kind:'act',index:1,itemId:'test',buffer:input.nativeQuoted.proposalBuffer,source:{...source,sha256:createHash('sha256').update(input.nativeQuoted.proposalBuffer).digest('hex')}}]})});
 const query={...documentContextQuery(id,new URLSearchParams()),amendmentId:id+'-AM-2',listId,wordingLanguage:'en'},result=await reader.query(query,{store:{}});assert.equal(result.placement?.status,'placed');assert.equal(result.placement.insertBefore,input.placement.insertBefore);assert.equal(result.placement.evidence.find(e=>e.basis==='sequential-new-annex').reference,'1');assert.equal(Object.hasOwn(result,'amendmentNumber'),false);assert.equal(JSON.stringify(result).includes('\"type\":\"Buffer\"'),false);
});
