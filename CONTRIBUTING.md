# Contributing

Create a branch and open a pull request with the problem, resulting behaviour and validation. Keep unrelated changes separate. Include mobile and desktop screenshots for visible changes.

Before review, run:

```sh
npm ci
npm test
npm run check
npm run build
```

The Checks workflow runs these steps for pull requests, including drafts, and for pushes to main; it can also be started manually for any branch. It runs on GitHub-hosted standard runners at no cost to the public repository, so opening a draft pull request early is the cheapest way to run the full checks from a constrained machine. It uses read-only permissions and no deployment secrets. Maintainers should require its `test-and-build` check and review before merging. Repository visibility, branch protection and release permissions are managed separately.

Keep `.nvmrc` and the Dockerfile's Node version aligned. Pin `NODE_IMAGE` to the official multi-platform image index digest so build, dependency and runtime stages share an immutable base across supported architectures. The runtime-image check asserts the actual Node version, exercises valid and malformed Brotli decoding, and checks startup and built assets; run it for any image built with a `NODE_IMAGE` override as well.

For an API response contract change, update the affected endpoint `*_VERSION` and run:

```sh
npm run api:bump
node --test server/api-version.test.mjs scripts/api-version.test.mjs
git add server/api-version.mjs
```

The command fetches `origin/main`, keeps every recorded main version/digest pair, renumbers branch-only entries after main's latest, and appends the current endpoint inventory digest if needed. Repeated runs are unchanged. It writes only `server/api-version.mjs`; review and commit that change with the contract change. It neither stages files nor changes branches, installs hooks, commits, or pushes. Fetch failures stop before writing. Do not bump for builds, releases or data refreshes.

After merging or rebasing main (or another branch in a stack), resolve endpoint code first and rerun `npm run api:bump`. For conflicts in `server/api-version.mjs`, leave Git's ordinary or diff3 conflict markers in place: the tool preserves both sides' recorded digests and renumbers their entries after main. It refuses conflicts in helper code outside the version declarations; resolve those manually first. Then stage the result and continue the merge/rebase. Run it again when main advances before merge; do not edit or discard recorded digests to make a check pass. Branch entries whose original version/digest pair already appears on main are treated as landed; equal digest values at different versions are retained.

For a response-semantic change that does not change the endpoint inventory digest, use `npm run api:bump -- --force` once. This deliberately appends another version with the same digest; ordinary reruns remain unchanged. The digest cannot detect semantic changes without a changed endpoint version, so reviewers must still check this case.

`npm run api:check` is read-only and compares the working registry with the locally available `origin/main`; fetch main first when using it locally. `-- --base <ref>` adds a stack parent baseline: its branch-only digests must survive after main, but may move to new versions. `API_VERSION_BASE` supplies CI's immutable PR base or previous main commit. `API_VERSION_MAIN_BASE` pins the protected main history: the immutable base SHA for a PR targeting main, the previous commit for a push to main, or the fetched `origin/main` for a stacked PR. CI preserves main's exact mappings and each occurrence of a parent-only digest, and runs the normal digest test. Neither CI nor `npm test` performs an automatic bump, so unbumped endpoint changes still fail. No hook is required; if using a local hook, keep it read-only (for example `npm run api:check`) and stage bumps explicitly.

Style components with the design tokens in `src/theme.css`, never raw colour values. Each token has a light and a dark value, and every view uses the same surfaces in both schemes; the political-group, vote and status colours are reserved for data. Keep the interface independent of European Parliament branding. `src/theme.test.mjs` checks token contrast and rejects raw colours, and the focus tests run in both schemes. Check visible changes in light and dark appearance.

Use public sources and retain exact identifiers, dates, languages and attribution. Document a new source in `docs/PUBLIC_DATA.md` and add bounded, attributable test examples. Keep unavailable observations distinct from zeroes.

Do not commit credentials, private datasets, browser storage, generated caches, runtime databases, host addresses or site-specific deployment configuration. CI does not access a deployed website or run an indexer. Deployment is separate from pull-request checks.
