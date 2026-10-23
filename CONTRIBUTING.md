# Contributing

Create a branch and open a pull request with the problem, resulting behaviour and validation. Keep unrelated changes separate. Include mobile and desktop screenshots for visible changes.

Run `npm ci` first; test runs without it are not validation evidence. Iterate with `npm run test:fast` or a focused file (`npm test -- server/example.test.mjs`). Before opening a PR, run the full suite when the environment allows:

```sh
npm ci
npm test
npm run check
npm run build
```

`test:slow` runs the explicit subprocess manifest; `test:server` and `test:frontend` restrict directories. Combine them with profiles, e.g. `npm run test:fast -- --server`. Explicit file arguments override the profile. Runner flags such as `--test-reporter=tap` pass through to Node. `TEST_CONCURRENCY` overrides concurrency (local default: half the available CPUs, minimum two; CI: Node default); `TEST_TIMEOUT_MS` sets the default per-test timeout (120000 ms). Tests with explicit timeouts retain them. Outbound network is blocked, including in Node subprocesses through the inherited `NODE_OPTIONS` preload; use fixtures or mocked fetch.

Loopback tests report a reason when sandbox permissions deny listening; CI fails instead of skipping. `TEST_SIMULATE_NO_LOOPBACK=1` is a test-only way to verify that behaviour, including the CI failure. Report sandbox loopback/subprocess skips in PR validation and rely on CI for full coverage.

The Checks workflow runs these steps for pull requests and pushes to main. It uses read-only permissions and no deployment secrets. Maintainers should require its `test-and-build` check and review before merging. Repository visibility, branch protection and release permissions are managed separately.

Style components with the design tokens in `src/theme.css`, never raw colour values. Each token has a light and a dark value, and every view uses the same surfaces in both schemes; the political-group, vote and status colours are reserved for data. Keep the interface independent of European Parliament branding. `src/theme.test.mjs` checks token contrast and rejects raw colours, and the focus tests run in both schemes. Check visible changes in light and dark appearance.

Use public sources and retain exact identifiers, dates, languages and attribution. Document a new source in `docs/PUBLIC_DATA.md` and add bounded, attributable test examples. Keep unavailable observations distinct from zeroes.

Do not commit credentials, private datasets, browser storage, generated caches, runtime databases, host addresses or site-specific deployment configuration. CI does not access a deployed website or run an indexer. Deployment is separate from pull-request checks.
