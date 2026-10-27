# Contributing

Create a branch and open a pull request with the problem, resulting behaviour and validation. Keep unrelated changes separate. Include mobile and desktop screenshots for visible changes.

Run `npm ci` first; test runs without it are not validation evidence. Iterate with `npm run test:fast` or a focused file (`npm test -- server/example.test.mjs`). Before opening a PR, run the full suite when the environment allows:

```sh
npm ci
npm test
npm run check
npm run build
```

`npm test` discovers all `src/*.test.mjs`, `server/*.test.mjs` and `scripts/*.test.mjs`. `test:slow` runs the explicit subprocess manifest; `test:server` and `test:frontend` restrict directories; `--scripts` selects script tests. Combine them with profiles, e.g. `npm run test:fast -- --server`. Explicit file arguments override the profile. Runner flags such as `--test-reporter=tap` pass through to Node. `TEST_CONCURRENCY` overrides concurrency (local default: half the available CPUs, minimum two; CI: Node default); `TEST_TIMEOUT_MS` sets the default per-test timeout (120000 ms). Tests with explicit timeouts retain them. Outbound network is blocked, including in Node subprocesses through the inherited `NODE_OPTIONS` preload; use fixtures or mocked fetch.

Loopback tests report a reason when sandbox permissions deny listening; CI fails instead of skipping. `TEST_SIMULATE_NO_LOOPBACK=1` is a test-only way to verify that behaviour, including the CI failure. Report sandbox loopback/subprocess skips in PR validation and rely on CI for full coverage.

The Checks workflow runs these steps for pull requests, including drafts, and for pushes to main; it can also be started manually for any branch. It runs on GitHub-hosted standard runners at no cost to the public repository, so opening a draft pull request early is the cheapest way to run the full checks from a constrained machine. It uses read-only permissions and no deployment secrets. Maintainers should require its `test-and-build` check and review before merging. Repository visibility, branch protection and release permissions are managed separately.

Keep `.nvmrc` and the Dockerfile's Node version aligned. Pin `NODE_IMAGE` to the official multi-platform image index digest so build, dependency and runtime stages share an immutable base across supported architectures. The runtime-image check asserts the actual Node version, exercises valid and malformed Brotli decoding, and checks startup and built assets; run it for any image built with a `NODE_IMAGE` override as well.

For an API response contract change, update the affected endpoint `*_VERSION` and run:

```sh
npm run api:bump
node --test server/api-version.test.mjs scripts/api-version.test.mjs
git add server/api-version.mjs
```

The command fetches `origin/main`, keeps every recorded main revision/digest pair, renumbers branch-only entries after main's latest revision, and appends the current endpoint inventory digest if needed. Repeated runs are unchanged. It writes only `server/api-version.mjs`; review and commit that change with the contract change. It neither stages files nor changes branches, installs hooks, commits, or pushes. Fetch failures stop before writing. Do not bump for builds, releases or data refreshes.

`API_CONTRACT_REVISION` and registry keys increase without wrapping. `API_VERSION` runs from 1 to 999, then returns to 1: revision 1000 exposes version 1. Keep all earlier registry entries. Requests still use only `v`; reusing a number relies on existing caches expiring between cycles.

After merging or rebasing main (or another branch in a stack), resolve endpoint code first and rerun `npm run api:bump`. For conflicts in `server/api-version.mjs`, leave Git's ordinary or diff3 conflict markers in place: the tool preserves both sides' recorded digests and renumbers their entries after main. It refuses conflicts in helper code outside the version declarations; resolve those manually first. Then stage the result and continue the merge/rebase. Run it again when main advances before merge; do not edit or discard recorded digests to make a check pass. Branch entries whose original revision/digest pair already appears on main are treated as landed; equal digest values at different revisions are retained.

For a response-semantic change that does not change the endpoint inventory digest, use `npm run api:bump -- --force` once. This deliberately appends another revision with the same digest; ordinary reruns remain unchanged. The digest cannot detect semantic changes without a changed endpoint version, so reviewers must still check this case.

`npm run api:check` is read-only and compares the working registry with the locally available `origin/main`; fetch main first when using it locally. `-- --base <ref>` adds a stack parent baseline: its branch-only digests must survive after main, but may move to new revisions. `API_VERSION_BASE` supplies CI's immutable PR base or previous main commit. `API_VERSION_MAIN_BASE` pins the protected main history: the immutable base SHA for a PR targeting main, the previous commit for a push to main, or the fetched `origin/main` for a stacked PR. CI preserves main's exact mappings and each occurrence of a parent-only digest, and runs the normal digest test. Neither CI nor `npm test` performs an automatic bump, so unbumped endpoint changes still fail. No hook is required; if using a local hook, keep it read-only (for example `npm run api:check`) and stage bumps explicitly.

Style components with the design tokens in `src/theme.css`, never raw colour values. Each token has a light and a dark value, and every view uses the same surfaces in both schemes; the political-group, vote and status colours are reserved for data. Keep the interface independent of European Parliament branding. `src/theme.test.mjs` checks token contrast and rejects raw colours, and the focus tests run in both schemes. Check visible changes in light and dark appearance.

Write interface text for readers: plain, brief and free of disclaimers, hedges and robotic phrasing. Before adding a sentence, ask whether a reader would miss it. Coding agents tend to add caveats and explanations to UI copy; report uncertainty, gaps and limits to the maintainer in full in the PR description, review replies or chat instead.

- The site notice (`src/components/DataNotice.tsx`) states once that the site is independent, that its counts may be incomplete or out of date, and that readers should check the original. Do not repeat that inline.
- Link only to human-readable public pages; `sourcePageUrl` and `SourceLink` in `src/SourceLink.tsx` apply this rule. Never link to or display machine endpoints (API, JSON-LD, SPARQL, concept URIs, the developer corner), request URLs, retrieval timestamps or record IDs as evidence. Without a public page, show no link and no note about it.
- Mark gaps, unavailable values and partial coverage with short labels such as "Partial coverage", "Unavailable" or "—", not sentences.
- Do not state what the app does not infer or claim, and do not explain methods. Add one line only where it changes how a number reads, such as "Shared questions count once per country".
- Keep pipeline and maintainer terms out of public views: index generations, parsers, source variants, load states, what an API returned.
- State empty and error states in a few words ("No matching amendments.", "Transcript unavailable."), without reasons or advice. Omit helper captions, such as search-scope notes, unless the reader can act on them.

Use public sources and retain exact identifiers, dates, languages and attribution. Document a new source in `docs/PUBLIC_DATA.md` and add bounded, attributable test examples. Keep unavailable observations distinct from zeroes.

Do not commit credentials, private datasets, browser storage, generated caches, runtime databases, host addresses or site-specific deployment configuration. CI does not access a deployed website or run an indexer. Deployment is separate from pull-request checks.

## Amendment benchmark

After `npm ci`, set `AMENDMENT_BENCHMARK_API_BASE` to the public explorer's HTTPS origin (or pass `--api-base HTTPS_ORIGIN`), then acquire a frozen snapshot with `npm run bench:amendments -- --fetch --request-cap 2500`. No deployment origin is built in. Acquisition is sequential, at least 750 ms apart; attempts and approved official DOCX redirect hops count against the cap. HTTP 429/503 `Retry-After` is honoured up to 60 seconds; a longer delay aborts rather than retrying early. `--retry-after-cap-ms` can lower that ceiling. Network errors and 5xx responses are never cached. Missing inputs, exhausted request caps and malformed catalogue/context responses abort acquisition, without producing a score.

The default sample is term-10 amendments with indexed plenary decisions in the latest eight Monday weeks containing decisions, through the snapshot's Brussels date. `--weeks N`, inclusive `--from YYYY-MM-DD --to YYYY-MM-DD`, or repeatable exact `--document`/`--report` IDs select other samples. One variant per amendment is evaluated by English, language code, then list ID; alternatives remain recorded. Provisional-agreement decisions are not placeable amendments: their rows remain in raw counts but are excluded from the headline and vote denominators. A collective/split decision counts once and requires all sampled linked placeable amendments to be correct.

Inputs and JSON/Markdown results stay outside Git in `${XDG_CACHE_HOME:-~/.cache}/ep-explorer/amendment-benchmark`; override with `AMENDMENT_BENCHMARK_CACHE_DIR` or `--cache-dir`, and optionally `--output-dir`. Acquisition always reads plain document context, one deterministic report-level proposal context per indexed language, and every indexed DOCX list for each sampled document, regardless of checkout extraction. `snapshot.json` records the origin, sample and full URL/hash/retrieval manifest; its ID is independent of the inputs a particular placement reads. Use a new cache directory for a new snapshot. Rerun without `--fetch` offline; keep the checkout fixed throughout a run.

The benchmark re-extracts amendment wording and computes placement with checkout code. Document text and proposal projections currently remain frozen live API acquisition inputs. Their gaps have a separate `acquisition-unavailable` outcome, retained in the headline denominator. Output records live document-context versions and checkout document-context, proposal-parser and DOCX-extractor versions. Until upstream source replay is available, the regression gate refuses comparison if observed live projection versions differ from their checkout constants. Live wording and placement are ignored. Parser/grammar limits never prove source absence; JSON explains the narrow affirmative exclusions. Resolution insertion/extent assertions derive their own boundaries from raw source rows and formatting, stopping at numbered provisions, whole-row bold headings, degree-sign separators and section/annex headings. Uncertain extents stay unverified. Unique reason counts are disjoint; pattern taxonomy rows overlap.

Keep a baseline JSON and replay the same snapshot/sample after changing code with `npm run bench:amendments -- --baseline /absolute/path/to/baseline.json`. The gate validates the full snapshot manifest, warns if the benchmark/oracle model changed, reports comparable metric/taxonomy deltas and every regressed amendment, and exits non-zero on any false placement, deterioration from `correct`, missing row or projection-version incompatibility.

For placement PRs using the same frozen API text/proposals, add `--placement-only --baseline /absolute/path/to/baseline.json`. This explicitly limits the gate to checkout-computed placement outcomes and waives only the recorded document-context wrapper-version mismatch. It requires identical sample/manifest and unchanged source-producer modules, their local dependency closure and dependency lock. Other projection-version mismatches and producer changes still refuse comparison pending #278. Older clean baseline reports can recover producer hashes from their recorded Git revision, which must be available locally and match the report's producer hashes; dirty or unverifiable baselines are refused. Never compare different snapshots. Keep public-source results outside Git and CI artifacts.
