# Proposal structure

`server/proposal-structure.mjs` parses one exact Commission proposal content item. Acquisition and baseline identity checks belong to the source layer; the parser does not fetch documents, select translations, or apply amendments.

```js
import {
  parseProposal, parseTargetLabel, proposalCandidates,
  unitLabel, normaliseForMatching,
} from '../server/proposal-structure.mjs';

const proposal = parseProposal(docxBuffer, {
  language: 'en', item: 'act', sourceUrl: officialItemUrl,
  identity: { work: workUri, expression: expressionUri, item: itemUri },
});
const target = parseTargetLabel('Article 1 – paragraph 1 – point 4 – point a', 'en');
const candidates = proposalCandidates(proposal, target);
```

`parseProposal` also accepts a string or a document projection with `paragraphs: string[]`, optional `paragraphSources`, `paragraphProperties`, `documentObjects`, `tables`, notes and links. Plain text cannot establish original object or table completeness and produces `source-structure-unavailable`. Excerpts should supply `coverage: {complete: false}`. Use the DOCX buffer for complete extraction.

## Tree and source positions

The result contains `parserVersion`, `sourceHash`, exact source context, `paragraphs`, ordered `units`, notes, links, objects and explicit `gaps`. `src/proposalTypes.ts` describes the frontend projection.

- Unit `path` segments preserve labels, suffixes and scripts. Chapter, section and title containers remain in the tree. `proposalCandidates` permits an article/annex/recital address to omit its preceding heading containers, returning every candidate when the result is ambiguous.
- `extent: {start, end}` is a half-open range of paragraph indices including descendants. `content` identifies directly owned paragraphs; `spans` supplies exact UTF-16 slices. An instruction and inline replacement can share a paragraph through disjoint slices.
- Memorandum, preamble, signature and financial statement remain separate regions. Articles, including binding final articles, belong to the legal body. A non-normative region is never treated as an article container.
- Quoted replacements have `scope: 'quoted'`, their outer `instructionPath`, and an `underlyingPath` that inherits the enclosing instruction's article/annex context. A quoted Article 9 cannot become an outer proposal Article 9. Inline openings retain quoted scope across paragraphs until the observed outer delimiter closes; nested term quotations and apostrophes do not close it. An explicit replacement instruction can establish the opening boundary when the DOCX omits its quotation mark; `boundaryBasis` records this.
- Tables retain rows, cell paragraph references, column spans, horizontal/vertical merges and nested tables. Empty tables retain their source anchor. Cells are not concatenated into legal paragraphs.
- `complete`, `contentComplete` and `structureComplete` distinguish object/text fidelity from structural gaps. Inspect the selected unit and its objects as well as document-wide status. An unresolved logo can make the whole document incomplete while a legal provision remains readable.

IDs are versioned hashes of source identity, source content, language and item plus the structural path. They identify a particular parser/source revision; they are not official legal-unit identifiers. For a supplied text projection `sourceHash` hashes the supplied paragraph text, rather than claiming to hash its unavailable DOCX bytes.

Results use a bounded process-local LRU keyed by exact input hash, parser version, language, item, identity and source URL. Up to eight immutable results occupy an estimated 64 MiB budget. Consumers must copy a result before modifying it. Changes to parsing semantics require a parser-version bump.

## Numbering and candidate resolution

Proposal extraction injects `proposalNumberingLabels` into `docxContent`. Concrete numbering instances sharing an abstract list continue that list unless an explicit `startOverride` or overridden level start restarts it. Formatting-only overrides continue the list. `lvlRestart` uses its one-based trigger from the abstract definition; zero prevents restarts, and an omitted or invalid trigger uses the preceding level. Independent abstract lists remain separate. The shared extractor's default numbering is unchanged. This recovers the CBAM annex's published `(1), (2), (3)` sequence and makes amendment 8's `Annex I / paragraph 1 / point 2 / point a` address unique.

DOCX paragraph properties retain the concrete and abstract list IDs, level and number format. These levels, or explicit point styles, establish point depth. Roman-compatible letters alone never establish a deeper list: alphabetic `(a)` through `(e)` remain siblings. An unstyled Roman item with uncertain depth retains an `ambiguous-point-level` gap and a conflicting path. Compact decimal article headings such as `Article2` retain a separate article boundary.

Literal duplicate labels under the same parent remain separate units with `pathConflict: true` and distinct occurrence IDs. `proposalCandidates` returns **all** exact candidates, ignoring the internal occurrence suffix; it never chooses by wording or invents a number alias. A caller may compare the amendment's original wording against exactly those candidates and record a unique normalised match. Otherwise the target stays unresolved. Labels repeated under different parents are independent.

`parseTargetLabel(label, language)` returns `{raw, language, segments, complete, unparsed, underlyingLabel}`. Its second line is retained separately as the underlying-act label. Unsupported fragments keep `complete: false`. Greek uppercase heading vocabulary and Greek Ι/Χ glyphs used for Roman heading ordinals have explicit grammar rules; `sourceValue` retains the original glyph spelling. A source article heading without a number remains unlabelled with a gap. The 24 language grammars preserve observed EP discrepancies: omitted paragraph levels, Portuguese `Article I`, Dutch annex `1`, and the Slovak annex point `1` are not silently rewritten to another path. `unitLabel(unit, language)` formats one segment for display; it does not translate source wording.

## Mathematics and other objects

`proposal-math.mjs` converts fractions, sub/superscripts, radicals, n-ary operators, delimiters, matrices, equation arrays, text runs, functions, limits and allowlisted bar/hat/tilde/dot accents to a JSON MathML tree. `ProposalMath` creates allowlisted React elements and escaped text. The only permitted MathML attributes are `accent="true"` on `mover` and `accentunder="true"` on `munder`. Upstream markup is never inserted into the DOM.

Unsupported structures retain U+FFFC, source offsets, `complete: false`, the unsupported element names and an official-document link. Other drawings and objects follow the same unresolved-object convention. A plain text match containing U+FFFC cannot establish equation equality: callers must compare the corresponding safe object structures or leave the match unresolved.

## Matching policy

`normaliseForMatching(text, {stripNumbering = true, stripTerminators = true, numberingPrefixes = []})` produces an alignment key while preserving the original strings in the proposal and amendment records. It applies NFC, removes soft hyphens, folds NBSP/narrow NBSP to spaces, maps typographic apostrophes and quotes, and maps typographic dashes to `-`. It strips an enclosing quotation boundary, decimal and single-letter numbering prefixes, and trailing list full stops/semicolons. Parenthetical words remain meaningful. Multiletter labels require an exact prefix supplied for the corresponding line in `numberingPrefixes`, taken from parsed numbering metadata. `stripNumbering: false` and `stripTerminators: false` retain those features.

For CBAM report A-10-2025-0085:

- Amendment 5's quoted source ends with a differently positioned quote/semicolon; its wording has the same key.
- Amendment 7 ends `declarant.’;` in the proposal and `declarant.;’` in the EP comparison column; both retain the same words and key.
- Amendment 8's sentence has a quotation boundary and terminator in the proposal that the comparison column serialises differently.

The normaliser does not fold case, remove accents, transliterate suffixes, change dates or numbers, delete words, or use fuzzy matching. The real source pairs and source URLs are in `server/fixtures/proposal-matching-excerpts.json`.

## Sources and bounded validation

The offline fixtures contain selected public Commission DOCX paragraphs and EP amendment labels with exact source URLs, languages, hashes and retrieval dates. Full documents remain outside Git. The CBAM act/annex, AI Act annex, all 24 label grammars, instruction nesting, shared-list restarts, MathML safety and punctuation pairs have offline tests. The large-text regression parses exactly 8 MiB within a 15-second CPU budget and 60-second wall guard under a 256 MiB V8 heap cap; cache hits reuse the immutable result.

The renderer is available for the proposal reader but is not connected to an existing page by this module. Acquisition, original-wording verification, insertion anchors and the one-amendment diff remain separate responsibilities.
