# Development

## Running locally

Use the Node version in `.nvmrc`. SQLite full-text search (FTS5) needs Node.js 22.16 or 24+; Node.js 23 lacks it.

```sh
npm ci
npm run dev:api   # API server on 127.0.0.1:8790
npm run dev       # Vite frontend, proxying /api to the server
```

Without the activity index the app reads the Open Data API on demand. Question and legislative history, Following and Topics need the local index:

```sh
mkdir -p var/cache var/index var/corpus
ODP_CACHE_DIR="$PWD/var/cache" ACTIVITY_INDEX_DIR="$PWD/var/index" ACTIVITY_INDEX_ENABLED=true \
  CORPUS_ENABLED=true CORPUS_DIR="$PWD/var/corpus" npm start
```

The indexer starts from nothing, works within a request budget and keeps its progress, so coverage starts partial and grows over days. Never run two processes against the same index or corpus directory. `.env.example` lists the settings with their defaults; load them through your shell or service manager.

The unfinished amendment catalogue is hidden by `publicAmendmentsEnabled` in `src/publicFeatures.ts`. Its API, parsing and indexing keep running, and motion outcomes and wording comparisons stay public.

## Architecture

- The frontend (`src/main.tsx`) is a single page; navigation uses query parameters at the root. The server serves only the root page, `index.html` and `assets/`, plus flat JSON routes under `/api/`.
- The HTTP thread answers visitors from read-only SQLite connections and bounded caches. It owns the shared upstream request queue.
- One worker thread hosts the source writers: the activity-index writer, the corpus writer when enabled, and the background collectors (documents, official context, sitting snapshots, press, topics). Each writer holds a lease in its database, so a second process can’t write by accident. Requests from visitors never write.
- The index is published in generations: the writer builds a working generation and switches readers to it atomically.
- Follows and reading state stay in browser storage (`ep.following.*`). The server sees only which MEPs, questions or dossiers a tab checks for updates.
- Data lives in `activities-v1.sqlite` and `press-v1.sqlite` (index directory), `corpus-v1.sqlite` (corpus directory) and file caches under `ODP_CACHE_DIR`. All of it stays outside Git.

## Upstream requests

The Open Data API allows 500 requests per five minutes. The server enforces this as one rolling window for the whole API, reserving 20% for visitors. `ODP_REQUEST_MODE` sets background pacing:

| Mode | Behaviour |
| --- | --- |
| `normal` (default) | No extra spacing within the shared window |
| `steady` | At least 1.5 s between background starts, for periodic updates |
| `backfill` | At least 750 ms between starts (80% of the published rate), slowing after 429/503 |

`ACTIVITY_INDEX_RECOVERY_MODE=backfill` lets the writer work through recorded source gaps and overdue document refreshes between daily refreshes, within the same limits.

Other origins (website files, OEIL, Publications Office, Multimedia Centre) have their own small pools. `OFFICIAL_CONTEXT_DAILY_ORIGIN_LIMIT` limits context warming to 2,000 requests per origin per Brussels day by default. Topic collection uses the writer’s request budget instead. A cold procedure needs about 72 Publications Office requests across 24 languages, so warming a full term takes weeks.

Older speech months are re-checked less often: metadata every 30 days at 4–12 months old, 90 days at 1–2 years and 180 days after that, with a full text verification at 90, 180 and 365 days. A correction to an old speech can therefore take up to a year to appear.

## HTTP caching and the gateway

The server sends separate `Cache-Control` and `CDN-Cache-Control` headers. A gateway or CDN in front of it must:

- overwrite forwarded headers before `TRUST_PROXY=true` is enabled;
- keep the full query string and `Origin` in the cache key, and respect origin `no-store`;
- treat JSON and the extensionless portrait route as cacheable;
- require the `v` parameter on API GETs. The frontend sends `v=<API_VERSION>` (portraits use `PORTRAIT_VERSION`). Without `v` responses are CDN `no-store`; a different version returns HTTP 409 `api_version_mismatch`, and the app shows a reload notice;
- admit `POST /api/client-errors` without caching it.

The API rejects requests from other sites. `API_READ_ORIGIN` names one exact origin that may read it with GET and HEAD, for a separately hosted client such as the media station; writes stay same-origin.

Fingerprinted assets are immutable for a year. HTML and source maps revalidate. Site routing, access control, host configuration and credentials belong outside this repository.

## Container and deployment

```sh
docker build --build-arg APP_REVISION="$(git rev-parse HEAD)" -t parliament-explorer .
docker run --rm -p 127.0.0.1:8790:8790 parliament-explorer
node scripts/check-runtime-image.mjs parliament-explorer "$(git rev-parse HEAD)"
```

The image runs as UID 1000 with production dependencies and built assets only. Mount persistent directories at `/data/cache`, `/data/index` and `/data/diagnostics`, owned by UID 1000, and set `ACTIVITY_INDEX_ENABLED=true`. To enable the corpus, also mount a persistent directory owned by UID 1000 at `/data/corpus` and set `CORPUS_ENABLED=true CORPUS_DIR=/data/corpus`. Outside-speaker title enrichment is disabled and logged once when `CORPUS_DIR` is unset; missing titles use country names. The activity process must receive `CORPUS_DIR` to reuse held headers and collect missing titles. `NODE_IMAGE` pins the base image; keep it aligned with `.nvmrc`.

- **Stop the old container before starting the new one.** Two writers on the same directories are not allowed.
- **Startup preparation:** before listening, the server prepares SQLite indexes and projections for the enabled services. It makes no upstream requests and skips completed work, but after schema changes it can take 20–30 minutes or more on a slow disk. The image allows a 60-minute health-check start period; deployment readiness deadlines must allow for it. `node server/migrate-indexes.mjs` runs the same preparation for maintenance.
- **Keep the data when replacing a container.** Don’t reset generations or bulk-download sources as a release check.

Disk budgets (MiB unless stated):

| Setting | Default | Notes |
| --- | --- | --- |
| `ACTIVITY_INDEX_MAX_DISK_MIB` | 8192 | Includes retained generations and WAL |
| `ACTIVITY_INDEX_RECOVERY_BEGIN_INTERVAL_HOURS` | 6 | Minimum hours between recovery generation starts (1–24); daily refreshes and hard rebuilds bypass it |
| `CORPUS_MAX_DISK_MIB` | 2048 | A full term in all languages needs about 10–15 GB |
| `OFFICIAL_CONTEXT_MAX_DISK_MIB` | 32768 | OEIL and Publications Office pages; collection pauses at 90% |
| `AMENDMENT_SOURCE_MAX_DISK_MIB` | 512 | Term-10 amendment-list DOCX; about 80 MiB now, a few MiB per plenary week |
| `DOCUMENT_TEXT_MAX_DISK_MIB` | 256 | Extracted document texts |
| `SITTING_SNAPSHOT_MAX_DISK_MIB` | 256 | Compressed vote and attendance snapshots, inside the activity budget |
| `BASE_SOURCE_MAX_DISK_MIB` | 128 | Native base documents; set 4096 (with `BASE_SOURCE_MAX_BINDINGS=65536`) for a one-time `BASE_SOURCE_BACKFILL=1` collection |

When one of these budgets is full, collection pauses until it is raised; retained sources aren’t evicted. Portraits have their own 1.4 GB cap.

## Operations

- `npm run data:audit -- --reconcile` inventories queues, recorded gaps and missing question/answer files without starting a writer. Save the JSON and pass `--baseline FILE` later to see what was resolved and what is newly missing. Keep reports outside Git.
- Errors are logged as JSONL in `ERROR_LOG_DIR` (default `var/diagnostics`), with failed index tasks under `activity-index/`. Each directory keeps about 20 MiB and must have one writing process. `node scripts/error-summary.mjs DIR` groups them. Browser reports arrive through `POST /api/client-errors` and exclude free text, page URLs, cookies, IP addresses and user agents.
- Service log prefixes:

| Prefix | Meaning |
| --- | --- |
| `[odp-throttle]` | An upstream 429/503 and the pause applied |
| `[odp-monitor]` | Per-minute request summary: status counts, route families, quota headroom |
| `[event-loop-delay]` | HTTP thread delay over 100 ms (p99) or 250 ms (max) |
| `[sqlite-slow]` | A main-thread SQLite statement that took 250 ms or more |
| `[base-source-backfill]` | Progress of the optional base-document collection |

## Verification

Run the checks in [Contributing](../CONTRIBUTING.md). For visible changes, check the directory, a profile, question and speech reading, vote and country views, language selection, Following, and mobile layouts, in light and dark appearance. Test media through the official player after an explicit Play, including the requested audio language. Local fixtures omit parts of the archive, so their counts are not live figures.
