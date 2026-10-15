# Parliament explorer

Explore Members of the European Parliament, written questions, plenary debates, votes and legislative dossiers. Word clouds lead to the underlying speeches, with the selected words highlighted. Questions can be explored by topic, time and author country. Following MEPs is stored in the browser.

## Run locally

Use Node.js 22.13 or newer and npm.

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

For frontend development, run `npm run dev:api` and `npm run dev` in separate terminals. Following is browser-local and persists across visits to the same origin.

## Checks

```sh
npm test
npm run check
npm run build
```

Tests use public-source examples and temporary stores; they do not need credentials or a running indexer. See [Development](docs/DEVELOPMENT.md) for container usage and checks.

Changes go through pull requests with automated tests and a build. See [Contributing](CONTRIBUTING.md). Application source has no redistribution licence assigned. Public data and included third-party material retain their own terms; see [Third-party notices](THIRD_PARTY_NOTICES.md).
