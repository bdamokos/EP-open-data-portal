import test from 'node:test';import assert from 'node:assert/strict';
import {assertTableContext} from './amendment-table-context-oracle.mjs';
import {tableContextNative,tableParagraph,contextTable} from './fixtures/table-context-native.mjs';
test('independent native table proof covers the entire table without consulting placer units',()=>{
 for(const inherited of [false,true]){const input=tableContextNative({inherited});Object.defineProperty(input.proposal,'units',{get(){throw Error('placer hierarchy forbidden');}});assert.equal(assertTableContext(input).status,'verified');
 for(const placement of [{...input.placement,span:{...input.placement.span,start:input.placement.span.start+1}},{...input.placement,splice:{start:{paragraph:0,offset:0},end:{paragraph:1,offset:1}}}])assert.equal(assertTableContext({...input,placement}).status,'failed');}
});
test('native caption, retained cells, identity, continuity and unique tables remain required',()=>{
 const changes=[xml=>xml.replace('Nitrate of potassium','Different substance'),xml=>xml.replace('Fertilisers','Aluminium'),xml=>xml.replace('</w:body>',tableParagraph('Fertilisers')+contextTable([['CN code','Description'],['28342100','Nitrate of potassium']])+'</w:body>'),xml=>xml.replace('<w:t>Nitrate','<w:object/><w:t>Nitrate'),xml=>xml.replace('</w:body>',tableParagraph('ANNEX')+'</w:body>')];
 for(const change of changes)assert.notEqual(assertTableContext(tableContextNative({change})).status,'verified');
 for(const mutate of [a=>a.proposal.sourceHash='wrong',a=>a.proposal.paragraphs[a.placement.span.start].source.complete=false,a=>a.wording.originalText=a.wording.originalText.replace('CN code','Other header'),a=>a.wording.originalText=a.wording.originalText.replace('…\t…','…\tDescription'),a=>a.items.push(a.items[0]),a=>a.wording.targetPath={proposal:[{raw:a.wording.targetLabel},{raw:'Annex II'}]},a=>a.wording.targetPath={language:'pl'}]){const input=tableContextNative();mutate(input);assert.notEqual(assertTableContext(input).status,'verified',mutate.toString());}
});
test('the complete underlying annex and point are independently bound to native instructions',()=>{
 const positive=tableContextNative({instruction:true});assert.equal(assertTableContext(positive).status,'verified');
 for(const [from,to] of [['Annex II','Annex IX'],['point 2','point 99']]){const input=tableContextNative({instruction:true});input.wording.targetPath.underlying[0].raw=input.wording.targetPath.underlying[0].raw.replace(from,to);input.wording.targetLabel=input.wording.targetLabel.replace('— '+from,'— '+to).replace('– '+from,'– '+to);assert.notEqual(assertTableContext(input).status,'verified');}
});
