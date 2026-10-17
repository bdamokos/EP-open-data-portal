# Development

Use the Node version in `.nvmrc`. The frontend entry is `src/main.tsx`. Navigation uses query parameters at the application root. Static serving is limited to the root page, `index.html` and `assets/`; unknown paths return 404 instead of absorbing another application’s namespace.

The adapter binds to loopback by default and does not implement accounts. Browser data requests omit cookies and authorization. A reverse proxy must overwrite forwarded headers before `TRUST_PROXY=true` is enabled. Site routing, access controls, host configuration and credentials belong outside this repository.

## Container

```sh
docker build -t parliament-explorer .
docker run --rm -p 127.0.0.1:8790:8790 parliament-explorer
```

The image runs as an unprivileged user and includes only built assets, runtime modules and production dependencies. Tests, fixtures, server declarations, documentation and local state are excluded. The build accepts `NODE_IMAGE` for an immutable base-image reference and `APP_REVISION` for the source label and response header.

CI also starts the built production image with its normal command and health check. To repeat locally, build with `--build-arg APP_REVISION="$(git rev-parse HEAD)"`, then run `node scripts/check-runtime-image.mjs parliament-explorer "$(git rev-parse HEAD)"`. This check disables outbound networking and source writers, uses temporary in-memory data, and verifies health, revision headers and the built frontend entry without publishing a host port.

For persistent data, mount a writable cache directory at `/data/cache` and an index directory at `/data/index`, owned by UID 1000. Set `ACTIVITY_INDEX_ENABLED=true` to enable history indexing. Use only one index writer. The optional full-text corpus (`CORPUS_ENABLED=true`, `CORPUS_DIR`) needs its own persistent directory and disk budget (`CORPUS_MAX_DISK_MIB`); a full term with all languages needs roughly 10–15 GB. It has one leased writer and reads the index without writing to it. Preserve retained data when replacing a container; do not reset generations or bulk-download sources as a release check.

Corpus search and status scans use read-only worker threads, with one query at a time and a five-second response deadline. Busy or slow queries return HTTP 503. Search pagination stops at offset 1,000; `truncated: true` indicates more matches beyond the accessible pages. Narrow the language, date, kind or member filters to inspect those matches.

## Verification

Run the checks in [Contributing](../CONTRIBUTING.md). Verify the directory, a profile, question/answer reading, speech-cloud reading and highlights, named vote/country joins, language selection, Following, and mobile layouts. Inspect screenshots as well as measurements.

Local test examples intentionally omit parts of the archive, portraits and demographics. Keep fixture limits separate from live counts. Test external media through the official public player after an explicit Play, including the requested language and actual decoded audio.
