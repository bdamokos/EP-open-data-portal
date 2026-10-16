# Development

Use the Node version in `.nvmrc`. The frontend entry is `src/main.tsx`. Navigation uses query parameters at the application root. Static serving is limited to the root page, `index.html` and `assets/`; unknown paths return 404 instead of absorbing another application’s namespace.

The adapter binds to loopback by default and does not implement accounts. Browser data requests omit cookies and authorization. A reverse proxy must overwrite forwarded headers before `TRUST_PROXY=true` is enabled. Site routing, access controls, host configuration and credentials belong outside this repository.

## Container

```sh
docker build -t parliament-explorer .
docker run --rm -p 127.0.0.1:8790:8790 parliament-explorer
```

The image runs as an unprivileged user and includes only built assets, runtime modules and production dependencies. Tests, fixtures, server declarations, documentation and local state are excluded. The build accepts `NODE_IMAGE` for an immutable base-image reference and `APP_REVISION` for the source label and response header.

For persistent data, mount a writable cache directory at `/data/cache` and an index directory at `/data/index`, owned by UID 1000. Set `ACTIVITY_INDEX_ENABLED=true` to enable history indexing. Use only one index writer. The optional full-text corpus (`CORPUS_ENABLED=true`, `CORPUS_DIR`) needs its own persistent directory and disk budget (`CORPUS_MAX_DISK_MIB`); a full term with all languages needs roughly 10–15 GB. It has one leased writer and reads the index without writing to it. Preserve retained data when replacing a container; do not reset generations or bulk-download sources as a release check.

Corpus search and status scans use read-only worker threads, with one query at a time and a five-second response deadline. Busy or slow queries return HTTP 503. Search pagination stops at offset 1,000; `truncated: true` indicates more matches beyond the accessible pages. Narrow the language, date, kind or member filters to inspect those matches.

Status reads document/variant counts, character totals and retry summaries from covering metadata indexes, without scanning stored text or task bodies. The writable store adds these indexes in place on first open after an upgrade; read-only workers never create them. Existing text, task cursors, retries and schema version are unchanged. One read snapshot keeps the status fields coherent while collection continues.

Corpus discovery yields after each question record and every eight file tasks. Speech extraction yields between individual language parses and stored speeches. Language extraction retains only attributes, without building a body tree; oversized fragments still supply provenance while the existing 2 MiB body limit remains. These checkpoints let HTTP handlers and lease renewals run during collection and check cancellation and writer ownership before continuing. Interrupted discovery leaves its completion marker unset; interrupted speech pages retain their previous offset and can be retried without duplicating stored text. No additional writer or schema migration is needed.

## Verification

Run the checks in [Contributing](../CONTRIBUTING.md). Verify the directory, a profile, question/answer reading, speech-cloud reading and highlights, named vote/country joins, language selection, Following, and mobile layouts. Inspect screenshots as well as measurements.

Local test examples intentionally omit parts of the archive, portraits and demographics. Keep fixture limits separate from live counts. Test external media through the official public player after an explicit Play, including the requested language and actual decoded audio.
