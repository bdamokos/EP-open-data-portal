# Parliament explorer

Explore Members of the European Parliament, written questions, plenary debates, votes and legislative dossiers. Word clouds lead to the underlying speeches, with the selected words highlighted. Questions can be explored by topic, time and author country. Following MEPs is stored in the browser.

Outside voices follows Commissioners and other non-MEP speakers through plenary timelines, repeat appearances, speeches and linked dossiers.

See the [project vision](VISION.md) for the proof of concept’s purpose, approach to public data and future directions.

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

For full-text search, add `CORPUS_ENABLED=true CORPUS_DIR="$PWD/var/corpus"`. A background worker stores speech texts and question/answer texts in `corpus-v1.sqlite`, searchable through `/api/poc/corpus/search` and joined read-only to the activity index; `/api/poc/corpus/status` reports coverage. It pauses at `CORPUS_MAX_DISK_MIB`. See [Public data sources](docs/PUBLIC_DATA.md#full-text-corpus).

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
