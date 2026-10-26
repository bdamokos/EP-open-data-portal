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

After `npm ci`, acquire a frozen public-input snapshot with `npm run bench:amendments -- --fetch --request-cap 1500`. Requests are sequential, at least 750 ms apart, with bounded retries and source `Retry-After` delays. Every attempt and approved official DOCX redirect hop counts against the cap. The default sample is term-10 amendments with an indexed plenary decision in the latest eight Monday weeks containing such decisions, through the snapshot's Brussels date. `--weeks N`, an inclusive `--from YYYY-MM-DD --to YYYY-MM-DD`, or repeatable exact `--document`/`--report` IDs select other samples. One exact variant per amendment is selected by English, then language code, then list ID; the output retains the alternatives. Decision IDs count once in vote metrics; all sampled amendments linked to a collective/split decision must be correct.

Inputs, hashes, retrieval times and JSON/Markdown results live outside Git in `${XDG_CACHE_HOME:-~/.cache}/ep-explorer/amendment-benchmark`. Override it with `AMENDMENT_BENCHMARK_CACHE_DIR` or `--cache-dir`; `--output-dir` selects a separate result directory. Rerun without `--fetch` for offline evaluation of checkout extraction, target parsing and placement. Keep the checkout fixed during a run; a changed revision or working diff aborts scoring and requires an offline replay. The structured baseline/document projection comes from the frozen public context API; its live placement and amendment wording are ignored. Missing projections, unsupported DOCX structures and language gaps remain pipeline failures, never inferred source absence. The result documents the narrow affirmative source-exclusion rules. This measures the indexed sample, not all published EP amendments.

Keep the baseline JSON, change the checkout, then run the same sample/cache with `npm run bench:amendments -- --baseline /absolute/path/to/baseline.json`. The gate requires identical sample definitions and input hashes, prints metric/taxonomy deltas and every regressed amendment, and exits non-zero for any false placement or deterioration from `correct`. A missing row also fails. Cache entries are immutable, including failed public requests; use a new cache directory to acquire a new snapshot. Never compare scores from different inputs as a code regression gate. Outputs may contain exact public-source wording and identifiers; keep them outside Git and CI artifacts.
