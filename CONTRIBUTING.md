# Contributing

Create a branch and open a pull request describing the problem, the resulting behaviour and how you validated it. Keep unrelated changes separate. Include mobile and desktop screenshots for visible changes.

## Checks

```sh
npm ci            # required first: runs without installed dependencies prove nothing
npm test
npm run check
npm run build
```

| Command | Runs |
| --- | --- |
| `npm test` | All `src/`, `server/` and `scripts/` `*.test.mjs` files |
| `npm run test:fast` | The quick profile, for iterating |
| `npm run test:slow` | Subprocess tests |
| `npm run test:server`, `test:frontend`, `-- --scripts` | One directory; combine with a profile, e.g. `npm run test:fast -- --server` |
| `npm test -- path/to/file.test.mjs` | Named files only |

`TEST_CONCURRENCY` and `TEST_TIMEOUT_MS` (default 120 s) override the runner. On a 4 GB machine, `npm test -- --max-old-space-size=1024` bounds each test process.

- Outbound network is blocked in tests, including subprocesses; use fixtures or a mocked fetch.
- Share Vite transform servers through `src/test-support/viteRunner.mjs` instead of creating one per test.
- Settle every deferred fetch fixture at teardown, or its timer keeps the process alive.
- Sandboxes that deny loopback listening or `ps` skip the affected tests with a reason; CI fails instead. Report such skips in the PR.

The Checks workflow runs on pull requests (including drafts) and pushes to main, and can be started for any branch with `gh workflow run checks.yml --ref BRANCH`. It uses free GitHub-hosted runners, so a draft PR is the cheapest full run from a constrained machine. Its `test-and-build` check gates merging.

Keep `.nvmrc` and the Dockerfile’s Node version aligned, and pin `NODE_IMAGE` to the official multi-platform image digest.

## API versions

For an API response contract change, including a change of meaning, bump the affected endpoint `*_VERSION`. The client build and server startup derive the same 12-character version from the contract digest; no other version update is needed.

## Interface

- **Colour:** style with the tokens in `src/theme.css`, never raw colour values. Every token has light and dark values; political-group, vote and status colours are reserved for data. Don’t use European Parliament branding. Check visible changes in both appearances.
- **Controls** (`src/Controls.css`): underlined tabs navigate between sections; segmented controls switch views of the same content; outlined buttons are secondary actions; `.ui-primary-action` marks the main action. Applied filters use the accent tint and a remove control.
- **Focus** (`src/focus.css`): use `:focus-visible`, including for headings and readers that receive focus. Preserve autofocus, focus restoration and dialog focus management.

## Interface text

Write for readers: plain, brief and free of disclaimers, hedges and robotic phrasing. Before adding a sentence, ask whether a reader would miss it. Report uncertainty, gaps and limits to the maintainer in full in the PR, review replies or chat instead.

- The site notice (`src/components/DataNotice.tsx`) says once that the site is independent, its counts may be incomplete and readers should check the original. Don’t repeat it inline.
- Link only to human-readable public pages (`sourcePageUrl` and `SourceLink` in `src/SourceLink.tsx`). Never show API, JSON-LD, SPARQL or concept URLs, request URLs, retrieval timestamps or record IDs as evidence. Without a public page, show no link and no note.
- Keep in-page disclaimers and source links to a minimum. General sourcing and translation notes belong in the site notice. Show a source link in the page only when it replaces something we couldn't parse and that public page holds the exact information, or when the information is useful and we deliberately don't parse it.
- Use “Partial” only for a concrete missing record, failed read or bounded omission in the displayed selection, and name it briefly. A recent date or an unrelated archive gap is not a gap. Keep unknown values distinct from zero.
- Don’t explain methods or say what the app doesn’t infer. Add one line only where it changes how a number reads, such as “Shared questions count once per country”.
- Keep pipeline terms out of public views: generations, parsers, source variants, load states, what an API returned.
- State empty and error states in a few words (“No matching amendments.”, “Transcript unavailable.”), without reasons or advice.

## Translations

UI messages use stable IDs in `src/ui-locales/en.json`. Components use `useUiI18n`; helpers take a formatter argument. Use whole messages with named rich slots, and keep source wording, identifiers and language tags in slots. Never look up arbitrary API strings or rewrite rendered text.

Each `src/ui-locales/<language>.json` is a flat dictionary by message ID; missing messages fall back to English individually. `plural-pairs.json` declares plural families and `plural-forms.json` holds reviewed native forms. Owned errors use `UiMessageError` and `uiErrorText`; external API error messages stay literal.

The interface language is chosen in the header. Readers show one `TextLanguagePicker` line above the text; don’t add other language selectors, except search filters. List languages in EU protocol order (`protocolOrder` in `server/language-order.mjs`).

## Data

Use public sources and keep exact identifiers, dates, languages and attribution. Document a new source in [Public data sources](docs/PUBLIC_DATA.md) and add small, attributed test fixtures. Don’t commit credentials, private datasets, browser storage, caches, databases, host addresses or deployment configuration.

## Benchmarks

Benchmark caches, snapshots and results stay outside Git and out of CI artifacts. Run any benchmark script with `--help` for the full options.

**Read benchmark.** `npm run bench:reads` (needs the `sqlite3` CLI) measures SQLite page reads on synthetic data; add `-- --compare REF` to compare against a Git revision. CI measures the base and head in the same job and fails when page fetches exceed base × 1.20 + 10 or an existing scenario adds a full scan of a large table. New and removed scenarios are reported without failing the gate.

**Amendment benchmark** (`npm run bench:amendments`) scores amendment placement against a frozen public snapshot:

- Acquire into a new, empty directory: `--fetch --cache-dir DIR --request-cap N` (`--delay-ms` sets pacing; `--api-base` or `AMENDMENT_BENCHMARK_API_BASE` names the public explorer). Alternatively, `--production-data-dir PATH` reads a copy of the explorer’s data read-only, with no upstream fallback. Never point it at live databases. Use a consistent copy with no SQLite sidecars; the copy’s owner must establish consistency across the databases and caches.
- Replay offline: `--cache-dir DIR [--output-dir DIR]`.
- Compare: `--baseline FILE` (`--placement-only` is the same gate). Keep an append-only `ratchet.md` and `baseline-current.json` in the snapshot’s output directory.
- Gates: a PR may not turn a previously correct row into anything else, and false placements must stay at zero. The hold-out snapshot is measure-only: never tune against it. The language snapshot (`--languages`) is a separate gate with its own ledger.
- Whole-document operations, including rejections, Rule 188(3) alternative motions and provisional agreements, remain in placement and vote denominators. Independently source-verified operations count as correct at document scope; unverified operations stay withheld. Reasons remain distinct in reports.
- Frozen replay records an absent exact request as `frozen-input-absent`, with URL, Accept and snapshot identity in affected rows and result diagnostics. These derived acquisition gaps never enter the sealed manifest or input cache. Listed inputs with corrupt bytes, missing files or invalid metadata still abort replay; unsealed acquisition is unchanged.

**Agenda benchmark** (`npm run bench:agenda`) times agenda assembly. Capture once with `--fetch --api-base ORIGIN --cache-dir DIR --week latest`, then replay offline with `--latency zero|recorded` and compare with `--baseline FILE`.

### Adopted-text calibration

The optional `--adopted-text-snapshot DIRECTORY --request-cap 0` amendment replay
writes a separate `adopted-calibration-*.json` report. It does not affect placement,
verification, scores or the ratchet. Acquire a new sealed TA directory once with
`node scripts/amendment-adopted-snapshot.mjs BENCHMARK.json NEW_DIRECTORY` outside
Git. Acquisition reads public ODP adopted-text listings and their declared English
XML manifestations sequentially, at least two seconds apart; a 429 pauses three
minutes and stops. Replay verifies every input hash and makes no source requests.

Use the sidecar's `placedDisagreements` list for maintainer review. Calibration
results never change the benchmark's existing score or verifier.
