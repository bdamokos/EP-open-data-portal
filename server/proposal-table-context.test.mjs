import test from 'node:test';import assert from 'node:assert/strict';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {tableContextNative,tableParagraph,contextTable} from '../scripts/fixtures/table-context-native.mjs';
const place=a=>resolveProposalPlacement(a.items,a.wording,{nativeProposalInputs:a.nativeProposalInputs});
test('elided table amendments select the full physical table without a cell splice',()=>{
 for(const inherited of [false,true]){const input=tableContextNative({inherited}),actual=place(input);assert.equal(actual.status,'placed',actual.reason);assert.deepEqual(actual.span,input.placement.span);assert.equal(actual.splice,undefined);assert.equal(actual.evidence[0].basis,'table-level-elision');assert.equal(place({...input,nativeProposalInputs:[]}).status,'unresolved');}
});
test('context fallback rejects altered retained cells, headers, captions and duplicate tables',()=>{
 for(const change of [xml=>xml.replace('Nitrate of potassium','Different substance'),xml=>xml.replace('Fertilisers','Aluminium'),xml=>xml.replace('</w:body>',tableParagraph('Fertilisers')+contextTable([['CN code','Description'],['28342100','Nitrate of potassium']])+'</w:body>')])assert.equal(place(tableContextNative({change})).status,'unresolved');
 for(const mutate of [a=>a.proposal.sourceHash='wrong',a=>a.proposal.paragraphs[a.placement.span.start].complete=false,a=>a.wording.originalText=a.wording.originalText.replace('CN code','Other header'),a=>a.wording.originalText=a.wording.originalText.replace('…\t…','…\tDescription'),a=>a.items.push(a.items[0])]){const input=tableContextNative();mutate(input);assert.equal(place(input).status,'unresolved',mutate.toString());}
});
test('the underlying annex and point must agree with the native governing and table instructions',()=>{
 const positive=tableContextNative({instruction:true});assert.equal(place(positive).status,'placed');
 for(const [from,to] of [['Annex II','Annex IX'],['point 2','point 99']]){const input=tableContextNative({instruction:true});input.wording.targetPath.underlying[0].raw=input.wording.targetPath.underlying[0].raw.replace(from,to);assert.equal(place(input).status,'unresolved');}
});
