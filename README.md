# Parliament explorer

Explore Members of the European Parliament, written questions, plenary debates, votes and legislative dossiers. Word clouds lead to the underlying speeches, with the selected words highlighted. Questions can be explored by topic, time and author country. Following MEPs is stored in the browser.

Outside voices follows Commissioners and other non-MEP speakers through plenary timelines, repeat appearances, speeches and linked dossiers. It uses dated MEP membership and the existing activity index, with historical coverage filling in through the same bounded worker.

See the [project vision](VISION.md) for the proof of concept’s purpose, approach to public data and future directions.

## Run locally

Use Node.js 22.15 or newer and npm.

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

When `ODP_CACHE_DIR` is set, requested portraits persist in its `portraits-v1` subdirectory across restarts. Fresh saved images need no profile API or image request. The cache fills on demand and caps image files plus metadata at 128 MiB / 2,048 portraits, removing the oldest saved images as needed. RAM holds at most 8 MiB / 120 portraits. Images refresh after seven days; a saved image stays available during refresh or upstream failure, with failed requests retried after five minutes. Without a writable cache directory, portraits use the bounded RAM cache and a disk failure is logged once. Use one source-cache writer per directory; retain the cache mount when replacing a container.

For frontend development, run `npm run dev:api` and `npm run dev` in separate terminals. Following is browser-local and persists across visits to the same origin.

## Checks

```sh
npm test
npm run check
npm run build
```

Tests use public-source examples and temporary stores; they do not need credentials or a running indexer. See [Development](docs/DEVELOPMENT.md) for container usage and checks.

Changes go through pull requests with automated tests and a build. See [Contributing](CONTRIBUTING.md). Application source has no redistribution licence assigned. Public data and included third-party material retain their own terms; see [Third-party notices](THIRD_PARTY_NOTICES.md).
