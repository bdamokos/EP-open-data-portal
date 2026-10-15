# Parliament explorer

Use only publicly accessible parliamentary data and transparently documented processing of public websites/documents. Do not add authenticated institutional services, private data exports, copied production caches or secrets. Document each external source in docs/PUBLIC_DATA.md and keep docs/DATA_ACCESS_AUDIT.md accurate.

Preserve exact identifiers, source URLs, retrieval dates, languages and explicit gaps. Do not join records solely by title, tally or name similarity. Keep unavailable observations distinct from zeroes.

Use branches and pull requests for changes. Do not publish the repository, change its visibility or add a source licence without maintainer authorization. Keep cache/index directories and browser following data outside Git.

Use one source writer and one index writer. Keep site-specific routing, service configuration, host addresses, credentials and deployment records outside this repository. A push or health check is not user-visible acceptance. Verify the exact live revision and user path; preserve the accepted runtime and data while testing a candidate.

Run npm test, npm run check and npm run build for structural changes. Verify changed UI flows in the browser at mobile and desktop widths. Avoid cold corpus downloads during tests and preserve incomplete-coverage labels.
