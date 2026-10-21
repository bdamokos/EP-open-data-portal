import test from 'node:test';
import assert from 'node:assert/strict';
import {amendmentOperation,DELETION_MARKERS,resolveAmendmentPlacement,segmentMotionUnits,resolveDocumentTarget} from './document-context-model.mjs';

function document(paragraphs, overrides = {}) {
  const {sources = {}, ...fields} = overrides;
  return {
    paragraphs, structureStatus: 'extracted',
    paragraphSources: paragraphs.map((_, ordinal) => ({path: `word/document.xml/body/p[${ordinal + 1}]`, ordinal,
      container: 'body', containerPath: 'word/document.xml/body', segment: 0, complete: true, ...sources[ordinal]})),
    ...fields,
  };
}
const resolve = (text, options = {}) => resolveDocumentTarget(text, {language: 'en', ...options});
const found = (paragraphs, basis = 'quoted-original', quoteMatches = true, relation = 'at') => ({
  status: 'found', paragraphs, basis, relation, quoteMatches, reason: null,
});

test('exact quote comparison collapses whitespace without changing source strings', () => {
  const text = document(['D.\twhereas the text has\u00a0spaces;']);
  const copy = structuredClone(text);
  assert.deepEqual(resolve(text, {originalText: ' D. whereas  the text has spaces; '}), found([0]));
  assert.deepEqual(text, copy);
});

test('one exact quote may span consecutive complete source paragraphs', () => {
  const text = document(['D. whereas the first passage', 'continues in the next paragraph;', 'E. whereas another passage;']);
  assert.deepEqual(resolve(text, {originalText: 'D. whereas the first passage continues in the next paragraph;'}), found([0, 1]));
});

test('repeated complete blank paragraphs and quote prefixes stop at the matching-work budget', () => {
  const paragraphs = ['D. independent reference;', ...Array.from({length: 1200}, (_, index) => index % 2 ? '' : 'a')];
  const text = document(paragraphs);
  const originalText = `${Array(400).fill('a').join(' ')} z`;
  const before = structuredClone(text);
  assert.deepEqual(resolve(text, {originalText, targetLabel: 'Recital D'}), {
    status: 'unavailable', paragraphs: [], basis: null, relation: null, quoteMatches: null, reason: 'matching_budget',
  });
  assert.deepEqual(text, before, 'stopping matching must not remove or alter readable text');
});

test('oversized documents and quote inputs are rejected before matching', () => {
  for (const [text, options] of [
    [document(Array(10_001).fill('')), {}],
    [document(['a'.repeat(4 * 1024 * 1024 + 1)]), {}],
    [document(['D. source text;']), {originalText: 'a'.repeat(64 * 1024 + 1)}],
    [document(['D. source text;']), {referenceText: 'a'.repeat(1025)}],
  ]) assert.equal(resolve(text, options).reason, 'matching_budget');
});

test('source ordinal gaps, segment changes and containers prevent joining a flattened quote', () => {
  for (const second of [{ordinal: 2}, {segment: 1}, {container: 'table-cell', containerPath: 'word/document.xml/body/tbl[1]/tc[1]'},
    {complete: false}]) {
    const text = document(['D. first passage', 'second passage;'], {sources: {1: second}});
    assert.equal(resolve(text, {originalText: 'D. first passage second passage;'}).status, 'unavailable');
  }
});

test('an exact quote may match one table cell but may not cross cells', () => {
  const cell = 'word/document.xml/body/tbl[1]/tr[1]/tc[1]';
  const text = document(['First cell paragraph', 'continues here', 'Other cell'], {sources: {
    0: {container: 'table-cell', containerPath: cell}, 1: {container: 'table-cell', containerPath: cell},
    2: {container: 'table-cell', containerPath: `${cell}-other`},
  }});
  assert.deepEqual(resolve(text, {originalText: 'First cell paragraph continues here'}), found([0, 1]));
  assert.equal(resolve(text, {originalText: 'continues here Other cell'}).status, 'unavailable');
});

test('legacy or malformed structure never establishes a target', () => {
  for (const text of [
    {paragraphs: ['D. exact text;']},
    document(['D. exact text;'], {structureStatus: 'not-extracted'}),
    document(['D. exact text;'], {paragraphSources: []}),
    document(['D. exact text;', 'Another'], {sources: {1: {ordinal: 0}}}),
    document(['D. exact text;', 'Another'], {sources: {1: {path: 'word/document.xml/body/p[1]'}}}),
  ]) assert.equal(resolve(text, {originalText: 'D. exact text;', targetLabel: 'Recital D'}).reason, 'source_structure_unavailable');
});

test('unknown objects withhold exact matching while leaving readable text untouched', () => {
  const text = document(['D. text \uFFFC remains readable;'], {sources: {0: {complete: false}}});
  assert.equal(resolve(text, {originalText: text.paragraphs[0]}).status, 'unavailable');
  assert.equal(resolve(text, {targetLabel: 'Recital D'}).reason, 'source_passage_incomplete');
  assert.equal(text.paragraphs[0], 'D. text \uFFFC remains readable;');
});

test('duplicate exact quotes are ambiguous without an independent unique reference', () => {
  const text = document(['Repeated text;', 'Repeated text;']);
  assert.equal(resolve(text, {originalText: 'Repeated text;'}).reason, 'multiple_quoted_targets');
});

test('published recital, paragraph, point and article labels are anchored', () => {
  const text = document(['References to paragraph 8 and recital AT appear here.', 'AT. whereas this is the recital;',
    '8. Calls for action;', '1. Recommends:', '(au) complete the union;', 'Article 5', 'Article 6 applies to another matter.']);
  for (const [targetLabel, index] of [['Recital AT', 1], ['Paragraph 8', 2], ['Paragraph 1 – point au', 4], ['§1, point au', 4], ['Article 5', 5]]) {
    assert.deepEqual(resolve(text, {targetLabel}), found([index], 'published-reference', null));
  }
  assert.equal(resolve(text, {targetLabel: 'Article 6'}).status, 'unavailable');
  assert.equal(resolve(text, {targetLabel: 'Recital A'}).status, 'unavailable');
});

test('published reference lookup ignores tables and page furniture', () => {
  const text = document(['D. header;', 'D. table quotation;', 'D. source body;'], {sources: {
    0: {container: 'other', containerPath: 'word/header1.xml'},
    1: {container: 'table-cell', containerPath: 'word/document.xml/body/tbl[1]/tc[1]'},
  }});
  assert.deepEqual(resolve(text, {targetLabel: 'Recital D'}), found([2], 'published-reference', null));
  assert.equal(resolve(text, {originalText: 'D. header;'}).status, 'unavailable');
  assert.deepEqual(resolve(text, {originalText: 'D. table quotation;'}), found([1]));
});

test('duplicate body provision labels remain ambiguous even if one quote is unique', () => {
  const text = document(['D. first occurrence;', 'D. different occurrence;']);
  assert.equal(resolve(text, {targetLabel: 'Recital D', originalText: 'D. first occurrence;'}).reason, 'multiple_published_targets');
});

test('an incomplete observed point label cannot hide a duplicate published target', () => {
  for (const [secondPoint, source] of [
    ['a) second point;', {}],
    ['a) second point;', {complete: false}],
    ['a) second point with an unresolved object \uFFFC;', {}],
  ]) {
    const text = document(['1. First section:', 'a) first point;', '1. Second section:', secondPoint], {sources: {3: source}});
    for (const originalText of [undefined, 'a) first point;']) {
      assert.equal(resolve(text, {targetLabel: 'Paragraph 1 – point a', originalText}).reason, 'multiple_published_targets');
    }
  }
});

test('a single incomplete point stays unavailable with or without its broad paragraph reference', () => {
  for (const [point, source] of [
    ['a) source point;', {complete: false}],
    ['a) source point with an unresolved object \uFFFC;', {}],
  ]) {
    const text = document(['1. Recommends:', point], {sources: {1: source}});
    for (const references of [
      {targetLabel: 'Paragraph 1 – point a'},
      {targetLabel: 'Paragraph 1', referenceText: '§1, point a'},
      {targetLabel: 'Paragraph 1 – point a', referenceText: '§1'},
    ]) {
      for (const originalText of [undefined, '1. Recommends:', point]) {
        assert.equal(resolve(text, {...references, originalText}).reason, 'source_passage_incomplete');
      }
    }
  }
});

test('incomplete numbered labels remain observed without establishing following point scope', () => {
  const duplicate = document(['1. First section:', '1. Second section \uFFFC'], {sources: {1: {complete: false}}});
  assert.equal(resolve(duplicate, {targetLabel: 'Paragraph 1'}).reason, 'multiple_published_targets');
  for (const source of [{complete: false}, {}]) {
    const text = document(['1. Recommends \uFFFC:', 'a) point after missing content;'], {sources: {0: source}});
    assert.equal(resolve(text, {targetLabel: 'Paragraph 1'}).reason, 'source_passage_incomplete');
    assert.equal(resolve(text, {targetLabel: 'Paragraph 1 – point a'}).reason, 'target_not_found');
  }
});

test('point scope resets on unlabeled headings, recitals, gaps and table boundaries', () => {
  for (const text of [
    document(['1. Recommends:', 'Explanatory statement', 'au) this point has no established paragraph;']),
    document(['1. Recommends:', 'A. whereas another section;', 'au) this point has no established paragraph;']),
    document(['1. Recommends:', 'au) this point has no established paragraph;'], {sources: {1: {ordinal: 3}}}),
    document(['1. Recommends:', 'au) this point has no established paragraph;'], {sources: {1: {segment: 1}}}),
    document(['1. Recommends:', 'Unrelated table cell', 'au) this point has no established paragraph;'], {sources: {1: {container: 'table-cell', containerPath: 'cell'}}}),
  ]) assert.equal(resolve(text, {targetLabel: 'Paragraph 1 – point au'}).status, 'unavailable');
});

test('unknown labels and missing point structure cannot fall back to a broad paragraph', () => {
  for (const text of [
    document(['1. Recommends:', '\uFFFCa) point with an unknown prefix;']),
    document(['1. Recommends:', 'a\uFFFC) point with an unknown label;']),
    document(['1. Recommends:', 'a) point after a gap;'], {sources: {1: {ordinal: 2}}}),
    document(['1. Recommends:', 'a) point in another segment;'], {sources: {1: {segment: 1}}}),
    document(['1. Recommends:', 'b) incomplete preceding point;', 'a) point after missing content;'], {sources: {1: {complete: false}}}),
  ]) {
    for (const references of [
      {targetLabel: 'Paragraph 1 – point a'},
      {targetLabel: 'Paragraph 1', referenceText: '§1, point a'},
      {targetLabel: 'Paragraph 1 – point a', referenceText: '§1'},
    ]) {
      for (const originalText of references.referenceText ? [undefined, '1. Recommends:'] : [undefined]) {
        assert.equal(resolve(text, {...references, originalText}).reason, 'target_not_found');
      }
    }
  }
});

test('point lookup is scoped to its exact numbered paragraph', () => {
  const text = document(['1. First recommendation:', 'a) first point;', '2. Second recommendation:', 'a) second point;']);
  assert.deepEqual(resolve(text, {targetLabel: 'Paragraph 2 – point a'}), found([3], 'published-reference', null));
});

test('AM37-style insertion requires the independent published relative reference', () => {
  const text = document(['F. whereas the published recital;', 'G. whereas the following recital;']);
  assert.deepEqual(resolve(text, {originalText: '', targetLabel: 'Recital F a (new)', referenceText: 'after recital F'}),
    found([0], 'published-reference', null, 'after'));
  assert.equal(resolve(text, {targetLabel: 'Recital F a (new)'}).reason, 'insertion_reference_unavailable');
  assert.equal(resolve(text, {targetLabel: 'Recital F a (new)', referenceText: 'Recital F'}).reason, 'insertion_reference_unavailable');
});

test('explicit source before/after point grammar is retained without inventing a new target label', () => {
  const text = document(['1. Recommends:', 'ao) published point;', 'ap) following point;']);
  assert.deepEqual(resolve(text, {targetLabel: 'Paragraph 1 – point ao a (new)', referenceText: '§1, after point ao'}),
    found([1], 'published-reference', null, 'after'));
  assert.deepEqual(resolve(text, {referenceText: 'Paragraph 1, before point ap'}), found([2], 'published-reference', null, 'before'));
});

// Exact paragraphs from the saved English source DOCX files, not reconstructed prose:
// https://data.europarl.europa.eu/distribution/reds_iPlRp/A-10-2026-0237/A-10-2026-0237_en.docx
// https://data.europarl.europa.eu/distribution/reds_iPlRp_Amd/A-10-2026-0237-AM-037-046/A-10-2026-0237-AM-037-046_en.docx
test('AM45/46 typography differences use the published point without claiming quote equality', () => {
  const sourceAv = "av) \tremain mindful of the importance of keeping democracies united in response to attempts to divide them and of the strategic interests of China and Russia; work collaboratively mainly with the United States and other like-minded countries to formulate strategies concerning China's increasingly assertive stance on the global stage; strengthen the European pillar of defence within the transatlantic alliance while consolidating the transatlantic bond and reinforcing NATO;";
  const sourceAy = "ay)\tincrease public diplomacy efforts in China to provide authentic information about the EU’s policies and actions, and work to strengthen knowledge of China in all EU institutions; emphasise, while exchanges between European and Chinese universities are in place, the importance of clear guidance for engagement between EU universities and Chinese entities; strengthen the coordination and coherence of policies across EU Member States and institutions in order to develop a common and coherent strategy towards China; ensure that such a strategy includes enhanced coordination among Member States on their main political leaders' visits to China and the main messages addressed to the Chinese leadership so as to avoid political fragmentation; adopt a unitary and coordinated strategy to diplomatically engage with China, firmly protect the EU geopolitical and economic interests, improve bilateral relations and pursue mutually beneficial cooperation;";
  const text = document(['1. Recommends:', sourceAv, sourceAy]);
  for (const [point, index, source] of [['av', 1, sourceAv], ['ay', 2, sourceAy]]) {
    assert.deepEqual(resolve(text, {targetLabel: `Paragraph 1 – point ${point}`, originalText: source.replace("'", '’')}),
      found([index], 'published-reference', false));
  }
});

test('conflicting quote and supported published provision do not select a passage', () => {
  const text = document(['D. first recital;', 'E. another recital;']);
  assert.equal(resolve(text, {originalText: 'D. first recital;', targetLabel: 'Recital E'}).reason, 'conflicting_target_evidence');
});

test('repeated exact quotes elsewhere cannot override the conflicting published provision', () => {
  const text = document(['D. target text;', 'Repeated quote;', 'Repeated quote;']);
  assert.equal(resolve(text, {originalText: 'Repeated quote;', targetLabel: 'Recital D'}).reason, 'conflicting_target_evidence');
});

test('point references accept balanced parentheses or bare letters, never malformed parentheses', () => {
  const text = document(['1. Recommends:', 'au) source point;']);
  for (const targetLabel of ['Paragraph 1, point (au', 'Paragraph 1, point au)', '§1, after point (au', '§1, before point au)']) {
    assert.equal(resolve(text, {targetLabel}).status, 'unavailable');
  }
  assert.deepEqual(resolve(text, {targetLabel: 'Paragraph 1, point (au)'}), found([1], 'published-reference', null));
  assert.deepEqual(resolve(text, {referenceText: '§1, after point (au)'}), found([1], 'published-reference', null, 'after'));
});

test('compatible paragraph and point references do not conflict with a quote in that point', () => {
  const text = document(['1. Recommends:', 'au) complete the union;']);
  assert.deepEqual(resolve(text, {originalText: 'au) complete the union;', targetLabel: 'Paragraph 1 – point au', referenceText: '§1'}), found([1]));
});

test('compatible paragraph and point references resolve the narrower established point in either order', () => {
  const text = document(['1. Recommends:', 'a) source point;']);
  for (const [targetLabel, referenceText] of [['Paragraph 1', '§1, point a'], ['Paragraph 1 – point a', '§1']]) {
    assert.deepEqual(resolve(text, {targetLabel, referenceText}), found([1], 'published-reference', null));
  }
});

test('a compatible broad paragraph reference cannot substitute for a missing precise point', () => {
  const text = document(['1. Recommends:', 'a) available point;']);
  for (const [targetLabel, referenceText] of [['Paragraph 1', '§1, point b'], ['Paragraph 1 – point b', '§1']]) {
    for (const originalText of [undefined, '1. Recommends:']) {
      assert.equal(resolve(text, {targetLabel, referenceText, originalText}).reason, 'target_not_found');
    }
  }
});

test('conflicting supported identities remain ambiguous even when one or both source labels are missing', () => {
  const samples = [
    {paragraphs: ['E. available recital;'], targetLabel: 'Recital D', referenceText: 'Recital E', quote: 'E. available recital;'},
    {paragraphs: ['D. available recital;'], targetLabel: 'Recital D', referenceText: 'Recital E', quote: 'D. available recital;'},
    {paragraphs: ['Neither requested label occurs here.'], targetLabel: 'Recital D', referenceText: 'Recital E'},
    {paragraphs: ['2. Available paragraph;'], targetLabel: 'Paragraph 1', referenceText: 'Paragraph 2', quote: '2. Available paragraph;'},
    {paragraphs: ['5. Available paragraph;'], targetLabel: 'Article 5', referenceText: 'Paragraph 5', quote: '5. Available paragraph;'},
    {paragraphs: ['1. Recommends:', 'b) available point;'], targetLabel: 'Paragraph 1 – point a', referenceText: '§1, point b', quote: 'b) available point;'},
    {paragraphs: ['2. Recommends:', 'a) available point;'], targetLabel: 'Paragraph 1 – point a', referenceText: '§2, point a', quote: 'a) available point;'},
    {paragraphs: ['No matching recital.'], targetLabel: 'before recital D', referenceText: 'after recital D'},
  ];
  for (const {paragraphs, targetLabel, referenceText, quote} of samples) {
    for (const originalText of [undefined, quote]) {
      assert.equal(resolve(document(paragraphs), {targetLabel, referenceText, originalText}).reason,
        'conflicting_published_references', `${targetLabel} / ${referenceText}`);
    }
  }
});

test('different published references and contradictory relative directions remain ambiguous', () => {
  const text = document(['D. first recital;', 'E. another recital;']);
  assert.equal(resolve(text, {targetLabel: 'Recital D', referenceText: 'Recital E'}).reason, 'conflicting_published_references');
  assert.equal(resolve(text, {targetLabel: 'before recital D', referenceText: 'after recital D'}).reason, 'conflicting_published_references');
});

test('relative placement cannot be transferred to a different or unavailable provision', () => {
  const text = document(['1. Recommends:', 'au) complete the union;']);
  assert.equal(resolve(text, {targetLabel: 'Paragraph 1 – point au', referenceText: 'before paragraph 1'}).reason,
    'conflicting_published_references');
  assert.equal(resolve(text, {originalText: 'au) complete the union;', referenceText: 'after recital D'}).reason,
    'relative_target_not_found');
});

test('an unsupported reference may not invalidate a unique exact source quote', () => {
  const text = document(['D. exact source text;']);
  assert.deepEqual(resolve(text, {originalText: 'D. exact source text;', referenceText: 'the fifth part of the amendment'}), found([0]));
});

test('a repeated quote may be resolved by a separate unique provision', () => {
  const text = document(['1. First section:', 'a) same source words;', '2. Second section:', 'a) same source words;']);
  assert.deepEqual(resolve(text, {originalText: 'a) same source words;', targetLabel: 'Paragraph 2 – point a'}),
    found([3], 'published-reference', true));
});

test('English reference grammar is not silently applied to another or unknown source language', () => {
  const text = document(['D. exact source text;']);
  assert.equal(resolveDocumentTarget(text, {targetLabel: 'Recital D', language: 'fr'}).reason, 'reference_language_unsupported');
  assert.equal(resolveDocumentTarget(text, {targetLabel: 'Recital D'}).reason, 'reference_language_unsupported');
  assert.deepEqual(resolveDocumentTarget(text, {originalText: 'D. exact source text;', language: 'fr'}), found([0]));
});


const motion = paragraphs => document(['Cover', 'The European Parliament,', '– having regard to public sources,', ...paragraphs], {textLanguage:'en'});
const placement = (text, options) => resolveAmendmentPlacement(text, {language:'en', ...options});
test('units retain complete extents, parents, citations, headings and suffixed recital identities', () => {
  const units=segmentMotionUnits(motion(['A. whereas first;', 'Ba. whereas inserted;', 'AO. whereas last;', 'OPERATIVE SECTION', '19. Main provision:', '(a) first point', 'continued point', '(b) second point', '20. Next provision;']), 'en');
  assert.deepEqual(units.find(unit=>unit.label==='19'), {kind:'paragraph',label:'19',parent:6,start:7,end:10,level:1});
  assert.equal(units.find(unit=>unit.label==='a').parent,7);
  assert.equal(units.find(unit=>unit.label==='a').end,9);
  assert.deepEqual(units.filter(unit=>unit.kind==='recital').map(unit=>unit.label),['A','Ba','AO']);
  assert.equal(units[0].kind,'citation');
});
test('paragraph 19a inserts after paragraph 19 and all of its points, before 20', () => {
  const text=motion(['19. Main provision:', '(a) first point', 'continuation', '(b) second point', '20. Next provision;']);
  const result=placement(text,{originalText:'',proposedText:'19a. New provision;',targetLabel:'Paragraph 19 a (new)',referenceText:'After § 19'});
  assert.equal(result.operation,'insert');assert.equal(result.status,'placed');
  assert.equal(result.insertAfter,6);assert.equal(result.insertBefore,7);assert.equal(text.paragraphs[result.insertBefore],'20. Next provision;');
  assert.deepEqual(result.evidence.map(item=>item.basis),['published-reference','relative-reference']);
});
test('recital insertion and highest existing suffixed sibling keep source order', () => {
  const text=motion(['A. whereas first;', 'B. whereas second;', 'Ba. whereas existing suffix;', 'C. whereas next;']);
  const result=placement(text,{originalText:'',proposedText:'Bb. whereas new;',targetLabel:'Recital B b (new)',referenceText:'After recital B'});
  assert.equal(result.status,'placed');assert.equal(result.insertAfter,5);assert.equal(result.insertBefore,6);
});
test('replace and delete cross-check the full multi-paragraph provision', () => {
  const text=motion(['19. Opening provision', 'continues in a second source paragraph;', '20. Next;']);
  for(const proposedText of ['19. New provision;', '', 'deleted']) {
    const result=placement(text,{originalText:'19.  Opening provision\ncontinues in a second source paragraph;',proposedText,targetLabel:'Paragraph 19'});
    assert.equal(result.status,'placed');assert.deepEqual(result.span,{start:3,end:4});
    assert.equal(result.operation,proposedText==='19. New provision;'?'replace':'delete');
  }
});
test('whole-cell localized deletion markers do not turn ordinary prose into a deletion', () => {
  for(const marker of DELETION_MARKERS)assert.equal(amendmentOperation({originalText:'Source text',proposedText:' '+marker.toUpperCase()+' '}),'delete',marker);
  assert.equal(amendmentOperation({originalText:'Source text',proposedText:'The word deleted occurs in this sentence.'}),'replace');
  assert.equal(amendmentOperation({originalText:null,proposedText:'New'}),null);
});
test('CBAM amendment 7 is deletion despite a nested new provision; proposal baseline is unavailable', async () => {
  const {readFile}=await import('node:fs/promises');
  const fixtures=JSON.parse(await readFile(new URL('./fixtures/amendment-docx-excerpts-20261016.json',import.meta.url),'utf8'));
  const am=fixtures.documents.find(doc=>doc.targetDocumentId==='A-10-2025-0085').expected.find(am=>am.number===7);
  const result=placement(motion(['1. Unrelated report paragraph;']),am);
  assert.equal(result.operation,'delete');assert.equal(result.status,'unresolved');assert.equal(result.reason,'baseline_unavailable');
  assert.equal(placement(motion(['1. First;']),{originalText:'',proposedText:'Article 1a',targetLabel:'Article 1 a (new)'}).reason,'baseline_unavailable');
});
test('label/quote disagreement, repeated labels and insertion/relative conflicts stay unresolved', () => {
  const text=motion(['19. Actual text;', '20. Other text;']);
  assert.equal(placement(text,{originalText:'20. Other text;',proposedText:'New',targetLabel:'Paragraph 19'}).reason,'conflicting_target_evidence');
  assert.equal(placement(text,{originalText:'',proposedText:'New',targetLabel:'Paragraph 19 a (new)',referenceText:'After § 20'}).reason,'conflicting_target_evidence');
  const duplicate=motion(['19. Actual;', '19a. Existing;', '20. Next;']);
  assert.equal(placement(duplicate,{originalText:'',proposedText:'New',targetLabel:'Paragraph 19 a (new)'}).reason,'duplicate_target_label');
  const repeated=motion(['19. Actual;', '19. Actual;', '20. Next;']);
  assert.equal(placement(repeated,{originalText:'19. Actual;',proposedText:'New',targetLabel:'Paragraph 19'}).reason,'multiple_published_targets');
});
test('placement quotation fallback stays bounded, unique, in the resolution and in the wording language', () => {
  const text=motion(['19. Complete text;', '20. Next;']);
  assert.equal(placement(text,{originalText:'19. Complete text;',proposedText:'New',targetLabel:'Unsupported location'}).status,'placed');
  assert.equal(placement(text,{originalText:'Cover',proposedText:'New'}).reason,'target_not_found');
  assert.equal(placement(text,{originalText:'19. Complete text;',proposedText:'New',language:'fr'}).reason,'different_text_languages');
  assert.equal(placement(text,{originalText:'19. Complete text;',proposedText:'x'.repeat(65537)}).reason,'matching_budget');
  assert.equal(placement(document(['19. Complete text;']),{originalText:'19. Complete text;',proposedText:'New'}).reason,'baseline_unavailable');
  text.paragraphSources[3].complete=false;
  assert.equal(placement(text,{originalText:'19. Complete text;',proposedText:'New',targetLabel:'Paragraph 19'}).reason,'source_passage_incomplete');
});

for(const [kind,base,labels,next] of [
  ['Paragraph','19',['19. First;', '19b. Earlier sibling;', '19aa. Later sibling;', '20. Next;'],'20. Next;'],
  ['Recital','B',['B. whereas first;', 'Bb. whereas earlier sibling;', 'Baa. whereas later sibling;', 'C. whereas next;'],'C. whereas next;'],
])test(`${kind} insertion anchors to the last source sibling when suffix lengths differ`,()=>{
  const text=motion(labels),result=placement(text,{originalText:'',proposedText:'New provision;',targetLabel:kind+' '+base+' c (new)'});
  assert.equal(result.status,'placed');assert.equal(result.insertAfter,5);assert.equal(result.insertBefore,6);
  assert.equal(text.paragraphs[result.insertBefore],next);
  assert.equal(result.evidence[0].anchor,base+'aa');
});
