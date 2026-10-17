import test from 'node:test';
import assert from 'node:assert/strict';
import {amendmentDecisionKey,amendmentDecisionPart,amendmentDecisionScope,amendmentFailureKey,amendmentFailureLabel,amendmentGroups,amendmentHref,amendmentOutcomeLabel,amendmentPlanSummary,amendmentProcedure,amendmentRoute,publicAmendmentSource,supportedAmendmentTarget} from './amendmentModel.mjs';

test('amendment trail targets match the supported current-term plenary report and motion contract',()=>{
  for(const id of ['A-10-2026-0254','B-10-2026-0424','RC-10-2026-0441','A-10-2026-12345','B-10-2026-123456'])assert.equal(supportedAmendmentTarget(id),true,id);
  for(const id of ['JURI-AL-788004','TA-10-2026-0254','P10_TA(2026)0254','A-9-2023-0001','B-11-2030-0001','A-10-2026-0254-AM-001-004','A-10-2026-123','A-10-2026-1234567','a-10-2026-0254',null])assert.equal(supportedAmendmentTarget(id),false,String(id));
});

test('amendment filters round-trip exact document and author identities without a language-specific dossier reference',()=>{
  const route=amendmentRoute({document:'RC-10-2026-0441',procedure:'2025/0407(COD)',member:197818,outcome:'mixed',offset:20,language:'hu'});
  const query=new URLSearchParams(route.slice(route.indexOf('?')));
  assert.equal(route.startsWith('amendments?'),true);
  assert.equal(query.get('procedure'),'2025-0407');
  assert.equal(query.get('document'),'RC-10-2026-0441');
  assert.equal(query.get('member'),'197818');
  assert.equal(query.get('outcome'),'mixed');
  assert.equal(query.get('offset'),'20');
  assert.equal(query.get('lang'),'hu');
  assert.equal(amendmentProcedure('2025-0407'),'2025-0407');
  assert.equal(amendmentProcedure('2025/0407A(COD)'),'2025-0407A');
  assert.equal(amendmentProcedure('https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2025%2F0407A(COD)'),'2025-0407A');
  assert.equal(new URLSearchParams(amendmentRoute({member:'not-a-person',outcome:'invented',offset:-30}).split('?')[1]).has('member'),false);
});
test('dossier and author entry links retain their owning view and only their own filters',()=>{
  const link=amendmentHref('/explore',{procedure:'2025/0407(COD)',member:'197818',language:'en'});
  const query=new URL(link,'https://example.test').searchParams;
  assert.equal(query.get('view'),'amendments');
  assert.equal(query.get('am-procedure'),'2025/0407(COD)');
  assert.equal(query.get('am-member'),'197818');
  assert.equal(query.has('member'),false);
});
test('grouping uses supplied exact dossier and target labels without conflating similarly titled texts',()=>{
  const items=[
    {id:'first',procedureIds:['2025-0407'],targetDocumentId:'A-10-2026-0254',targetLabel:'Article 1',topics:[{id:'4.70',label:'Environment',basis:'dossier'}]},
    {id:'second',procedureIds:['2025-0408'],targetDocumentId:'A-10-2026-0255',targetLabel:'Article 1',topics:[{id:'4.70',label:'Environment',basis:'dossier'}]},
    {id:'third',targetLabel:null,topics:[]},
  ];
  assert.equal(amendmentGroups(items).length,3);
  const targets=amendmentGroups(items,'target');
  assert.equal(targets.length,3);
  assert.deepEqual(targets[0].items.map(item=>item.id),['first']);
  assert.equal(targets[0].label,'A-10-2026-0254 · Article 1');
  const topics=amendmentGroups(items,'topic');
  assert.equal(topics[0].basis,'Dossier subject classification');
  assert.equal(topics[1].label,'Topic unavailable');
  assert.equal(topics.flatMap(group=>group.items).length,items.length);
  const provisions=items.slice(0,2).map(item=>({...item,topics:[{id:'target:Article 1',label:'Article 1',basis:'target'}]}));
  assert.equal(amendmentGroups(provisions,'topic').length,2,'a provision label from another document is not the same recorded topic');
});
test('whole, collective and split decisions remain distinct and unavailable is never rendered as rejected',()=>{
  assert.equal(amendmentDecisionScope({},{}),'Whole amendment');
  assert.equal(amendmentDecisionScope({},{amendmentIds:['AM-1','AM-2']}),'Collective decision');
  assert.equal(amendmentDecisionScope({splitParts:[{id:'p1'}]},{partId:'p1',partNumber:1}),'Split part 1');
  assert.equal(amendmentOutcomeLabel('unavailable'),'Outcome unavailable');
  assert.equal(amendmentOutcomeLabel(null),'Outcome unavailable');
  assert.equal(amendmentOutcomeLabel('mixed'),'Mixed outcomes');
});
test('decision rendering identity includes each exact split component even without its description',()=>{
  const first={id:'same-decision',partId:'eli/dl/doc/request-SPLIT-1-1'},second={id:'same-decision',partId:'eli/dl/doc/request-SPLIT-1-2'};
  assert.notEqual(amendmentDecisionKey(first),amendmentDecisionKey(second));
  assert.equal(amendmentDecisionKey(first),amendmentDecisionKey({...first,outcome:'REJECTED'}));
  assert.notEqual(amendmentDecisionKey(first),amendmentDecisionKey({id:first.id}));
});
test('split binding always respects exact IDs and only falls back to unique part numbers',()=>{
  const first={id:'request-one-part-1',number:1},second={id:'request-two-part-1',number:1},third={id:'request-two-part-2',number:2};
  const parts=[first,second,third];
  assert.equal(amendmentDecisionPart(parts,{partId:second.id,partNumber:1}),second);
  assert.equal(amendmentDecisionPart(parts,{partId:'different-request-part-1',partNumber:1}),null);
  assert.equal(amendmentDecisionPart(parts,{partNumber:1}),null);
  assert.equal(amendmentDecisionPart(parts,{partNumber:2}),third);
  assert.equal(amendmentDecisionPart([{id:null,number:3,componentIndex:0}],{partNumber:3}),null,'a missing official component identity never becomes a binding');
});
test('failure registry keys remain distinct and stable without presenting local keys as official component IDs',()=>{
  const first={requestId:'eli/dl/event/request',partId:null,registryPartKey:'__component__:0:one',recordKind:'component',componentIndex:0,language:'en'};
  const second={...first,registryPartKey:'__component__:1:two',componentIndex:1};
  const request={...first,registryPartKey:'__request__',recordKind:'request',componentIndex:null};
  assert.equal(new Set([first,second,request].map(amendmentFailureKey)).size,3);
  assert.deepEqual([second,first].map(amendmentFailureKey).reverse(),[first,second].map(amendmentFailureKey),'row order does not define registry identity');
  assert.equal(amendmentFailureLabel(first),'Unidentified split component 1');
  assert.equal(amendmentFailureLabel(second),'Unidentified split component 2');
  assert.equal(amendmentFailureLabel(request),'Split request failure');
  assert.equal(amendmentFailureLabel({...first,partId:'eli/dl/doc/exact-part'}),'eli/dl/doc/exact-part');
  assert.notEqual(amendmentFailureKey({...first,registryPartKey:undefined}),amendmentFailureKey({...second,registryPartKey:undefined}),'legacy unidentified components can use their source position');
  const unknownRequest={requestId:null,partId:null,registryPartKey:'__request__',recordKind:'request',language:'en'};
  assert.notEqual(amendmentFailureKey({...unknownRequest,registryRequestKey:'local-request-one'}),amendmentFailureKey({...unknownRequest,registryRequestKey:'local-request-two'}),'unidentified requests can share a component key without sharing their local request identity');
  assert.equal(amendmentFailureLabel({...unknownRequest,registryRequestKey:'local-request-one'}),'Split request failure','a local request registry key is not an official ID');
});
test('split selection summaries preserve exclusions, occurrences and deletion edit semantics',()=>{
  const plan={type:'difference',base:{type:'all'},except:{type:'union',items:[{type:'text',quote:'carbon leakage',occurrences:[2]},{type:'delete_operation',quote:'existing safeguard'}]},grounding:'not_attempted'};
  const [summary]=amendmentPlanSummary(plan);
  assert.match(summary,/excluding \(The text “carbon leakage” · occurrence 2/);
  assert.match(summary,/deletion of “existing safeguard” \(an edit operation\)/);
  assert.doesNotMatch(summary,/adopted|rejected|final text/i);
  assert.match(amendmentPlanSummary({type:'character',character:'E',characterOccurrence:2,within:'EEAS',expectedCount:1})[0],/Occurrence 2 of “E” within “EEAS” · 1 expected occurrence/);
  assert.deepEqual(amendmentPlanSummary({type:'unknown',quote:'do not guess this'}),[]);
  assert.deepEqual(amendmentPlanSummary({type:'difference',base:{type:'all'},except:{type:'unknown'}}),[]);
});
test('external evidence links permit public web sources and reject executable links',()=>{
  assert.equal(publicAmendmentSource({url:'https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-10-08/decisions'}),'https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-10-08/decisions');
  for(const source of ['javascript:alert(1)','data:text/html,test',null,{}])assert.equal(publicAmendmentSource(source),null);
});
