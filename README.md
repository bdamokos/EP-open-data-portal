# European Parliament data explorer

Explore Members of the European Parliament, written questions, plenary debates, votes and legislative dossiers. Word clouds lead to the underlying speeches, with the selected words highlighted. Questions can be explored by topic, time and author country. Following MEPs is stored in the browser.

Outside voices follows Commissioners and other non-MEP speakers through plenary timelines, repeat appearances, speeches and linked dossiers.

See the [project vision](VISION.md) for the project’s purpose, approach to public data and future directions.

## Run locally

Use the Node.js version in `.nvmrc` (Node.js 26) and npm. The minimum is Node.js 22.16 or 24+; earlier releases and Node.js 23 bundle SQLite without FTS5.

```sh
npm ci
npm run build
npm start
```

Open <http://127.0.0.1:8790/>. For question and legislative history, enable a local activity index:

```sh
mkdir -p var/cache var/index
ODP_CACHE_DIR="$PWD/var/cache" ACTIVITY_INDEX_DIR="$PWD/var/index" ACTIVITY_INDEX_ENABLED=true npm start
```

The indexer starts with bounded requests and retains its progress. Initial coverage is partial and is shown in the interface. Do not run two processes against the same index directory. Cache and index data stay outside Git. `.env.example` lists the available settings; load environment variables through your shell or service manager.

Boolean settings accept `1`, `true`, `yes`, `on` and `0`, `false`, `no`, `off` (case-insensitive); other nonempty values fail with the setting name. Worker flags are checked when accessed or started; directory and bounded job settings are read when their service is first created. Relative paths resolve from the working directory. `JSON_RESPONSE_LIMIT_BYTES` caps supported JSON responses (default 5242880 bytes).

For full-text search, add `CORPUS_ENABLED=true CORPUS_DIR="$PWD/var/corpus"`. A background worker stores speech texts and question/answer texts in `corpus-v1.sqlite`, searchable through `/api/corpus/search` and joined read-only to the activity index; `/api/corpus/status` reports coverage. It pauses at `CORPUS_MAX_DISK_MIB`. See [Public data sources](docs/PUBLIC_DATA.md#full-text-corpus).

Run `npm run data:audit -- --reconcile` in the service environment to inventory both serving and working queues, retained gaps and exact question/answer distribution URLs without starting a writer. Alternatively supply `--index FILE --corpus FILE --press FILE`. Missing databases or tables are reported as unavailable. A queue is evidence of ownership; compare successive reports and service settings to establish progress. Keep reports outside Git.

Save a baseline with `node scripts/data-gap-audit.mjs --reconcile > /absolute/path/baseline.json`, then add `--baseline /absolute/path/baseline.json` on later runs. Comparisons list resolved and newly missing exact identities; the question-file denominator has a digest so changed source scope is visible. Failure classes separate throttling, transient errors, source absence and source/parser problems without declaring a missing record permanently unpublished.

`ACTIVITY_INDEX_RECOVERY_MODE=backfill` admits up to 25 already-due durable source gaps per worker iteration, including between daily refreshes. The existing writer, cursors, retry dates, request budget and disk limit still apply. Return to `normal` for the ordinary 25-per-day recovery policy. This mode does not reopen future retries, historical coverage-window labels, completed empty extractions or unsupported parser results.

API requests emit `[odp-throttle]` events and one `[odp-monitor]` JSON summary per minute to the existing service logs. These distinguish HTTP 429, HTTP 503, network failures, route families, recent request starts and local quota headroom. `ODP_REQUEST_MODE=backfill` spaces starts by at least 667 ms (about 90 per minute), leaving reader capacity within the shared 500-per-five-minute ceiling. It slows after 429/503 and cautiously recovers after successful responses. `steady` starts at 1500 ms for periodic updates; the default `normal` preserves the existing unpaced rolling allowance. Every mode honors the same rolling ceiling, reader reserve and server pauses. Select the mode in runtime configuration; logs measure ordinary useful work, with no separate quota probes. Observations reset on process restart, and process-local limits assume one application source writer.

When `ODP_CACHE_DIR` is set, portraits are also cached on disk in its `portraits-v1` subdirectory. Use one cache writer per directory and keep the cache mount when replacing a container.

For frontend development, run `npm run dev:api` and `npm run dev` in separate terminals. Following is browser-local and persists across visits to the same origin.

## Checks

```sh
npm test
npm run check
npm run build
```

Tests use public-source examples and temporary stores; they do not need credentials or a running indexer. See [Development](docs/DEVELOPMENT.md) for container usage and checks.

Changes go through pull requests with automated tests and a build. See [Contributing](CONTRIBUTING.md). Application source has no redistribution licence assigned. Public data and included third-party material retain their own terms; see [Third-party notices](THIRD_PARTY_NOTICES.md).
