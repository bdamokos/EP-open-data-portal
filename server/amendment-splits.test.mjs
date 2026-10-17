import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SPLIT_PARSER_VERSION,parseSplitRequest} from './amendment-splits.mjs';

const sourceUrl='https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-10-08/vote-results';
const fetchedAt='2026-10-16T16:39:00Z';
const xml = text => '<partValue>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;')+'</partValue>';
const part = (number,description,id='eli/dl/doc/test-SPLIT-1-'+number) => ({id,number:String(number),numbering:number,expressionContent:{en:xml(description)}});
const request = (parts,id='eli/dl/event/test-SPLIT-1') => ({id,had_activity_type:'def/ep-activities/REQUEST_VOTE_SPLIT',created_a_realization_of:parts});
const parse = (parts,options={}) => parseSplitRequest(request(parts),{sourceUrl,fetchedAt,...options});
const text = quote => ({type:'text',quote});
const difference = (base,except) => ({type:'difference',base,except});
const all = {type:'all'};
const union = (...items) => ({type:'union',items});
const bare = ({grounding,selectionDomain,...plan}) => plan;
function recognized(parts) {
  const result=parse(parts);
  assert.deepEqual(result.failures,[]);
  assert(result.parts.every(part=>part.status==='parsed' && part.plan.grounding==='not_attempted'));
  return result.parts.map(part=>bare(part.plan));
}

// Eleven manually specified component meanings from four official requests.
// Public source: sourceUrl above, retrieved 2026-10-16. Expectations distinguish
// selected text from deletion edits and do not assert offsets or final text.
test('independent eleven-part gold: operation selection, complement, anaphora and ordered clauses',()=>{
  const deletion='but that recognising organised Islamist networks as representative interlocutors constitutes a political and institutional failure';
  const deletionId='eli/dl/event/MTG-PL-2026-10-08-VOT-ITM-993171-SPLIT-5';
  const deletionParts=[part(1,`Text as a whole without the deletion of the words: ‘${deletion}’`,deletionId.replace('/event/','/doc/')+'-1'),part(2,`The deletion of the words: ‘${deletion}’`,deletionId.replace('/event/','/doc/')+'-2')];
  const deleted=recognized(deletionParts);
  assert.deepEqual(deleted,[difference(all,{type:'delete_operation',quote:deletion}),{type:'delete_operation',quote:deletion}]);
  assert.equal(parse(deletionParts).parts[0].plan.selectionDomain,'amendment_operations');

  const rights='sexual health and reproductive rights,', lgbti='LGBTIQ+ rights,';
  assert.deepEqual(recognized([part(1,`Text as a whole without the words: ‘${rights}’ and ‘${lgbti}’`),part(2,`‘${rights}’`),part(3,`‘${lgbti}’`)]),[
    difference(all,union(text(rights),text(lgbti))),text(rights),text(lgbti),
  ]);

  const referred=recognized([part(2,'that word'),part(1,'Text as a whole without the word: ‘political’')]);
  assert.deepEqual(referred,[difference(all,text('political')),{...text('political'),binding:{kind:'previous_part_exclusion',partId:'eli/dl/doc/test-SPLIT-1-1'}}]);

  const clauses=[
    'Refuses to recognise the Russian State Duma as the legitimate representative and legislative body of the Russian Federation',
    'and refuses to recognise any legal or political consequences deriving from the illegal organisation of so-called elections by Russia in the temporarily occupied territories of Ukraine; denounces the inclusion in the new State Duma of 46 individuals who either served in the Russian invasion forces in Ukraine or held posts in the occupation administrations; notes that Nursultan Mussagaleev, who Ukrainian authorities have accused of ordering the torture and execution of a civilian near Bucha in 2022, is among them; condemns the human rights violations committed by the Russian occupation authorities who forced Ukrainian citizens in Ukrainian territories to register and vote in the fake elections to the Russian State Duma;',
    'calls on the Council and the Member States to adopt the same position of non-recognition; calls for the EU institutions and Member States to refrain from any official contact with the newly constituted State Duma and its members, to oppose their participation in interparliamentary assemblies,',
    'and to consider null any act of this State Duma purporting to legislate for, annex or ratify the status of temporarily occupied Ukrainian territory;',
  ];
  assert.deepEqual(recognized([1,3,2,4].map(number=>part(number,'‘'+clauses[number-1]+'’'))),clauses.map(text));
});

test('one component may mix text selection with a deletion operation',()=>{
  // MTG-PL-2026-10-07-VOT-ITM-993151-SPLIT-3.
  const excluded=union(text('comprehensive strategic partnership'),{type:'delete_operation',quote:'policy'});
  const parts=[part(1,'Text as a whole without the words: ‘comprehensive strategic partnership’ and excluding the deletion of the word ‘policy’'),part(2,'‘comprehensive strategic partnership’ and the deletion of the word ‘policy’')];
  assert.deepEqual(recognized(parts),[difference(all,excluded),excluded]);
  assert.equal(parse(parts).parts[1].plan.selectionDomain,'mixed');
});

test('character selectors preserve ordinal positions independently of expected counts',()=>{
  // MTG-PL-2025-07-09-VOT-ITM-965785-SPLIT-5, English public descriptions.
  const source='https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2025-07-09/vote-results';
  const result=parse([part(1,'Text as a whole without the words: ‘LGBTIQ+ people’, and the second ‘R’ in the acronym ‘SRHR’ (2 occurrences) and ‘and SRHR human right defenders’ and ‘free, safe and legal abortion’'),part(2,'‘and SRHR human right defenders’ without the second ‘R’ in the acronym ‘SRHR’'),part(3,'the second ‘R’ in the acronym ‘SRHR’'),part(4,'the second ‘R’ in the acronym ‘SRHR’ (2nd and 3rd occurrence)')],{sourceUrl:source});
  assert.deepEqual(result.failures,[]);
  assert.deepEqual(result.parts[0].plan.except.items[1],{type:'character',character:'R',characterOccurrence:2,within:'SRHR',expectedCount:2});
  assert.deepEqual(bare(result.parts[3].plan),{type:'character',character:'R',characterOccurrence:2,within:'SRHR',occurrences:[2,3]});
  assert.deepEqual(result.parts[2].plan.scope,text('and SRHR human right defenders'));
  const ordinals=recognized([part(1,'‘sexual and reproductive rights’ (1st occurrence)'),part(2,'‘sexual and reproductive rights’ (2nd occurrence)')]);
  assert.deepEqual(ordinals,[{...text('sexual and reproductive rights'),occurrences:[1]},{...text('sexual and reproductive rights'),occurrences:[2]}]);
});

test('nested text exclusion binds the following component to its containing clause',()=>{
  const clause='calls for harmonised testing of the origin of fossil fuel, LNG and refined fossil fuel imports to prevent the re-export of Russian energy to the EU;';
  const plans=recognized([part(1,`‘${clause}’ without the word: ‘harmonised’`),part(2,'‘harmonised’')]);
  assert.deepEqual(plans,[difference(text(clause),text('harmonised')),{...text('harmonised'),scope:text(clause),binding:{kind:'earlier_part_exclusion',partId:'eli/dl/doc/test-SPLIT-1-1'}}]);
});

test('apostrophes, plural possessives and mixed quote delimiters remain literal source text',()=>{
  const examples=[
    ['‘Stresses the importance of delivering on EU citizens’ expectations regarding the protection of the environment;’','Stresses the importance of delivering on EU citizens’ expectations regarding the protection of the environment;'],
    ["'Recalls its criticism of the Commission for failing to disclose full details, thereby violating citizens’ right to information;’",'Recalls its criticism of the Commission for failing to disclose full details, thereby violating citizens’ right to information;'],
    ['‘and upholding women’s and girls’ bodily autonomy’','and upholding women’s and girls’ bodily autonomy'],
    ["'citizens' expectations'","citizens' expectations"],
    ['‘citizens’ and residents’ rights’','citizens’ and residents’ rights'],
    ['‘implementing institutional reform through an “urgency convention”,’','implementing institutional reform through an “urgency convention”,'],
    ['“the Council’s position”','the Council’s position'],
  ];
  for(const [description,expected] of examples) assert.deepEqual(recognized([part(1,description)]),[text(expected)],description);
});

test('standard escaped XML, numeric references and inline markup decode once',()=>{
  for(const raw of ['<partValue>‘trade &amp; aid’</partValue>','&lt;partValue&gt;‘trade &amp;amp; aid’&lt;/partValue&gt;','<partValue>‘trade &#38; aid’</partValue>','<partValue>‘trade <b>&amp;</b> aid’</partValue>']) {
    const input=part(1,'unused');input.expressionContent.en=raw;
    const parsed=parse([input]);assert.deepEqual(parsed.failures,[]);assert.equal(parsed.parts[0].plan.quote,'trade & aid');assert.equal(parsed.parts[0].rawDescription,raw);
  }
  const input=part(1,'unused');input.expressionContent.en='<partValue>‘&lt;b&gt;&amp;lt;’</partValue>';
  assert.equal(parse([input]).parts[0].plan.quote,'<b>&lt;');
  input.expressionContent.en='<partValue><![CDATA[‘&amp;’]]></partValue>';
  assert.equal(parse([input]).parts[0].plan.quote,'&amp;');
});

test('exact component identifiers are deduplicated and parts sort numerically',()=>{
  const a=part(1,'‘one’'), b=part(2,'‘two’'), c=part(10,'‘ten’');
  const result=parse([c,b,a,structuredClone(b)]);
  assert.deepEqual(result.failures,[]);assert.deepEqual(result.parts.map(part=>[part.id,part.number]),[[a.id,1],[b.id,2],[c.id,10]]);
  const conflict=structuredClone(b);conflict.expressionContent.en=xml('‘different’');
  const failed=parse([b,conflict]);assert.equal(failed.parts.length,1);assert.equal(failed.failures[0].code,'conflicting_part');assert.equal(failed.parts[0].conflictingDescriptions.length,2);
});

test('unknown grammar and ambiguous references produce durable failures with provenance',()=>{
  for(const [description,code] of [['the last half of paragraph 2','unsupported_syntax'],['those words','ambiguous_anaphora'],['‘policy’ (last occurrence)','unsupported_qualifier'],['the third ‘R’ in the acronym ‘SRHR’','invalid_character_selector']]) {
    const result=parse([part(1,description)]), failure=result.failures[0];
    assert.equal(result.parts[0].status,'unresolved');assert.equal(result.parts[0].plan,null);assert.equal(failure.code,code);
    assert.deepEqual(failure,{requestId:'eli/dl/event/test-SPLIT-1',partId:'eli/dl/doc/test-SPLIT-1-1',description,language:'en',parserVersion:SPLIT_PARSER_VERSION,code,message:result.parts[0].failure.message,sourceUrl,fetchedAt,rawDescription:xml(description)});
  }
  const gap=parse([part(1,'Text as a whole without the word ‘policy’'),part(3,'those words')]);
  assert.equal(gap.failures[0].code,'ambiguous_anaphora');
  const deletionReference=parse([part(1,'Text as a whole without the deletion of the word ‘policy’'),part(2,'those words')]);
  assert.equal(deletionReference.failures[0].code,'ambiguous_anaphora');
  const singular=parse([part(1,'Text as a whole without the words ‘many words’'),part(2,'that word')]);
  assert.equal(singular.failures[0].code,'ambiguous_anaphora');
});

test('scoped references fail when more than one earlier containing clause fits',()=>{
  const result=parse([part(1,'‘one policy clause’ without the word ‘policy’'),part(2,'‘another policy clause’ without the word ‘policy’'),part(3,'‘policy’')]);
  assert.equal(result.failures[0].code,'ambiguous_scope');assert.equal(result.parts[2].plan,null);
  for(const description of ['‘a’ and ‘b’ without ‘c’','‘a’ without ‘b’ without ‘c’']) {
    assert.equal(parse([part(1,description)]).failures[0].code,'ambiguous_scope');
  }
});

test('missing and unsupported languages preserve the available source descriptions',()=>{
  const input=part(1,'‘policy’');input.expressionContent={fr:'<partValue>«politique»</partValue>'};
  const missing=parse([input]);assert.equal(missing.failures[0].code,'missing_language');assert.equal(missing.parts[0].description,null);
  assert.deepEqual(missing.failures[0].sourceDescriptions,input.expressionContent);
  const french=parse([input],{language:'fr'});assert.equal(french.failures[0].code,'unsupported_language');assert.equal(french.parts[0].description,'«politique»');assert.equal(french.parts[0].language,'fr');
});

test('unsafe, malformed and oversized XML produce records instead of throwing',()=>{
  for(const [raw,code] of [
    ['<!DOCTYPE partValue [<!ENTITY leak SYSTEM "file:///etc/passwd">]><partValue>&leak;</partValue>','unsafe_xml'],
    ['<partValue>‘&unknown;’</partValue>','unsafe_xml'],
    ['<partValue>‘&#x110000;’</partValue>','invalid_xml'],
    ['<partValue>‘unclosed’','invalid_xml'],
    ['<other>‘wrong root’</other>','invalid_xml'],
    ['<partValue>‘'+ 'x'.repeat(65536)+'’</partValue>','description_too_large'],
    ['<partValue>'+'<span>'.repeat(34)+'‘policy’'+'</span>'.repeat(34)+'</partValue>','description_too_large'],
  ]) {
    const input=part(1,'unused');input.expressionContent.en=raw;
    const result=parse([input]);assert.equal(result.failures[0]?.code,code);assert.equal(result.parts[0].rawDescription,raw);assert.equal(result.parts[0].plan,null);
  }
});

test('malformed request identity and numbering never become inferred identifiers',()=>{
  const missingId=part(1,'‘policy’');delete missingId.id;
  assert.equal(parse([missingId]).failures[0].code,'missing_part_id');
  const conflicting=part(1,'‘policy’');conflicting.numbering=2;
  assert.equal(parse([conflicting]).failures[0].code,'invalid_part_number');
  const duplicates=parse([part(1,'‘policy’','eli/dl/doc/one'),part(1,'‘trade’','eli/dl/doc/another')]);
  assert.deepEqual(duplicates.failures.map(failure=>failure.code),['ambiguous_part_number','ambiguous_part_number']);
  const noRequestId=request([part(1,'‘policy’')]);delete noRequestId.id;
  assert.equal(parseSplitRequest(noRequestId).failures[0].code,'missing_request_id');
  assert.equal(parseSplitRequest(null).failures[0].code,'missing_parts');
});
