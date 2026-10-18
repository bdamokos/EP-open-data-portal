# Development

Use the Node version in `.nvmrc`. The frontend entry is `src/main.tsx`. Navigation uses query parameters at the application root. Static serving covers only the root page, `index.html` and `assets/`; other paths return 404.

The unfinished amendment catalogue is hidden by `publicAmendmentsEnabled` in `src/publicFeatures.ts`. This gates its main navigation, MEP tab and document/dossier links. Old catalogue URLs fall back to Members, and old MEP amendment-tab URLs to Latest speeches. The amendment components, API, parsing, indexing and stored data remain intact; motion outcomes and original/joint/adopted wording comparisons remain public.

Boolean settings accept `1`, `true`, `yes`, `on` and `0`, `false`, `no`, `off` (case-insensitive); other nonempty values fail with the setting name. Worker flags are checked when accessed or started; directory and bounded job settings are read when their service is first created. Relative paths resolve from the working directory. `JSON_RESPONSE_LIMIT_BYTES` caps supported JSON responses (default 5242880 bytes).

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

For persistent data, mount a writable cache directory at `/data/cache` and an index directory at `/data/index`, owned by UID 1000. Extracted document texts in the cache directory are capped by `DOCUMENT_TEXT_MAX_DISK_MIB` (default 256). Set `ACTIVITY_INDEX_ENABLED=true` to enable history indexing. Use only one index writer. The optional full-text corpus (`CORPUS_ENABLED=true`, `CORPUS_DIR`) needs its own persistent directory and disk budget (`CORPUS_MAX_DISK_MIB`); a full term with all languages needs roughly 10–15 GB. It has one leased writer and reads the index without writing to it. Preserve retained data when replacing a container; do not reset generations or bulk-download sources as a release check.

## Member voting API

`GET /api/member-votes/{personId}` projects a positive Open Data person ID over one held plenary `sitting=MTG-PL-YYYY-MM-DD` or Monday `week=YYYY-MM-DD` (`week=latest` by default). Optional parameters are `lang`, `limit` (1–100, default 25), `offset` (0–10000), exact `decision`, and `snapshot`. Unknown, duplicate and invalid parameters return 400. Exported response types live in `src/MemberVotesTypes.ts`; this endpoint does not depend on the activity index or expose a frontend view.

The response resolves a concrete `period`, supplies a `snapshotId`, and paginates all observed decisions by date descending, then exact ID. `observedTotal` describes that retrieved snapshot, including non-named and non-conducted observations; it is not a term total or participation denominator. Pin subsequent pages with `snapshot`; selection by `decision` searches the full pinned snapshot independently of the visible page. A retained `week=latest&snapshot=…` resolves its original week without looking up today's latest week. Evicted, expired or mismatched snapshots return 409. Snapshots are shared across members and languages, retained for at most ten minutes, with an eight-entry/32 MiB memory limit.

`coverage` separates catalogue, source pages and declared result/decision children, with failed and incomplete sittings. Expected results come from both the meeting's own children and expanded result parents. Missing records are distinct from an empty successful collection. Repeated or conflicting source pages, bounds, inconsistent identities, missing children and upstream failures prevent complete coverage. Overlapping decision records that disagree retain both values in each item's `sourceConflicts`. `collectionComplete` describes these checks only; publication can change. Sources retain retrieval times, content hashes and stale/refresh flags. Hashes identify retrieved content, not publication timestamps. No mandate eligibility or historical group membership is inferred, and no attendance or group percentages are supplied.

Readers use the existing cached public-source client, with metadata-only requests and a 24 MiB period budget. A selected week scans at most five held sittings, one sitting at a time to respect shared admission limits. Sources page at 50 rows (250 for decisions), with ten catalogue pages and four pages per daily stream. Decisions are read both without named voters and as named roll calls, joined by exact identity. Ignored paging is detected without repeatedly adding records. Offset pages and other members reuse the collected period; reader cancellation does not cancel a shared bounded loader. A cold week can exceed the 30-second HTTP budget while its independent loader continues for at most 50 seconds; retry can join or reuse that load. Local timeout/busy/cancellation errors never become parliamentary coverage gaps. No source/index writer or full-term reverse index is added.

## Verification

Run the checks in [Contributing](../CONTRIBUTING.md). Verify the directory, a profile, question/answer reading, speech-cloud reading and highlights, named vote/country joins, language selection, Following, and mobile layouts.

Local test examples intentionally omit parts of the archive, portraits and demographics. Keep fixture limits separate from live counts. Test external media through the official public player after an explicit Play, including the requested language and actual decoded audio.

The application API uses flat routes under `/api/`, such as `/api/directory` and `/api/profile/{id}`. The former `/api/poc/` routes are not served. Deploy this route contract together with the gateway’s bounded route admission and verify the frontend after the coordinated switch.

## Motion amendment API

`GET /api/motion-amendments/{id}` reads the accepted index for one exact term-10 `B-10-YYYY-NNNN` or `RC-10-YYYY-NNNN` identifier, allowing four to six final digits (`server/motion-amendments.mjs`, `src/MotionAmendmentsTypes.ts`). It never fetches upstream sources, queues work or writes data. The hidden amendment catalogue remains hidden.

Query parameters are `member` (positive Open Data person ID), `scope=all|member` (default `all`), `lang` (default `en`), `offset` (default `0`, maximum `1000000`) and `limit` (default `20`, maximum `50`). Member scope requires a valid member. Unsupported or repeated parameters return HTTP 400. All scope with a member annotates each checked aggregate and variant match without filtering out other proposers; member scope uses the same checked, dated author matching. `total` counts the selected indexed scope; `totals` also gives all indexed rows and member matches.

The response keeps queried-text authorship, amendment proposers and exact original/joint relationships independent. Related texts are capped at five per direction and are not a complete relationship census. Each amendment retains list and individual identity, provision, proposer and on-behalf-of evidence, conflicting variants, actual wording language and field-level provenance. `wording` distinguishes available, withheld and unavailable columns. Each decision has whole-amendment, split-part or unresolved-split scope; `wholeAmendmentOutcome` excludes split-part decisions. Split descriptions do not establish validated wording spans or survival in adopted text. Original/joint/adopted comparison remains a separate API; this endpoint adds no direct original-to-adopted reader.

`coverage.resultState` distinguishes records, not indexed, no indexed member matches, observed empty and unavailable evidence. The existing writer records `emptyObservation` only when the current document projection explicitly publishes an empty `inverse_foresees_change_of` array. With no retained amendment rows, that establishes `observed-empty` for `observationScope=published-amendment-list-relationships`; it establishes neither absence of oral amendments nor complete decision coverage. Missing, unknown or legacy relationships cannot establish emptiness. `observationComplete` is limited to the stated source scope, while legacy `complete` remains false for this narrow empty observation. `backgroundPending` has global index scope, and `targetProcessing` stays unknown. Keep retained/stale evidence and gaps visible, including on later pages; `snapshots` identifies the amendment and text generations separately.
