# Development

Use the Node version in `.nvmrc`. The frontend entry is `src/main.tsx`. Navigation uses query parameters at the application root. Static serving covers only the root page, `index.html` and `assets/`; other paths return 404.

The server binds to loopback by default and has no accounts. A reverse proxy must overwrite forwarded headers before `TRUST_PROXY=true` is enabled. Site routing, access controls, host configuration and credentials belong outside this repository.

## HTTP caching

Anonymous, stateless API reads use a six-hour CDN lifetime; activity and speech lists use one hour. Positive speech/document reading responses dated at least 14 days ago use 24 hours, except unanswered questions, whose answer links can still change. Answer age comes from the selected answer, not its parent question; unknown dates keep six hours. Browsers revalidate API responses. Partial index and corpus coverage remains an explicit snapshot, with source retrieval dates preserved; background retries do not by themselves invalidate saved observations. Source refresh schedules are independent and unchanged: CDN lifetimes describe when a shared cache checks this server, not the maximum age of upstream data.

Health, progress, diagnostic failures, stateful speech statistics, speech clouds and topic trends, non-read methods, errors, and temporary unavailable/stale/refreshing responses use `no-store`. Upstream freshness state is retained through reading and legislation projections. Successful portraits use up to seven days at the CDN and one day in browsers, capped by the saved image's existing source expiry, with content ETags and Origin variation for conditional reads. HTML and source maps revalidate: a map can change without changing its script's fingerprint. Vite's build manifest identifies fingerprinted assets for one-year immutable caching; other assets use five minutes.

The application sends separate `Cache-Control` and `CDN-Cache-Control` headers. A gateway must preserve the approved public policy and keep its own errors, private routes and legacy routes uncached. A CDN needs explicit eligibility for JSON and extensionless portraits, must respect origin `no-store`, and must retain the full query string and Origin in its cache key. Mutable API entries require invalidation when a release changes their representation; refresh publication can invalidate affected entries sooner than their TTL. Hosting-specific rules and invalidation configuration belong outside this repository. Do not treat a revision response header as a cache-key change.

## Container

```sh
docker build -t parliament-explorer .
docker run --rm -p 127.0.0.1:8790:8790 parliament-explorer
```

The image runs as an unprivileged user and includes only built assets, runtime modules and production dependencies. Tests, fixtures, server declarations, documentation and local state are excluded. The build accepts `NODE_IMAGE` for an immutable base-image reference and `APP_REVISION` for the source label and response header.

CI also starts the built production image with its normal command and health check. To repeat locally, build with `--build-arg APP_REVISION="$(git rev-parse HEAD)"`, then run `node scripts/check-runtime-image.mjs parliament-explorer "$(git rev-parse HEAD)"`. This check disables outbound networking and source writers, uses temporary in-memory data, and verifies health, revision headers and the built frontend entry without publishing a host port.

For persistent data, mount a writable cache directory at `/data/cache` and an index directory at `/data/index`, owned by UID 1000. Set `ACTIVITY_INDEX_ENABLED=true` to enable history indexing. Use only one index writer. The optional full-text corpus (`CORPUS_ENABLED=true`, `CORPUS_DIR`) needs its own persistent directory and disk budget (`CORPUS_MAX_DISK_MIB`); a full term with all languages needs roughly 10–15 GB. It has one leased writer and reads the index without writing to it. Preserve retained data when replacing a container; do not reset generations or bulk-download sources as a release check.

## Verification

Run the checks in [Contributing](../CONTRIBUTING.md). Verify the directory, a profile, question/answer reading, speech-cloud reading and highlights, named vote/country joins, language selection, Following, and mobile layouts.

Local test examples intentionally omit parts of the archive, portraits and demographics. Keep fixture limits separate from live counts. Test external media through the official public player after an explicit Play, including the requested language and actual decoded audio.

The published application API uses `/api/poc/`. This transport namespace is a compatibility contract with the gateway and clients, independent of application file and component names.
